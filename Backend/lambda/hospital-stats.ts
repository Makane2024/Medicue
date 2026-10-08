import { callerId, HttpError, respond, withErrorHandling } from './lib/http';
import { queryAll, requireRole } from './lib/db';
import { summarize } from './lib/stats';

const MAX_WINDOW_DAYS = 62;

// Hospital admin: how many appointments of their hospital were completed, missed, cancelled ... between `from` and
// `to` (ISO instants chosen by the client, e.g. this week or this month), in total and per calendar day.
// `tzOffsetMinutes` is the browser's Date#getTimezoneOffset so that days line up with the admin's wall clock.
export const handler = withErrorHandling(async (event) => {
  const caller = await requireRole(callerId(event), 'HOSPITAL_ADMIN');
  const q = event.queryStringParameters ?? {};

  const parse = (key: 'from' | 'to') => {
    const ms = Date.parse(q[key] ?? '');
    if (Number.isNaN(ms)) throw new HttpError(400, `${key} must be an ISO-8601 timestamp`);
    return ms;
  };
  const from = parse('from');
  const to = parse('to');
  if (to < from) throw new HttpError(400, 'to must not be before from');
  if (to - from > MAX_WINDOW_DAYS * 86_400_000) throw new HttpError(400, `The window can span at most ${MAX_WINDOW_DAYS} days`);
  const tz = q.tzOffsetMinutes === undefined ? 0 : Number(q.tzOffsetMinutes);
  if (!Number.isInteger(tz) || Math.abs(tz) > 14 * 60) throw new HttpError(400, 'tzOffsetMinutes must be a number of minutes');

  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();
  const appointments = await queryAll({
    TableName: process.env.APPOINTMENTS_TABLE_NAME,
    IndexName: 'hospital-index',
    KeyConditionExpression: 'hospitalId = :h AND startTime BETWEEN :from AND :to',
    ProjectionExpression: 'startTime, #s',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':h': caller.hospitalId, ':from': fromIso, ':to': toIso },
  });

  return respond(200, { from: fromIso, to: toIso, ...summarize(appointments as any, fromIso, toIso, tz) });
});
