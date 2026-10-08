import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, isTransactionCanceled } from './lib/db';
import { requireString } from './lib/validation';
import { sendNotification } from './lib/notify';
import { releaseSlot, releaseTablesFromEnv } from './lib/waitlist';
import { getAmount, HOLD_EXPIRY_MINUTES } from './lib/constants';

// MOCK payment provider. Replace with a real checkout + verified provider callback before production.
// `simulateOutcome` is a testing hook and is only honoured when ALLOW_PAYMENT_SIMULATION=true.
const SIMULATION_ENABLED = process.env.ALLOW_PAYMENT_SIMULATION === 'true';

export const handler = withErrorHandling(async (event) => {
  if (!SIMULATION_ENABLED) {
    throw new HttpError(501, 'No payment provider is configured');
  }

  const body = parseBody(event);
  const appointmentId = requireString(body, 'appointmentId', { max: 64 });
  const outcome = body.simulateOutcome ?? 'SUCCESS';
  if (outcome !== 'SUCCESS' && outcome !== 'FAILED') {
    throw new HttpError(400, 'simulateOutcome must be SUCCESS or FAILED');
  }
  const patientId = callerId(event);

  const appointment = (
    await ddb.send(
      new GetCommand({
        TableName: process.env.APPOINTMENTS_TABLE_NAME,
        Key: { appointmentId, itemType: 'METADATA' },
      })
    )
  ).Item;
  if (!appointment) throw new HttpError(404, 'Appointment not found');
  if (appointment.patientId !== patientId) throw new HttpError(403, 'Not authorized');
  if (appointment.status !== 'PENDING_PAYMENT') throw new HttpError(409, 'Appointment is not awaiting payment');
  if (Date.now() > new Date(appointment.createdAt).getTime() + HOLD_EXPIRY_MINUTES * 60 * 1000) {
    throw new HttpError(409, 'The payment window for this booking has expired');
  }

  const paymentId = randomUUID();
  const amount = getAmount(appointment.consultationType);
  const now = new Date().toISOString();
  const paymentItem = {
    TableName: process.env.APPOINTMENTS_TABLE_NAME,
    Item: {
      appointmentId,
      itemType: 'PAYMENT',
      paymentId,
      amount,
      paymentStatus: outcome,
      provider: 'MOCK_MTN',
      transactionRef: paymentId,
      createdAt: now,
      updatedAt: now,
    },
  };
  const appointmentKey = { appointmentId, itemType: 'METADATA' };
  const moveFromPending = (to: string) => ({
    Update: {
      TableName: process.env.APPOINTMENTS_TABLE_NAME,
      Key: appointmentKey,
      UpdateExpression: 'SET #s = :to',
      ConditionExpression: '#s = :pending', // loses cleanly against the hold-expiry job
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':to': to, ':pending': 'PENDING_PAYMENT' },
    },
  });

  try {
    if (outcome === 'SUCCESS') {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            moveFromPending('CONFIRMED'),
            {
              ConditionCheck: {
                TableName: process.env.AVAILABILITY_TABLE_NAME,
                Key: { hospitalId: appointment.hospitalId, slotId: appointment.slotId },
                ConditionExpression: '#s = :booked',
                ExpressionAttributeNames: { '#s': 'status' },
                ExpressionAttributeValues: { ':booked': 'BOOKED' },
              },
            },
            { Put: paymentItem },
          ],
        })
      );
    } else {
      const slot = (
        await ddb.send(
          new GetCommand({
            TableName: process.env.AVAILABILITY_TABLE_NAME,
            Key: { hospitalId: appointment.hospitalId, slotId: appointment.slotId },
          })
        )
      ).Item;
      const baseItems = [moveFromPending('CANCELLED'), { Put: paymentItem }];
      if (slot) {
        await releaseSlot(
          ddb,
          releaseTablesFromEnv(),
          {
            hospitalId: appointment.hospitalId,
            slotId: appointment.slotId,
            doctorId: slot.doctorId,
            specialtyId: slot.specialtyId,
            startTime: slot.startTime,
          },
          { fromStatus: 'BOOKED', baseItems }
        );
      } else {
        await ddb.send(new TransactWriteCommand({ TransactItems: baseItems }));
      }
    }
  } catch (err) {
    if (isTransactionCanceled(err)) {
      throw new HttpError(409, 'The booking changed while the payment was processed (it may have expired)');
    }
    throw err;
  }

  const notifications = process.env.NOTIFICATIONS_TABLE_NAME!;
  await sendNotification(ddb, notifications, {
    recipientId: appointment.patientId,
    channels: ['EMAIL', 'SMS'],
    type: 'PAYMENT_RESULT',
    payload: { appointmentId, paymentStatus: outcome, amount },
  });
  if (outcome === 'SUCCESS') {
    await sendNotification(ddb, notifications, {
      recipientId: appointment.patientId,
      channels: ['EMAIL', 'SMS'],
      type: 'BOOKING_CONFIRMATION',
      payload: { appointmentId, startTime: appointment.startTime },
    });
  }

  return respond(200, { appointmentId, paymentStatus: outcome, amount });
});
