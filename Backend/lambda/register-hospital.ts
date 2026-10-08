import { CognitoIdentityProviderClient, SignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { ddb } from './lib/db';
import { HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { requireEmail, requirePhone, requireString } from './lib/validation';
import { deleteCognitoUserQuietly } from './lib/cognito';

const cognitoClient = new CognitoIdentityProviderClient({});
const s3Client = new S3Client({});

// API Gateway/Lambda cap a synchronous payload at ~6 MB, and base64 adds a third on top.
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const firstName = requireString(body, 'firstName', { max: 100 });
  const lastName = requireString(body, 'lastName', { max: 100 });
  const email = requireEmail(body);
  const password = requireString(body, 'password', { min: 8, max: 256 });
  const hospitalName = requireString(body, 'hospitalName', { max: 200 });
  const address = requireString(body, 'address', { max: 300 });
  const phone = requirePhone(body);
  const documentBase64 = requireString(body, 'documentBase64', { max: Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 8 });

  const document = Buffer.from(documentBase64, 'base64');
  if (document.length === 0 || document.length > MAX_DOCUMENT_BYTES) {
    throw new HttpError(400, 'documentBase64 must decode to a PDF of at most 4 MB');
  }
  if (document.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new HttpError(400, 'documentBase64 must be a PDF file');
  }

  const signUpResult = await cognitoClient.send(
    new SignUpCommand({
      ClientId: process.env.USER_POOL_CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: 'email', Value: email }],
    })
  );
  const userId = signUpResult.UserSub!;
  const hospitalId = randomUUID();
  const docKey = `verification-docs/${hospitalId}.pdf`;
  const now = new Date().toISOString();

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.BUCKET_NAME,
        Key: docKey,
        Body: document,
        ContentType: 'application/pdf',
      })
    );

    await ddb.send(
      new PutCommand({
        TableName: process.env.USERS_TABLE_NAME,
        Item: { userId, firstName, lastName, email, role: 'HOSPITAL_ADMIN', hospitalId, createdAt: now },
      })
    );

    await ddb.send(
      new PutCommand({
        TableName: process.env.HOSPITALS_TABLE_NAME,
        Item: {
          hospitalId,
          itemType: 'PROFILE',
          name: hospitalName,
          address,
          phone,
          adminUserId: userId,
          verificationDocKey: docKey,
          status: 'PENDING',
          createdAt: now,
        },
      })
    );
  } catch (err) {
    await deleteCognitoUserQuietly(email);
    throw err;
  }

  return respond(200, { message: 'Hospital submitted for review.', hospitalId });
});
