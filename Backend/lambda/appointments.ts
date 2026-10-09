import { GetCommand, TransactWriteCommand, BatchGetCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, isTransactionCanceled, queryAll, requireRole, getUser, isConditionFailed } from './lib/db';
import { requireString, requireEnum } from './lib/validation';
import { getAmount, HOLD_EXPIRY_MINUTES, MAX_PENDING_HOLDS_PER_PATIENT, MAX_VISIT_NOTE_CHARS, PATIENT_RESCHEDULE_CUTOFF_HOURS } from './lib/constants';
import { sendNotification } from './lib/notify';
import { releaseSlot, releaseTablesFromEnv } from './lib/waitlist';
import { HOSPITAL_STAFF_ROLES, requireAnyRole } from './lib/guards';
import { routes } from './lib/router';

// A booking from start to finish, and the waitlist that feeds freed slots back into it.

// ------------------------------------------------------------------ book-appointment
export const bookAppointment = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const hospitalId = requireString(body, 'hospitalId', { max: 64 });
  const slotId = requireString(body, 'slotId', { max: 64 });
  const patientId = callerId(event);
  await requireRole(patientId, 'PATIENT');

  const slot = (
    await ddb.send(new GetCommand({ TableName: process.env.AVAILABILITY_TABLE_NAME, Key: { hospitalId, slotId } }))
  ).Item;
  if (!slot || slot.status !== 'APPROVED') throw new HttpError(409, 'Slot is not available');
  if (slot.startTime <= new Date().toISOString()) throw new HttpError(409, 'This slot has already started');

  // The consultation type (and therefore the fee) is fixed by the slot, never by the client.
  const consultationType = slot.consultationType || 'GENERAL';

  // An optional note on what the patient is coming in for. Only the patient and the doctor can read it
  // (my-appointments leaves it out for everybody else), and only specialist visits have one.
  if (body.note !== undefined && typeof body.note !== 'string') throw new HttpError(400, 'note must be text');
  const note = (body.note ?? '').trim();
  if (note.length > MAX_VISIT_NOTE_CHARS) {
    throw new HttpError(400, `note must be at most ${MAX_VISIT_NOTE_CHARS} characters`);
  }
  if (note && consultationType !== 'SPECIALIST') {
    throw new HttpError(400, 'A note can only be added to a specialist appointment');
  }

  const upcoming = await queryAll({
    TableName: process.env.APPOINTMENTS_TABLE_NAME,
    IndexName: 'patient-index',
    KeyConditionExpression: 'patientId = :p AND startTime >= :now',
    FilterExpression: '#s IN (:pending, :confirmed)',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':p': patientId,
      ':now': new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
      ':pending': 'PENDING_PAYMENT',
      ':confirmed': 'CONFIRMED',
    },
  });

  // Stops one patient from locking many slots by letting unpaid holds expire.
  if (upcoming.filter((a) => a.status === 'PENDING_PAYMENT').length >= MAX_PENDING_HOLDS_PER_PATIENT) {
    throw new HttpError(429, 'You have too many unpaid bookings. Complete or wait out a pending payment first.');
  }
  if (upcoming.some((a) => a.startTime < slot.endTime && a.endTime > slot.startTime)) {
    throw new HttpError(409, 'You already have an appointment that overlaps this slot');
  }

  const appointmentId = randomUUID();
  const now = new Date();

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: process.env.AVAILABILITY_TABLE_NAME,
              Key: { hospitalId, slotId },
              UpdateExpression: 'SET #s = :booked',
              ConditionExpression: '#s = :approved',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: { ':booked': 'BOOKED', ':approved': 'APPROVED' },
            },
          },
          {
            Put: {
              TableName: process.env.APPOINTMENTS_TABLE_NAME,
              Item: {
                appointmentId,
                itemType: 'METADATA',
                patientId,
                doctorId: slot.doctorId,
                hospitalId,
                slotId,
                consultationType,
                specialtyId: slot.specialtyId,
                fee: getAmount(consultationType),
                status: 'PENDING_PAYMENT',
                startTime: slot.startTime,
                endTime: slot.endTime,
                ...(note ? { note } : {}),
                createdAt: now.toISOString(),
              },
            },
          },
        ],
      })
    );
  } catch (err) {
    if (isTransactionCanceled(err)) throw new HttpError(409, 'Slot was just taken by someone else');
    throw err;
  }

  return respond(200, {
    appointmentId,
    status: 'PENDING_PAYMENT',
    amount: getAmount(consultationType),
    payBefore: new Date(now.getTime() + HOLD_EXPIRY_MINUTES * 60 * 1000).toISOString(),
  });
});

