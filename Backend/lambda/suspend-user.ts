import {
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, getUser, requireRole } from './lib/db';
import { requireString } from './lib/validation';

const cognitoClient = new CognitoIdentityProviderClient({});

// Platform admin: suspends an account (it can no longer sign in and its open sessions stop working) or reinstates it.
export const handler = withErrorHandling(async (event) => {
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
