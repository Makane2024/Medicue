import { callerId, respond, withErrorHandling } from './lib/http';
import { queryAll } from './lib/db';

// The signed-in patient's waitlist entries (any status), oldest first.
export const handler = withErrorHandling(async (event) => {
  const entries = await queryAll({
    TableName: process.env.WAITLIST_TABLE_NAME,
    KeyConditionExpression: 'patientId = :p',
    ExpressionAttributeValues: { ':p': callerId(event) },
  });

  return respond(200, { entries: entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
});
