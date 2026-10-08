import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { callerId, respond, withErrorHandling } from './lib/http';
import { ddb } from './lib/db';
import { buildMessage } from './lib/messages';

const LIMIT = 50;

// The signed-in user's most recent notifications (delivery log), newest first.
export const handler = withErrorHandling(async (event) => {
  const result = await ddb.send(
    new QueryCommand({
      TableName: process.env.NOTIFICATIONS_TABLE_NAME,
      KeyConditionExpression: 'recipientId = :r',
      ExpressionAttributeValues: { ':r': callerId(event) },
    })
  );

  // notificationId is a random UUID, so order by creation time in memory.
  const notifications = (result.Items || [])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, LIMIT)
    .map((n) => ({
      notificationId: n.notificationId,
      type: n.type,
      channel: n.channel,
      deliveryStatus: n.deliveryStatus,
      message: buildMessage(n.type, n.payload || {}).body,
      createdAt: n.createdAt,
    }));

  return respond(200, { notifications });
});
