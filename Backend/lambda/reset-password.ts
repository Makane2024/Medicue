import { CognitoIdentityProviderClient, ConfirmForgotPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import { HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { requireEmail, requireString } from './lib/validation';

const cognitoClient = new CognitoIdentityProviderClient({});

// Public: completes a password reset with the code emailed by POST /auth/forgot-password.
export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const email = requireEmail(body);
  const code = requireString(body, 'code', { max: 20 });
  const newPassword = requireString(body, 'newPassword', { min: 8, max: 256 });

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
