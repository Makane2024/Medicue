import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, isConditionFailed, queryAll } from './lib/db';
import { releaseSlot, releaseTablesFromEnv } from './lib/waitlist';

export const handler = async () => {
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
