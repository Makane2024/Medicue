// HTTP client for the backend contract. Without VITE_API_URL it answers from the in-browser mock instead.

import { BASE } from './config'
import { ApiError } from './errors'
import { mockRequest, prepareMock } from './mock/index'
import { getToken } from './session'

let expiredListeners: (() => void)[] = []

export const onAuthExpired = (fn: () => void) => {
  expiredListeners.push(fn)
  return () => {
    expiredListeners = expiredListeners.filter((x) => x !== fn)
  }
}

export async function call<T = any>(method: 'GET' | 'POST', path: string, body?: any): Promise<T> {
  const token = getToken()
  if (BASE) {
    let res: Response
    try {
      res = await fetch(BASE.replace(/\/$/, '') + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch {
      throw new ApiError(0, 'Cannot reach the server. Check your connection.')
    }
    const data = await res.json().catch(() => ({}))
    if (res.status === 401 && token) expiredListeners.forEach((fn) => fn())
    if (!res.ok)
      throw new ApiError(
        res.status,
        data.message || (res.status === 429 ? 'Too many requests, slow down' : 'Request failed'),
      )
    return data
  }
  await new Promise((r) => setTimeout(r, 220))
  await prepareMock()
  return JSON.parse(JSON.stringify(mockRequest(method, path, body ?? {}))) as T
}
