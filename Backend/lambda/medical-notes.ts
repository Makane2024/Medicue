import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, getUser, queryAll } from './lib/db';
import { requireString } from './lib/validation';
import { routes } from './lib/router';

// The only Lambda allowed to touch the medical notes table (see lib/api-stack.ts and test/stacks.test.ts).

// ------------------------------------------------------------------ record-medical-note
export const recordMedicalNote = withErrorHandling(async (event) => {
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

// ------------------------------------------------------------------ get-medical-notes
export const getMedicalNotes = withErrorHandling(async (event) => {
  const caller = callerId(event);
  const user = await getUser(caller);

  if (!user || (user.role !== 'PATIENT' && user.role !== 'DOCTOR')) throw new HttpError(403, 'Not authorized');

  if (user.role === 'PATIENT') {
    const notes = await queryAll({
      TableName: process.env.MEDICAL_NOTES_TABLE_NAME,
      KeyConditionExpression: 'patientId = :patientId',
      ExpressionAttributeValues: { ':patientId': caller },
    });
    return respond(200, { notes });
  }

  // Doctor: only the notes they personally wrote, for the patient they specify
  const patientId = event.queryStringParameters?.patientId;
  if (!patientId) throw new HttpError(400, 'patientId is required');

  const notes = await queryAll({
    TableName: process.env.MEDICAL_NOTES_TABLE_NAME,
    KeyConditionExpression: 'patientId = :patientId',
    FilterExpression: 'doctorId = :doctorId',
    ExpressionAttributeValues: { ':patientId': patientId, ':doctorId': caller },
  });
  return respond(200, { notes });
});

export const handler = routes({
  'POST /medical-notes/record': recordMedicalNote,
  'GET /medical-notes/list': getMedicalNotes,
});
