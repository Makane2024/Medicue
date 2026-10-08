// Shared building blocks of the mock handlers: guards, notifications, slot logic.

import { ApiError } from '../errors'
import { BUFFER_CROSS, BUFFER_SAME, OFFER_MIN } from '../rules'
import { getToken } from '../session'
import type { Appointment, Role, Slot, User } from '../types'
import { db, type MUser } from './db'
import { id, iso, now } from './utils'

export const err = (status: number, msg: string) => new ApiError(status, msg)

export const me = () => {
  const u = db.users.find((x) => x.userId === mockSessionUserId())
  if (!u) throw err(401, 'Unauthorized')
  if ((u as MUser).suspended) throw err(403, 'Your account has been suspended. Contact the platform administrators.')
  return u
}

export const need = (role: Role) => {
  const u = me()
  if (u.role !== role) throw err(403, 'Not authorized')
  return u
}

export const notify = (userId: string, type: string, channels: ('EMAIL' | 'SMS')[], message: string) =>
  channels.forEach((channel) =>
    db.notices.unshift({
      notificationId: id('n'),
      userId,
      type,
      channel,
      deliveryStatus: 'SENT',
      message,
      createdAt: iso(now()),
    }),
  )

export const nameOf = (uid: string) => {
  const u = db.users.find((x) => x.userId === uid)
  return u ? `${u.firstName} ${u.lastName}` : undefined
}

export const docName = (uid: string) => {
  const n = nameOf(uid)
  return n ? `Dr. ${n}` : uid
}

export const str = (b: any, k: string, max = 500) => {
  const v = b[k]
  if (typeof v !== 'string' || !v.trim()) throw err(400, `${k} is required`)
  if (v.length > max) throw err(400, `${k} is too long`)
  return v.trim()
}

export const oneOf = <T extends string>(b: any, k: string, allowed: readonly T[]) => {
  if (!allowed.includes(b[k])) throw err(400, `${k} must be one of: ${allowed.join(', ')}`)
  return b[k] as T
}

export const approvedHospital = (hid: string) => {
  const h = db.hospitals.find((x) => x.hospitalId === hid)
  if (!h || h.status !== 'APPROVED') throw err(403, 'Hospital is not approved')
  return h
}

export function conflict(
  doctorId: string,
  hospitalId: string,
  start: string,
  end: string,
  ignore?: string,
  includePendingOfHospital = false,
) {
  const s = +new Date(start),
    e = +new Date(end)
  return db.slots.find((x) => {
    if (x.doctorId !== doctorId || x.slotId === ignore) return false
    const blocks =
      ['APPROVED', 'BOOKED', 'OFFERED'].includes(x.status) ||
      (includePendingOfHospital && x.status === 'PENDING' && x.hospitalId === hospitalId)
    if (!blocks) return false
    const buf = (x.hospitalId === hospitalId ? BUFFER_SAME : BUFFER_CROSS) * 6e4
    return s < +new Date(x.endTime) + buf && e > +new Date(x.startTime) - buf
  })
}

// frees a BOOKED/OFFERED slot: straight to the next waiting patient (most specific preference first), else back to APPROVED
export function releaseSlot(slot: Slot) {
  const keys = [`DOCTOR#${slot.doctorId}`, `SPECIALTY#${slot.specialtyId}`, `HOSPITAL#${slot.hospitalId}`]
  for (const k of keys) {
    const w = db.waitlist
      .filter((x) => x.matchKey === k && x.status === 'WAITING')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
    if (w) {
      const exp = iso(new Date(Date.now() + OFFER_MIN * 6e4))
      Object.assign(w, { status: 'OFFERED', slotId: slot.slotId, hospitalId: slot.hospitalId, offerExpiresAt: exp })
      Object.assign(slot, { status: 'OFFERED', offeredTo: w.patientId, offerExpiresAt: exp })
      notify(
        w.patientId,
        'WAITLIST_OFFER',
        ['EMAIL', 'SMS'],
        `A slot with ${docName(slot.doctorId)} opened up. Claim it within ${OFFER_MIN} minutes.`,
      )
      return
    }
  }
  slot.status = 'APPROVED'
  delete slot.offeredTo
  delete slot.offerExpiresAt
}

export const release = (slotId: string) => {
  const s = db.slots.find((x) => x.slotId === slotId)
  if (s && ['BOOKED', 'OFFERED'].includes(s.status)) releaseSlot(s)
}

export function deleteUser(userId: string) {
  db.users = db.users.filter((u) => u.userId !== userId)
  db.affiliations = db.affiliations.filter((a) => a.doctorId !== userId)
  db.slots = db.slots.filter((s) => !(s.doctorId === userId && ['PENDING', 'APPROVED', 'OFFERED'].includes(s.status)))
  db.waitlist = db.waitlist.filter((w) => w.patientId !== userId)
  db.appts.forEach((a) => {
    if (!['CONFIRMED', 'PENDING_PAYMENT'].includes(a.status)) return
    if (a.patientId === userId) {
      a.status = 'CANCELLED'
      release(a.slotId)
    } else if (a.doctorId === userId) {
      a.status = 'CANCELLED'
      notify(
        a.patientId,
        'CANCELLATION',
        ['EMAIL'],
        'Your doctor is no longer on MediCue; the appointment was cancelled.',
      )
    }
  })
}

// the mock's token is just 'mock.<userId>'; the real backend sends the ID token only
const mockSessionUserId = () => getToken()?.replace(/^mock\./, '') ?? null

export const tokensFor = (u: User) => ({ idToken: 'mock.' + u.userId })

export const withNames = (a: Appointment): Appointment => ({
  ...a,
  patientName: nameOf(a.patientId),
  doctorName: nameOf(a.doctorId),
  hospitalName: db.hospitals.find((h) => h.hospitalId === a.hospitalId)?.name,
})

export const apptSlot = (a: Appointment) => db.slots.find((s) => s.slotId === a.slotId)

export const MIN_START = () => iso(now())
