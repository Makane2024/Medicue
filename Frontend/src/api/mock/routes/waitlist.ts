// Joining the waitlist and claiming an offered slot.

import { FEES, HOLD_MIN } from '../../rules'
import type { Appointment, WaitEntry } from '../../types'
import { db } from '../db'
import { err, me, MIN_START, oneOf, str } from '../helpers'
import { RouteMap } from '../types'
import { id, iso, now } from '../utils'

export const waitlistRoutes: RouteMap = {
  'POST /waitlist/join': ({ b }) => {
    const p = me()
    const type = oneOf(b, 'preferenceType', ['HOSPITAL', 'SPECIALTY', 'DOCTOR'] as const)
    const field = { HOSPITAL: 'hospitalId', SPECIALTY: 'specialtyId', DOCTOR: 'doctorId' }[type]
    const target = str(b, field, 64)
    const open = db.slots.some(
      (x) =>
        x.status === 'APPROVED' &&
        x.startTime > MIN_START() &&
        (type === 'HOSPITAL'
          ? x.hospitalId === target
          : type === 'DOCTOR'
            ? x.doctorId === target
            : x.specialtyId === target),
    )
    if (open) throw err(409, `This ${type.toLowerCase()} already has available slots, please book directly instead`)
    const matchKey = `${type}#${target}`
    if (
      db.waitlist.some(
        (w) => w.patientId === p.userId && w.matchKey === matchKey && ['WAITING', 'OFFERED'].includes(w.status),
      )
    )
      throw err(409, 'You are already on this waitlist')
    const w: WaitEntry = {
      waitlistId: id('wl'),
      patientId: p.userId,
      preferenceType: type,
      matchKey,
      status: 'WAITING',
      createdAt: iso(now()),
    }
    db.waitlist.push(w)
    return { waitlistId: w.waitlistId, status: 'WAITING' }
  },
  'GET /waitlist/mine': () => {
    return { entries: db.waitlist.filter((w) => w.patientId === me().userId) }
  },
  'POST /waitlist/claim': ({ b }) => {
    const p = me()
    const w = db.waitlist.find((x) => x.waitlistId === str(b, 'waitlistId') && x.patientId === p.userId)
    if (!w || w.status !== 'OFFERED') throw err(409, 'No active offer for this waitlist entry')
    if (+new Date(w.offerExpiresAt!) < Date.now()) throw err(409, 'Offer has expired')
    const s = db.slots.find((x) => x.slotId === w.slotId)
    if (!s || s.status !== 'OFFERED' || s.offeredTo !== p.userId) throw err(409, 'Slot offer is no longer valid')
    w.status = 'CLAIMED'
    s.status = 'BOOKED'
    delete s.offeredTo
    delete s.offerExpiresAt
    const a: Appointment = {
      appointmentId: id('appt'),
      patientId: p.userId,
      doctorId: s.doctorId,
      hospitalId: s.hospitalId,
      slotId: s.slotId,
      specialtyId: s.specialtyId,
      consultationType: s.consultationType,
      fee: FEES[s.consultationType],
      startTime: s.startTime,
      endTime: s.endTime,
      status: 'PENDING_PAYMENT',
      createdAt: iso(now()),
    }
    db.appts.push(a)
    return {
      appointmentId: a.appointmentId,
      status: 'PENDING_PAYMENT',
      amount: a.fee,
      payBefore: iso(new Date(Date.now() + HOLD_MIN * 6e4)),
    }
  },
}
