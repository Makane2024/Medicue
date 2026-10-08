import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, isTransactionCanceled } from './lib/db';
import { requireString } from './lib/validation';
import { getAmount, HOLD_EXPIRY_MINUTES } from './lib/constants';

export const handler = withErrorHandling(async (event) => {
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