// ------------------------------------------------------------------ my-appointments
// Appointments of the signed-in user, oldest first. Patients see their own, doctors the ones booked
// with them, hospital admins and staff everything at their hospital. Optional ?status= filter.
// Each item carries display names so the client does not need a user directory.
export const myAppointments = withErrorHandling(async (event) => {
  const user = await getUser(callerId(event));
  if (!user) throw new HttpError(403, 'Not authorized');

  const status = event.queryStringParameters?.status;
  const index =
    user.role === 'PATIENT'
      ? { name: 'patient-index', key: 'patientId', value: user.userId }
      : user.role === 'DOCTOR'
        ? { name: 'doctor-index', key: 'doctorId', value: user.userId }
        : user.role === 'HOSPITAL_ADMIN' || user.role === 'STAFF'
          ? { name: 'hospital-index', key: 'hospitalId', value: user.hospitalId }
          : undefined;
  if (!index) throw new HttpError(403, 'Not authorized');

  const appointments = await queryAll({
    TableName: process.env.APPOINTMENTS_TABLE_NAME,
    IndexName: index.name,
    KeyConditionExpression: `${index.key} = :k`,
    ...(status ? { FilterExpression: '#s = :status', ExpressionAttributeNames: { '#s': 'status' } } : {}),
    ExpressionAttributeValues: { ':k': index.value, ...(status ? { ':status': status } : {}) },
  });

  const userIds = [...new Set(appointments.flatMap((a) => [a.patientId, a.doctorId]).filter(Boolean))];
  const names = new Map<string, string>();
  for (let i = 0; i < userIds.length; i += 100) {
    const result = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [process.env.USERS_TABLE_NAME!]: {
            Keys: userIds.slice(i, i + 100).map((userId) => ({ userId })),
            ProjectionExpression: 'userId, firstName, lastName',
          },
        },
      })
    );
    for (const u of result.Responses?.[process.env.USERS_TABLE_NAME!] || []) {
      names.set(u.userId, `${u.firstName} ${u.lastName}`);
    }
  }

  const hospitalNames = new Map<string, string>();
  for (const hospitalId of new Set(appointments.map((a) => a.hospitalId))) {
    const hospital = (
      await ddb.send(
        new GetCommand({ TableName: process.env.HOSPITALS_TABLE_NAME, Key: { hospitalId, itemType: 'PROFILE' } })
      )
    ).Item;
    if (hospital) hospitalNames.set(hospitalId, hospital.name);
  }

  return respond(200, {
    appointments: appointments
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map(({ note, ...a }) => ({
        ...a,
        // the patient's note on why they are coming is private to the patient and their doctor
        ...(note && ['PATIENT', 'DOCTOR'].includes(user.role) ? { note } : {}),
        patientName: names.get(a.patientId),
        doctorName: names.get(a.doctorId),
        hospitalName: hospitalNames.get(a.hospitalId),
      })),
  });
});

// ------------------------------------------------------------------ process-payment
// MOCK payment provider. Replace with a real checkout + verified provider callback before production.
// `simulateOutcome` is a testing hook and is only honoured when ALLOW_PAYMENT_SIMULATION=true.
const SIMULATION_ENABLED = process.env.ALLOW_PAYMENT_SIMULATION === 'true';

