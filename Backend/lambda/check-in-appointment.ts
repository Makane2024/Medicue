import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, isConditionFailed } from './lib/db';
import { HOSPITAL_STAFF_ROLES, requireAnyRole } from './lib/guards';
import { requireString } from './lib/validation';

/** How long before its start time a patient may be checked in. */
export const CHECK_IN_EARLY_MINUTES = 120;

// Hospital staff (or the hospital admin): the patient has arrived and signed in at the hospital. A confirmed
// appointment becomes ARRIVED; the doctor marks it COMPLETED once the consultation is over.
export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const appointmentId = requireString(body, 'appointmentId', { max: 64 });
  const caller = await requireAnyRole(callerId(event), HOSPITAL_STAFF_ROLES);

  const appointment = (
    await ddb.send(
      new GetCommand({ TableName: process.env.APPOINTMENTS_TABLE_NAME, Key: { appointmentId, itemType: 'METADATA' } })
    )
  ).Item;
  if (!appointment) throw new HttpError(404, 'Appointment not found');
  if (appointment.hospitalId !== caller.hospitalId) throw new HttpError(403, 'Not authorized for this hospital');
  if (appointment.status === 'ARRIVED') throw new HttpError(409, 'This patient is already checked in');
  if (appointment.status !== 'CONFIRMED') {
    throw new HttpError(409, 'Only a confirmed appointment can be checked in');
  }

  const now = Date.now();
  if (new Date(appointment.startTime).getTime() - CHECK_IN_EARLY_MINUTES * 60_000 > now) {
    throw new HttpError(409, `Patients can be checked in from ${CHECK_IN_EARLY_MINUTES / 60} hours before the appointment`);
  }
  if (new Date(appointment.endTime).getTime() < now) {
    throw new HttpError(409, 'This appointment time has already passed');
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: process.env.APPOINTMENTS_TABLE_NAME,
        Key: { appointmentId, itemType: 'METADATA' },
        UpdateExpression: 'SET #s = :arrived, arrivedAt = :now, checkedInBy = :by',
        ConditionExpression: '#s = :confirmed',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':arrived': 'ARRIVED',
          ':confirmed': 'CONFIRMED',
          ':now': new Date(now).toISOString(),
          ':by': caller.userId,
        },
      })
    );
  } catch (err) {
    if (isConditionFailed(err)) throw new HttpError(409, 'The appointment changed, please refresh and retry');
    throw err;
  }

  return respond(200, { appointmentId, status: 'ARRIVED' });
});
