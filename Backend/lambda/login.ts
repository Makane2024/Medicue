import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import { HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { requireEmail, requireString } from './lib/validation';

const cognitoClient = new CognitoIdentityProviderClient({});

export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const email = requireEmail(body);
  const password = requireString(body, 'password', { max: 256 });

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

  return respond(200, {
    idToken: auth.IdToken,
    accessToken: auth.AccessToken,
    refreshToken: auth.RefreshToken,
    expiresIn: auth.ExpiresIn,
  });
});
