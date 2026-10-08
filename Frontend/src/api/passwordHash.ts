// The raw password never leaves the browser: every request that carries a password sends this derived value instead.
// PBKDF2-SHA256 (WebCrypto), salted with the email address so equal passwords of different accounts differ and the
// result cannot be looked up in a precomputed table. The backend only accepts this exact shape on the routes that set
// a password (requirePasswordHash in Backend/lambda/lib/validation.ts) and Cognito stores it as the password.
// Whoever holds the hash can sign in, so HTTPS is still required; what this removes is the user's real password
// (often reused elsewhere) from payloads, proxies, logs and the network tab.

const PREFIX = 'Mc1!' // keeps the Cognito policy satisfied: upper-case, lower-case, digit and symbol
const ITERATIONS = 210_000
const encoder = new TextEncoder()

export async function hashPassword(password: string, email: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Secure sign-in needs HTTPS (or localhost).')
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: ITERATIONS,
      salt: encoder.encode('medicue:v1:' + email.trim().toLowerCase()),
    },
    key,
    256,
  )
  return PREFIX + Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('')
}
