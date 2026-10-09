import { GetCommand, TransactWriteCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, requireApprovedHospital, requireRole, isConditionFailed, queryAll } from './lib/db';
import { requireEnum, requireIsoTime, requireString } from './lib/validation';
import { findDoctorConflict, hasConflict, SAME_HOSPITAL_BUFFER_MINUTES } from './lib/scheduling';
import { CONSULTATION_TYPES, MAX_SLOT_HOURS, MAX_SLOTS_PER_PROPOSAL } from './lib/constants';
import { sendNotification } from './lib/notify';
import { routes } from './lib/router';

// Sessions doctors offer, hospital admins approve, and patients browse.

// ------------------------------------------------------------------ propose-slot
// A hospital admin proposes up to MAX_SLOTS_PER_PROPOSAL slots for one doctor, each with the exact start and
// end the admin chose. The slots must not overlap (or sit closer than the same-hospital buffer) with each other
// or with the doctor's existing slots. The whole batch is accepted or rejected together.
export const proposeSlot = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const doctorId = requireString(body, 'doctorId', { max: 64 });
  const consultationType = body.consultationType
    ? requireEnum(body, 'consultationType', CONSULTATION_TYPES)
    : 'GENERAL';

  if (!Array.isArray(body.slots) || body.slots.length === 0) {
    throw new HttpError(400, 'slots must be a non-empty list of { startTime, endTime }');
  }
  if (body.slots.length > MAX_SLOTS_PER_PROPOSAL) {
    throw new HttpError(400, `You can propose at most ${MAX_SLOTS_PER_PROPOSAL} slots at once`);
  }

  const now = new Date().toISOString();
  const slots = body.slots.map((raw: unknown, i: number) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, `Slot ${i + 1} is invalid`);
    const startTime = requireIsoTime(raw as Record<string, any>, 'startTime');
    const endTime = requireIsoTime(raw as Record<string, any>, 'endTime');
    const duration = new Date(endTime).getTime() - new Date(startTime).getTime();
    if (duration <= 0) throw new HttpError(400, `Slot ${i + 1}: endTime must be after startTime`);
    if (duration > MAX_SLOT_HOURS * 3600 * 1000) {
      throw new HttpError(400, `Slot ${i + 1}: a slot cannot exceed ${MAX_SLOT_HOURS} hours`);
    }
    if (startTime <= now) throw new HttpError(400, `Slot ${i + 1}: startTime must be in the future`);
    return { startTime, endTime };
  });

  // The slots of one request must not clash with each other.
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      if (hasConflict(slots[j].startTime, slots[j].endTime, slots[i].startTime, slots[i].endTime, SAME_HOSPITAL_BUFFER_MINUTES)) {
        throw new HttpError(
          409,
          `Slots ${i + 1} and ${j + 1} overlap or are less than ${SAME_HOSPITAL_BUFFER_MINUTES} minutes apart`
        );
      }
    }
  }

  const callerUserId = callerId(event);
  const caller = await requireRole(callerUserId, 'HOSPITAL_ADMIN');
  const hospitalId = caller.hospitalId;
  await requireApprovedHospital(hospitalId);

  // The doctor must work for this hospital; the specialty comes from the affiliation, not the client.
  const affiliation = (
    await ddb.send(
      new GetCommand({ TableName: process.env.AFFILIATIONS_TABLE_NAME, Key: { doctorId, hospitalId } })
    )
  ).Item;
  if (!affiliation || affiliation.status !== 'ACTIVE') {
    throw new HttpError(400, 'This doctor is not affiliated with your hospital');
  }

  for (let i = 0; i < slots.length; i++) {
    const conflict = await findDoctorConflict(
      process.env.AVAILABILITY_TABLE_NAME!,
      doctorId,
      hospitalId,
      slots[i].startTime,
      slots[i].endTime,
      undefined,
      true
    );
    if (conflict) {
      throw new HttpError(409, `Slot ${i + 1}: the doctor already has an overlapping or too-close slot`);
    }
  }

  const created = new Date().toISOString();
  const items = slots.map((slot: { startTime: string; endTime: string }) => ({
    hospitalId,
    slotId: randomUUID(),
    doctorId,
    specialtyId: affiliation.specialtyId,
    consultationType,
    startTime: slot.startTime,
    endTime: slot.endTime,
    status: 'PENDING',
    proposedBy: callerUserId,
    createdAt: created,
  }));

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: items.map((Item: Record<string, any>) => ({
        Put: { TableName: process.env.AVAILABILITY_TABLE_NAME, Item, ConditionExpression: 'attribute_not_exists(slotId)' },
      })),
    })
  );

  // One message per batch, so the doctor is not sent up to five emails at once.
  const starts = items.map((i: Record<string, any>) => i.startTime).sort();
  const ends = items.map((i: Record<string, any>) => i.endTime).sort();
  await sendNotification(ddb, process.env.NOTIFICATIONS_TABLE_NAME!, {
    recipientId: doctorId,
    channels: ['EMAIL'],
    type: 'SLOT_PROPOSED',
    payload: {
      hospitalId,
      slotId: items[0].slotId,
      slotIds: items.map((i: Record<string, any>) => i.slotId),
      count: items.length,
      startTime: starts[0],
      endTime: ends[ends.length - 1],
    },
  });

  return respond(200, { slotIds: items.map((i: Record<string, any>) => i.slotId), status: 'PENDING' });
});

