import { callerId, respond, withErrorHandling } from './lib/http';
import { queryAll, requireRole } from './lib/db';

// Doctor: all of their upcoming slots (pending, approved, booked, offered) across hospitals.
export const handler = withErrorHandling(async (event) => {
  const doctorId = callerId(event);
  await requireRole(doctorId, 'DOCTOR');

  const slots = await queryAll({
    TableName: process.env.AVAILABILITY_TABLE_NAME,
    IndexName: 'doctor-index',
    KeyConditionExpression: 'doctorId = :d AND startTime >= :now',
    ExpressionAttributeValues: { ':d': doctorId, ':now': new Date().toISOString() },
  });

  return respond(200, { slots });
});
