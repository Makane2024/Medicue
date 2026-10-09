import { GetCommand, PutCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, isConditionFailed, requireRole, getUser, queryAll } from './lib/db';
import { requireString } from './lib/validation';
import { routes } from './lib/router';

// Patients review a doctor after a completed session.

// ------------------------------------------------------------------ create-review
// A patient reviews the doctor of one of their completed appointments, once per appointment.
export const createReview = withErrorHandling(async (event) => {
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

// ------------------------------------------------------------------ doctor-reviews
// Reviews of one doctor, newest first. Any signed-in user may read them; reviewers are shown by first name only.
export const doctorReviews = withErrorHandling(async (event) => {
  if (!(await getUser(callerId(event)))) throw new HttpError(403, 'Not authorized');
  const doctorId = event.queryStringParameters?.doctorId;
  if (!doctorId) throw new HttpError(400, 'doctorId is required');

  const reviews = (
    await queryAll({
      TableName: process.env.REVIEWS_TABLE_NAME,
      KeyConditionExpression: 'doctorId = :d',
      ExpressionAttributeValues: { ':d': doctorId },
    })
  ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const patientIds = [...new Set(reviews.map((r) => r.patientId))];
  const firstNames = new Map<string, string>();
  for (let i = 0; i < patientIds.length; i += 100) {
    const result = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [process.env.USERS_TABLE_NAME!]: {
            Keys: patientIds.slice(i, i + 100).map((userId) => ({ userId })),
            ProjectionExpression: 'userId, firstName',
          },
        },
      })
    );
    for (const u of result.Responses?.[process.env.USERS_TABLE_NAME!] || []) firstNames.set(u.userId, u.firstName);
  }

  return respond(200, {
    reviews: reviews.map((r) => ({
      reviewId: r.reviewId,
      doctorId: r.doctorId,
      patientId: r.patientId,
      patientName: firstNames.get(r.patientId),
      appointmentId: r.appointmentId,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
    })),
  });
});

// ------------------------------------------------------------------ my-reviews
// The reviews the signed-in patient has written (so the UI knows which appointments are still reviewable).
export const myReviews = withErrorHandling(async (event) => {
  const patient = await requireRole(callerId(event), 'PATIENT');

  const reviews = await queryAll({
    TableName: process.env.REVIEWS_TABLE_NAME,
    IndexName: 'patient-index',
    KeyConditionExpression: 'patientId = :p',
    ExpressionAttributeValues: { ':p': patient.userId },
  });

  return respond(200, {
    reviews: reviews.map(({ reviewId, doctorId, patientId, appointmentId, rating, comment, createdAt }) => ({
      reviewId,
      doctorId,
      patientId,
      appointmentId,
      rating,
      comment,
      createdAt,
    })),
  });
});

export const handler = routes({
  'POST /reviews/create': createReview,
  'GET /reviews/doctor': doctorReviews,
  'GET /reviews/mine': myReviews,
});
