import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { requireApprovedHospital, requireRole } from './lib/db';
import { requireEmail, requireString, slugify } from './lib/validation';
import { inviteAccount } from './lib/accounts';

export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const firstName = requireString(body, 'firstName', { max: 100 });
  const lastName = requireString(body, 'lastName', { max: 100 });
  const email = requireEmail(body);
  const specialty = requireString(body, 'specialty', { max: 100 });
  const bio = typeof body.bio === 'string' ? body.bio.trim().slice(0, 1000) : '';
  const specialtyId = slugify(specialty);
  if (!specialtyId) throw new HttpError(400, 'specialty must contain letters or digits');

  const caller = await requireRole(callerId(event), 'HOSPITAL_ADMIN');
  const hospitalId = caller.hospitalId;
  await requireApprovedHospital(hospitalId);

  // Cognito emails the doctor the invitation (a link that opens the app with the email and a generated
  // temporary password filled in). First login (POST /auth/login) answers with a NEW_PASSWORD_REQUIRED challenge,
  // completed with POST /auth/new-password.
  const { userId: doctorId, created } = await inviteAccount({
    role: 'DOCTOR',
    firstName,
    lastName,
    email,
    specialty,
    bio,
    hospitalId,
  });

  return respond(200, {
    doctorId,
    hospitalId,
    specialtyId,
    message: created
      ? 'Doctor account created. A temporary password was emailed to the doctor.'
      : 'Existing doctor affiliated with your hospital.',
  });
});
