import { CognitoIdentityProviderClient, SignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './lib/db';
import { parseBody, respond, withErrorHandling } from './lib/http';
import { requireDate, requireEmail, requirePhone, requireString } from './lib/validation';
import { deleteCognitoUserQuietly } from './lib/cognito';

const cognitoClient = new CognitoIdentityProviderClient({});

export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const firstName = requireString(body, 'firstName', { max: 100 });
  const lastName = requireString(body, 'lastName', { max: 100 });
  const email = requireEmail(body);
  const password = requireString(body, 'password', { min: 8, max: 256 });
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

  return respond(200, { message: 'Signup successful. Check your email for a verification code.', userId });
});
