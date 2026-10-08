import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { isConditionFailed, ddb, requireRole } from './lib/db';
import { requireEnum, requireString } from './lib/validation';
import { sendNotification } from './lib/notify';

export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const hospitalId = requireString(body, 'hospitalId', { max: 64 });
  const decision = requireEnum(body, 'decision', ['APPROVED', 'REJECTED'] as const);
  await requireRole(callerId(event), 'PLATFORM_ADMIN');

  let hospital;
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: process.env.HOSPITALS_TABLE_NAME,
        Key: { hospitalId, itemType: 'PROFILE' },
        UpdateExpression: 'SET #s = :s, reviewedAt = :now',
        ConditionExpression: 'attribute_exists(hospitalId)', // never create a phantom hospital
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': decision, ':now': new Date().toISOString() },
        ReturnValues: 'ALL_NEW',
      })
    );
    hospital = result.Attributes;
  } catch (err) {
    if (isConditionFailed(err)) throw new HttpError(404, 'Hospital not found');
    throw err;
  }

  if (hospital?.adminUserId) {
    await sendNotification(ddb, process.env.NOTIFICATIONS_TABLE_NAME!, {
      recipientId: hospital.adminUserId,
      channels: ['EMAIL'],
      type: 'HOSPITAL_REVIEWED',
      payload: { hospitalName: hospital.name, decision },
    });
  }

  return respond(200, { hospitalId, status: decision });
});
