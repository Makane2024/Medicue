import { callerId, respond, withErrorHandling } from './lib/http';
import { queryAll, requireRole } from './lib/db';

// Platform admin only: reported accounts, most reported first.
export const handler = withErrorHandling(async (event) => {
  await requireRole(callerId(event), 'PLATFORM_ADMIN');

  const reported = await queryAll({
    TableName: process.env.USERS_TABLE_NAME,
    IndexName: 'reported-index',
    KeyConditionExpression: 'reported = :y',
    ExpressionAttributeValues: { ':y': 'Y' },
    ScanIndexForward: false,
  });

  return respond(200, {
    users: reported.map(({ userId, firstName, lastName, email, phone, role, hospitalId, photo, reportCount }) => ({
      userId,
      firstName,
      lastName,
      email,
      phone,
      role,
      hospitalId,
      photo,
      reportCount,
    })),
  });
});
