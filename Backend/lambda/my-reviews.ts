import { callerId, respond, withErrorHandling } from './lib/http';
import { queryAll, requireRole } from './lib/db';

// The reviews the signed-in patient has written (so the UI knows which appointments are still reviewable).
export const handler = withErrorHandling(async (event) => {
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
