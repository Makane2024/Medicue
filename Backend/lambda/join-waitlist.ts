import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, queryAll } from './lib/db';
import { requireEnum, requireString } from './lib/validation';

const PREFERENCE_TYPES = ['HOSPITAL', 'SPECIALTY', 'DOCTOR'] as const;

const SLOT_QUERIES = {
  DOCTOR: (id: string) => ({
    IndexName: 'doctor-index',
    KeyConditionExpression: 'doctorId = :id AND startTime >= :now',
    values: { ':id': id },
  }),
  SPECIALTY: (id: string) => ({
    IndexName: 'specialty-index',
    KeyConditionExpression: 'specialtyId = :id AND startTime >= :now',
    values: { ':id': id },
  }),
  HOSPITAL: (id: string) => ({
    IndexName: 'hospital-time-index',
    KeyConditionExpression: 'hospitalId = :id AND startTime >= :now',
    values: { ':id': id },
  }),
};

export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const preferenceType = requireEnum(body, 'preferenceType', PREFERENCE_TYPES);
  const targetField = { DOCTOR: 'doctorId', SPECIALTY: 'specialtyId', HOSPITAL: 'hospitalId' }[preferenceType];
  const targetId = requireString(body, targetField, { max: 64 });
  const patientId = callerId(event);

  // Waitlisting only makes sense when nothing matching is bookable right now.
  const query = SLOT_QUERIES[preferenceType](targetId);
  const openSlots = await queryAll({
    TableName: process.env.AVAILABILITY_TABLE_NAME,
    IndexName: query.IndexName,
    KeyConditionExpression: query.KeyConditionExpression,
    FilterExpression: '#s = :approved',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ...query.values, ':now': new Date().toISOString(), ':approved': 'APPROVED' },
  });
  if (openSlots.length > 0) {
    throw new HttpError(409, `This ${preferenceType.toLowerCase()} already has available slots, please book directly instead`);
  }

  const matchKey = `${preferenceType}#${targetId}`;

  const mine = await queryAll({
    TableName: process.env.WAITLIST_TABLE_NAME,
    KeyConditionExpression: 'patientId = :p',
    FilterExpression: 'matchKey = :m AND #s IN (:waiting, :offered)',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':p': patientId, ':m': matchKey, ':waiting': 'WAITING', ':offered': 'OFFERED' },
  });
  if (mine.length > 0) throw new HttpError(409, 'You are already on this waitlist');

  const waitlistId = randomUUID();
  await ddb.send(
    new PutCommand({
      TableName: process.env.WAITLIST_TABLE_NAME,
      Item: {
        patientId,
        waitlistId,
        preferenceType,
        hospitalId: preferenceType === 'HOSPITAL' ? targetId : null,
        specialtyId: preferenceType === 'SPECIALTY' ? targetId : null,
        doctorId: preferenceType === 'DOCTOR' ? targetId : null,
        matchKey,
        status: 'WAITING',
        createdAt: new Date().toISOString(),
      },
    })
  );

  return respond(200, { waitlistId, status: 'WAITING' });
});
