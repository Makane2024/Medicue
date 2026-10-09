import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { getUser, requireRole, ddb } from './lib/db';
import { requireString } from './lib/validation';
import { removeAccount, removeHospital } from './lib/cleanup';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { routes } from './lib/router';

// Permanent removals cascade through bookings, slots and the waitlist, so they get their own (wider) permissions.

// ------------------------------------------------------------------ delete-user
// Platform admin only: permanently deletes a patient or doctor account. Upcoming appointments are
// cancelled (the patient is told) or freed. Hospital admins go with their hospital instead.
export const deleteUser = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const userId = requireString(body, 'userId', { max: 64 });
  await requireRole(callerId(event), 'PLATFORM_ADMIN');

  const user = await getUser(userId, true);
  if (!user) throw new HttpError(404, 'User not found');
  if (user.role === 'PLATFORM_ADMIN') throw new HttpError(403, 'Platform admins cannot be deleted');
  if (user.role === 'HOSPITAL_ADMIN') {
    throw new HttpError(409, 'Hospital admin accounts are removed together with their hospital. Delete the hospital instead.');
  }

  await removeAccount(user);
  return respond(200, { ok: true });
});

// ------------------------------------------------------------------ delete-hospital
// Platform admin only: permanently deletes a hospital together with its admin account, doctors that work
// nowhere else, availability and waitlist entries. Upcoming appointments are cancelled and patients told.
// The uploaded verification document stays in the bucket for audit purposes.
export const deleteHospital = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const hospitalId = requireString(body, 'hospitalId', { max: 64 });
  await requireRole(callerId(event), 'PLATFORM_ADMIN');

  const hospital = (
    await ddb.send(
      new GetCommand({ TableName: process.env.HOSPITALS_TABLE_NAME, Key: { hospitalId, itemType: 'PROFILE' } })
    )
  ).Item;
  if (!hospital) throw new HttpError(404, 'Hospital not found');

  const { doctorsRemoved } = await removeHospital(hospital);
  return respond(200, { ok: true, doctorsRemoved });
});

export const handler = routes({
  'POST /users/delete': deleteUser,
  'POST /hospitals/delete': deleteHospital,
});
