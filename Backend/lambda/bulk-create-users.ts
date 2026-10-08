import { callerId, HttpError, parseBody, respond, withErrorHandling } from './lib/http';
import { queryAll, requireApprovedHospital } from './lib/db';
import { HOSPITAL_ADMIN_OR_PLATFORM_ADMIN, requireAnyRole } from './lib/guards';
import { MAX_BULK_USERS } from './lib/constants';
import { inviteAccount } from './lib/accounts';
import { type BulkHospital, validateRow } from './lib/bulk';

const CONCURRENCY = 5;

type RowResult = { index: number; email?: string; status: 'CREATED' | 'AFFILIATED' | 'ERROR'; message?: string };

// Creates many accounts at once from the rows of a spreadsheet the client has already parsed. Every row is
// validated and created on its own: one bad row never stops the others, and the answer says what happened to each.
// Each new person gets the usual invitation email with a link and a temporary password.
export const handler = withErrorHandling(async (event) => {
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
