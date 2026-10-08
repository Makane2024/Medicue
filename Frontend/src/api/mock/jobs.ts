import { ATTENDANCE_GRACE_MIN, GP_ID, HOLD_MIN } from '../rules'
import type { Slot } from '../types'
import { db } from './db'
import { docName, notify, release, releaseSlot } from './helpers'
import { id, iso } from './utils'

// scheduled jobs: stand-ins for the backend's EventBridge rules (payment holds, waitlist offers, missed sessions)
export function runScheduledJobs() {
  const t = Date.now()
  db.appts.forEach((a) => {
    if (a.status === 'PENDING_PAYMENT' && +new Date(a.createdAt) + HOLD_MIN * 6e4 < t) {
      a.status = 'EXPIRED'
      release(a.slotId)
    }
  })
  db.appts.forEach((a) => {
    if (a.status === 'CONFIRMED' && +new Date(a.endTime) + ATTENDANCE_GRACE_MIN * 6e4 < t) {
      a.status = 'MISSED'
      notify(a.patientId, 'MISSED', ['EMAIL', 'SMS'], `You missed your appointment with ${docName(a.doctorId)}.`)
    }
  })
  db.waitlist.forEach((w) => {
    if (w.status === 'OFFERED' && w.offerExpiresAt && +new Date(w.offerExpiresAt) < t) {
      w.status = 'EXPIRED'
      if (w.slotId) release(w.slotId)
    }
  })
}

// demo-only: simulate a slot opening up for the first waiting patient, so the waitlist flow can be shown.
// A slot matching the waiter's preference is created and released, because a real one cannot exist while they wait.
export const demo = {
  forceOffer() {
    const waiter = db.waitlist.find((w) => w.status === 'WAITING')
    if (!waiter) return false

    const [type, target] = waiter.matchKey.split('#')
    const affiliation =
      db.affiliations.find((a) =>
        type === 'DOCTOR'
          ? a.doctorId === target
          : type === 'SPECIALTY'
            ? a.specialtyId === target
            : a.hospitalId === target,
      ) ?? db.affiliations[0]
    const start = new Date(Date.now() + 864e5)
    start.setHours(18, 0, 0, 0)

    const slot: Slot = {
      slotId: id('slot'),
      hospitalId: type === 'HOSPITAL' ? target : affiliation.hospitalId,
      doctorId: type === 'DOCTOR' ? target : affiliation.doctorId,
      specialtyId: type === 'SPECIALTY' ? target : affiliation.specialtyId,
      consultationType: affiliation.specialtyId === GP_ID ? 'GENERAL' : 'SPECIALIST',
      startTime: iso(start),
      endTime: iso(new Date(+start + 30 * 6e4)),
      status: 'BOOKED',
    }
    db.slots.push(slot)
    waiter.createdAt = '0' // first in line
    releaseSlot(slot)
    return true
  },
}
