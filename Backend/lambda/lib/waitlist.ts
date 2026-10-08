import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { sendNotification } from './notify';
import { OFFER_CLAIM_MINUTES } from './constants';
import { isTransactionCanceled, queryAll } from './db';

const MAX_OFFER_ATTEMPTS = 10;

export interface SlotRef {
  hospitalId: string;
  slotId: string;
  doctorId: string;
  specialtyId: string;
  startTime?: string;
}

export interface ReleaseTables {
  waitlist: string;
  availability: string;
  notifications: string;
}

/** Waiting patients for a freed slot: most specific preference first, FIFO within a preference. */
async function findCandidates(waitlistTable: string, slot: SlotRef) {
  const matchKeys = [`DOCTOR#${slot.doctorId}`, `SPECIALTY#${slot.specialtyId}`, `HOSPITAL#${slot.hospitalId}`];
  const candidates: Record<string, any>[] = [];
  for (const matchKey of matchKeys) {
    const items = await queryAll({
      TableName: waitlistTable,
      IndexName: 'match-index',
      KeyConditionExpression: 'matchKey = :matchKey',
      FilterExpression: '#s = :waiting',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':matchKey': matchKey, ':waiting': 'WAITING' },
    });
    candidates.push(...items.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }
  return candidates;
}

/**
 * Frees a slot that currently has status `fromStatus` in ONE transaction together with the caller's
 * own writes (`baseItems`, e.g. cancelling the appointment). If a patient is waiting, the slot goes
 * straight to OFFERED for them and never becomes publicly bookable in between; otherwise it returns to
 * APPROVED. Every write is conditional, so a concurrent change aborts the transaction (the error is
 * re-thrown to the caller) instead of overwriting someone else's state.
 */
export async function releaseSlot(
  dynamoDocClient: DynamoDBDocumentClient,
  tables: ReleaseTables,
  slot: SlotRef,
  opts: { fromStatus: 'BOOKED' | 'OFFERED'; expectedOfferedTo?: string; baseItems?: any[] }
): Promise<{ offeredTo?: string }> {
  const baseItems = opts.baseItems || [];
  const slotKey = { hospitalId: slot.hospitalId, slotId: slot.slotId };
  const fromCondition = '#s = :from' + (opts.expectedOfferedTo ? ' AND offeredTo = :ot' : '');
  const fromValues: Record<string, any> = { ':from': opts.fromStatus };
  if (opts.expectedOfferedTo) fromValues[':ot'] = opts.expectedOfferedTo;

  const candidates = (await findCandidates(tables.waitlist, slot)).slice(0, MAX_OFFER_ATTEMPTS);

  for (const candidate of candidates) {
    const offerExpiresAt = new Date(Date.now() + OFFER_CLAIM_MINUTES * 60 * 1000).toISOString();
    try {
      await dynamoDocClient.send(
        new TransactWriteCommand({
          TransactItems: [
            ...baseItems,
            {
              Update: {
                TableName: tables.availability,
                Key: slotKey,
                UpdateExpression: 'SET #s = :offered, offeredTo = :p, offerExpiresAt = :exp',
                ConditionExpression: fromCondition,
                ExpressionAttributeNames: { '#s': 'status' },
                ExpressionAttributeValues: {
                  ...fromValues,
                  ':offered': 'OFFERED',
                  ':p': candidate.patientId,
                  ':exp': offerExpiresAt,
                },
              },
            },
            {
              Update: {
                TableName: tables.waitlist,
                Key: { patientId: candidate.patientId, waitlistId: candidate.waitlistId },
                UpdateExpression: 'SET #s = :offered, offerExpiresAt = :exp, hospitalId = :h, slotId = :sl',
                ConditionExpression: '#s = :waiting',
                ExpressionAttributeNames: { '#s': 'status' },
                ExpressionAttributeValues: {
                  ':offered': 'OFFERED',
                  ':waiting': 'WAITING',
                  ':exp': offerExpiresAt,
                  ':h': slot.hospitalId,
                  ':sl': slot.slotId,
                },
              },
            },
          ],
        })
      );
    } catch (err: any) {
      if (!isTransactionCanceled(err)) throw err;
      // Only the waitlist entry changed under us (someone else already took this candidate): try the next one.
      const reasons: any[] = err.CancellationReasons || [];
      const waitlistIndex = baseItems.length + 1;
      const onlyWaitlistFailed =
        reasons[waitlistIndex]?.Code === 'ConditionalCheckFailed' &&
        reasons.every((r, i) => i === waitlistIndex || !r?.Code || r.Code === 'None');
      if (onlyWaitlistFailed) continue;
      throw err;
    }

    await sendNotification(dynamoDocClient, tables.notifications, {
      recipientId: candidate.patientId,
      channels: ['EMAIL', 'SMS'],
      type: 'WAITLIST_OFFER',
      payload: {
        hospitalId: slot.hospitalId,
        slotId: slot.slotId,
        waitlistId: candidate.waitlistId,
        startTime: slot.startTime,
        offerExpiresAt,
      },
    });
    return { offeredTo: candidate.patientId };
  }

  await dynamoDocClient.send(
    new TransactWriteCommand({
      TransactItems: [
        ...baseItems,
        {
          Update: {
            TableName: tables.availability,
            Key: slotKey,
            UpdateExpression: 'SET #s = :approved REMOVE offeredTo, offerExpiresAt',
            ConditionExpression: fromCondition,
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ...fromValues, ':approved': 'APPROVED' },
          },
        },
      ],
    })
  );
  return {};
}

export function releaseTablesFromEnv(): ReleaseTables {
  return {
    waitlist: process.env.WAITLIST_TABLE_NAME!,
    availability: process.env.AVAILABILITY_TABLE_NAME!,
    notifications: process.env.NOTIFICATIONS_TABLE_NAME!,
  };
}
