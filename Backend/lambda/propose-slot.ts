import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, requireApprovedHospital, requireRole } from './lib/db';
import { requireEnum, requireIsoTime, requireString } from './lib/validation';
import { findDoctorConflict, hasConflict, SAME_HOSPITAL_BUFFER_MINUTES } from './lib/scheduling';
import { CONSULTATION_TYPES, MAX_SLOT_HOURS, MAX_SLOTS_PER_PROPOSAL } from './lib/constants';
import { sendNotification } from './lib/notify';

// A hospital admin proposes up to MAX_SLOTS_PER_PROPOSAL slots for one doctor, each with the exact start and
// end the admin chose. The slots must not overlap (or sit closer than the same-hospital buffer) with each other
// or with the doctor's existing slots. The whole batch is accepted or rejected together.
export const handler = withErrorHandling(async (event) => {
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
