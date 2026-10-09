import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { readRefreshCookie, refreshCookie } from './http';
import { getSecretJson } from './secrets';

// The session cookie does not carry Cognito's refresh token as is: it is encrypted (AES-256-GCM) with a key that lives
// in Secrets Manager (medicue/cookie-key). A copied cookie value is useless without the key, a forged or altered one
// fails authentication, and replacing the key in Secrets Manager signs everybody out at once.
// Secret fields: `key` (current) and, while rotating, `previousKey` (still accepted for reading, never for writing).

const b64 = (b: Buffer) => b.toString('base64url');
const keyBytes = (secret: string) => createHash('sha256').update(secret).digest();

async function keys(): Promise<{ current?: Buffer; previous?: Buffer }> {
  const { key, previousKey } = await getSecretJson(process.env.COOKIE_SECRET_ARN);
  return { current: key ? keyBytes(key) : undefined, previous: previousKey ? keyBytes(previousKey) : undefined };
}

export async function sealToken(token: string): Promise<string> {
  const { current } = await keys();
  if (!current) throw new Error('Cookie key is not set');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', current, iv);
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', b64(iv), b64(body), b64(cipher.getAuthTag())].join('.');
}

export async function unsealToken(sealed: string): Promise<string | undefined> {
  const [version, iv, body, tag] = sealed.split('.');
  if (version !== 'v1' || !iv || !body || !tag) return undefined;
  const { current, previous } = await keys();
  for (const key of [current, previous]) {
    if (!key) continue;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      // wrong key or a tampered value: try the next key
    }
  }
  return undefined;
}

/**
 * The Set-Cookie header that starts a session, or nothing when the refresh token is missing or the key cannot be
 * read. Either way the sign-in itself still works: the session then simply ends with the ID token after an hour.
 */
export async function sessionCookieHeader(refreshToken: string | undefined, event: any): Promise<Record<string, string>> {
  if (!refreshToken) return {};
  try {
    return { 'Set-Cookie': refreshCookie(await sealToken(refreshToken), event) };
  } catch (err) {
    console.error('Session cookie not set', err);
    return {};
  }
}

/** The refresh token inside the request's session cookie, or undefined when it is absent, altered or from a retired key. */
export async function sessionRefreshToken(event: any): Promise<string | undefined> {
  const sealed = readRefreshCookie(event);
  if (!sealed) return undefined;
  try {
    return await unsealToken(sealed);
  } catch (err) {
    console.error('Session cookie could not be opened', err);
    return undefined;
  }
}
