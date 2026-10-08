import { callerId, HttpError, respond, withErrorHandling } from './lib/http';
import { getUser } from './lib/db';
import { buildProfile } from './lib/profile';

// The signed-in user's own profile. The client needs the role (and, for a hospital admin, the hospital
// and its approval status) to decide what to show.
export const handler = withErrorHandling(async (event) => {
  const user = await getUser(callerId(event));
  if (!user) throw new HttpError(404, 'No profile found for this account');
  return respond(200, await buildProfile(user));
});
