import { callerId, respond, withErrorHandling } from './lib/http';
import { queryAll, requireRole } from './lib/db';

// Hospital admin: upcoming slots of their own hospital in every status, so they can track proposals.
export const handler = withErrorHandling(async (event) => {
  const admin = await requireRole(callerId(event), 'HOSPITAL_ADMIN');

  const slots = await queryAll({
    TableName: process.env.AVAILABILITY_TABLE_NAME,
    IndexName: 'hospital-time-index',
    KeyConditionExpression: 'hospitalId = :h AND startTime >= :from',
    ExpressionAttributeValues: {
      ':h': admin.hospitalId,
      // include today's earlier slots and recent history so rejected/expired proposals stay visible
      ':from': new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    },
  });

  return respond(200, { slots });
});
