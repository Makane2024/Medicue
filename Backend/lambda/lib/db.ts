import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { HttpError } from './http';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Runs a query to completion, following pagination. */
export async function queryAll(input: QueryCommandInput): Promise<Record<string, any>[]> {
  const items: Record<string, any>[] = [];
  let startKey: Record<string, any> | undefined;
  do {
    const result = await ddb.send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }));
    items.push(...(result.Items || []));
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return items;
}

export const isTransactionCanceled = (err: any) => err?.name === 'TransactionCanceledException';
export const isConditionFailed = (err: any) => err?.name === 'ConditionalCheckFailedException';

/**
 * The user's profile row. A suspended account is refused here, so a token issued before the suspension stops
 * working for every handler that reads the caller's profile (that is, almost all of them).
 */
export async function getUser(userId: string, includeSuspended = false) {
  const result = await ddb.send(new GetCommand({ TableName: process.env.USERS_TABLE_NAME, Key: { userId } }));
  if (!includeSuspended && result.Item?.suspended === true) throw new HttpError(403, 'Your account has been suspended. Contact the platform administrators.');
  return result.Item;
}

export async function requireRole(userId: string, role: string) {
  const user = await getUser(userId);
  if (!user || user.role !== role) throw new HttpError(403, 'Not authorized');
  return user;
}

export async function requireApprovedHospital(hospitalId: string) {
  const result = await ddb.send(
    new GetCommand({ TableName: process.env.HOSPITALS_TABLE_NAME, Key: { hospitalId, itemType: 'PROFILE' } })
  );
  if (!result.Item || result.Item.status !== 'APPROVED') {
    throw new HttpError(403, 'Hospital is not approved');
  }
  return result.Item;
}