// ------------------------------------------------------------------ approve-slot
export const approveSlot = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const hospitalId = requireString(body, 'hospitalId', { max: 64 });
  const slotId = requireString(body, 'slotId', { max: 64 });
  const decision = requireEnum(body, 'decision', ['APPROVED', 'REJECTED'] as const);
  const doctorId = callerId(event);

  const slot = (
    await ddb.send(new GetCommand({ TableName: process.env.AVAILABILITY_TABLE_NAME, Key: { hospitalId, slotId } }))
  ).Item;
  if (!slot || slot.doctorId !== doctorId) throw new HttpError(403, 'Not authorized');

  // Only a proposal can be decided. Without this a doctor could re-open a BOOKED slot.
  if (slot.status !== 'PENDING') {
    throw new HttpError(409, `Slot is already ${slot.status} and can no longer be approved or rejected`);
  }

  if (decision === 'APPROVED') {
    if (slot.startTime <= new Date().toISOString()) throw new HttpError(409, 'This slot starts in the past');
    const conflict = await findDoctorConflict(
      process.env.AVAILABILITY_TABLE_NAME!,
      slot.doctorId,
      slot.hospitalId,
      slot.startTime,
      slot.endTime,
      slotId
    );
    if (conflict) throw new HttpError(409, 'Conflict detected at approval time');
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: process.env.AVAILABILITY_TABLE_NAME,
        Key: { hospitalId, slotId },
        UpdateExpression: 'SET #s = :s, decidedAt = :now',
        ConditionExpression: '#s = :pending',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': decision, ':pending': 'PENDING', ':now': new Date().toISOString() },
      })
    );
  } catch (err) {
    if (isConditionFailed(err)) throw new HttpError(409, 'Slot changed while being decided, please retry');
    throw err;
  }

  return respond(200, { slotId, status: decision });
});

// ------------------------------------------------------------------ pending-slots
// Doctor: upcoming slots proposed by hospitals that still await this doctor's decision.
export const pendingSlots = withErrorHandling(async (event) => {
  const doctorId = callerId(event);

  const slots = await queryAll({
    TableName: process.env.AVAILABILITY_TABLE_NAME,
    IndexName: 'doctor-index',
    KeyConditionExpression: 'doctorId = :d AND startTime >= :now',
    FilterExpression: '#s = :pending',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':d': doctorId, ':now': new Date().toISOString(), ':pending': 'PENDING' },
  });

  return respond(200, { slots });
});

