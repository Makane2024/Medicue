import { randomInt } from 'crypto';
import { CognitoIdentityProviderClient, AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const cognitoClient = new CognitoIdentityProviderClient({});

/**
 * A random temporary password for an invited doctor. Letters and digits only, so it can sit in the
 * invitation link without any URL escaping (Cognito's own generator also produces #, & and %).
 * Always contains a lower-case letter, an upper-case letter and a digit, as the pool policy requires.
 */
export function generateTemporaryPassword(length = 16): string {
  const lower = 'abcdefghijkmnopqrstuvwxyz'; // no l, to avoid look-alikes when typed by hand
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
  const digits = '23456789'; // no 0 or 1
  const all = lower + upper + digits;
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(lower), pick(upper), pick(digits)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Compensation for half-finished signups: removes the Cognito user, never throws. */
export async function deleteCognitoUserQuietly(username: string) {
  try {
    await cognitoClient.send(new AdminDeleteUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: username }));
  } catch (err) {
    console.error('Failed to clean up Cognito user', err);
  }
}

/** Removes the Cognito user. A user that is already gone counts as success; any other failure is thrown. */
export async function deleteCognitoUser(username: string) {
  try {
    await cognitoClient.send(new AdminDeleteUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: username }));
  } catch (err: any) {
    if (err?.name !== 'UserNotFoundException') throw err;
  }
}