export const processPayment = withErrorHandling(async (event) => {
  if (!SIMULATION_ENABLED) {
    throw new HttpError(501, 'No payment provider is configured');
  }

  const body = parseBody(event);
  const appointmentId = requireString(body, 'appointmentId', { max: 64 });
  const outcome = body.simulateOutcome ?? 'SUCCESS';
  if (outcome !== 'SUCCESS' && outcome !== 'FAILED') {
    throw new HttpError(400, 'simulateOutcome must be SUCCESS or FAILED');
  }
  const patientId = callerId(event);

  const appointment = (
    await ddb.send(
      new GetCommand({
        TableName: process.env.APPOINTMENTS_TABLE_NAME,
        Key: { appointmentId, itemType: 'METADATA' },
      })
    )
  ).Item;
  if (!appointment) throw new HttpError(404, 'Appointment not found');
  if (appointment.patientId !== patientId) throw new HttpError(403, 'Not authorized');
  if (appointment.status !== 'PENDING_PAYMENT') throw new HttpError(409, 'Appointment is not awaiting payment');
  if (Date.now() > new Date(appointment.createdAt).getTime() + HOLD_EXPIRY_MINUTES * 60 * 1000) {
    throw new HttpError(409, 'The payment window for this booking has expired');
  }

  const paymentId = randomUUID();
  const amount = getAmount(appointment.consultationType);
  const now = new Date().toISOString();
  const paymentItem = {
    TableName: process.env.APPOINTMENTS_TABLE_NAME,
    Item: {
      appointmentId,
      itemType: 'PAYMENT',
      paymentId,
      amount,
      paymentStatus: outcome,
      provider: 'MOCK_MTN',
      transactionRef: paymentId,
      createdAt: now,
      updatedAt: now,
    },
  };
  const appointmentKey = { appointmentId, itemType: 'METADATA' };
  const moveFromPending = (to: string) => ({
    Update: {
      TableName: process.env.APPOINTMENTS_TABLE_NAME,
      Key: appointmentKey,
      UpdateExpression: 'SET #s = :to',
      ConditionExpression: '#s = :pending', // loses cleanly against the hold-expiry job
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':to': to, ':pending': 'PENDING_PAYMENT' },
    },
  });

  try {
    if (outcome === 'SUCCESS') {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            moveFromPending('CONFIRMED'),
            {
              ConditionCheck: {
                TableName: process.env.AVAILABILITY_TABLE_NAME,
                Key: { hospitalId: appointment.hospitalId, slotId: appointment.slotId },
                ConditionExpression: '#s = :booked',
                ExpressionAttributeNames: { '#s': 'status' },
                ExpressionAttributeValues: { ':booked': 'BOOKED' },
              },
            },
            { Put: paymentItem },
          ],
        })
      );
    } else {
      const slot = (
        await ddb.send(
          new GetCommand({
            TableName: process.env.AVAILABILITY_TABLE_NAME,
            Key: { hospitalId: appointment.hospitalId, slotId: appointment.slotId },
          })
        )
      ).Item;
      const baseItems = [moveFromPending('CANCELLED'), { Put: paymentItem }];
      if (slot) {
        await releaseSlot(
          ddb,
          releaseTablesFromEnv(),
          {
            hospitalId: appointment.hospitalId,
            slotId: appointment.slotId,
            doctorId: slot.doctorId,
            specialtyId: slot.specialtyId,
            startTime: slot.startTime,
          },
          { fromStatus: 'BOOKED', baseItems }
        );
      } else {
        await ddb.send(new TransactWriteCommand({ TransactItems: baseItems }));
      }
    }
  } catch (err) {
    if (isTransactionCanceled(err)) {
      throw new HttpError(409, 'The booking changed while the payment was processed (it may have expired)');
    }
    throw err;
  }

  const notifications = process.env.NOTIFICATIONS_TABLE_NAME!;
  await sendNotification(ddb, notifications, {
    recipientId: appointment.patientId,
    channels: ['EMAIL', 'SMS'],
    type: 'PAYMENT_RESULT',
    payload: { appointmentId, paymentStatus: outcome, amount },
  });
  if (outcome === 'SUCCESS') {
    await sendNotification(ddb, notifications, {
      recipientId: appointment.patientId,
      channels: ['EMAIL', 'SMS'],
      type: 'BOOKING_CONFIRMATION',
      payload: { appointmentId, startTime: appointment.startTime },
    });
  }

  return respond(200, { appointmentId, paymentStatus: outcome, amount });
});

