import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { requireApprovedHospital, requireRole, ddb, getUser, queryAll } from './lib/db';
import { requireEmail, requireString, slugify, requirePhone } from './lib/validation';
import { inviteAccount } from './lib/accounts';
import { BatchGetCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { batchDelete, removeAccount } from './lib/cleanup';
import { HOSPITAL_ADMIN_OR_PLATFORM_ADMIN, requireAnyRole } from './lib/guards';
import { MAX_BULK_USERS } from './lib/constants';
import { type BulkHospital, validateRow } from './lib/bulk';
import { routes } from './lib/router';

// A hospital's doctors and staff, and creating accounts for other people (invitations).

// ------------------------------------------------------------------ add-doctor
export const addDoctor = withErrorHandling(async (event) => {
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

// ------------------------------------------------------------------ list-doctors
// Doctors affiliated with an approved hospital. Any signed-in user may list them (patients pick a
// specialist, hospital admins manage their staff); only public profile fields are returned.
export const listDoctors = withErrorHandling(async (event) => {
  const caller = await getUser(callerId(event));
  if (!caller) throw new HttpError(403, 'Not authorized');

  const hospitalId = event.queryStringParameters?.hospitalId;
  if (!hospitalId) throw new HttpError(400, 'hospitalId is required');
  // A hospital admin may also see their own hospital before it is approved.
  if (!(caller.role === 'HOSPITAL_ADMIN' && caller.hospitalId === hospitalId)) {
    await requireApprovedHospital(hospitalId);
  }

  const affiliations = await queryAll({
    TableName: process.env.AFFILIATIONS_TABLE_NAME,
    IndexName: 'hospital-index',
    KeyConditionExpression: 'hospitalId = :h',
    FilterExpression: '#s = :active',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':h': hospitalId, ':active': 'ACTIVE' },
  });

  const names = new Map<string, { firstName: string; lastName: string; bio?: string; photo?: string }>();
  for (let i = 0; i < affiliations.length; i += 100) {
    const keys = affiliations.slice(i, i + 100).map((a) => ({ userId: a.doctorId }));
    const result = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [process.env.USERS_TABLE_NAME!]: { Keys: keys, ProjectionExpression: 'userId, firstName, lastName, bio, photo' },
        },
      })
    );
    for (const u of result.Responses?.[process.env.USERS_TABLE_NAME!] || []) {
      names.set(u.userId, { firstName: u.firstName, lastName: u.lastName, bio: u.bio, photo: u.photo });
    }
  }

  return respond(200, {
    doctors: affiliations.map((a) => ({
      doctorId: a.doctorId,
      hospitalId: a.hospitalId,
      specialty: a.specialty,
      specialtyId: a.specialtyId,
      firstName: names.get(a.doctorId)?.firstName,
      lastName: names.get(a.doctorId)?.lastName,
      bio: names.get(a.doctorId)?.bio,
      photo: names.get(a.doctorId)?.photo,
    })),
  });
});

// ------------------------------------------------------------------ remove-doctor
// Hospital admin only: ends a doctor's affiliation with the caller's hospital. The doctor's account stays
// (they may work elsewhere and their name still appears on past appointments). Pending and open slots
// here are deleted; a doctor with upcoming bookings here cannot be removed until those are dealt with.
export const removeDoctor = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const doctorId = requireString(body, 'doctorId', { max: 64 });
  const caller = await requireRole(callerId(event), 'HOSPITAL_ADMIN');
  const hospitalId: string = caller.hospitalId;

  const affiliation = (
    await ddb.send(
      new GetCommand({ TableName: process.env.AFFILIATIONS_TABLE_NAME, Key: { doctorId, hospitalId } })
    )
  ).Item;
  if (!affiliation || affiliation.status !== 'ACTIVE') throw new HttpError(404, 'Doctor is not at this hospital');

  const slots = await queryAll({
    TableName: process.env.AVAILABILITY_TABLE_NAME,
    IndexName: 'doctor-index',
    KeyConditionExpression: 'doctorId = :d',
    FilterExpression: 'hospitalId = :h',
    ExpressionAttributeValues: { ':d': doctorId, ':h': hospitalId },
  });

  const now = new Date().toISOString();
  if (slots.some((s) => ['BOOKED', 'OFFERED'].includes(s.status) && s.startTime > now)) {
    throw new HttpError(409, 'This doctor has upcoming bookings. Wait until they are completed or cancelled.');
  }

  await batchDelete(
    process.env.AVAILABILITY_TABLE_NAME!,
    slots.filter((s) => ['PENDING', 'APPROVED'].includes(s.status)).map((s) => ({ hospitalId, slotId: s.slotId }))
  );

  // Kept as REMOVED rather than deleted so the history stays; listing and slot proposals only accept ACTIVE.
  await ddb.send(
    new UpdateCommand({
      TableName: process.env.AFFILIATIONS_TABLE_NAME,
      Key: { doctorId, hospitalId },
      UpdateExpression: 'SET #s = :removed, removedAt = :now',
      ConditionExpression: '#s = :active',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':removed': 'REMOVED', ':active': 'ACTIVE', ':now': now },
    })
  );

  return respond(200, { ok: true });
});

