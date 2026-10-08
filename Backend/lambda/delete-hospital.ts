import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { ddb, requireRole } from './lib/db';
import { requireString } from './lib/validation';
import { removeHospital } from './lib/cleanup';

// Platform admin only: permanently deletes a hospital together with its admin account, doctors that work
// nowhere else, availability and waitlist entries. Upcoming appointments are cancelled and patients told.
// The uploaded verification document stays in the bucket for audit purposes.
export const handler = withErrorHandling(async (event) => {
  const body = parseBody(event);
  const hospitalId = requireString(body, 'hospitalId', { max: 64 });
  await requireRole(callerId(event), 'PLATFORM_ADMIN');

  const hospital = (
    await ddb.send(
      new GetCommand({ TableName: process.env.HOSPITALS_TABLE_NAME, Key: { hospitalId, itemType: 'PROFILE' } })
    )
  ).Item;
  if (!hospital) throw new HttpError(404, 'Hospital not found');

  const { doctorsRemoved } = await removeHospital(hospital);
  return respond(200, { ok: true, doctorsRemoved });
});
