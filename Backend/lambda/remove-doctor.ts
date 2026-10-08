import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, queryAll, requireRole } from './lib/db';
import { requireString } from './lib/validation';
import { batchDelete } from './lib/cleanup';

// Hospital admin only: ends a doctor's affiliation with the caller's hospital. The doctor's account stays
// (they may work elsewhere and their name still appears on past appointments). Pending and open slots
// here are deleted; a doctor with upcoming bookings here cannot be removed until those are dealt with.
export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const doctorId = requireString(body, 'doctorId', { max: 64 });
  const caller = await requireRole(callerId(event), 'HOSPITAL_ADMIN');
  const hospitalId: string = caller.hospitalId;

  const affiliation = (
    await ddb.send(
      new GetCommand({ TableName: process.env.AFFILIATIONS_TABLE_NAME, Key: { doctorId, hospitalId } })
    )
  ).Item;
  if (!affiliation || affiliation.status !== 'ACTIVE') throw new HttpError(404, 'Doctor is not at this hospital');

  const slots = await queryAll({
    TableName: process.env.AVAILABILITY_TABLE_NAME,
    IndexName: 'doctor-index',
    KeyConditionExpression: 'doctorId = :d',
    FilterExpression: 'hospitalId = :h',
    ExpressionAttributeValues: { ':d': doctorId, ':h': hospitalId },
  });

  const now = new Date().toISOString();
  if (slots.some((s) => ['BOOKED', 'OFFERED'].includes(s.status) && s.startTime > now)) {
    throw new HttpError(409, 'This doctor has upcoming bookings. Wait until they are completed or cancelled.');
  }

  await batchDelete(
    process.env.AVAILABILITY_TABLE_NAME!,
    slots.filter((s) => ['PENDING', 'APPROVED'].includes(s.status)).map((s) => ({ hospitalId, slotId: s.slotId }))
  );

  // Kept as REMOVED rather than deleted so the history stays; listing and slot proposals only accept ACTIVE.
  await ddb.send(
    new UpdateCommand({
      TableName: process.env.AFFILIATIONS_TABLE_NAME,
      Key: { doctorId, hospitalId },
      UpdateExpression: 'SET #s = :removed, removedAt = :now',
      ConditionExpression: '#s = :active',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':removed': 'REMOVED', ':active': 'ACTIVE', ':now': now },
    })
  );

  return respond(200, { ok: true });
});