// ------------------------------------------------------------------ doctor-slots
// Doctor: all of their upcoming slots (pending, approved, booked, offered) across hospitals.
export const doctorSlots = withErrorHandling(async (event) => {
  const doctorId = callerId(event);
  await requireRole(doctorId, 'DOCTOR');

  const slots = await queryAll({
    TableName: process.env.AVAILABILITY_TABLE_NAME,
    IndexName: 'doctor-index',
    KeyConditionExpression: 'doctorId = :d AND startTime >= :now',
    ExpressionAttributeValues: { ':d': doctorId, ':now': new Date().toISOString() },
  });

  return respond(200, { slots });
});

// ------------------------------------------------------------------ hospital-slots
// Hospital admin: upcoming slots of their own hospital in every status, so they can track proposals.
export const hospitalSlots = withErrorHandling(async (event) => {
  const admin = await requireRole(callerId(event), 'HOSPITAL_ADMIN');

  const slots = await queryAll({
    TableName: process.env.AVAILABILITY_TABLE_NAME,
    IndexName: 'hospital-time-index',
    KeyConditionExpression: 'hospitalId = :h AND startTime >= :from',
    ExpressionAttributeValues: {
      ':h': admin.hospitalId,
      // include today's earlier slots and recent history so rejected/expired proposals stay visible
      ':from': new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    },
  });

  return respond(200, { slots });
});

// ------------------------------------------------------------------ browse-slots
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_PAGES = 10;

function parseTime(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  if (Number.isNaN(Date.parse(value))) throw new HttpError(400, `${name} must be an ISO-8601 timestamp`);
  return new Date(value).toISOString();
}

// Public. Lists bookable (APPROVED, upcoming) slots of an approved hospital, newest pages via nextToken.
export const browseSlots = withErrorHandling(async (event) => {
  const params = event.queryStringParameters || {};
  const hospitalId = params.hospitalId;
  if (!hospitalId) throw new HttpError(400, 'hospitalId is required');

  const limit = Math.min(Math.max(parseInt(params.limit ?? '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const now = new Date().toISOString();
  const requestedFrom = parseTime(params.from, 'from');
  const from = requestedFrom && requestedFrom > now ? requestedFrom : now; // never list past slots
  const to = parseTime(params.to, 'to') ?? '9999-12-31T23:59:59.999Z';

  let startKey: Record<string, any> | undefined;
  if (params.nextToken) {
    try {
      startKey = JSON.parse(Buffer.from(params.nextToken, 'base64url').toString('utf8'));
    } catch {
      throw new HttpError(400, 'nextToken is invalid');
    }
  }

  const hospital = (
    await ddb.send(
      new GetCommand({ TableName: process.env.HOSPITALS_TABLE_NAME, Key: { hospitalId, itemType: 'PROFILE' } })
    )
  ).Item;
  if (!hospital || hospital.status !== 'APPROVED') throw new HttpError(404, 'Hospital not found');

  // Limit bounds the items examined per call, so keep paging until the page is full or exhausted.
  const slots: Record<string, any>[] = [];
  let pages = 0;
  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: process.env.AVAILABILITY_TABLE_NAME,
        IndexName: 'hospital-time-index',
        KeyConditionExpression: 'hospitalId = :h AND startTime BETWEEN :from AND :to',
        FilterExpression: '#s = :approved',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':h': hospitalId, ':from': from, ':to': to, ':approved': 'APPROVED' },
        Limit: limit - slots.length,
        ExclusiveStartKey: startKey,
      })
    );
    slots.push(...(result.Items || []));
    startKey = result.LastEvaluatedKey;
    pages++;
  } while (startKey && slots.length < limit && pages < MAX_PAGES);

  return respond(200, {
    slots: slots.map(({ proposedBy, ...publicFields }) => publicFields),
    nextToken: startKey ? Buffer.from(JSON.stringify(startKey)).toString('base64url') : undefined,
  });
});

export const handler = routes({
  'POST /availability/propose': proposeSlot,
  'POST /availability/approve': approveSlot,
  'GET /availability/pending': pendingSlots,
  'GET /availability/mine': doctorSlots,
  'GET /availability/hospital': hospitalSlots,
  'GET /availability/browse': browseSlots,
});
