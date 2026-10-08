import { callerId, respond, withErrorHandling } from './lib/http';
import { queryAll } from './lib/db';

// Doctor: upcoming slots proposed by hospitals that still await this doctor's decision.
export const handler = withErrorHandling(async (event) => {
  const doctorId = callerId(event);

  const slots = await queryAll({
    TableName: process.env.AVAILABILITY_TABLE_NAME,
    IndexName: 'doctor-index',
    KeyConditionExpression: 'doctorId = :d AND startTime >= :now',
    FilterExpression: '#s = :pending',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':d': doctorId, ':now': new Date().toISOString(), ':pending': 'PENDING' },
  });

  return respond(200, { slots });
});