// ------------------------------------------------------------------ cancel-appointment
export const cancelAppointment = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const appointmentId = requireString(body, 'appointmentId', { max: 64 });
  const patientId = callerId(event);

  const appointment = (
    await ddb.send(
      new GetCommand({ TableName: process.env.APPOINTMENTS_TABLE_NAME, Key: { appointmentId, itemType: 'METADATA' } })
    )
  ).Item;
  if (!appointment) throw new HttpError(404, 'Appointment not found');
  if (appointment.patientId !== patientId) throw new HttpError(403, 'Not authorized');
  if (appointment.status !== 'CONFIRMED') {
    throw new HttpError(409, 'Only a confirmed appointment can be cancelled');
  }
  if (appointment.startTime <= new Date().toISOString()) {
    throw new HttpError(409, 'An appointment that has already started cannot be cancelled');
  }

  const slot = (
    await ddb.send(
      new GetCommand({
        TableName: process.env.AVAILABILITY_TABLE_NAME,
        Key: { hospitalId: appointment.hospitalId, slotId: appointment.slotId },
      })
    )
  ).Item;

  const cancelItem = {
    Update: {
      TableName: process.env.APPOINTMENTS_TABLE_NAME,
      Key: { appointmentId, itemType: 'METADATA' },
      UpdateExpression: 'SET #s = :cancelled',
      ConditionExpression: '#s = :confirmed',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':cancelled': 'CANCELLED', ':confirmed': 'CONFIRMED' },
    },
  };

  try {
    if (slot) {
      // Cancels and frees the slot (straight to the next waiting patient if any) in one transaction.
      await releaseSlot(
        ddb,
        releaseTablesFromEnv(),
        {
          hospitalId: appointment.hospitalId,
          slotId: appointment.slotId,
          doctorId: slot.doctorId,
          specialtyId: slot.specialtyId,
          startTime: slot.startTime,
        },
        { fromStatus: 'BOOKED', baseItems: [cancelItem] }
      );
    } else {
      await ddb.send(new TransactWriteCommand({ TransactItems: [cancelItem] }));
    }
  } catch (err) {
    if (isTransactionCanceled(err)) throw new HttpError(409, 'The appointment changed, please refresh and retry');
    throw err;
  }

  await sendNotification(ddb, process.env.NOTIFICATIONS_TABLE_NAME!, {
    recipientId: appointment.patientId,
    channels: ['EMAIL', 'SMS'],
    type: 'CANCELLATION',
    payload: { appointmentId, startTime: appointment.startTime },
  });

  return respond(200, { appointmentId, status: 'CANCELLED' });
});

// ------------------------------------------------------------------ check-in-appointment
/** How long before its start time a patient may be checked in. */
export const CHECK_IN_EARLY_MINUTES = 120;

// Hospital staff (or the hospital admin): the patient has arrived and signed in at the hospital. A confirmed
// appointment becomes ARRIVED; the doctor marks it COMPLETED once the consultation is over.
export const checkInAppointment = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const appointmentId = requireString(body, 'appointmentId', { max: 64 });
  const caller = await requireAnyRole(callerId(event), HOSPITAL_STAFF_ROLES);

  const appointment = (
    await ddb.send(
      new GetCommand({ TableName: process.env.APPOINTMENTS_TABLE_NAME, Key: { appointmentId, itemType: 'METADATA' } })
    )
  ).Item;
  if (!appointment) throw new HttpError(404, 'Appointment not found');
  if (appointment.hospitalId !== caller.hospitalId) throw new HttpError(403, 'Not authorized for this hospital');
  if (appointment.status === 'ARRIVED') throw new HttpError(409, 'This patient is already checked in');
  if (appointment.status !== 'CONFIRMED') {
    throw new HttpError(409, 'Only a confirmed appointment can be checked in');
  }

  const now = Date.now();
  if (new Date(appointment.startTime).getTime() - CHECK_IN_EARLY_MINUTES * 60_000 > now) {
    throw new HttpError(409, `Patients can be checked in from ${CHECK_IN_EARLY_MINUTES / 60} hours before the appointment`);
  }
  if (new Date(appointment.endTime).getTime() < now) {
    throw new HttpError(409, 'This appointment time has already passed');
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: process.env.APPOINTMENTS_TABLE_NAME,
        Key: { appointmentId, itemType: 'METADATA' },
        UpdateExpression: 'SET #s = :arrived, arrivedAt = :now, checkedInBy = :by',
        ConditionExpression: '#s = :confirmed',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':arrived': 'ARRIVED',
          ':confirmed': 'CONFIRMED',
          ':now': new Date(now).toISOString(),
          ':by': caller.userId,
        },
      })
    );
  } catch (err) {
    if (isConditionFailed(err)) throw new HttpError(409, 'The appointment changed, please refresh and retry');
    throw err;
  }

  return respond(200, { appointmentId, status: 'ARRIVED' });
});

