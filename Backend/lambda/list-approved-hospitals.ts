import { queryAll } from './lib/db';
import { respond, withErrorHandling } from './lib/http';

// Public: lets patients discover hospitals they can book with.
export const handler = withErrorHandling(async () => {
  const hospitals = await queryAll({
    TableName: process.env.HOSPITALS_TABLE_NAME,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :approved',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':approved': 'APPROVED' },
  });

  return respond(200, {
    hospitals: hospitals.map(({ hospitalId, name, address, phone }) => ({ hospitalId, name, address, phone })),
  });
});
