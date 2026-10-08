import { HttpError } from './http';
import { requireDate, requireEmail, requirePhone, requireString } from './validation';
import type { InvitedRole, NewAccount } from './accounts';

export interface BulkHospital {
  hospitalId: string;
  name: string;
}

const ROLE_ALIASES: Record<string, InvitedRole> = {
  PATIENT: 'PATIENT',
  DOCTOR: 'DOCTOR',
  STAFF: 'STAFF',
};

/** "Doctor", "doctor " and "DOCTOR" all mean DOCTOR. Anything else is not a role this import can create. */
export function normalizeRole(raw: unknown): InvitedRole {
  const key = typeof raw === 'string' ? raw.trim().toUpperCase().replace(/[\s-]+/g, '_') : '';
  const role = ROLE_ALIASES[key];
  if (!role) throw new HttpError(400, 'role must be PATIENT, DOCTOR or STAFF');
  return role;
}

const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim());

/**
 * Checks one row of a bulk import and turns it into an account to create.
 * - A hospital admin may only create doctors and staff, always for their own hospital.
 * - The platform admin may also create patients; doctors and staff must name an approved hospital (its name or id).
 */
export function validateRow(
  raw: unknown,
  caller: { role: string; hospitalId?: string },
  approvedHospitals: BulkHospital[]
): NewAccount {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'The row is not valid');
  const row = Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, clean(v)]));

  const role = normalizeRole(row.role);
  if (caller.role === 'HOSPITAL_ADMIN' && role === 'PATIENT') {
    throw new HttpError(403, 'Hospital admins can create doctors and staff, not patients');
  }

  const base = {
    role,
    firstName: requireString(row, 'firstName', { max: 100 }),
    lastName: requireString(row, 'lastName', { max: 100 }),
    email: requireEmail(row),
  };

  const phone = row.phone ? requirePhone(row) : undefined;

  if (role === 'PATIENT') {
    // Same details as the public sign-up form asks for, because SMS reminders need the number.
    if (!phone) throw new HttpError(400, 'phone is required for patients');
    return { ...base, phone, dateOfBirth: requireDate(row, 'dateOfBirth') };
  }

  let hospitalId = caller.hospitalId;
  if (caller.role === 'PLATFORM_ADMIN') {
    const wanted = requireString(row, 'hospital', { max: 200 }).toLowerCase();
    const match = approvedHospitals.find((h) => h.hospitalId.toLowerCase() === wanted || h.name.toLowerCase() === wanted);
    if (!match) throw new HttpError(400, `hospital "${row.hospital}" is not an approved hospital`);
    hospitalId = match.hospitalId;
  }

  if (role === 'STAFF') return { ...base, phone, hospitalId };
  return { ...base, phone, hospitalId, specialty: requireString(row, 'specialty', { max: 100 }), bio: row.bio ? String(row.bio).slice(0, 1000) : undefined };
}
