import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, isConditionFailed, requireRole } from './lib/db';
import { requireString } from './lib/validation';

// A patient reviews the doctor of one of their completed appointments, once per appointment.
export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const appointmentId = requireString(body, 'appointmentId', { max: 64 });
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'rating must be a whole number from 1 to 5');
  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  if (comment.length > 1000) throw new HttpError(400, 'comment must be at most 1000 characters');

  const patient = await requireRole(callerId(event), 'PATIENT');

  const appointment = (
    await ddb.send(
      new GetCommand({ TableName: process.env.APPOINTMENTS_TABLE_NAME, Key: { appointmentId, itemType: 'METADATA' } })
    )
  ).Item;
  if (!appointment || appointment.patientId !== patient.userId || appointment.status !== 'COMPLETED') {
    throw new HttpError(403, 'You can only review doctors after a completed session');
  }

  const review = {
    reviewId: randomUUID(),
    doctorId: appointment.doctorId,
    patientId: patient.userId,
    appointmentId,
    rating,
    comment,
    createdAt: new Date().toISOString(),
  };
  try {
    await ddb.send(
      new PutCommand({
        TableName: process.env.REVIEWS_TABLE_NAME,
        Item: review,
        ConditionExpression: 'attribute_not_exists(appointmentId)',
      })
    );
  } catch (err) {
    if (isConditionFailed(err)) throw new HttpError(409, 'You already reviewed this session');
    throw err;
  }

  return respond(200, review);
});
