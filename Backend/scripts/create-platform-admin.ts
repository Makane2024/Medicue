/**
 * One-off bootstrap: creates the first PLATFORM_ADMIN (nothing in the API can create one).
 *
 *   USER_POOL_ID=... USERS_TABLE_NAME=... npx tsx scripts/create-platform-admin.ts admin@example.com 'S3cret-Passw0rd' Ada Lovelace +237650000000
 *
 * Both ids are printed as outputs by `cdk deploy` (UserPoolId, UsersTableName).
 */
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

async function main() {
  const [email, password, firstName = 'Platform', lastName = 'Admin', phone] = process.argv.slice(2);
  const userPoolId = process.env.USER_POOL_ID;
  const usersTable = process.env.USERS_TABLE_NAME;
  if (!email || !password || !userPoolId || !usersTable) {
    console.error('Usage: USER_POOL_ID=... USERS_TABLE_NAME=... tsx scripts/create-platform-admin.ts <email> <password> [first] [last] [phone]');
    process.exit(1);
  }

  const cognito = new CognitoIdentityProviderClient({});
  const created = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
    })
  );
  await cognito.send(
    new AdminSetUserPasswordCommand({ UserPoolId: userPoolId, Username: email, Password: password, Permanent: true })
  );

  const userId = created.User?.Attributes?.find((a) => a.Name === 'sub')?.Value ?? created.User!.Username!;
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  await ddb.send(
    new PutCommand({
      TableName: usersTable,
      Item: { userId, firstName, lastName, email, phone, role: 'PLATFORM_ADMIN', createdAt: new Date().toISOString() },
    })
  );
  console.log(`Platform admin created: ${email} (userId ${userId})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
