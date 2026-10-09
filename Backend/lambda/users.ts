import { callerId, HttpError, respond, withErrorHandling, parseBody } from './lib/http';
import { getUser, ddb, isTransactionCanceled, queryAll, requireRole } from './lib/db';
import { buildProfile } from './lib/profile';
import { UpdateCommand, TransactWriteCommand, BatchGetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requirePhone, requireString } from './lib/validation';
import { AdminDisableUserCommand, AdminEnableUserCommand, AdminUserGlobalSignOutCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { buildMessage } from './lib/messages';
import { routes } from './lib/router';

// The signed-in person's own profile and inbox, plus the platform admin's account directory.

// ------------------------------------------------------------------ get-me
// The signed-in user's own profile. The client needs the role (and, for a hospital admin, the hospital
// and its approval status) to decide what to show.
export const getMe = withErrorHandling(async (event) => {
  const user = await getUser(callerId(event));
  if (!user) throw new HttpError(404, 'No profile found for this account');
  return respond(200, await buildProfile(user));
});

// ------------------------------------------------------------------ update-profile
// The photo is stored on the profile row as a small data URL (the client shrinks it first); the cap keeps
// the doctor list, which embeds it, well below the Lambda response limit.
const MAX_PHOTO_CHARS = 100_000;
const PHOTO_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;

// Updates the signed-in user's own profile. Every field is optional; the email can't be changed.
export const updateProfile = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const userId = callerId(event);
  const user = await getUser(userId);
  if (!user) throw new HttpError(404, 'No profile found for this account');

  const sets: string[] = [];
  const removes: string[] = [];
  const values: Record<string, any> = {};

  for (const key of ['firstName', 'lastName'] as const) {
    if (body[key] === undefined) continue;
    sets.push(`${key} = :${key}`);
    values[`:${key}`] = requireString(body, key, { max: 100 });
  }

  // An empty phone means "leave it as it is"; a patient's phone is where SMS reminders go.
  if (typeof body.phone === 'string' && body.phone.trim() !== '') {
    sets.push('phone = :phone');
    values[':phone'] = requirePhone(body);
  }

  if (body.photo !== undefined) {
    if (body.photo === null || body.photo === '') {
      removes.push('photo');
    } else {
      if (typeof body.photo !== 'string' || body.photo.length > MAX_PHOTO_CHARS || !PHOTO_RE.test(body.photo)) {
        throw new HttpError(400, 'photo must be a PNG, JPEG or WebP image under 100 KB');
      }
      sets.push('photo = :photo');
      values[':photo'] = body.photo;
    }
  }

  // Only doctors have a public description; other roles ignore it.
  if (user.role === 'DOCTOR' && body.bio !== undefined) {
    if (typeof body.bio !== 'string' || body.bio.length > 1000) {
      throw new HttpError(400, 'bio must be at most 1000 characters');
    }
    if (body.bio.trim() === '') {
      removes.push('bio');
    } else {
      sets.push('bio = :bio');
      values[':bio'] = body.bio.trim();
    }
  }

  if (sets.length === 0 && removes.length === 0) return respond(200, await buildProfile(user));

  const updated = await ddb.send(
    new UpdateCommand({
      TableName: process.env.USERS_TABLE_NAME,
      Key: { userId },
      UpdateExpression: [sets.length ? `SET ${sets.join(', ')}` : '', removes.length ? `REMOVE ${removes.join(', ')}` : '']
        .filter(Boolean)
        .join(' '),
      ConditionExpression: 'attribute_exists(userId)',
      ...(sets.length ? { ExpressionAttributeValues: values } : {}),
      ReturnValues: 'ALL_NEW',
    })
  );

  return respond(200, await buildProfile(updated.Attributes!));
});

