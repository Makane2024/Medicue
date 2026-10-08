import { BatchWriteCommand, DeleteCommand, GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, isTransactionCanceled, queryAll } from './db';
import { deleteCognitoUser } from './cognito';
import { sendNotification } from './notify';
import { releaseSlot, releaseTablesFromEnv } from './waitlist';

// Cascading removal of accounts and hospitals. Every step is idempotent, so a request that fails halfway
// can simply be sent again. Medical notes are deliberately never touched: they are medical records and
// only the two medical-note functions have access to that table.

const ACTIVE_APPOINTMENT = ['CONFIRMED', 'PENDING_PAYMENT'];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function batchDelete(table: string, keys: Record<string, any>[]) {
  for (let i = 0; i < keys.length; i += 25) {
    let pending: Record<string, any> = {
      [table]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })),
    };
    for (let attempt = 0; attempt < 5 && Object.keys(pending).length > 0; attempt++) {
      if (attempt > 0) await sleep(100 * 2 ** attempt);
      pending = (await ddb.send(new BatchWriteCommand({ RequestItems: pending }))).UnprocessedItems ?? {};
    }
    if (Object.keys(pending).length > 0) throw new Error(`Could not delete all items from ${table}`);
  }
}

/** Appointments that have not started yet and are still live (awaiting payment or confirmed). */
const upcoming = (appointments: Record<string, any>[]) => {
  const now = new Date().toISOString();
  return appointments.filter((a) => ACTIVE_APPOINTMENT.includes(a.status) && a.startTime > now);
};

const cancelItem = (appointmentId: string) => ({
  Update: {
    TableName: process.env.APPOINTMENTS_TABLE_NAME,
    Key: { appointmentId, itemType: 'METADATA' },
    UpdateExpression: 'SET #s = :cancelled',
    ConditionExpression: '#s IN (:confirmed, :pending)',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':cancelled': 'CANCELLED', ':confirmed': 'CONFIRMED', ':pending': 'PENDING_PAYMENT' },
  },
});

async function notifyCancelled(appointment: Record<string, any>) {
  await sendNotification(ddb, process.env.NOTIFICATIONS_TABLE_NAME!, {
    recipientId: appointment.patientId,
    channels: ['EMAIL', 'SMS'],
    type: 'CANCELLATION',
    payload: { appointmentId: appointment.appointmentId, startTime: appointment.startTime },
  });
}

/**
 * Cancels upcoming appointments whose slot is going to be deleted anyway (so there is nothing to free) and
 * tells each patient. Returns the cancelled appointments.
 */
async function cancelAndNotify(appointments: Record<string, any>[]) {
  const cancelled: Record<string, any>[] = [];
  for (const appointment of upcoming(appointments)) {
    try {
      await ddb.send(new TransactWriteCommand({ TransactItems: [cancelItem(appointment.appointmentId)] }));
    } catch (err) {
      if (isTransactionCanceled(err)) continue; // already cancelled, paid out or expired
      throw err;
    }
    cancelled.push(appointment);
    await notifyCancelled(appointment);
  }
  return cancelled;
}

/** A waiting patient holds an offer on a slot that is about to disappear: expire the offer. */
async function expireOffer(slot: Record<string, any>) {
  if (slot.status !== 'OFFERED' || !slot.offeredTo) return;
  const entries = await queryAll({
    TableName: process.env.WAITLIST_TABLE_NAME,
    KeyConditionExpression: 'patientId = :p',
    FilterExpression: 'slotId = :s AND #st = :offered',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: { ':p': slot.offeredTo, ':s': slot.slotId, ':offered': 'OFFERED' },
  });
  for (const entry of entries) {
    await ddb.send(
      new UpdateCommand({
        TableName: process.env.WAITLIST_TABLE_NAME,
        Key: { patientId: entry.patientId, waitlistId: entry.waitlistId },
        UpdateExpression: 'SET #st = :expired',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':expired': 'EXPIRED' },
      })
    );
  }
}

/** Deletes slots (expiring any waitlist offer held on them). */
async function deleteSlots(slots: Record<string, any>[]) {
  for (const slot of slots) await expireOffer(slot);
  await batchDelete(
    process.env.AVAILABILITY_TABLE_NAME!,
    slots.map((s) => ({ hospitalId: s.hospitalId, slotId: s.slotId }))
  );
}

