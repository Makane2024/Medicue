// HTTP client for the backend contract. Without VITE_API_URL it answers from the in-browser mock instead.

import { BASE } from './config'
import { ApiError } from './errors'
import { mockRequest } from './mock/index'
import { getToken } from './session'
import type { LogEntry } from './types'

let listeners: ((l: LogEntry) => void)[] = []

export const onLog = (fn: (l: LogEntry) => void) => {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter((x) => x !== fn)
  }
}

let expiredListeners: (() => void)[] = []

export const onAuthExpired = (fn: () => void) => {
  expiredListeners.push(fn)
  return () => {
    expiredListeners = expiredListeners.filter((x) => x !== fn)
  }
}

export async function call<T = any>(method: 'GET' | 'POST', path: string, body?: any): Promise<T> {
  const token = getToken()
  const log = (status: number) =>
    listeners.forEach((fn) => fn({ method, path: path.split('?')[0], status, at: Date.now() }))
  if (BASE) {
    let res: Response
    try {
      res = await fetch(BASE.replace(/\/$/, '') + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch {
      log(0)
      throw new ApiError(0, 'Cannot reach the server. Check your connection.')
    }
    log(res.status)
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
  try {
    const out = mockRequest(method, path, body ?? {})
    log(200)
    return JSON.parse(JSON.stringify(out)) as T
  } catch (e: any) {
    log(e.status ?? 500)
    throw e
  }
}
