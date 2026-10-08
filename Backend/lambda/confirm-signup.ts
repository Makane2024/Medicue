import { CognitoIdentityProviderClient, ConfirmSignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import { parseBody, respond, withErrorHandling } from './lib/http';
import { requireEmail, requireString } from './lib/validation';

const cognitoClient = new CognitoIdentityProviderClient({});

export const handler = withErrorHandling(async (event) => {
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
