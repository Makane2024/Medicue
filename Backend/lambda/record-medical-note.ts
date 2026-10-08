import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb } from './lib/db';
import { requireString } from './lib/validation';

export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const appointmentId = requireString(body, 'appointmentId', { max: 64 });
  const content = requireString(body, 'content', { max: 10000 });
  const doctorId = callerId(event);

  const appointment = (
    await ddb.send(
      new GetCommand({ TableName: process.env.APPOINTMENTS_TABLE_NAME, Key: { appointmentId, itemType: 'METADATA' } })
    )
  ).Item;
  if (!appointment || appointment.doctorId !== doctorId) throw new HttpError(403, 'Not authorized');
  if (appointment.status !== 'COMPLETED') {
    throw new HttpError(409, 'A note can only be recorded once the appointment is marked completed');
  }

  const noteId = randomUUID();
  await ddb.send(
    new PutCommand({
      TableName: process.env.MEDICAL_NOTES_TABLE_NAME,
      Item: {
        patientId: appointment.patientId,
        noteId,
        appointmentId,
        doctorId: appointment.doctorId,
        hospitalId: appointment.hospitalId,
        content,
        createdAt: new Date().toISOString(),
      },
    })
  );

  return respond(200, { noteId });
});