// ------------------------------------------------------------------ complete-appointment
// The doctor ends the consultation: an appointment whose patient has arrived becomes COMPLETED. Only then can
// the doctor write the session notes and the patient review the doctor.
export const completeAppointment = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const appointmentId = requireString(body, 'appointmentId', { max: 64 });
  const doctor = await requireRole(callerId(event), 'DOCTOR');

  const appointment = (
    await ddb.send(
      new GetCommand({ TableName: process.env.APPOINTMENTS_TABLE_NAME, Key: { appointmentId, itemType: 'METADATA' } })
    )
  ).Item;
  if (!appointment || appointment.doctorId !== doctor.userId) throw new HttpError(403, 'Not authorized');
  if (appointment.status !== 'ARRIVED') {
    throw new HttpError(409, 'The patient must be checked in at the hospital before the session can be completed');
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: process.env.APPOINTMENTS_TABLE_NAME,
        Key: { appointmentId, itemType: 'METADATA' },
        UpdateExpression: 'SET #s = :completed, completedAt = :now',
        ConditionExpression: '#s = :arrived',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':completed': 'COMPLETED', ':arrived': 'ARRIVED', ':now': new Date().toISOString() },
      })
    );
  } catch (err) {
    if (isConditionFailed(err)) throw new HttpError(409, 'The appointment changed, please refresh and retry');
    throw err;
  }

  // Invites the patient to review the doctor, now that they can.
  await sendNotification(ddb, process.env.NOTIFICATIONS_TABLE_NAME!, {
    recipientId: appointment.patientId,
    channels: ['EMAIL'],
    type: 'SESSION_COMPLETED',
    payload: { appointmentId, startTime: appointment.startTime },
  });

  return respond(200, { appointmentId, status: 'COMPLETED' });
});

