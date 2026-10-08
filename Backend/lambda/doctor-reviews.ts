import { BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { callerId, HttpError, respond, withErrorHandling } from './lib/http';
import { ddb, getUser, queryAll } from './lib/db';

// Reviews of one doctor, newest first. Any signed-in user may read them; reviewers are shown by first name only.
export const handler = withErrorHandling(async (event) => {
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
