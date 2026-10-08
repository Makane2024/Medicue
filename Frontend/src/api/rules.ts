// Business rules and small pure helpers that mirror Backend/lambda/lib (constants.ts, validation.ts).

import type { ConsultationType } from './types'

// ----------------------------------------------------------------- shared rules (mirror Backend/lambda/lib)
export const FEES: Record<ConsultationType, number> = { GENERAL: 2000, SPECIALIST: 3000 }

export const BUFFER_SAME = 10,
  BUFFER_CROSS = 90

export const HOLD_MIN = 5,
  OFFER_MIN = 15

export const RESCHEDULE_CUTOFF_H = 2

export const MAX_SLOT_H = 12

// a hospital admin proposes at most this many slots in one go
export const MAX_PROPOSAL_SLOTS = 5

// longest note a patient can add to a specialist appointment (what they are coming in for)
export const MAX_VISIT_NOTE = 500

// accounts per bulk-create request (the import screen sends bigger files in batches of this size or fewer)
export const MAX_BULK_USERS = 50

// patients can be checked in this long before their appointment starts
export const CHECK_IN_EARLY_H = 2

// sessions not marked COMPLETED this long after they end are recorded as MISSED (backend: mark-missed-appointments)
export const ATTENDANCE_GRACE_MIN = 120

export const GP_SPECIALTY = 'General Practice'

export const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const GP_ID = slug(GP_SPECIALTY)

export const prettySpecialty = (s?: string) =>
  (s ?? '')
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')

/** Backend requires E.164 (+<country><number>, no spaces). Accepts common Cameroonian input like "6 70 11 22 33". */

export function toE164(raw: string): string {
  const d = raw.replace(/[\s().-]/g, '')
  if (d.startsWith('+')) return d
  if (d.startsWith('00')) return '+' + d.slice(2)
  if (/^[62]\d{8}$/.test(d)) return '+237' + d
  return '+' + d
}

export const isE164 = (p: string) => /^\+[1-9]\d{6,14}$/.test(p)
/** Same policy as the Cognito pool: 8+ characters with upper, lower and a digit. */

export const passwordProblem = (p: string) =>
  p.length < 8
    ? 'Password must be at least 8 characters'
    : !/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p)
      ? 'Password needs an upper-case letter, a lower-case letter and a digit'
      : null
