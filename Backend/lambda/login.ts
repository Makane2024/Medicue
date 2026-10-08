import {
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { requireEmail, requirePasswordHash, requireString } from './lib/validation';

const cognitoClient = new CognitoIdentityProviderClient({});

export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const email = requireEmail(body);
  const password = requireString(body, 'password', { max: 256 });
  // Accounts created before passwords were hashed in the browser still have their raw password in Cognito. The client
  // retries with it once, together with the hash it should become; after a successful sign-in the password is replaced
  // by that hash, so the raw one is sent at most once per account. Switch off with `-c allowLegacyLogin=false`.
  const upgradeTo = body.upgradeTo === undefined ? undefined : requirePasswordHash(body, 'upgradeTo');
  if (upgradeTo && process.env.ALLOW_LEGACY_LOGIN !== 'true') throw new HttpError(401, 'Incorrect email or password');

  let result;
  try {
    result = await cognitoClient.send(
      new InitiateAuthCommand({
        ClientId: process.env.USER_POOL_CLIENT_ID,
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: email, PASSWORD: password },
      })
    );
  } catch (err: any) {
    // A suspended account is disabled in Cognito.
    if (err?.name === 'NotAuthorizedException' && /disabled/i.test(err.message ?? '')) {
      throw new HttpError(403, 'Your account has been suspended. Contact the platform administrators.');
    }
    throw err;
  }

  // Accounts created by a hospital admin (doctors) sign in with the emailed temporary password and
  // must choose their own password first: hand the client the challenge to answer via /auth/new-password.
  if (result.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
    return respond(200, {
      challenge: 'NEW_PASSWORD_REQUIRED',
      session: result.Session,
      message: 'This is your first login. Set a new password using POST /auth/new-password.',
    });
  }

  const auth = result.AuthenticationResult;
  if (!auth) return respond(401, { message: 'Login could not be completed' });

  if (upgradeTo) {
    try {
      await cognitoClient.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: process.env.USER_POOL_ID,
          Username: email,
          Password: upgradeTo,
          Permanent: true,
        })
      );
    } catch (err) {
      // The sign-in itself succeeded; the next one tries the upgrade again.
      console.error('Password upgrade failed', err);
    }
  }

  // Only the ID token goes to the browser: it is the one the API's authorizer checks. The access and refresh
  // tokens are never needed by the client, so they are not handed out.
  return respond(200, {
    idToken: auth.IdToken,
  });
});