// ------------------------------------------------------------------ reschedule-appointment
export const rescheduleAppointment = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const appointmentId = requireString(body, 'appointmentId', { max: 64 });
  const newHospitalId = requireString(body, 'newHospitalId', { max: 64 });
  const newSlotId = requireString(body, 'newSlotId', { max: 64 });
  const caller = callerId(event);

  const appointment = (
    await ddb.send(
      new GetCommand({ TableName: process.env.APPOINTMENTS_TABLE_NAME, Key: { appointmentId, itemType: 'METADATA' } })
    )
  ).Item;
  if (!appointment) throw new HttpError(404, 'Appointment not found');

  const isPatient = appointment.patientId === caller;
  const isDoctor = appointment.doctorId === caller;

  if (isPatient) {
    if (appointment.status === 'MISSED') {
      throw new HttpError(403, 'A missed appointment cannot be rescheduled or refunded');
    }
    if (appointment.status !== 'CONFIRMED') {
      throw new HttpError(403, 'Only a confirmed appointment can be rescheduled');
    }
    const cutoffTime = new Date(appointment.startTime).getTime() - PATIENT_RESCHEDULE_CUTOFF_HOURS * 3600 * 1000;
    if (Date.now() > cutoffTime) {
      throw new HttpError(
        403,
        `Appointments can only be rescheduled more than ${PATIENT_RESCHEDULE_CUTOFF_HOURS} hours before the start time`
      );
    }
  } else if (isDoctor) {
    if (appointment.status === 'COMPLETED') throw new HttpError(403, 'A completed appointment cannot be rescheduled');
    if (appointment.status !== 'CONFIRMED' && appointment.status !== 'MISSED') {
      throw new HttpError(409, 'This appointment cannot be rescheduled from its current state');
    }
  } else {
    throw new HttpError(403, 'Not authorized');
  }

  if (newHospitalId === appointment.hospitalId && newSlotId === appointment.slotId) {
    throw new HttpError(400, 'The new slot must differ from the current one');
  }

  const newSlot = (
    await ddb.send(
      new GetCommand({
        TableName: process.env.AVAILABILITY_TABLE_NAME,
        Key: { hospitalId: newHospitalId, slotId: newSlotId },
      })
    )
  ).Item;
  if (!newSlot || newSlot.status !== 'APPROVED') throw new HttpError(409, 'New slot is not available');
  if (newSlot.startTime <= new Date().toISOString()) throw new HttpError(409, 'New slot has already started');
  // No payment flow exists for a fee difference, so the consultation type must stay the same.
  if ((newSlot.consultationType || 'GENERAL') !== (appointment.consultationType || 'GENERAL')) {
    throw new HttpError(409, 'The new slot has a different consultation type (and fee)');
  }

  const oldSlot = (
    await ddb.send(
      new GetCommand({
        TableName: process.env.AVAILABILITY_TABLE_NAME,
        Key: { hospitalId: appointment.hospitalId, slotId: appointment.slotId },
      })
    )
  ).Item;
  const oldPayment = (
    await ddb.send(
      new GetCommand({ TableName: process.env.APPOINTMENTS_TABLE_NAME, Key: { appointmentId, itemType: 'PAYMENT' } })
    )
  ).Item;

  const newAppointmentId = randomUUID();
  const now = new Date().toISOString();
  const baseItems: any[] = [
    {
      Update: {
        TableName: process.env.APPOINTMENTS_TABLE_NAME,
        Key: { appointmentId, itemType: 'METADATA' },
        UpdateExpression: 'SET #s = :rescheduled, rescheduledTo = :newId',
        ConditionExpression: '#s = :current',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':rescheduled': 'RESCHEDULED', ':current': appointment.status, ':newId': newAppointmentId },
      },
    },
    {
      Update: {
        TableName: process.env.AVAILABILITY_TABLE_NAME,
        Key: { hospitalId: newHospitalId, slotId: newSlotId },
        UpdateExpression: 'SET #s = :booked',
        ConditionExpression: '#s = :approved',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':booked': 'BOOKED', ':approved': 'APPROVED' },
      },
    },
    {
      Put: {
        TableName: process.env.APPOINTMENTS_TABLE_NAME,
        Item: {
          appointmentId: newAppointmentId,
          itemType: 'METADATA',
          patientId: appointment.patientId,
          doctorId: newSlot.doctorId,
          hospitalId: newHospitalId,
          slotId: newSlotId,
          consultationType: appointment.consultationType || 'GENERAL',
          specialtyId: newSlot.specialtyId,
          fee: appointment.fee,
          status: 'CONFIRMED',
          startTime: newSlot.startTime,
          endTime: newSlot.endTime,
          rescheduledFrom: appointmentId,
          ...(appointment.note ? { note: appointment.note } : {}),
          createdAt: now,
        },
      },
    },
  ];
  // Carry the payment over so the new appointment stays traceable for refunds and audits.
  if (oldPayment) {
    baseItems.push({
      Put: {
        TableName: process.env.APPOINTMENTS_TABLE_NAME,
        Item: { ...oldPayment, appointmentId: newAppointmentId, carriedOverFrom: appointmentId, updatedAt: now },
      },
    });
  }

  // Free the old slot only if it is still booked and in the future (a missed, past slot stays closed).
  const releaseOld = oldSlot && oldSlot.status === 'BOOKED' && oldSlot.startTime > now;

  try {
    if (releaseOld) {
      await releaseSlot(
        ddb,
        releaseTablesFromEnv(),
        {
          hospitalId: appointment.hospitalId,
          slotId: appointment.slotId,
          doctorId: oldSlot.doctorId,
          specialtyId: oldSlot.specialtyId,
          startTime: oldSlot.startTime,
        },
        { fromStatus: 'BOOKED', baseItems }
      );
    } else {
      await ddb.send(new TransactWriteCommand({ TransactItems: baseItems }));
    }
  } catch (err) {
    if (isTransactionCanceled(err)) throw new HttpError(409, 'New slot was just taken, or the appointment changed');
    throw err;
  }

  await sendNotification(ddb, process.env.NOTIFICATIONS_TABLE_NAME!, {
    recipientId: appointment.patientId,
    channels: ['EMAIL', 'SMS'],
    type: 'RESCHEDULE',
    payload: { oldAppointmentId: appointmentId, newAppointmentId, startTime: newSlot.startTime },
  });

  return respond(200, { oldAppointmentId: appointmentId, newAppointmentId });
});

