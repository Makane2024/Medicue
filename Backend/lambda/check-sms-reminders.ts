import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, queryAll } from './lib/db';
import { sendNotification } from './lib/notify';

const REMINDER_MINUTES_BEFORE = 30;

export const handler = async () => {
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
