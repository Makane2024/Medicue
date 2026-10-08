import { CognitoIdentityProviderClient, ForgotPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import { parseBody, respond, withErrorHandling } from './lib/http';
import { requireEmail } from './lib/validation';

const cognitoClient = new CognitoIdentityProviderClient({});

const GENERIC = 'If an account exists for this email, a verification code has been sent to it.';

// Public: emails a verification code that lets the owner choose a new password (POST /auth/reset-password).
// The answer is the same whether or not the account exists, so the form cannot be used to find out who has one.
export const handler = withErrorHandling(async (event) => {
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
