import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, queryAll } from './lib/db';
import { releaseSlot, releaseTablesFromEnv } from './lib/waitlist';
import { HOLD_EXPIRY_MINUTES } from './lib/constants';

export const handler = async () => {
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
