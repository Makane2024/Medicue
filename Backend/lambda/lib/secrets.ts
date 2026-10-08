import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({});
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: Record<string, string>; expires: number }>();

/**
 * Reads a JSON secret from AWS Secrets Manager. Third-party keys live there instead of in environment variables
 * or code; the Lambda only receives the secret's ARN. The value is cached for a few minutes per container, so a
 * rotated key is picked up without a redeploy and without a call on every request.
 */
export async function getSecretJson(secretId: string | undefined): Promise<Record<string, string>> {
  if (!secretId) throw new Error('Secret id is not configured');
  const hit = cache.get(secretId);
  if (hit && hit.expires > Date.now()) return hit.value;
  const out = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  const value = JSON.parse(out.SecretString ?? '{}') as Record<string, string>;
  cache.set(secretId, { value, expires: Date.now() + CACHE_MS });
  return value;
}
