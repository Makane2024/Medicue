import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './lib/db';
import { HttpError, respond, withErrorHandling } from './lib/http';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_PAGES = 10;

function parseTime(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  if (Number.isNaN(Date.parse(value))) throw new HttpError(400, `${name} must be an ISO-8601 timestamp`);
  return new Date(value).toISOString();
}

// Public. Lists bookable (APPROVED, upcoming) slots of an approved hospital, newest pages via nextToken.
export const handler = withErrorHandling(async (event) => {
  const params = event.queryStringParameters || {};
  const hospitalId = params.hospitalId;
  if (!hospitalId) throw new HttpError(400, 'hospitalId is required');

  const limit = Math.min(Math.max(parseInt(params.limit ?? '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const now = new Date().toISOString();
  const requestedFrom = parseTime(params.from, 'from');
  const from = requestedFrom && requestedFrom > now ? requestedFrom : now; // never list past slots
  const to = parseTime(params.to, 'to') ?? '9999-12-31T23:59:59.999Z';

  let startKey: Record<string, any> | undefined;
  if (params.nextToken) {
    try {
      startKey = JSON.parse(Buffer.from(params.nextToken, 'base64url').toString('utf8'));
    } catch {
      throw new HttpError(400, 'nextToken is invalid');
    }
  }

  const hospital = (
    await ddb.send(
      new GetCommand({ TableName: process.env.HOSPITALS_TABLE_NAME, Key: { hospitalId, itemType: 'PROFILE' } })
    )
  ).Item;
  if (!hospital || hospital.status !== 'APPROVED') throw new HttpError(404, 'Hospital not found');

  // Limit bounds the items examined per call, so keep paging until the page is full or exhausted.
  const slots: Record<string, any>[] = [];
  let pages = 0;
  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: process.env.AVAILABILITY_TABLE_NAME,
        IndexName: 'hospital-time-index',
        KeyConditionExpression: 'hospitalId = :h AND startTime BETWEEN :from AND :to',
        FilterExpression: '#s = :approved',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':h': hospitalId, ':from': from, ':to': to, ':approved': 'APPROVED' },
        Limit: limit - slots.length,
        ExclusiveStartKey: startKey,
      })
    );
    slots.push(...(result.Items || []));
    startKey = result.LastEvaluatedKey;
    pages++;
  } while (startKey && slots.length < limit && pages < MAX_PAGES);

  return respond(200, {
    slots: slots.map(({ proposedBy, ...publicFields }) => publicFields),
    nextToken: startKey ? Buffer.from(JSON.stringify(startKey)).toString('base64url') : undefined,
  });
});
