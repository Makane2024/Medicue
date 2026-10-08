import { BatchGetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { callerId, HttpError, respond, withErrorHandling } from './lib/http';
import { ddb, requireRole } from './lib/db';

const ROLES = ['PATIENT', 'DOCTOR', 'STAFF', 'HOSPITAL_ADMIN'] as const;
const PAGE_SIZE = 50;

const encode = (key: Record<string, any>) => Buffer.from(JSON.stringify(key)).toString('base64url');
const decode = (token: string) => {
  try {
    const key = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (typeof key?.userId !== 'string' || typeof key?.role !== 'string') throw new Error('bad key');
    return { userId: key.userId, role: key.role };
  } catch {
    throw new HttpError(400, 'nextToken is not valid');
  }
};

async function countRole(role: string): Promise<number> {
  let count = 0;
  let startKey: Record<string, any> | undefined;
  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: process.env.USERS_TABLE_NAME,
        IndexName: 'role-index',
        KeyConditionExpression: '#r = :role',
        ExpressionAttributeNames: { '#r': 'role' },
        ExpressionAttributeValues: { ':role': role },
        Select: 'COUNT',
        ExclusiveStartKey: startKey,
      })
    );
    count += result.Count ?? 0;
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return count;
}

// Platform admin: one page of the accounts with a given role (patients, doctors, staff or hospital admins).
// The first page also carries the number of accounts per role, for the tabs of the admin screen.
export const handler = withErrorHandling(async (event) => {
  await requireRole(callerId(event), 'PLATFORM_ADMIN');
  const q = event.queryStringParameters ?? {};

  const role = q.role as (typeof ROLES)[number];
  if (!ROLES.includes(role)) throw new HttpError(400, `role must be one of: ${ROLES.join(', ')}`);

  const page = await ddb.send(
    new QueryCommand({
      TableName: process.env.USERS_TABLE_NAME,
      IndexName: 'role-index',
      KeyConditionExpression: '#r = :role',
      ExpressionAttributeNames: { '#r': 'role' },
      ExpressionAttributeValues: { ':role': role },
      Limit: PAGE_SIZE,
      ExclusiveStartKey: q.nextToken ? decode(q.nextToken) : undefined,
    })
  );
  const items = page.Items ?? [];

  // Hospital names for staff, doctors' hospital admins ... (patients have none).
  const hospitalIds = [...new Set(items.map((u) => u.hospitalId).filter(Boolean))] as string[];
  const hospitalNames = new Map<string, string>();
  if (hospitalIds.length > 0) {
    const result = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [process.env.HOSPITALS_TABLE_NAME!]: {
            Keys: hospitalIds.map((hospitalId) => ({ hospitalId, itemType: 'PROFILE' })),
            ProjectionExpression: 'hospitalId, #n',
            ExpressionAttributeNames: { '#n': 'name' },
          },
        },
      })
    );
    for (const h of result.Responses?.[process.env.HOSPITALS_TABLE_NAME!] ?? []) hospitalNames.set(h.hospitalId, h.name);
  }

  const counts = q.nextToken ? undefined : Object.fromEntries(await Promise.all(ROLES.map(async (r) => [r, await countRole(r)])));

  return respond(200, {
    users: items.map((u) => ({
      userId: u.userId,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      phone: u.phone,
      role: u.role,
      specialty: u.specialty,
      hospitalId: u.hospitalId,
      hospitalName: u.hospitalId ? hospitalNames.get(u.hospitalId) : undefined,
      suspended: u.suspended === true,
      reportCount: u.reportCount,
      createdAt: u.createdAt,
    })),
    nextToken: page.LastEvaluatedKey ? encode(page.LastEvaluatedKey) : undefined,
    counts,
  });
});
