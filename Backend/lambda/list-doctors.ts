import { BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { callerId, HttpError, respond, withErrorHandling } from './lib/http';
import { ddb, getUser, queryAll, requireApprovedHospital } from './lib/db';

// Doctors affiliated with an approved hospital. Any signed-in user may list them (patients pick a
// specialist, hospital admins manage their staff); only public profile fields are returned.
export const handler = withErrorHandling(async (event) => {
  const caller = await getUser(callerId(event));
  if (!caller) throw new HttpError(403, 'Not authorized');

  const hospitalId = event.queryStringParameters?.hospitalId;
  if (!hospitalId) throw new HttpError(400, 'hospitalId is required');
  // A hospital admin may also see their own hospital before it is approved.
  if (!(caller.role === 'HOSPITAL_ADMIN' && caller.hospitalId === hospitalId)) {
    await requireApprovedHospital(hospitalId);
  }

  const affiliations = await queryAll({
    TableName: process.env.AFFILIATIONS_TABLE_NAME,
    IndexName: 'hospital-index',
    KeyConditionExpression: 'hospitalId = :h',
    FilterExpression: '#s = :active',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':h': hospitalId, ':active': 'ACTIVE' },
  });

  const names = new Map<string, { firstName: string; lastName: string; bio?: string; photo?: string }>();
  for (let i = 0; i < affiliations.length; i += 100) {
    const keys = affiliations.slice(i, i + 100).map((a) => ({ userId: a.doctorId }));
    const result = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [process.env.USERS_TABLE_NAME!]: { Keys: keys, ProjectionExpression: 'userId, firstName, lastName, bio, photo' },
        },
      })
    );
    for (const u of result.Responses?.[process.env.USERS_TABLE_NAME!] || []) {
      names.set(u.userId, { firstName: u.firstName, lastName: u.lastName, bio: u.bio, photo: u.photo });
    }
  }

  return respond(200, {
    doctors: affiliations.map((a) => ({
      doctorId: a.doctorId,
      hospitalId: a.hospitalId,
      specialty: a.specialty,
      specialtyId: a.specialtyId,
      firstName: names.get(a.doctorId)?.firstName,
      lastName: names.get(a.doctorId)?.lastName,
      bio: names.get(a.doctorId)?.bio,
      photo: names.get(a.doctorId)?.photo,
    })),
  });
});
