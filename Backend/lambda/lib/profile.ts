import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './db';

/**
 * The user shape the client receives from GET /users/me and POST /users/update-profile. The caller's own userId
 * is left out on purpose: the client never needs it (the API identifies the caller from the token).
 */
export async function buildProfile(user: Record<string, any>) {
  const { firstName, lastName, email, phone, role, hospitalId, photo, bio } = user;

  let hospital: { name: string; status: string; address?: string } | undefined;
  // Staff see the hospital they work at, hospital admins the one they run.
  if ((role === 'HOSPITAL_ADMIN' || role === 'STAFF') && hospitalId) {
    const profile = (
      await ddb.send(
        new GetCommand({ TableName: process.env.HOSPITALS_TABLE_NAME, Key: { hospitalId, itemType: 'PROFILE' } })
      )
    ).Item;
    if (profile) {
      hospital = {
        name: profile.name,
        status: profile.status,
        address: profile.address,
      };
    }
  }

  return { firstName, lastName, email, phone, role, hospitalId, hospital, photo, bio };
}