async function deleteWaitlistEntriesByMatchKey(matchKey: string) {
  const entries = await queryAll({
    TableName: process.env.WAITLIST_TABLE_NAME,
    IndexName: 'match-index',
    KeyConditionExpression: 'matchKey = :m',
    ExpressionAttributeValues: { ':m': matchKey },
  });
  await batchDelete(
    process.env.WAITLIST_TABLE_NAME!,
    entries.map((e) => ({ patientId: e.patientId, waitlistId: e.waitlistId }))
  );
}

/** Everything a doctor owns: waitlist preferences, open slots, upcoming appointments and affiliations. */
async function removeDoctorFootprint(doctorId: string) {
  await deleteWaitlistEntriesByMatchKey(`DOCTOR#${doctorId}`);

  const appointments = await queryAll({
    TableName: process.env.APPOINTMENTS_TABLE_NAME,
    IndexName: 'doctor-index',
    KeyConditionExpression: 'doctorId = :d',
    ExpressionAttributeValues: { ':d': doctorId },
  });
  const cancelled = await cancelAndNotify(appointments);
  const bookedSlotIds = new Set(cancelled.map((a) => `${a.hospitalId}#${a.slotId}`));

  const slots = await queryAll({
    TableName: process.env.AVAILABILITY_TABLE_NAME,
    IndexName: 'doctor-index',
    KeyConditionExpression: 'doctorId = :d',
    ExpressionAttributeValues: { ':d': doctorId },
  });
  // BOOKED slots of past or finished appointments are history and stay.
  await deleteSlots(slots.filter((s) => s.status !== 'BOOKED' || bookedSlotIds.has(`${s.hospitalId}#${s.slotId}`)));

  await removeAffiliations(doctorId);
}

async function removeAffiliations(doctorId: string, hospitalId?: string) {
  const affiliations = await queryAll({
    TableName: process.env.AFFILIATIONS_TABLE_NAME,
    KeyConditionExpression: 'doctorId = :d',
    ExpressionAttributeValues: { ':d': doctorId },
  });
  await batchDelete(
    process.env.AFFILIATIONS_TABLE_NAME!,
    affiliations.filter((a) => !hospitalId || a.hospitalId === hospitalId).map((a) => ({ doctorId, hospitalId: a.hospitalId }))
  );
}

/** Everything a patient owns that other people depend on: held slots and waitlist entries. */
async function removePatientFootprint(patientId: string) {
  const tables = releaseTablesFromEnv();

  const appointments = await queryAll({
    TableName: process.env.APPOINTMENTS_TABLE_NAME,
    IndexName: 'patient-index',
    KeyConditionExpression: 'patientId = :p',
    ExpressionAttributeValues: { ':p': patientId },
  });
  for (const appointment of upcoming(appointments)) {
    const slot = (
      await ddb.send(
        new GetCommand({
          TableName: process.env.AVAILABILITY_TABLE_NAME,
          Key: { hospitalId: appointment.hospitalId, slotId: appointment.slotId },
        })
      )
    ).Item;
    try {
      if (slot) {
        // Cancels and frees the slot (or hands it to the next waiting patient) in one transaction.
        await releaseSlot(
          ddb,
          tables,
          {
            hospitalId: appointment.hospitalId,
            slotId: appointment.slotId,
            doctorId: slot.doctorId,
            specialtyId: slot.specialtyId,
            startTime: slot.startTime,
          },
          { fromStatus: 'BOOKED', baseItems: [cancelItem(appointment.appointmentId)] }
        );
      } else {
        await ddb.send(new TransactWriteCommand({ TransactItems: [cancelItem(appointment.appointmentId)] }));
      }
    } catch (err) {
      if (!isTransactionCanceled(err)) throw err; // already cancelled or expired meanwhile
    }
  }

  const entries = await queryAll({
    TableName: process.env.WAITLIST_TABLE_NAME,
    KeyConditionExpression: 'patientId = :p',
    ExpressionAttributeValues: { ':p': patientId },
  });
  for (const entry of entries) {
    const deleteEntry = {
      Delete: { TableName: process.env.WAITLIST_TABLE_NAME, Key: { patientId, waitlistId: entry.waitlistId } },
    };
    if (entry.status === 'OFFERED' && entry.slotId) {
      // The patient holds an offer: pass it on to the next person instead of leaving the slot stuck.
      const slot = (
        await ddb.send(
          new GetCommand({
            TableName: process.env.AVAILABILITY_TABLE_NAME,
            Key: { hospitalId: entry.hospitalId, slotId: entry.slotId },
          })
        )
      ).Item;
      if (slot && slot.status === 'OFFERED' && slot.offeredTo === patientId) {
        try {
          await releaseSlot(
            ddb,
            tables,
            {
              hospitalId: entry.hospitalId,
              slotId: entry.slotId,
              doctorId: slot.doctorId,
              specialtyId: slot.specialtyId,
              startTime: slot.startTime,
            },
            { fromStatus: 'OFFERED', expectedOfferedTo: patientId, baseItems: [deleteEntry] }
          );
          continue;
        } catch (err) {
          if (!isTransactionCanceled(err)) throw err;
        }
      }
    }
    await ddb.send(new DeleteCommand({ ...deleteEntry.Delete }));
  }
}

