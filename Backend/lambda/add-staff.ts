import { callerId, parseBody, respond, withErrorHandling } from './lib/http';
import { requireApprovedHospital, requireRole } from './lib/db';
import { requireEmail, requirePhone, requireString } from './lib/validation';
import { inviteAccount } from './lib/accounts';

// Hospital admin: creates a reception/staff account for their own hospital. Staff check patients in when they
// arrive. Like doctors, they get an emailed link with a temporary password and only choose their own password.
export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const firstName = requireString(body, 'firstName', { max: 100 });
  const lastName = requireString(body, 'lastName', { max: 100 });
  const email = requireEmail(body);
  const phone = typeof body.phone === 'string' && body.phone.trim() !== '' ? requirePhone(body) : undefined;

  const caller = await requireRole(callerId(event), 'HOSPITAL_ADMIN');
  await requireApprovedHospital(caller.hospitalId);

  const { userId } = await inviteAccount({
    role: 'STAFF',
    firstName,
    lastName,
    email,
    phone,
    hospitalId: caller.hospitalId,
  });

  return respond(200, { staffId: userId, message: 'Staff account created. A temporary password was emailed.' });
});
