import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { getUser, requireRole } from './lib/db';
import { requireString } from './lib/validation';
import { removeAccount } from './lib/cleanup';

// Platform admin only: permanently deletes a patient or doctor account. Upcoming appointments are
// cancelled (the patient is told) or freed. Hospital admins go with their hospital instead.
export const handler = withErrorHandling(async (event) => {
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
