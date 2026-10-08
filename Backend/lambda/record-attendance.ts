import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, isConditionFailed, requireRole } from './lib/db';
import { requireEnum, requireString } from './lib/validation';
import { sendNotification } from './lib/notify';

export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const appointmentId = requireString(body, 'appointmentId', { max: 64 });
  const decision = requireEnum(body, 'decision', ['COMPLETED', 'MISSED'] as const);
  const caller = await requireRole(callerId(event), 'HOSPITAL_ADMIN');

  const appointment = (
    await ddb.send(
      new GetCommand({ TableName: process.env.APPOINTMENTS_TABLE_NAME, Key: { appointmentId, itemType: 'METADATA' } })
    )
  ).Item;
  if (!appointment) throw new HttpError(404, 'Appointment not found');
  if (appointment.hospitalId !== caller.hospitalId) throw new HttpError(403, 'Not authorized for this hospital');
  if (appointment.status !== 'CONFIRMED') {
    throw new HttpError(409, 'Only a confirmed appointment can have attendance recorded');
  }
  if (appointment.startTime > new Date().toISOString()) {
    throw new HttpError(409, 'Attendance cannot be recorded before the appointment starts');
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: process.env.APPOINTMENTS_TABLE_NAME,
        Key: { appointmentId, itemType: 'METADATA' },
        UpdateExpression: 'SET #s = :decision',
        ConditionExpression: '#s = :confirmed',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':decision': decision, ':confirmed': 'CONFIRMED' },
      })
    );
  } catch (err) {
    if (isConditionFailed(err)) throw new HttpError(409, 'The appointment changed, please refresh and retry');
    throw err;
  }

  if (decision === 'MISSED') {
    await sendNotification(ddb, process.env.NOTIFICATIONS_TABLE_NAME!, {
      recipientId: appointment.patientId,
      channels: ['EMAIL', 'SMS'],
      type: 'MISSED',
      payload: { appointmentId, startTime: appointment.startTime },
    });
  }

  return respond(200, { appointmentId, status: decision });
});
