import { UpdateCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, queryAll, isConditionFailed } from './lib/db';
import { sendNotification } from './lib/notify';
import { releaseSlot, releaseTablesFromEnv } from './lib/waitlist';
import { HOLD_EXPIRY_MINUTES } from './lib/constants';
import { jobs } from './lib/router';

// Every EventBridge schedule in lib/api-stack.ts targets this Lambda with `{ job: '<name>' }`.

// ------------------------------------------------------------------ check-email-reminders
const REMINDER_HOURS_BEFORE = 48; // 2 days

export const checkEmailReminders = async () => {
  // The window reaches back to "now" rather than just the last hour, so a skipped or delayed run does
  // not lose reminders; the emailReminderSent flag prevents duplicates.
  const now = new Date().toISOString();
  const windowEnd = new Date(Date.now() + REMINDER_HOURS_BEFORE * 60 * 60 * 1000).toISOString();

  const appointments = await queryAll({
    TableName: process.env.APPOINTMENTS_TABLE_NAME,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :confirmed AND startTime BETWEEN :start AND :end',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':confirmed': 'CONFIRMED', ':start': now, ':end': windowEnd },
  });

  for (const appointment of appointments) {
    if (appointment.emailReminderSent) continue;

    try {
      await sendNotification(ddb, process.env.NOTIFICATIONS_TABLE_NAME!, {
        recipientId: appointment.patientId,
        channels: ['EMAIL'],
        type: 'APPOINTMENT_REMINDER',
        payload: { appointmentId: appointment.appointmentId, startTime: appointment.startTime },
      });

      await ddb.send(
        new UpdateCommand({
          TableName: process.env.APPOINTMENTS_TABLE_NAME,
          Key: { appointmentId: appointment.appointmentId, itemType: 'METADATA' },
          UpdateExpression: 'SET emailReminderSent = :true',
          ExpressionAttributeValues: { ':true': true },
        })
      );
    } catch (err) {
      console.error('Email reminder failed', appointment.appointmentId, err);
    }
  }
};

// ------------------------------------------------------------------ check-sms-reminders
const REMINDER_MINUTES_BEFORE = 30;

export const checkSmsReminders = async () => {
  // Window starts at "now" so a skipped run does not lose reminders; smsReminderSent prevents duplicates.
  const now = new Date().toISOString();
  const windowEnd = new Date(Date.now() + REMINDER_MINUTES_BEFORE * 60 * 1000).toISOString();

  const appointments = await queryAll({
    TableName: process.env.APPOINTMENTS_TABLE_NAME,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :confirmed AND startTime BETWEEN :start AND :end',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':confirmed': 'CONFIRMED', ':start': now, ':end': windowEnd },
  });

  for (const appointment of appointments) {
    if (appointment.smsReminderSent) continue;

    try {
      await sendNotification(ddb, process.env.NOTIFICATIONS_TABLE_NAME!, {
        recipientId: appointment.patientId,
        channels: ['SMS'],
        type: 'APPOINTMENT_REMINDER',
        payload: { appointmentId: appointment.appointmentId, startTime: appointment.startTime },
      });

      await ddb.send(
        new UpdateCommand({
          TableName: process.env.APPOINTMENTS_TABLE_NAME,
          Key: { appointmentId: appointment.appointmentId, itemType: 'METADATA' },
          UpdateExpression: 'SET smsReminderSent = :true',
          ExpressionAttributeValues: { ':true': true },
        })
      );
    } catch (err) {
      console.error('SMS reminder failed', appointment.appointmentId, err);
    }
  }
};

// ------------------------------------------------------------------ release-expired-payment-holds
export const releaseExpiredPaymentHolds = async () => {
  const pending = await queryAll({
    TableName: process.env.APPOINTMENTS_TABLE_NAME,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :pending',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':pending': 'PENDING_PAYMENT' },
  });

  const cutoff = Date.now() - HOLD_EXPIRY_MINUTES * 60 * 1000;

  for (const appointment of pending) {
    if (new Date(appointment.createdAt).getTime() > cutoff) continue; // not expired yet

    // One bad item (e.g. a payment succeeding at this very moment) must not stop the rest of the run.
    try {
      const slot = (
        await ddb.send(
          new GetCommand({
            TableName: process.env.AVAILABILITY_TABLE_NAME,
            Key: { hospitalId: appointment.hospitalId, slotId: appointment.slotId },
          })
        )
      ).Item;

      const expireItem = {
        Update: {
          TableName: process.env.APPOINTMENTS_TABLE_NAME,
          Key: { appointmentId: appointment.appointmentId, itemType: 'METADATA' },
          UpdateExpression: 'SET #s = :expired',
          ConditionExpression: '#s = :pending',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':expired': 'EXPIRED', ':pending': 'PENDING_PAYMENT' },
        },
      };

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
          { fromStatus: 'BOOKED', baseItems: [expireItem] }
        );
      } else {
        await ddb.send(new TransactWriteCommand({ TransactItems: [expireItem] }));
      }
    } catch (err: any) {
      if (err?.name === 'TransactionCanceledException') {
        console.warn('Hold already resolved elsewhere, skipping', appointment.appointmentId);
      } else {
        console.error('Failed to release expired hold', appointment.appointmentId, err);
      }
    }
  }
};

