// HTTP client for the backend contract (see api/endpoints.ts).

import { BASE } from './config'
import { ApiError } from './errors'
import { getToken, setSession } from './session'

let expiredListeners: (() => void)[] = []

export const onAuthExpired = (fn: () => void) => {
  expiredListeners.push(fn)
  return () => {
    expiredListeners = expiredListeners.filter((x) => x !== fn)
  }
}

async function send(method: 'GET' | 'POST', path: string, body: any, token: string | null): Promise<Response> {
  try {
    return await fetch(BASE.replace(/\/$/, '') + path, {
      method,
      credentials: 'include', // the refresh-token cookie travels with /auth/* requests
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.')
  }
}

let renewing: Promise<string | null> | null = null

/** A new ID token from the refresh-token cookie, or null when there is no valid session. One request at a time. */
export function renewSession(): Promise<string | null> {
  renewing ??= call<{ idToken?: string }>('POST', '/auth/refresh', {})
    .then((r) => r.idToken ?? null)
    .catch(() => null)
    .finally(() => {
      renewing = null
    })
  return renewing
}

export async function call<T = any>(method: 'GET' | 'POST', path: string, body?: any): Promise<T> {
  let token = getToken()
  let res = await send(method, path, body, token)
  // the ID token lasts an hour: renew it quietly once and repeat the request instead of signing the user out
  if (res.status === 401 && token && !path.startsWith('/auth/')) {
    const fresh = await renewSession()
    if (fresh) {
      setSession(fresh)
      token = fresh
      res = await send(method, path, body, token)
    }
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && token && !path.startsWith('/auth/')) expiredListeners.forEach((fn) => fn())
  if (!res.ok)
    throw new ApiError(
      res.status,
      data.message || (res.status === 429 ? 'Too many requests, slow down' : 'Request failed'),
    )
  return data
}
