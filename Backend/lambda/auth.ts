import { CognitoIdentityProviderClient, SignUpCommand, ConfirmSignUpCommand, AdminSetUserPasswordCommand, InitiateAuthCommand, RevokeTokenCommand, RespondToAuthChallengeCommand, ForgotPasswordCommand, ConfirmForgotPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './lib/db';
import { parseBody, respond, withErrorHandling, HttpError, clearRefreshCookie, requireAllowedOrigin } from './lib/http';
import { requireDate, requireEmail, requirePhone, requirePasswordHash, requireString } from './lib/validation';
import { deleteCognitoUserQuietly } from './lib/cognito';
import { sessionCookieHeader, sessionRefreshToken } from './lib/cookie-seal';
import { routes } from './lib/router';

// Everything that happens before or around signing in (all public routes).

// ------------------------------------------------------------------ patient-signup
const cognitoClient = new CognitoIdentityProviderClient({});

export const patientSignup = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const firstName = requireString(body, 'firstName', { max: 100 });
  const lastName = requireString(body, 'lastName', { max: 100 });
  const email = requireEmail(body);
  const password = requirePasswordHash(body);
  const phone = requirePhone(body); // E.164 so SNS can deliver SMS
  const dateOfBirth = requireDate(body, 'dateOfBirth');

  const signUpResult = await cognitoClient.send(
    new SignUpCommand({
      ClientId: process.env.USER_POOL_CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: 'email', Value: email }],
    })
  );
  const userId = signUpResult.UserSub!;

  try {
    await ddb.send(
      new PutCommand({
        TableName: process.env.USERS_TABLE_NAME,
        Item: { userId, firstName, lastName, email, phone, dateOfBirth, role: 'PATIENT', createdAt: new Date().toISOString() },
      })
    );
  } catch (err) {
    await deleteCognitoUserQuietly(email);
    throw err;
  }

  return respond(200, { message: 'Signup successful. Check your email for a verification code.' });
});

// ------------------------------------------------------------------ confirm-signup
export const confirmSignup = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const email = requireEmail(body);
  const confirmationCode = requireString(body, 'confirmationCode', { max: 20 });

  await cognitoClient.send(
    new ConfirmSignUpCommand({
      ClientId: process.env.USER_POOL_CLIENT_ID,
      Username: email,
      ConfirmationCode: confirmationCode,
    })
  );

  return respond(200, { message: 'Account confirmed. You can now log in.' });
});

// ------------------------------------------------------------------ login
export const login = withErrorHandling(async (event) => {
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

  // Only the ID token goes to the page: it is the one the API's authorizer checks. The access token is never needed.
  // The refresh token goes into an encrypted HttpOnly cookie, so the page can renew the session without ever seeing it.
  return respond(200, { idToken: auth.IdToken }, await sessionCookieHeader(auth.RefreshToken, event));
});

// ------------------------------------------------------------------ auth-session
/**
 * POST /auth/refresh: trades the HttpOnly refresh-token cookie for a new ID token (the page calls it when it loads and
 * when its ID token expires). Answers 200 with no idToken when there is no valid session, so a visitor who is simply
 * not signed in does not fill the console with errors.
 * POST /auth/logout: revokes the refresh token and clears the cookie.
 */
export const authSession = withErrorHandling(async (event) => {
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

// ------------------------------------------------------------------ new-password
/** Completes the first login of an account created with a temporary password (e.g. a doctor). */
export const newPassword = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const email = requireEmail(body);
  const newPassword = requirePasswordHash(body, 'newPassword');
  const session = requireString(body, 'session', { max: 4096 });

  const result = await cognitoClient.send(
    new RespondToAuthChallengeCommand({
      ClientId: process.env.USER_POOL_CLIENT_ID,
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      Session: session,
      ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
    })
  );

  const auth = result.AuthenticationResult;
  if (!auth) return respond(401, { message: 'Password change could not be completed' });

  // The refresh token goes into an encrypted HttpOnly cookie, so the page can renew the session without ever seeing it.
  return respond(200, { idToken: auth.IdToken }, await sessionCookieHeader(auth.RefreshToken, event));
});

// ------------------------------------------------------------------ forgot-password
const GENERIC = 'If an account exists for this email, a verification code has been sent to it.';

// Public: emails a verification code that lets the owner choose a new password (POST /auth/reset-password).
// The answer is the same whether or not the account exists, so the form cannot be used to find out who has one.
export const forgotPassword = withErrorHandling(async (event) => {
  const email = requireEmail(parseBody(event));

  try {
    await cognitoClient.send(new ForgotPasswordCommand({ ClientId: process.env.USER_POOL_CLIENT_ID, Username: email }));
  } catch (err: any) {
    // Rate limiting is about the caller, not the account, so it is safe to report.
    if (err?.name === 'LimitExceededException' || err?.name === 'TooManyRequestsException') throw err;
    // Unknown, unconfirmed, disabled or still-invited accounts: stay silent.
    console.warn('forgot-password not sent', err?.name);
  }

  return respond(200, { message: GENERIC });
});

// ------------------------------------------------------------------ reset-password
// Public: completes a password reset with the code emailed by POST /auth/forgot-password.
export const resetPassword = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const email = requireEmail(body);
  const code = requireString(body, 'code', { max: 20 });
  const newPassword = requirePasswordHash(body, 'newPassword');

  try {
    await cognitoClient.send(
      new ConfirmForgotPasswordCommand({
        ClientId: process.env.USER_POOL_CLIENT_ID,
        Username: email,
        ConfirmationCode: code,
        Password: newPassword,
      })
    );
  } catch (err: any) {
    // An unknown account must look like a wrong code, not like "Incorrect email or password".
    if (err?.name === 'UserNotFoundException') throw new HttpError(400, 'Invalid or expired verification code');
    if (err?.name === 'NotAuthorizedException') {
      throw new HttpError(400, 'This account cannot reset its password yet. Use the link from your invitation email.');
    }
    throw err;
  }

  return respond(200, { message: 'Password changed. You can now sign in.' });
});

export const handler = routes({
  'POST /patients/signup': patientSignup,
  'POST /patients/confirm-signup': confirmSignup,
  'POST /auth/login': login,
  'POST /auth/refresh': authSession,
  'POST /auth/logout': authSession,
  'POST /auth/new-password': newPassword,
  'POST /auth/forgot-password': forgotPassword,
  'POST /auth/reset-password': resetPassword,
});
