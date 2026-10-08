import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const eventBridgeClient = new EventBridgeClient({});

/**
 * Best effort: a notification problem must never fail the business operation that
 * already committed, so errors are logged and the row is flagged PUBLISH_FAILED
 * instead of being thrown.
 */
export async function sendNotification(
  dynamoDocClient: DynamoDBDocumentClient,
  notificationsTableName: string,
  params: {
    recipientId: string;
    channels: ('EMAIL' | 'SMS')[];
    type: string;
    payload: Record<string, any>;
  }
) {
  for (const channel of params.channels) {
    const notificationId = randomUUID();
    try {
      await dynamoDocClient.send(
        new PutCommand({
          TableName: notificationsTableName,
          Item: {
            recipientId: params.recipientId,
            notificationId,
            channel,
            type: params.type,
            payload: params.payload,
            deliveryStatus: 'PENDING',
            retryCount: 0,
            createdAt: new Date().toISOString(),
          },
        })
      );

      // EventBridge receives the "system event"; a rule forwards it to the notification queue.
      const result = await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              EventBusName: process.env.EVENT_BUS_NAME,
              Source: 'medicue.notifications',
              DetailType: params.type,
              Detail: JSON.stringify({
                recipientId: params.recipientId,
                notificationId,
                channel,
                type: params.type,
                payload: params.payload,
              }),
            },
          ],
        })
      );

      // PutEvents answers HTTP 200 even when an entry was rejected.
      if (result.FailedEntryCount) {
        console.error('EventBridge rejected notification', result.Entries?.[0]);
        await dynamoDocClient.send(
          new UpdateCommand({
            TableName: notificationsTableName,
            Key: { recipientId: params.recipientId, notificationId },
            UpdateExpression: 'SET deliveryStatus = :f',
            ExpressionAttributeValues: { ':f': 'PUBLISH_FAILED' },
          })
        );
      }
    } catch (err) {
      console.error('sendNotification failed', { type: params.type, recipientId: params.recipientId, err });
    }
  }
}
