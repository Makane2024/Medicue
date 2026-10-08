import { CognitoIdentityProviderClient, AdminCreateUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './db';
import { HttpError } from './http';
import { deleteCognitoUserQuietly, generateTemporaryPassword } from './cognito';
import { slugify } from './validation';

const cognitoClient = new CognitoIdentityProviderClient({});

export type InvitedRole = 'PATIENT' | 'DOCTOR' | 'STAFF';

export interface NewAccount {
  role: InvitedRole;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dateOfBirth?: string;
  /** Doctors only. */
  specialty?: string;
  bio?: string;
  /** Required for doctors and staff: the hospital they work at. */
  hospitalId?: string;
}

/**
 * Creates an account that somebody else (a hospital admin or the platform admin) set up: Cognito emails the
 * person a link with a generated temporary password (see the invitation template in api-stack.ts) and they only
 * choose their own password. A doctor who already has an account is simply affiliated with the hospital.
 * Anything else that already uses the email is refused. If a later step fails, the Cognito user is removed again.
 */
export async function inviteAccount(account: NewAccount): Promise<{ userId: string; created: boolean }> {
  const { role, firstName, lastName, email, hospitalId } = account;
  if ((role === 'DOCTOR' || role === 'STAFF') && !hospitalId) throw new HttpError(400, `${role} accounts need a hospital`);
  const specialtyId = role === 'DOCTOR' ? slugify(account.specialty ?? '') : '';
  if (role === 'DOCTOR' && !specialtyId) throw new HttpError(400, 'specialty must contain letters or digits');

  const existing = await ddb.send(
    new QueryCommand({
      TableName: process.env.USERS_TABLE_NAME,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
    })
  );

  let userId: string;
  let created = false;
  const current = existing.Items?.[0];
  if (current) {
    // A doctor can work for several hospitals, but any other account must not silently change role.
    if (role !== 'DOCTOR' || current.role !== 'DOCTOR') {
      throw new HttpError(409, current.role === role ? 'An account with this email already exists' : `This email already belongs to a ${current.role.toLowerCase().replace('_', ' ')} account`);
    }
    userId = current.userId;
  } else {
    const result = await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: email,
        DesiredDeliveryMediums: ['EMAIL'],
        TemporaryPassword: generateTemporaryPassword(),
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
      })
    );
    userId = result.User?.Attributes?.find((a) => a.Name === 'sub')?.Value ?? result.User!.Username!;
    created = true;
  }

  try {
    if (created) {
      await ddb.send(
        new PutCommand({
          TableName: process.env.USERS_TABLE_NAME,
          Item: {
            userId,
            firstName,
            lastName,
            email,
            role,
            ...(account.phone ? { phone: account.phone } : {}),
            ...(account.dateOfBirth ? { dateOfBirth: account.dateOfBirth } : {}),
            ...(role === 'DOCTOR' && account.bio ? { bio: account.bio } : {}),
            ...(role !== 'PATIENT' ? { hospitalId } : {}),
            createdAt: new Date().toISOString(),
          },
        })
      );
    }
    if (role === 'DOCTOR') {
      await ddb.send(
        new PutCommand({
          TableName: process.env.AFFILIATIONS_TABLE_NAME,
          Item: {
            doctorId: userId,
            hospitalId,
            specialty: account.specialty,
            specialtyId,
            status: 'ACTIVE',
            createdAt: new Date().toISOString(),
          },
        })
      );
    }
  } catch (err) {
    if (created) await deleteCognitoUserQuietly(email);
    throw err;
  }

  return { userId, created };
}
