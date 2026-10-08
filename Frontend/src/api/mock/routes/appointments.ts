// Booking, payment, cancelling, rescheduling, patient check-in and completing a session.

import { paymentSimulation } from '../../config'
import { CHECK_IN_EARLY_H, FEES, HOLD_MIN, MAX_VISIT_NOTE, RESCHEDULE_CUTOFF_H } from '../../rules'
import type { Appointment } from '../../types'
import { db } from '../db'
import { apptSlot, docName, err, me, MIN_START, need, notify, release, releaseSlot, str, withNames } from '../helpers'
import { RouteMap } from '../types'
import { id, iso, now } from '../utils'

export const appointmentRoutes: RouteMap = {
  'POST /appointments/book': ({ b }) => {
    const p = need('PATIENT')
    const s = db.slots.find((x) => x.slotId === str(b, 'slotId') && x.hospitalId === str(b, 'hospitalId'))
    if (!s || s.status !== 'APPROVED') throw err(409, 'Slot is not available')
    if (s.startTime <= MIN_START()) throw err(409, 'This slot has already started')
    const mine = db.appts.filter((a) => a.patientId === p.userId && ['PENDING_PAYMENT', 'CONFIRMED'].includes(a.status))
    if (mine.filter((a) => a.status === 'PENDING_PAYMENT').length >= 2)
      throw err(429, 'You have too many unpaid bookings. Complete or wait out a pending payment first.')
    if (mine.some((a) => a.startTime < s.endTime && a.endTime > s.startTime))
      throw err(409, 'You already have an appointment that overlaps this slot')
    if (b.note !== undefined && typeof b.note !== 'string') throw err(400, 'note must be text')
    const note = (b.note ?? '').trim()
    if (note.length > MAX_VISIT_NOTE) throw err(400, `note must be at most ${MAX_VISIT_NOTE} characters`)
    if (note && s.consultationType !== 'SPECIALIST')
      throw err(400, 'A note can only be added to a specialist appointment')
    s.status = 'BOOKED'
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
      ...(note ? { note } : {}),
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
  'POST /appointments/pay': ({ b }) => {
    if (!paymentSimulation) throw err(501, 'No payment provider is configured')
    const outcome = b.simulateOutcome ?? 'SUCCESS'
    if (outcome !== 'SUCCESS' && outcome !== 'FAILED') throw err(400, 'simulateOutcome must be SUCCESS or FAILED')
    const p = me()
    const a = db.appts.find((x) => x.appointmentId === str(b, 'appointmentId'))
    if (!a) throw err(404, 'Appointment not found')
    if (a.patientId !== p.userId) throw err(403, 'Not authorized')
    if (a.status !== 'PENDING_PAYMENT') throw err(409, 'Appointment is not awaiting payment')
    if (Date.now() > +new Date(a.createdAt) + HOLD_MIN * 6e4)
      throw err(409, 'The payment window for this booking has expired')
    if (outcome === 'SUCCESS') {
      a.status = 'CONFIRMED'
      notify(
        p.userId,
        'PAYMENT_RESULT',
        ['EMAIL', 'SMS'],
        `Payment of ${a.fee} for appointment ${a.appointmentId}: SUCCESS.`,
      )
      notify(
        p.userId,
        'BOOKING_CONFIRMATION',
        ['EMAIL', 'SMS'],
        `Your appointment with ${docName(a.doctorId)} is confirmed.`,
      )
    } else {
      a.status = 'CANCELLED'
      release(a.slotId)
      notify(
        p.userId,
        'PAYMENT_RESULT',
        ['EMAIL', 'SMS'],
        `Payment of ${a.fee} for appointment ${a.appointmentId}: FAILED.`,
      )
    }
    return { appointmentId: a.appointmentId, paymentStatus: outcome, amount: a.fee }
  },
  'GET /appointments/mine': ({ q }) => {
    const u = me()
    const list =
      u.role === 'PATIENT'
        ? db.appts.filter((a) => a.patientId === u.userId)
        : u.role === 'DOCTOR'
          ? db.appts.filter((a) => a.doctorId === u.userId)
          : u.role === 'HOSPITAL_ADMIN' || u.role === 'STAFF'
            ? db.appts.filter((a) => a.hospitalId === u.hospitalId)
            : null
    if (!list) throw err(403, 'Not authorized')
    return {
      appointments: list
        .filter((a) => !q.status || a.status === q.status)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .map(withNames)
        // the note is private to the patient and their doctor
        .map(({ note, ...a }) => (note && ['PATIENT', 'DOCTOR'].includes(u.role) ? { ...a, note } : a)),
    }
  },
  'POST /appointments/cancel': ({ b }) => {
    const p = me()
    const a = db.appts.find((x) => x.appointmentId === str(b, 'appointmentId'))
    if (!a) throw err(404, 'Appointment not found')
    if (a.patientId !== p.userId) throw err(403, 'Not authorized')
    if (a.status !== 'CONFIRMED') throw err(409, 'Only a confirmed appointment can be cancelled')
    if (a.startTime <= MIN_START()) throw err(409, 'An appointment that has already started cannot be cancelled')
    a.status = 'CANCELLED'
    release(a.slotId)
    notify(p.userId, 'CANCELLATION', ['EMAIL', 'SMS'], `Your appointment with ${docName(a.doctorId)} was cancelled.`)
    return { appointmentId: a.appointmentId, status: 'CANCELLED' }
  },
  'POST /appointments/reschedule': ({ b }) => {
    const u = me()
    const a = db.appts.find((x) => x.appointmentId === str(b, 'appointmentId'))
    if (!a) throw err(404, 'Appointment not found')
    if (a.patientId === u.userId) {
      if (a.status === 'MISSED') throw err(403, 'A missed appointment cannot be rescheduled or refunded')
      if (a.status !== 'CONFIRMED') throw err(403, 'Only a confirmed appointment can be rescheduled')
      if (Date.now() > +new Date(a.startTime) - RESCHEDULE_CUTOFF_H * 36e5)
        throw err(
          403,
          `Appointments can only be rescheduled more than ${RESCHEDULE_CUTOFF_H} hours before the start time`,
        )
    } else if (a.doctorId === u.userId) {
      if (a.status === 'COMPLETED') throw err(403, 'A completed appointment cannot be rescheduled')
      if (!['CONFIRMED', 'MISSED'].includes(a.status))
        throw err(409, 'This appointment cannot be rescheduled from its current state')
    } else throw err(403, 'Not authorized')
    const hid = str(b, 'newHospitalId'),
      sid = str(b, 'newSlotId')
    if (hid === a.hospitalId && sid === a.slotId) throw err(400, 'The new slot must differ from the current one')
    const s = db.slots.find((x) => x.slotId === sid && x.hospitalId === hid)
    if (!s || s.status !== 'APPROVED') throw err(409, 'New slot is not available')
    if (s.startTime <= MIN_START()) throw err(409, 'New slot has already started')
    if (s.consultationType !== a.consultationType)
      throw err(409, 'The new slot has a different consultation type (and fee)')
    const old = apptSlot(a)
    a.status = 'RESCHEDULED'
    s.status = 'BOOKED'
    if (old && old.status === 'BOOKED' && old.startTime > MIN_START()) releaseSlot(old)
    const n: Appointment = {
      ...a,
      appointmentId: id('appt'),
      slotId: s.slotId,
      doctorId: s.doctorId,
      hospitalId: s.hospitalId,
      specialtyId: s.specialtyId,
      startTime: s.startTime,
      endTime: s.endTime,
      status: 'CONFIRMED',
      createdAt: iso(now()),
    }
    db.appts.push(n)
    notify(
      a.patientId,
      'RESCHEDULE',
      ['EMAIL', 'SMS'],
      `Your appointment has been rescheduled to ${new Date(s.startTime).toLocaleString()}.`,
    )
    return { oldAppointmentId: a.appointmentId, newAppointmentId: n.appointmentId }
  },
  // hospital staff or the hospital admin: the patient has arrived and signed in
  'POST /appointments/check-in': ({ b }) => {
    const u = me()
    if (u.role !== 'STAFF' && u.role !== 'HOSPITAL_ADMIN') throw err(403, 'Not authorized')
    const a = db.appts.find((x) => x.appointmentId === str(b, 'appointmentId'))
    if (!a) throw err(404, 'Appointment not found')
    if (a.hospitalId !== u.hospitalId) throw err(403, 'Not authorized for this hospital')
    if (a.status === 'ARRIVED') throw err(409, 'This patient is already checked in')
    if (a.status !== 'CONFIRMED') throw err(409, 'Only a confirmed appointment can be checked in')
    if (+new Date(a.startTime) - CHECK_IN_EARLY_H * 36e5 > Date.now())
      throw err(409, `Patients can be checked in from ${CHECK_IN_EARLY_H} hours before the appointment`)
    if (+new Date(a.endTime) < Date.now()) throw err(409, 'This appointment time has already passed')
    a.status = 'ARRIVED'
    return { appointmentId: a.appointmentId, status: 'ARRIVED' }
  },
  // the doctor: the consultation is over
  'POST /appointments/complete': ({ b }) => {
    const d = need('DOCTOR')
    const a = db.appts.find((x) => x.appointmentId === str(b, 'appointmentId'))
    if (!a || a.doctorId !== d.userId) throw err(403, 'Not authorized')
    if (a.status !== 'ARRIVED')
      throw err(409, 'The patient must be checked in at the hospital before the session can be completed')
    a.status = 'COMPLETED'
    notify(
      a.patientId,
      'SESSION_COMPLETED',
      ['EMAIL'],
      `Your session with ${docName(a.doctorId)} is complete. You can now leave a review of your doctor (Appointments, then History).`,
    )
    return { appointmentId: a.appointmentId, status: 'COMPLETED' }
  },
}
