import { callerId, respond, withErrorHandling } from './lib/http';
import { queryAll, requireRole } from './lib/db';

// Hospital admin: the staff accounts of their own hospital.
export const handler = withErrorHandling(async (event) => {
  const caller = await requireRole(callerId(event), 'HOSPITAL_ADMIN');

  const staff = await queryAll({
    TableName: process.env.USERS_TABLE_NAME,
    IndexName: 'role-index',
    KeyConditionExpression: '#r = :staff',
    FilterExpression: 'hospitalId = :h',
    ExpressionAttributeNames: { '#r': 'role' },
    ExpressionAttributeValues: { ':staff': 'STAFF', ':h': caller.hospitalId },
  });

  return respond(200, {
    staff: staff
      .map(({ userId, firstName, lastName, email, phone, suspended, createdAt }) => ({
        staffId: userId,
        firstName,
        lastName,
        email,
        phone,
        suspended: suspended === true,
        createdAt,
      }))
      .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)),
  });
});