// ------------------------------------------------------------------ report-user
// Any signed-in user can report another account, once. Platform admins review the counts.
export const reportUser = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const targetId = requireString(body, 'userId', { max: 64 });
  const reporterId = callerId(event);
  if (targetId === reporterId) throw new HttpError(400, "You can't report yourself");

  const [reporter, target] = await Promise.all([getUser(reporterId), getUser(targetId)]);
  if (!reporter) throw new HttpError(403, 'Not authorized');
  if (!target) throw new HttpError(404, 'User not found');
  if (target.role === 'PLATFORM_ADMIN') throw new HttpError(403, 'Platform admins cannot be reported');

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: process.env.REPORTS_TABLE_NAME,
              Item: { userId: targetId, reporterId, createdAt: new Date().toISOString() },
              ConditionExpression: 'attribute_not_exists(userId)',
            },
          },
          {
            Update: {
              TableName: process.env.USERS_TABLE_NAME,
              Key: { userId: targetId },
              UpdateExpression: 'SET reported = :y ADD reportCount :one',
              ConditionExpression: 'attribute_exists(userId)',
              ExpressionAttributeValues: { ':y': 'Y', ':one': 1 },
            },
          },
        ],
      })
    );
  } catch (err) {
    if (isTransactionCanceled(err)) throw new HttpError(409, 'You already reported this account');
    throw err;
  }

  return respond(200, { ok: true });
});

// ------------------------------------------------------------------ reported-users
// Platform admin only: reported accounts, most reported first.
export const reportedUsers = withErrorHandling(async (event) => {
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

// ------------------------------------------------------------------ list-users
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
export const listUsers = withErrorHandling(async (event) => {
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

// ------------------------------------------------------------------ suspend-user
const cognitoClient = new CognitoIdentityProviderClient({});

// Platform admin: suspends an account (it can no longer sign in and its open sessions stop working) or reinstates it.
export const suspendUser = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const userId = requireString(body, 'userId', { max: 64 });
  if (typeof body.suspended !== 'boolean') throw new HttpError(400, 'suspended must be true or false');
  const suspend: boolean = body.suspended;
  const admin = await requireRole(callerId(event), 'PLATFORM_ADMIN');

  if (userId === admin.userId) throw new HttpError(400, 'You cannot suspend your own account');
  const user = await getUser(userId, true);
  if (!user) throw new HttpError(404, 'User not found');
  if (user.role === 'PLATFORM_ADMIN') throw new HttpError(403, 'Platform admins cannot be suspended');

  const target = { UserPoolId: process.env.USER_POOL_ID, Username: user.email };
  if (suspend) {
    await cognitoClient.send(new AdminDisableUserCommand(target));
    await cognitoClient.send(new AdminUserGlobalSignOutCommand(target)); // revoke refresh tokens
  } else {
    await cognitoClient.send(new AdminEnableUserCommand(target));
  }

  // The row is what getUser checks, so it also stops tokens that were issued before the suspension.
  await ddb.send(
    new UpdateCommand({
      TableName: process.env.USERS_TABLE_NAME,
      Key: { userId },
      UpdateExpression: suspend ? 'SET suspended = :t, suspendedAt = :now' : 'SET suspended = :f REMOVE suspendedAt',
      ExpressionAttributeValues: suspend ? { ':t': true, ':now': new Date().toISOString() } : { ':f': false },
    })
  );

  return respond(200, { userId, suspended: suspend });
});

// ------------------------------------------------------------------ my-notifications
const LIMIT = 50;

// The signed-in user's most recent notifications (delivery log), newest first.
export const myNotifications = withErrorHandling(async (event) => {
  const result = await ddb.send(
    new QueryCommand({
      TableName: process.env.NOTIFICATIONS_TABLE_NAME,
      KeyConditionExpression: 'recipientId = :r',
      ExpressionAttributeValues: { ':r': callerId(event) },
    })
  );

  // notificationId is a random UUID, so order by creation time in memory.
  const notifications = (result.Items || [])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, LIMIT)
    .map((n) => ({
      notificationId: n.notificationId,
      type: n.type,
      channel: n.channel,
      deliveryStatus: n.deliveryStatus,
      message: buildMessage(n.type, n.payload || {}).body,
      createdAt: n.createdAt,
    }));

  return respond(200, { notifications });
});

export const handler = routes({
  'GET /users/me': getMe,
  'POST /users/update-profile': updateProfile,
  'POST /users/report': reportUser,
  'GET /users/reported': reportedUsers,
  'GET /users/list': listUsers,
  'POST /users/suspend': suspendUser,
  'GET /notifications/mine': myNotifications,
});
