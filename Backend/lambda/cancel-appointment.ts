import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, isTransactionCanceled } from './lib/db';
import { requireString } from './lib/validation';
import { sendNotification } from './lib/notify';
import { releaseSlot, releaseTablesFromEnv } from './lib/waitlist';

export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const appointmentId = requireString(body, 'appointmentId', { max: 64 });
  const patientId = callerId(event);

  const appointment = (
    await ddb.send(
      new GetCommand({ TableName: process.env.APPOINTMENTS_TABLE_NAME, Key: { appointmentId, itemType: 'METADATA' } })
    )
  ).Item;
  if (!appointment) throw new HttpError(404, 'Appointment not found');
  if (appointment.patientId !== patientId) throw new HttpError(403, 'Not authorized');
  if (appointment.status !== 'CONFIRMED') {
    throw new HttpError(409, 'Only a confirmed appointment can be cancelled');
  }
  if (appointment.startTime <= new Date().toISOString()) {
    throw new HttpError(409, 'An appointment that has already started cannot be cancelled');
  }

  const slot = (
    await ddb.send(
      new GetCommand({
        TableName: process.env.AVAILABILITY_TABLE_NAME,
        Key: { hospitalId: appointment.hospitalId, slotId: appointment.slotId },
      })
    )
  ).Item;

  const cancelItem = {
    Update: {
      TableName: process.env.APPOINTMENTS_TABLE_NAME,
      Key: { appointmentId, itemType: 'METADATA' },
      UpdateExpression: 'SET #s = :cancelled',
      ConditionExpression: '#s = :confirmed',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':cancelled': 'CANCELLED', ':confirmed': 'CONFIRMED' },
    },
  };

  try {
    if (slot) {
      // Cancels and frees the slot (straight to the next waiting patient if any) in one transaction.
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
        { fromStatus: 'BOOKED', baseItems: [cancelItem] }
      );
    } else {
      await ddb.send(new TransactWriteCommand({ TransactItems: [cancelItem] }));
    }
  } catch (err) {
    if (isTransactionCanceled(err)) throw new HttpError(409, 'The appointment changed, please refresh and retry');
    throw err;
  }

  await sendNotification(ddb, process.env.NOTIFICATIONS_TABLE_NAME!, {
    recipientId: appointment.patientId,
    channels: ['EMAIL', 'SMS'],
    type: 'CANCELLATION',
    payload: { appointmentId, startTime: appointment.startTime },
  });

  return respond(200, { appointmentId, status: 'CANCELLED' });
});
