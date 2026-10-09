import { CognitoIdentityProviderClient, SignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { ddb, queryAll, isConditionFailed, requireRole } from './lib/db';
import { HttpError, parseBody, respond, withErrorHandling, callerId } from './lib/http';
import { requireEmail, requirePhone, requirePasswordHash, requireString, requireEnum } from './lib/validation';
import { deleteCognitoUserQuietly } from './lib/cognito';
import { sendNotification } from './lib/notify';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { summarize } from './lib/stats';
import { routes } from './lib/router';

// Hospital registration, approval and listing, and the hospital admin's statistics.

// ------------------------------------------------------------------ register-hospital
const cognitoClient = new CognitoIdentityProviderClient({});
const s3Client = new S3Client({});

// API Gateway/Lambda cap a synchronous payload at ~6 MB, and base64 adds a third on top.
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

export const registerHospital = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const firstName = requireString(body, 'firstName', { max: 100 });
  const lastName = requireString(body, 'lastName', { max: 100 });
  const email = requireEmail(body);
  const password = requirePasswordHash(body);
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

  return respond(200, { message: 'Hospital submitted for review.' });
});

// ------------------------------------------------------------------ list-approved-hospitals
// Public: lets patients discover hospitals they can book with.
export const listApprovedHospitals = withErrorHandling(async () => {
  const hospitals = await queryAll({
    TableName: process.env.HOSPITALS_TABLE_NAME,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :approved',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':approved': 'APPROVED' },
  });

  return respond(200, {
    hospitals: hospitals.map(({ hospitalId, name, address, phone }) => ({ hospitalId, name, address, phone })),
  });
});

// ------------------------------------------------------------------ review-hospital
export const reviewHospital = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const hospitalId = requireString(body, 'hospitalId', { max: 64 });
  const decision = requireEnum(body, 'decision', ['APPROVED', 'REJECTED'] as const);
  await requireRole(callerId(event), 'PLATFORM_ADMIN');

  let hospital;
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: process.env.HOSPITALS_TABLE_NAME,
        Key: { hospitalId, itemType: 'PROFILE' },
        UpdateExpression: 'SET #s = :s, reviewedAt = :now',
        ConditionExpression: 'attribute_exists(hospitalId)', // never create a phantom hospital
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': decision, ':now': new Date().toISOString() },
        ReturnValues: 'ALL_NEW',
      })
    );
    hospital = result.Attributes;
  } catch (err) {
    if (isConditionFailed(err)) throw new HttpError(404, 'Hospital not found');
    throw err;
  }

  if (hospital?.adminUserId) {
    await sendNotification(ddb, process.env.NOTIFICATIONS_TABLE_NAME!, {
      recipientId: hospital.adminUserId,
      channels: ['EMAIL'],
      type: 'HOSPITAL_REVIEWED',
      payload: { hospitalName: hospital.name, decision },
    });
  }

  return respond(200, { hospitalId, status: decision });
});

// ------------------------------------------------------------------ list-hospitals
const DOC_URL_TTL_SECONDS = 900;

// Platform admin only: lists hospitals by status, with a short-lived link to the verification PDF.
export const listHospitals = withErrorHandling(async (event) => {
  await requireRole(callerId(event), 'PLATFORM_ADMIN');

  const status = event.queryStringParameters?.status;
  if (!status || !['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    throw new HttpError(400, 'status query parameter must be PENDING, APPROVED or REJECTED');
  }

  const hospitals = await queryAll({
    TableName: process.env.HOSPITALS_TABLE_NAME,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :status',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':status': status },
  });

  const withLinks = await Promise.all(
    hospitals.map(async (hospital) => ({
      ...hospital,
      verificationDocUrl: hospital.verificationDocKey
        ? await getSignedUrl(
            s3Client,
            new GetObjectCommand({ Bucket: process.env.BUCKET_NAME, Key: hospital.verificationDocKey }),
            { expiresIn: DOC_URL_TTL_SECONDS }
          )
        : undefined,
    }))
  );

  return respond(200, { hospitals: withLinks });
});

// ------------------------------------------------------------------ hospital-stats
const MAX_WINDOW_DAYS = 62;

// Hospital admin: how many appointments of their hospital were completed, missed, cancelled ... between `from` and
// `to` (ISO instants chosen by the client, e.g. this week or this month), in total and per calendar day.
// `tzOffsetMinutes` is the browser's Date#getTimezoneOffset so that days line up with the admin's wall clock.
export const hospitalStats = withErrorHandling(async (event) => {
  const caller = await requireRole(callerId(event), 'HOSPITAL_ADMIN');
  const q = event.queryStringParameters ?? {};

  const parse = (key: 'from' | 'to') => {
    const ms = Date.parse(q[key] ?? '');
    if (Number.isNaN(ms)) throw new HttpError(400, `${key} must be an ISO-8601 timestamp`);
    return ms;
  };
  const from = parse('from');
  const to = parse('to');
  if (to < from) throw new HttpError(400, 'to must not be before from');
  if (to - from > MAX_WINDOW_DAYS * 86_400_000) throw new HttpError(400, `The window can span at most ${MAX_WINDOW_DAYS} days`);
  const tz = q.tzOffsetMinutes === undefined ? 0 : Number(q.tzOffsetMinutes);
  if (!Number.isInteger(tz) || Math.abs(tz) > 14 * 60) throw new HttpError(400, 'tzOffsetMinutes must be a number of minutes');

  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();
  const appointments = await queryAll({
    TableName: process.env.APPOINTMENTS_TABLE_NAME,
    IndexName: 'hospital-index',
    KeyConditionExpression: 'hospitalId = :h AND startTime BETWEEN :from AND :to',
    ProjectionExpression: 'startTime, #s',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':h': caller.hospitalId, ':from': fromIso, ':to': toIso },
  });

  return respond(200, { from: fromIso, to: toIso, ...summarize(appointments as any, fromIso, toIso, tz) });
});

export const handler = routes({
  'POST /hospitals/register': registerHospital,
  'GET /hospitals/approved': listApprovedHospitals,
  'POST /hospitals/review': reviewHospital,
  'GET /hospitals/list': listHospitals,
  'GET /stats/hospital': hospitalStats,
});
