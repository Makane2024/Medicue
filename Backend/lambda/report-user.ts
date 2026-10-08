import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, getUser, isTransactionCanceled } from './lib/db';
import { requireString } from './lib/validation';

// Any signed-in user can report another account, once. Platform admins review the counts.
export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const targetId = requireString(body, 'userId', { max: 64 });
  const reporterId = callerId(event);
  if (targetId === reporterId) throw new HttpError(400, "You can't report yourself");

  const [reporter, target] = await Promise.all([getUser(reporterId), getUser(targetId)]);
  if (!reporter) throw new HttpError(403, 'Not authorized');
  if (!target) throw new HttpError(404, 'User not found');
  if (target.role === 'PLATFORM_ADMIN') throw new HttpError(403, 'Platform admins cannot be reported');

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: process.env.REPORTS_TABLE_NAME,
              Item: { userId: targetId, reporterId, createdAt: new Date().toISOString() },
              ConditionExpression: 'attribute_not_exists(userId)',
            },
          },
          {
            Update: {
              TableName: process.env.USERS_TABLE_NAME,
              Key: { userId: targetId },
              UpdateExpression: 'SET reported = :y ADD reportCount :one',
              ConditionExpression: 'attribute_exists(userId)',
              ExpressionAttributeValues: { ':y': 'Y', ':one': 1 },
            },
          },
        ],
      })
    );
  } catch (err) {
    if (isTransactionCanceled(err)) throw new HttpError(409, 'You already reported this account');
    throw err;
  }

  return respond(200, { ok: true });
});
