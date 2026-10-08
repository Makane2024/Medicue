import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, isConditionFailed } from './lib/db';
import { requireEnum, requireString } from './lib/validation';
import { findDoctorConflict } from './lib/scheduling';

export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const hospitalId = requireString(body, 'hospitalId', { max: 64 });
  const slotId = requireString(body, 'slotId', { max: 64 });
  const decision = requireEnum(body, 'decision', ['APPROVED', 'REJECTED'] as const);
  const doctorId = callerId(event);

  const slot = (
    await ddb.send(new GetCommand({ TableName: process.env.AVAILABILITY_TABLE_NAME, Key: { hospitalId, slotId } }))
  ).Item;
  if (!slot || slot.doctorId !== doctorId) throw new HttpError(403, 'Not authorized');

  // Only a proposal can be decided. Without this a doctor could re-open a BOOKED slot.
  if (slot.status !== 'PENDING') {
    throw new HttpError(409, `Slot is already ${slot.status} and can no longer be approved or rejected`);
  }

  if (decision === 'APPROVED') {
    if (slot.startTime <= new Date().toISOString()) throw new HttpError(409, 'This slot starts in the past');
    const conflict = await findDoctorConflict(
      process.env.AVAILABILITY_TABLE_NAME!,
      slot.doctorId,
      slot.hospitalId,
      slot.startTime,
      slot.endTime,
      slotId
    );
    if (conflict) throw new HttpError(409, 'Conflict detected at approval time');
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: process.env.AVAILABILITY_TABLE_NAME,
        Key: { hospitalId, slotId },
        UpdateExpression: 'SET #s = :s, decidedAt = :now',
        ConditionExpression: '#s = :pending',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': decision, ':pending': 'PENDING', ':now': new Date().toISOString() },
      })
    );
  } catch (err) {
    if (isConditionFailed(err)) throw new HttpError(409, 'Slot changed while being decided, please retry');
    throw err;
  }

  return respond(200, { slotId, status: decision });
});
