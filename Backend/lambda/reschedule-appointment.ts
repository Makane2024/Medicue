import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, isTransactionCanceled } from './lib/db';
import { requireString } from './lib/validation';
import { sendNotification } from './lib/notify';
import { releaseSlot, releaseTablesFromEnv } from './lib/waitlist';
import { PATIENT_RESCHEDULE_CUTOFF_HOURS } from './lib/constants';

export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const appointmentId = requireString(body, 'appointmentId', { max: 64 });
  const newHospitalId = requireString(body, 'newHospitalId', { max: 64 });
  const newSlotId = requireString(body, 'newSlotId', { max: 64 });
  const caller = callerId(event);

  const appointment = (
    await ddb.send(
      new GetCommand({ TableName: process.env.APPOINTMENTS_TABLE_NAME, Key: { appointmentId, itemType: 'METADATA' } })
    )
  ).Item;
  if (!appointment) throw new HttpError(404, 'Appointment not found');

  const isPatient = appointment.patientId === caller;
  const isDoctor = appointment.doctorId === caller;

  if (isPatient) {
    if (appointment.status === 'MISSED') {
      throw new HttpError(403, 'A missed appointment cannot be rescheduled or refunded');
    }
    if (appointment.status !== 'CONFIRMED') {
      throw new HttpError(403, 'Only a confirmed appointment can be rescheduled');
    }
    const cutoffTime = new Date(appointment.startTime).getTime() - PATIENT_RESCHEDULE_CUTOFF_HOURS * 3600 * 1000;
    if (Date.now() > cutoffTime) {
      throw new HttpError(
        403,
        `Appointments can only be rescheduled more than ${PATIENT_RESCHEDULE_CUTOFF_HOURS} hours before the start time`
      );
    }
  } else if (isDoctor) {
    if (appointment.status === 'COMPLETED') throw new HttpError(403, 'A completed appointment cannot be rescheduled');
    if (appointment.status !== 'CONFIRMED' && appointment.status !== 'MISSED') {
      throw new HttpError(409, 'This appointment cannot be rescheduled from its current state');
    }
  } else {
    throw new HttpError(403, 'Not authorized');
  }

  if (newHospitalId === appointment.hospitalId && newSlotId === appointment.slotId) {
    throw new HttpError(400, 'The new slot must differ from the current one');
  }

  const newSlot = (
    await ddb.send(
      new GetCommand({
        TableName: process.env.AVAILABILITY_TABLE_NAME,
        Key: { hospitalId: newHospitalId, slotId: newSlotId },
      })
    )
  ).Item;
  if (!newSlot || newSlot.status !== 'APPROVED') throw new HttpError(409, 'New slot is not available');
  if (newSlot.startTime <= new Date().toISOString()) throw new HttpError(409, 'New slot has already started');
  // No payment flow exists for a fee difference, so the consultation type must stay the same.
  if ((newSlot.consultationType || 'GENERAL') !== (appointment.consultationType || 'GENERAL')) {
    throw new HttpError(409, 'The new slot has a different consultation type (and fee)');
  }

  const oldSlot = (
    await ddb.send(
      new GetCommand({
        TableName: process.env.AVAILABILITY_TABLE_NAME,
        Key: { hospitalId: appointment.hospitalId, slotId: appointment.slotId },
      })
    )
  ).Item;
  const oldPayment = (
    await ddb.send(
      new GetCommand({ TableName: process.env.APPOINTMENTS_TABLE_NAME, Key: { appointmentId, itemType: 'PAYMENT' } })
    )
  ).Item;

  const newAppointmentId = randomUUID();
  const now = new Date().toISOString();
  const baseItems: any[] = [
    {
      Update: {
        TableName: process.env.APPOINTMENTS_TABLE_NAME,
        Key: { appointmentId, itemType: 'METADATA' },
        UpdateExpression: 'SET #s = :rescheduled, rescheduledTo = :newId',
        ConditionExpression: '#s = :current',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':rescheduled': 'RESCHEDULED', ':current': appointment.status, ':newId': newAppointmentId },
      },
    },
    {
      Update: {
        TableName: process.env.AVAILABILITY_TABLE_NAME,
        Key: { hospitalId: newHospitalId, slotId: newSlotId },
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
          appointmentId: newAppointmentId,
          itemType: 'METADATA',
          patientId: appointment.patientId,
          doctorId: newSlot.doctorId,
          hospitalId: newHospitalId,
          slotId: newSlotId,
          consultationType: appointment.consultationType || 'GENERAL',
          specialtyId: newSlot.specialtyId,
          fee: appointment.fee,
          status: 'CONFIRMED',
          startTime: newSlot.startTime,
          endTime: newSlot.endTime,
          rescheduledFrom: appointmentId,
          ...(appointment.note ? { note: appointment.note } : {}),
          createdAt: now,
        },
      },
    },
  ];
  // Carry the payment over so the new appointment stays traceable for refunds and audits.
  if (oldPayment) {
    baseItems.push({
      Put: {
        TableName: process.env.APPOINTMENTS_TABLE_NAME,
        Item: { ...oldPayment, appointmentId: newAppointmentId, carriedOverFrom: appointmentId, updatedAt: now },
      },
    });
  }

  // Free the old slot only if it is still booked and in the future (a missed, past slot stays closed).
  const releaseOld = oldSlot && oldSlot.status === 'BOOKED' && oldSlot.startTime > now;

  try {
    if (releaseOld) {
      await releaseSlot(
        ddb,
        releaseTablesFromEnv(),
        {
          hospitalId: appointment.hospitalId,
          slotId: appointment.slotId,
          doctorId: oldSlot.doctorId,
          specialtyId: oldSlot.specialtyId,
          startTime: oldSlot.startTime,
        },
        { fromStatus: 'BOOKED', baseItems }
      );
    } else {
      await ddb.send(new TransactWriteCommand({ TransactItems: baseItems }));
    }
  } catch (err) {
    if (isTransactionCanceled(err)) throw new HttpError(409, 'New slot was just taken, or the appointment changed');
    throw err;
  }

  await sendNotification(ddb, process.env.NOTIFICATIONS_TABLE_NAME!, {
    recipientId: appointment.patientId,
    channels: ['EMAIL', 'SMS'],
    type: 'RESCHEDULE',
    payload: { oldAppointmentId: appointmentId, newAppointmentId, startTime: newSlot.startTime },
  });

  return respond(200, { oldAppointmentId: appointmentId, newAppointmentId });
});
