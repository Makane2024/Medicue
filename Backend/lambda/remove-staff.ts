import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { getUser, requireRole } from './lib/db';
import { requireString } from './lib/validation';
import { removeAccount } from './lib/cleanup';

// Hospital admin: deletes a staff account of their own hospital.
export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const staffId = requireString(body, 'staffId', { max: 64 });
  const caller = await requireRole(callerId(event), 'HOSPITAL_ADMIN');

  const staff = await getUser(staffId, true);
  if (!staff || staff.role !== 'STAFF' || staff.hospitalId !== caller.hospitalId) {
    throw new HttpError(404, 'Staff member not found at this hospital');
  }

  await removeAccount(staff);
  return respond(200, { ok: true });
});