// ------------------------------------------------------------------ join-waitlist
const PREFERENCE_TYPES = ['HOSPITAL', 'SPECIALTY', 'DOCTOR'] as const;

const SLOT_QUERIES = {
  DOCTOR: (id: string) => ({
    IndexName: 'doctor-index',
    KeyConditionExpression: 'doctorId = :id AND startTime >= :now',
    values: { ':id': id },
  }),
  SPECIALTY: (id: string) => ({
    IndexName: 'specialty-index',
    KeyConditionExpression: 'specialtyId = :id AND startTime >= :now',
    values: { ':id': id },
  }),
  HOSPITAL: (id: string) => ({
    IndexName: 'hospital-time-index',
    KeyConditionExpression: 'hospitalId = :id AND startTime >= :now',
    values: { ':id': id },
  }),
};

export const joinWaitlist = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const preferenceType = requireEnum(body, 'preferenceType', PREFERENCE_TYPES);
  const targetField = { DOCTOR: 'doctorId', SPECIALTY: 'specialtyId', HOSPITAL: 'hospitalId' }[preferenceType];
  const targetId = requireString(body, targetField, { max: 64 });
  const patientId = callerId(event);

  // Waitlisting only makes sense when nothing matching is bookable right now.
  const query = SLOT_QUERIES[preferenceType](targetId);
  const openSlots = await queryAll({
    TableName: process.env.AVAILABILITY_TABLE_NAME,
    IndexName: query.IndexName,
    KeyConditionExpression: query.KeyConditionExpression,
    FilterExpression: '#s = :approved',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ...query.values, ':now': new Date().toISOString(), ':approved': 'APPROVED' },
  });
  if (openSlots.length > 0) {
    throw new HttpError(409, `This ${preferenceType.toLowerCase()} already has available slots, please book directly instead`);
  }

  const matchKey = `${preferenceType}#${targetId}`;

  const mine = await queryAll({
    TableName: process.env.WAITLIST_TABLE_NAME,
    KeyConditionExpression: 'patientId = :p',
    FilterExpression: 'matchKey = :m AND #s IN (:waiting, :offered)',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':p': patientId, ':m': matchKey, ':waiting': 'WAITING', ':offered': 'OFFERED' },
  });
  if (mine.length > 0) throw new HttpError(409, 'You are already on this waitlist');

  const waitlistId = randomUUID();
  await ddb.send(
    new PutCommand({
      TableName: process.env.WAITLIST_TABLE_NAME,
      Item: {
        patientId,
        waitlistId,
        preferenceType,
        hospitalId: preferenceType === 'HOSPITAL' ? targetId : null,
        specialtyId: preferenceType === 'SPECIALTY' ? targetId : null,
        doctorId: preferenceType === 'DOCTOR' ? targetId : null,
        matchKey,
        status: 'WAITING',
        createdAt: new Date().toISOString(),
      },
    })
  );

  return respond(200, { waitlistId, status: 'WAITING' });
});