/**
 * Permanently removes an account: its footprint (by role), then the Cognito user, then the profile row.
 * The profile row goes last so a failed attempt can be repeated.
 */
export async function removeAccount(user: Record<string, any>) {
  if (user.role === 'DOCTOR') await removeDoctorFootprint(user.userId);
  else if (user.role === 'PATIENT') await removePatientFootprint(user.userId);

  await deleteCognitoUser(user.email);
  await ddb.send(new DeleteCommand({ TableName: process.env.USERS_TABLE_NAME, Key: { userId: user.userId } }));
}

/** Removes a hospital with its admin, its doctors, its slots and its upcoming appointments. */
export async function removeHospital(hospital: Record<string, any>): Promise<{ doctorsRemoved: number }> {
  const { hospitalId } = hospital;

  const appointments = await queryAll({
    TableName: process.env.APPOINTMENTS_TABLE_NAME,
    IndexName: 'hospital-index',
    KeyConditionExpression: 'hospitalId = :h',
    ExpressionAttributeValues: { ':h': hospitalId },
  });
  await cancelAndNotify(appointments);

  const slots = await queryAll({
    TableName: process.env.AVAILABILITY_TABLE_NAME,
    KeyConditionExpression: 'hospitalId = :h',
    ExpressionAttributeValues: { ':h': hospitalId },
  });
  await deleteSlots(slots);
  await deleteWaitlistEntriesByMatchKey(`HOSPITAL#${hospitalId}`);

  // Doctors who work nowhere else lose their account; the others only lose this affiliation.
  const affiliations = await queryAll({
    TableName: process.env.AFFILIATIONS_TABLE_NAME,
    IndexName: 'hospital-index',
    KeyConditionExpression: 'hospitalId = :h',
    ExpressionAttributeValues: { ':h': hospitalId },
  });
  let doctorsRemoved = 0;
  for (const { doctorId } of affiliations) {
    await removeAffiliations(doctorId, hospitalId);
    const others = await queryAll({
      TableName: process.env.AFFILIATIONS_TABLE_NAME,
      KeyConditionExpression: 'doctorId = :d',
      ExpressionAttributeValues: { ':d': doctorId },
    });
    if (others.length > 0) continue;
    const doctor = (await ddb.send(new GetCommand({ TableName: process.env.USERS_TABLE_NAME, Key: { userId: doctorId } })))
      .Item;
    if (doctor) {
      await removeAccount(doctor);
      doctorsRemoved++;
    }
  }

  if (hospital.adminUserId) {
    const admin = (
      await ddb.send(new GetCommand({ TableName: process.env.USERS_TABLE_NAME, Key: { userId: hospital.adminUserId } }))
    ).Item;
    if (admin) await removeAccount(admin);
  }

  const items = await queryAll({
    TableName: process.env.HOSPITALS_TABLE_NAME,
    KeyConditionExpression: 'hospitalId = :h',
    ExpressionAttributeValues: { ':h': hospitalId },
  });
  await batchDelete(
    process.env.HOSPITALS_TABLE_NAME!,
    items.map((i) => ({ hospitalId, itemType: i.itemType }))
  );

  return { doctorsRemoved };
}
