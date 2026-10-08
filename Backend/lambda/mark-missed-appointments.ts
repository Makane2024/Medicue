import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, isConditionFailed, queryAll } from './lib/db';
import { sendNotification } from './lib/notify';

// A confirmed session that the hospital never marked COMPLETED this long after it ended counts as missed.
const GRACE_MINUTES = 120;
const LOOKBACK_HOURS = 48;

export const handler = async () => {
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