// ------------------------------------------------------------------ claim-waitlist-offer
export const claimWaitlistOffer = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const waitlistId = requireString(body, 'waitlistId', { max: 64 });
  const patientId = callerId(event);

  const entry = (
    await ddb.send(
      new GetCommand({ TableName: process.env.WAITLIST_TABLE_NAME, Key: { patientId, waitlistId } })
    )
  ).Item;
  if (!entry || entry.status !== 'OFFERED') throw new HttpError(409, 'No active offer for this waitlist entry');
  if (new Date(entry.offerExpiresAt).getTime() < Date.now()) throw new HttpError(409, 'Offer has expired');

  const slot = (
    await ddb.send(
      new GetCommand({
        TableName: process.env.AVAILABILITY_TABLE_NAME,
        Key: { hospitalId: entry.hospitalId, slotId: entry.slotId },
      })
    )
  ).Item;
  if (!slot || slot.status !== 'OFFERED' || slot.offeredTo !== patientId) {
    throw new HttpError(409, 'Slot offer is no longer valid');
  }
  if (slot.startTime <= new Date().toISOString()) throw new HttpError(409, 'This slot has already started');

  const appointmentId = randomUUID();
  const consultationType = slot.consultationType || 'GENERAL'; // fee follows the slot, not a hard-coded default
  const now = new Date();

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: process.env.AVAILABILITY_TABLE_NAME,
              Key: { hospitalId: entry.hospitalId, slotId: entry.slotId },
              UpdateExpression: 'SET #s = :booked REMOVE offeredTo, offerExpiresAt',
              ConditionExpression: '#s = :offered AND offeredTo = :patientId',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: { ':booked': 'BOOKED', ':offered': 'OFFERED', ':patientId': patientId },
            },
          },
          {
            Update: {
              TableName: process.env.WAITLIST_TABLE_NAME,
              Key: { patientId, waitlistId },
              UpdateExpression: 'SET #s = :claimed',
              ConditionExpression: '#s = :offered',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: { ':claimed': 'CLAIMED', ':offered': 'OFFERED' },
            },
          },
          {
            Put: {
              TableName: process.env.APPOINTMENTS_TABLE_NAME,
              Item: {
                appointmentId,
                itemType: 'METADATA',
                patientId,
                doctorId: slot.doctorId,
                hospitalId: entry.hospitalId,
                slotId: entry.slotId,
                consultationType,
                specialtyId: slot.specialtyId,
                fee: getAmount(consultationType),
                status: 'PENDING_PAYMENT',
                startTime: slot.startTime,
                endTime: slot.endTime,
                createdAt: now.toISOString(),
              },
            },
          },
        ],
      })
    );
  } catch (err) {
    if (isTransactionCanceled(err)) throw new HttpError(409, 'Could not claim the slot, it may have changed');
    throw err;
  }

  return respond(200, {
    appointmentId,
    status: 'PENDING_PAYMENT',
    amount: getAmount(consultationType),
    payBefore: new Date(now.getTime() + HOLD_EXPIRY_MINUTES * 60 * 1000).toISOString(),
  });
});

// ------------------------------------------------------------------ my-waitlist
// The signed-in patient's waitlist entries (any status), oldest first.
export const myWaitlist = withErrorHandling(async (event) => {
  const entries = await queryAll({
    TableName: process.env.WAITLIST_TABLE_NAME,
    KeyConditionExpression: 'patientId = :p',
    ExpressionAttributeValues: { ':p': callerId(event) },
  });

  return respond(200, { entries: entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
});

export const handler = routes({
  'POST /appointments/book': bookAppointment,
  'GET /appointments/mine': myAppointments,
  'POST /appointments/pay': processPayment,
  'POST /appointments/cancel': cancelAppointment,
  'POST /appointments/check-in': checkInAppointment,
  'POST /appointments/complete': completeAppointment,
  'POST /appointments/reschedule': rescheduleAppointment,
  'POST /waitlist/join': joinWaitlist,
  'POST /waitlist/claim': claimWaitlistOffer,
  'GET /waitlist/mine': myWaitlist,
});
