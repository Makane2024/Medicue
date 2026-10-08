import { BatchGetCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { callerId, HttpError, respond, withErrorHandling } from './lib/http';
import { ddb, getUser, queryAll } from './lib/db';

// Appointments of the signed-in user, oldest first. Patients see their own, doctors the ones booked
// with them, hospital admins and staff everything at their hospital. Optional ?status= filter.
// Each item carries display names so the client does not need a user directory.
export const handler = withErrorHandling(async (event) => {
  const user = await getUser(callerId(event));
  if (!user) throw new HttpError(403, 'Not authorized');

  const status = event.queryStringParameters?.status;
  const index =
    user.role === 'PATIENT'
      ? { name: 'patient-index', key: 'patientId', value: user.userId }
      : user.role === 'DOCTOR'
        ? { name: 'doctor-index', key: 'doctorId', value: user.userId }
        : user.role === 'HOSPITAL_ADMIN' || user.role === 'STAFF'
          ? { name: 'hospital-index', key: 'hospitalId', value: user.hospitalId }
          : undefined;
  if (!index) throw new HttpError(403, 'Not authorized');

  const appointments = await queryAll({
    TableName: process.env.APPOINTMENTS_TABLE_NAME,
    IndexName: index.name,
    KeyConditionExpression: `${index.key} = :k`,
    ...(status ? { FilterExpression: '#s = :status', ExpressionAttributeNames: { '#s': 'status' } } : {}),
    ExpressionAttributeValues: { ':k': index.value, ...(status ? { ':status': status } : {}) },
  });

  const userIds = [...new Set(appointments.flatMap((a) => [a.patientId, a.doctorId]).filter(Boolean))];
  const names = new Map<string, string>();
  for (let i = 0; i < userIds.length; i += 100) {
    const result = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [process.env.USERS_TABLE_NAME!]: {
            Keys: userIds.slice(i, i + 100).map((userId) => ({ userId })),
            ProjectionExpression: 'userId, firstName, lastName',
          },
        },
      })
    );
    for (const u of result.Responses?.[process.env.USERS_TABLE_NAME!] || []) {
      names.set(u.userId, `${u.firstName} ${u.lastName}`);
    }
  }

  const hospitalNames = new Map<string, string>();
  for (const hospitalId of new Set(appointments.map((a) => a.hospitalId))) {
    const hospital = (
      await ddb.send(
        new GetCommand({ TableName: process.env.HOSPITALS_TABLE_NAME, Key: { hospitalId, itemType: 'PROFILE' } })
      )
    ).Item;
    if (hospital) hospitalNames.set(hospitalId, hospital.name);
  }

  return respond(200, {
    appointments: appointments
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map(({ note, ...a }) => ({
        ...a,
        // the patient's note on why they are coming is private to the patient and their doctor
        ...(note && ['PATIENT', 'DOCTOR'].includes(user.role) ? { note } : {}),
        patientName: names.get(a.patientId),
        doctorName: names.get(a.doctorId),
        hospitalName: hospitalNames.get(a.hospitalId),
      })),
  });
});
