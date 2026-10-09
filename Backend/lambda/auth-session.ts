import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RevokeTokenCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { clearRefreshCookie, requireAllowedOrigin, respond, withErrorHandling } from './lib/http';
import { sessionRefreshToken } from './lib/cookie-seal';

const cognitoClient = new CognitoIdentityProviderClient({});

/**
 * POST /auth/refresh: trades the HttpOnly refresh-token cookie for a new ID token (the page calls it when it loads and
 * when its ID token expires). Answers 200 with no idToken when there is no valid session, so a visitor who is simply
 * not signed in does not fill the console with errors.
 * POST /auth/logout: revokes the refresh token and clears the cookie.
 */
export const handler = withErrorHandling(async (event) => {
  requireAllowedOrigin(event); // a cookie authenticates this call, so only our own frontend may make it
  const token = await sessionRefreshToken(event);
  const clear = { 'Set-Cookie': clearRefreshCookie(event) };

  if (String(event.resource ?? event.path).endsWith('/logout')) {
    if (token) {
      try {
        await cognitoClient.send(new RevokeTokenCommand({ ClientId: process.env.USER_POOL_CLIENT_ID, Token: token }));
      } catch (err) {
        console.warn('Refresh token could not be revoked', err);
      }
    }
    return respond(200, { ok: true }, clear);
  }

  if (!token) return respond(200, {});
  try {
    const result = await cognitoClient.send(
      new InitiateAuthCommand({
        ClientId: process.env.USER_POOL_CLIENT_ID,
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        AuthParameters: { REFRESH_TOKEN: token },
      })
    );
    const idToken = result.AuthenticationResult?.IdToken;
    return idToken ? respond(200, { idToken }) : respond(200, {}, clear);
  } catch (err: any) {
    // Expired, revoked, or the account was suspended or deleted: the session is over.
    if (err?.name === 'NotAuthorizedException' || err?.name === 'UserNotFoundException') return respond(200, {}, clear);
    throw err;
  }
});
