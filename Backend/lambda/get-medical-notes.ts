import { callerId, HttpError, respond, withErrorHandling } from './lib/http';
import { getUser, queryAll } from './lib/db';

export const handler = withErrorHandling(async (event) => {
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