// ------------------------------------------------------------------ add-staff
// Hospital admin: creates a reception/staff account for their own hospital. Staff check patients in when they
// arrive. Like doctors, they get an emailed link with a temporary password and only choose their own password.
export const addStaff = withErrorHandling(async (event) => {
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

// ------------------------------------------------------------------ list-staff
// Hospital admin: the staff accounts of their own hospital.
export const listStaff = withErrorHandling(async (event) => {
  const caller = await requireRole(callerId(event), 'HOSPITAL_ADMIN');

  const staff = await queryAll({
    TableName: process.env.USERS_TABLE_NAME,
    IndexName: 'role-index',
    KeyConditionExpression: '#r = :staff',
    FilterExpression: 'hospitalId = :h',
    ExpressionAttributeNames: { '#r': 'role' },
    ExpressionAttributeValues: { ':staff': 'STAFF', ':h': caller.hospitalId },
  });

  return respond(200, {
    staff: staff
      .map(({ userId, firstName, lastName, email, phone, suspended, createdAt }) => ({
        staffId: userId,
        firstName,
        lastName,
        email,
        phone,
        suspended: suspended === true,
        createdAt,
      }))
      .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)),
  });
});

// ------------------------------------------------------------------ remove-staff
// Hospital admin: deletes a staff account of their own hospital.
export const removeStaff = withErrorHandling(async (event) => {
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

// ------------------------------------------------------------------ bulk-create-users
const CONCURRENCY = 5;

type RowResult = { index: number; email?: string; status: 'CREATED' | 'AFFILIATED' | 'ERROR'; message?: string };

// Creates many accounts at once from the rows of a spreadsheet the client has already parsed. Every row is
// validated and created on its own: one bad row never stops the others, and the answer says what happened to each.
// Each new person gets the usual invitation email with a link and a temporary password.
export const bulkCreateUsers = withErrorHandling(async (event) => {
  const body = parseBody(event);
  if (!Array.isArray(body.users) || body.users.length === 0) throw new HttpError(400, 'users must be a non-empty list');
  if (body.users.length > MAX_BULK_USERS) {
    throw new HttpError(400, `Send at most ${MAX_BULK_USERS} accounts per request`);
  }

  const caller = await requireAnyRole(callerId(event), HOSPITAL_ADMIN_OR_PLATFORM_ADMIN);

  // Hospital admins create for their own hospital (which must be approved); the platform admin names hospitals.
  let hospitals: BulkHospital[] = [];
  if (caller.role === 'HOSPITAL_ADMIN') {
    await requireApprovedHospital(caller.hospitalId);
  } else {
    const approved = await queryAll({
      TableName: process.env.HOSPITALS_TABLE_NAME,
      IndexName: 'status-index',
      KeyConditionExpression: '#s = :approved',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':approved': 'APPROVED' },
    });
    hospitals = approved.map((h) => ({ hospitalId: h.hospitalId, name: h.name }));
  }

  const results: RowResult[] = new Array(body.users.length);
  const seen = new Set<string>();

  const createRow = async (index: number) => {
    let email: string | undefined;
    try {
      const account = validateRow(body.users[index], { role: caller.role, hospitalId: caller.hospitalId }, hospitals);
      email = account.email;
      // The same address twice in one file would race in Cognito, so only the first one counts.
      if (seen.has(email)) throw new HttpError(409, 'This email appears more than once in the file');
      seen.add(email);
      const { created } = await inviteAccount(account);
      results[index] = { index, email, status: created ? 'CREATED' : 'AFFILIATED' };
    } catch (err: any) {
      if (!(err instanceof HttpError) && !err?.name?.endsWith('Exception')) {
        console.error('bulk-create row failed', index, err);
      }
      const message = err instanceof HttpError || err?.name?.endsWith('Exception') ? err.message : 'Could not create this account';
      results[index] = { index, email, status: 'ERROR', message };
    }
  };

  // validateRow's duplicate check needs rows to be started in order, then run a few at a time.
  const queue = [...results.keys()];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let index = queue.shift(); index !== undefined; index = queue.shift()) await createRow(index);
    })
  );

  const count = (status: RowResult['status']) => results.filter((r) => r.status === status).length;
  return respond(200, { created: count('CREATED'), affiliated: count('AFFILIATED'), failed: count('ERROR'), results });
});

export const handler = routes({
  'POST /doctors/add': addDoctor,
  'GET /doctors/list': listDoctors,
  'POST /doctors/remove': removeDoctor,
  'POST /staff/add': addStaff,
  'GET /staff/list': listStaff,
  'POST /staff/remove': removeStaff,
  'POST /users/bulk-create': bulkCreateUsers,
});
