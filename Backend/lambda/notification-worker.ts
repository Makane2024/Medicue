import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './lib/db';
import { buildMessage } from './lib/messages';

const sesClient = new SESClient({});
const snsClient = new SNSClient({});

/** The recipient can never be reached (no such user, no address, an address the provider refuses): retrying is pointless. */
class Undeliverable extends Error {}

// Provider answers that mean "this address or number will not work", as opposed to "try again later".
const PERMANENT = new Set(['MessageRejected', 'InvalidParameter', 'InvalidParameterValue', 'MailFromDomainNotVerifiedException']);

export const handler = async (event: any) => {
  for (const record of event.Records) {
    // The SQS message body is the full EventBridge event envelope: the data we want is under `.detail`.
    const envelope = JSON.parse(record.body);
    const { recipientId, notificationId, channel, type, payload } = envelope.detail;

    try {
      const user = (
        await ddb.send(new GetCommand({ TableName: process.env.USERS_TABLE_NAME, Key: { userId: recipientId } }))
      ).Item;
      if (!user) throw new Undeliverable('Recipient not found');

      const { subject, body } = buildMessage(type, payload);

      if (channel === 'EMAIL') {
        if (!user.email) throw new Undeliverable('Recipient has no email on file');
        await sesClient.send(
          new SendEmailCommand({
            Source: process.env.SES_FROM_ADDRESS,
            Destination: { ToAddresses: [user.email] },
            Message: { Subject: { Data: subject }, Body: { Text: { Data: body } } },
          })
        );
      } else if (channel === 'SMS') {
        if (!user.phone) throw new Undeliverable('Recipient has no phone number on file');
        await snsClient.send(new PublishCommand({ PhoneNumber: user.phone, Message: body }));
      }

      await ddb.send(
        new UpdateCommand({
          TableName: process.env.NOTIFICATIONS_TABLE_NAME,
          Key: { recipientId, notificationId },
          UpdateExpression: 'SET deliveryStatus = :sent, sentAt = :sentAt',
          ExpressionAttributeValues: { ':sent': 'SENT', ':sentAt': new Date().toISOString() },
        })
      );
    } catch (err: any) {
      if (err instanceof Undeliverable || PERMANENT.has(err?.name)) {
        // Recorded as failed for good and not retried, so it does not end up in the dead-letter queue.
        console.warn('Notification not deliverable', { notificationId, channel, reason: err.message });
        await ddb.send(
          new UpdateCommand({
            TableName: process.env.NOTIFICATIONS_TABLE_NAME,
            Key: { recipientId, notificationId },
            UpdateExpression: 'SET deliveryStatus = :failed, failureReason = :reason',
            ExpressionAttributeValues: { ':failed': 'FAILED', ':reason': String(err.message).slice(0, 300) },
          })
        );
        continue;
      }
      await ddb.send(
        new UpdateCommand({
          TableName: process.env.NOTIFICATIONS_TABLE_NAME,
          Key: { recipientId, notificationId },
          UpdateExpression: 'SET deliveryStatus = :failed, retryCount = if_not_exists(retryCount, :zero) + :one',
          ExpressionAttributeValues: { ':failed': 'FAILED', ':zero': 0, ':one': 1 },
        })
      );
      throw err; // re-throw so SQS retries, eventually moving the message to the DLQ
    }
  }
};
