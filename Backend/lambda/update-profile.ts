import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, getUser } from './lib/db';
import { buildProfile } from './lib/profile';
import { requirePhone, requireString } from './lib/validation';

// The photo is stored on the profile row as a small data URL (the client shrinks it first); the cap keeps
// the doctor list, which embeds it, well below the Lambda response limit.
const MAX_PHOTO_CHARS = 100_000;
const PHOTO_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;

// Updates the signed-in user's own profile. Every field is optional; the email can't be changed.
export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const userId = callerId(event);
  const user = await getUser(userId);
  if (!user) throw new HttpError(404, 'No profile found for this account');

  const sets: string[] = [];
  const removes: string[] = [];
  const values: Record<string, any> = {};

  for (const key of ['firstName', 'lastName'] as const) {
    if (body[key] === undefined) continue;
    sets.push(`${key} = :${key}`);
    values[`:${key}`] = requireString(body, key, { max: 100 });
  }

  // An empty phone means "leave it as it is"; a patient's phone is where SMS reminders go.
  if (typeof body.phone === 'string' && body.phone.trim() !== '') {
    sets.push('phone = :phone');
    values[':phone'] = requirePhone(body);
  }

  if (body.photo !== undefined) {
    if (body.photo === null || body.photo === '') {
      removes.push('photo');
    } else {
      if (typeof body.photo !== 'string' || body.photo.length > MAX_PHOTO_CHARS || !PHOTO_RE.test(body.photo)) {
        throw new HttpError(400, 'photo must be a PNG, JPEG or WebP image under 100 KB');
      }
      sets.push('photo = :photo');
      values[':photo'] = body.photo;
    }
  }

  // Only doctors have a public description; other roles ignore it.
  if (user.role === 'DOCTOR' && body.bio !== undefined) {
    if (typeof body.bio !== 'string' || body.bio.length > 1000) {
      throw new HttpError(400, 'bio must be at most 1000 characters');
    }
    if (body.bio.trim() === '') {
      removes.push('bio');
    } else {
      sets.push('bio = :bio');
      values[':bio'] = body.bio.trim();
    }
  }

  if (sets.length === 0 && removes.length === 0) return respond(200, await buildProfile(user));

  const updated = await ddb.send(
    new UpdateCommand({
      TableName: process.env.USERS_TABLE_NAME,
      Key: { userId },
      UpdateExpression: [sets.length ? `SET ${sets.join(', ')}` : '', removes.length ? `REMOVE ${removes.join(', ')}` : '']
        .filter(Boolean)
        .join(' '),
      ConditionExpression: 'attribute_exists(userId)',
      ...(sets.length ? { ExpressionAttributeValues: values } : {}),
      ReturnValues: 'ALL_NEW',
    })
  );

  return respond(200, await buildProfile(updated.Attributes!));
});
