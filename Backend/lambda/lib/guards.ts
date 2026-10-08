import { HttpError } from './http';
import { getUser } from './db';

/** Roles that work at a hospital and can check patients in. */
export const HOSPITAL_STAFF_ROLES = ['HOSPITAL_ADMIN', 'STAFF'] as const;

/** Roles that may create accounts in bulk. */
export const HOSPITAL_ADMIN_OR_PLATFORM_ADMIN = ['HOSPITAL_ADMIN', 'PLATFORM_ADMIN'] as const;

/** The caller's profile, if their role is one of `roles`. Suspended accounts are refused by getUser. */
export async function requireAnyRole(userId: string, roles: readonly string[]) {
  const user = await getUser(userId);
  if (!user || !roles.includes(user.role)) throw new HttpError(403, 'Not authorized');
  return user;
}
