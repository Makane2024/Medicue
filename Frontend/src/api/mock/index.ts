// In-browser stand-in for the backend: answers the same routes with the same request and response shapes.

import { hashPassword } from '../passwordHash'
import { db } from './db'
import { err } from './helpers'
import './seed'
import { authRoutes } from './routes/auth'
import { hospitalRoutes } from './routes/hospitals'
import { doctorRoutes } from './routes/doctors'
import { availabilityRoutes } from './routes/availability'
import { appointmentRoutes } from './routes/appointments'
import { waitlistRoutes } from './routes/waitlist'
import { recordRoutes } from './routes/records'
import { adminRoutes } from './routes/admin'
import { extraRoutes } from './routes/extras'
import type { RouteMap } from './types'

const routes: RouteMap = {
  ...authRoutes,
  ...hospitalRoutes,
  ...doctorRoutes,
  ...availabilityRoutes,
  ...appointmentRoutes,
  ...waitlistRoutes,
  ...recordRoutes,
  ...extraRoutes,
  ...adminRoutes,
}

export function mockRequest(method: string, fullPath: string, body: any): unknown {
  const [path, query] = fullPath.split('?')
  const handler = routes[`${method} ${path}`]
  if (!handler) throw err(404, 'Not found')
  return handler({ b: body, q: Object.fromEntries(new URLSearchParams(query)) })
}

const DEMO_PASSWORD = 'demo'

/** The seeded accounts use the password "demo"; like the real backend, the mock only ever stores the client's hash. */
export async function prepareMock() {
  for (const u of db.users) {
    if (u.password === DEMO_PASSWORD) u.password = await hashPassword(DEMO_PASSWORD, u.email)
  }
}
