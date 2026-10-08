import {
  CognitoIdentityProviderClient,
  RespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { parseBody, respond, withErrorHandling } from './lib/http';
import { requireEmail, requirePasswordHash, requireString } from './lib/validation';

const cognitoClient = new CognitoIdentityProviderClient({});

/** Completes the first login of an account created with a temporary password (e.g. a doctor). */
export const handler = withErrorHandling(async (event) => {
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

  return respond(200, {
    idToken: auth.IdToken,
  });
});
