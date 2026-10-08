import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, isTransactionCanceled, queryAll, requireRole } from './lib/db';
import { requireString } from './lib/validation';
import { getAmount, HOLD_EXPIRY_MINUTES, MAX_PENDING_HOLDS_PER_PATIENT, MAX_VISIT_NOTE_CHARS } from './lib/constants';

export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const hospitalId = requireString(body, 'hospitalId', { max: 64 });
  const slotId = requireString(body, 'slotId', { max: 64 });
  const patientId = callerId(event);
  await requireRole(patientId, 'PATIENT');

  const slot = (
    await ddb.send(new GetCommand({ TableName: process.env.AVAILABILITY_TABLE_NAME, Key: { hospitalId, slotId } }))
  ).Item;
  if (!slot || slot.status !== 'APPROVED') throw new HttpError(409, 'Slot is not available');
  if (slot.startTime <= new Date().toISOString()) throw new HttpError(409, 'This slot has already started');

  // The consultation type (and therefore the fee) is fixed by the slot, never by the client.
  const consultationType = slot.consultationType || 'GENERAL';

  // An optional note on what the patient is coming in for. Only the patient and the doctor can read it
  // (my-appointments leaves it out for everybody else), and only specialist visits have one.
  if (body.note !== undefined && typeof body.note !== 'string') throw new HttpError(400, 'note must be text');
  const note = (body.note ?? '').trim();
  if (note.length > MAX_VISIT_NOTE_CHARS) {
    throw new HttpError(400, `note must be at most ${MAX_VISIT_NOTE_CHARS} characters`);
  }
  if (note && consultationType !== 'SPECIALIST') {
    throw new HttpError(400, 'A note can only be added to a specialist appointment');
  }

  const upcoming = await queryAll({
    TableName: process.env.APPOINTMENTS_TABLE_NAME,
    IndexName: 'patient-index',
    KeyConditionExpression: 'patientId = :p AND startTime >= :now',
    FilterExpression: '#s IN (:pending, :confirmed)',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':p': patientId,
      ':now': new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
      ':pending': 'PENDING_PAYMENT',
      ':confirmed': 'CONFIRMED',
    },
  });

  // Stops one patient from locking many slots by letting unpaid holds expire.
  if (upcoming.filter((a) => a.status === 'PENDING_PAYMENT').length >= MAX_PENDING_HOLDS_PER_PATIENT) {
    throw new HttpError(429, 'You have too many unpaid bookings. Complete or wait out a pending payment first.');
  }
  if (upcoming.some((a) => a.startTime < slot.endTime && a.endTime > slot.startTime)) {
    throw new HttpError(409, 'You already have an appointment that overlaps this slot');
  }

  const appointmentId = randomUUID();
  const now = new Date();

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: process.env.AVAILABILITY_TABLE_NAME,
              Key: { hospitalId, slotId },
              UpdateExpression: 'SET #s = :booked',
              ConditionExpression: '#s = :approved',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: { ':booked': 'BOOKED', ':approved': 'APPROVED' },
            },
          },
          {
            Put: {
              TableName: process.env.APPOINTMENTS_TABLE_NAME,
              Item: {
                appointmentId,
                itemType: 'METADATA',
                patientId,
                doctorId: slot.doctorId,
                hospitalId,
                slotId,
                consultationType,
                specialtyId: slot.specialtyId,
                fee: getAmount(consultationType),
                status: 'PENDING_PAYMENT',
                startTime: slot.startTime,
                endTime: slot.endTime,
                ...(note ? { note } : {}),
                createdAt: now.toISOString(),
              },
            },
          },
        ],
      })
    );
  } catch (err) {
    if (isTransactionCanceled(err)) throw new HttpError(409, 'Slot was just taken by someone else');
    throw err;
  }

  return respond(200, {
    appointmentId,
    status: 'PENDING_PAYMENT',
    amount: getAmount(consultationType),
    payBefore: new Date(now.getTime() + HOLD_EXPIRY_MINUTES * 60 * 1000).toISOString(),
  });
});