// ------------------------------------------------------------------ release-expired-waitlist-offers
export const releaseExpiredWaitlistOffers = async () => {
  const offered = await queryAll({
    TableName: process.env.WAITLIST_TABLE_NAME,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :offered',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':offered': 'OFFERED' },
  });

  const now = Date.now();

  for (const entry of offered) {
    if (new Date(entry.offerExpiresAt).getTime() > now) continue; // offer still valid

    try {
      const slot = (
        await ddb.send(
          new GetCommand({
            TableName: process.env.AVAILABILITY_TABLE_NAME,
            Key: { hospitalId: entry.hospitalId, slotId: entry.slotId },
          })
        )
      ).Item;

      const expireItem = {
        Update: {
          TableName: process.env.WAITLIST_TABLE_NAME,
          Key: { patientId: entry.patientId, waitlistId: entry.waitlistId },
          UpdateExpression: 'SET #s = :expired',
          ConditionExpression: '#s = :offered',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':expired': 'EXPIRED', ':offered': 'OFFERED' },
        },
      };

      if (slot && slot.status === 'OFFERED' && slot.offeredTo === entry.patientId) {
        // Expires the entry and hands the slot to the next patient (or reopens it) atomically.
        await releaseSlot(
          ddb,
          releaseTablesFromEnv(),
          {
            hospitalId: entry.hospitalId,
            slotId: entry.slotId,
            doctorId: slot.doctorId,
            specialtyId: slot.specialtyId,
            startTime: slot.startTime,
          },
          { fromStatus: 'OFFERED', expectedOfferedTo: entry.patientId, baseItems: [expireItem] }
        );
      } else {
        await ddb.send(new UpdateCommand(expireItem.Update));
      }
    } catch (err: any) {
      if (err?.name === 'TransactionCanceledException' || isConditionFailed(err)) {
        console.warn('Offer already resolved elsewhere, skipping', entry.waitlistId);
      } else {
        console.error('Failed to expire waitlist offer', entry.waitlistId, err);
      }
    }
  }
};

// ------------------------------------------------------------------ mark-missed-appointments
// A confirmed session that the hospital never marked COMPLETED this long after it ended counts as missed.
const GRACE_MINUTES = 120;
const LOOKBACK_HOURS = 48;

export const markMissedAppointments = async () => {
  const now = Date.now();
  const candidates = await queryAll({
    TableName: process.env.APPOINTMENTS_TABLE_NAME,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :confirmed AND startTime BETWEEN :from AND :to',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':confirmed': 'CONFIRMED',
      ':from': new Date(now - LOOKBACK_HOURS * 3600 * 1000).toISOString(),
      ':to': new Date(now).toISOString(),
    },
  });

  for (const appointment of candidates) {
    if (new Date(appointment.endTime).getTime() + GRACE_MINUTES * 60 * 1000 > now) continue;

    try {
      await ddb.send(
        new UpdateCommand({
          TableName: process.env.APPOINTMENTS_TABLE_NAME,
          Key: { appointmentId: appointment.appointmentId, itemType: 'METADATA' },
          UpdateExpression: 'SET #s = :missed, autoMissed = :true',
          ConditionExpression: '#s = :confirmed', // a hospital admin may have just marked it
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':missed': 'MISSED', ':confirmed': 'CONFIRMED', ':true': true },
        })
      );
      await sendNotification(ddb, process.env.NOTIFICATIONS_TABLE_NAME!, {
        recipientId: appointment.patientId,
        channels: ['EMAIL', 'SMS'],
        type: 'MISSED',
        payload: { appointmentId: appointment.appointmentId, startTime: appointment.startTime },
      });
    } catch (err) {
      if (isConditionFailed(err)) continue;
      console.error('Failed to mark appointment missed', appointment.appointmentId, err);
    }
  }
};

export const handler = jobs({
  'email-reminders': checkEmailReminders,
  'sms-reminders': checkSmsReminders,
  'release-payment-holds': releaseExpiredPaymentHolds,
  'release-waitlist-offers': releaseExpiredWaitlistOffers,
  'mark-missed': markMissedAppointments,
});
