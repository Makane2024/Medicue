import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, isConditionFailed, requireRole } from './lib/db';
import { requireString } from './lib/validation';
import { sendNotification } from './lib/notify';

// The doctor ends the consultation: an appointment whose patient has arrived becomes COMPLETED. Only then can
// the doctor write the session notes and the patient review the doctor.
export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const appointmentId = requireString(body, 'appointmentId', { max: 64 });
  const doctor = await requireRole(callerId(event), 'DOCTOR');

  const appointment = (
    await ddb.send(
      new GetCommand({ TableName: process.env.APPOINTMENTS_TABLE_NAME, Key: { appointmentId, itemType: 'METADATA' } })
    )
  ).Item;
  if (!appointment || appointment.doctorId !== doctor.userId) throw new HttpError(403, 'Not authorized');
  if (appointment.status !== 'ARRIVED') {
    throw new HttpError(409, 'The patient must be checked in at the hospital before the session can be completed');
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: process.env.APPOINTMENTS_TABLE_NAME,
        Key: { appointmentId, itemType: 'METADATA' },
        UpdateExpression: 'SET #s = :completed, completedAt = :now',
        ConditionExpression: '#s = :arrived',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':completed': 'COMPLETED', ':arrived': 'ARRIVED', ':now': new Date().toISOString() },
      })
    );
  } catch (err) {
    if (isConditionFailed(err)) throw new HttpError(409, 'The appointment changed, please refresh and retry');
    throw err;
  }

  // Invites the patient to review the doctor, now that they can.
  await sendNotification(ddb, process.env.NOTIFICATIONS_TABLE_NAME!, {
    recipientId: appointment.patientId,
    channels: ['EMAIL'],
    type: 'SESSION_COMPLETED',
    payload: { appointmentId, startTime: appointment.startTime },
  });

  return respond(200, { appointmentId, status: 'COMPLETED' });
});
