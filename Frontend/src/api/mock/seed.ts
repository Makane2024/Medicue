// Demo content: hospitals' slots, a few appointments, notes and reviews for the seeded accounts.

import { BUFFER_CROSS, BUFFER_SAME, GP_ID } from '../rules'
import type { Appointment } from '../types'
import { db } from './db'
import { at, id, iso } from './utils'

;(() => {
  const docs = db.affiliations.filter((a) => a.hospitalId === 'hosp-1')
  // Open sessions for the coming week at both hospitals. Each doctor offers about four a day, at least the booking
  // rules' distance from their other sessions (10 minutes at one hospital, 90 minutes between hospitals), and doctors
  // who work at two hospitals alternate between them by day.
  const SESSION_STARTS: [number, number][] = [
    [8, 30],
    [9, 30],
    [10, 30],
    [11, 30],
    [14, 0],
    [15, 0],
    [16, 0],
  ]
  const clashes = (doctorId: string, hospitalId: string, start: number, end: number) =>
    db.slots.some((x) => {
      if (x.doctorId !== doctorId) return false
      const gap = (x.hospitalId === hospitalId ? BUFFER_SAME : BUFFER_CROSS) * 6e4
      return start < +new Date(x.endTime) + gap && end > +new Date(x.startTime) - gap
    })
  const doctorIds = [...new Set(db.affiliations.map((a) => a.doctorId))]
  for (let d = 0; d < 8; d++)
    doctorIds.forEach((doctorId, i) => {
      const places = db.affiliations.filter((a) => a.doctorId === doctorId)
      const a = places[d % places.length]
      const general = a.specialtyId === GP_ID
      SESSION_STARTS.forEach(([h, m], j) => {
        if ((d + i + j) % 7 > 3) return // about four of the seven, a different four each day
        const startDate = new Date(at(d, h, m + (i % 3) * 10))
        const start = +startDate
        const end = start + (general ? 20 : 30) * 6e4
        if (!general && [0, 6].includes(startDate.getDay())) return // specialists do not consult at weekends
        if (start < Date.now() + 45 * 6e4 || clashes(doctorId, a.hospitalId, start, end)) return
        db.slots.push({
          slotId: id('slot'),
          hospitalId: a.hospitalId,
          doctorId,
          specialtyId: a.specialtyId,
          consultationType: general ? 'GENERAL' : 'SPECIALIST',
          startTime: iso(startDate),
          endTime: iso(new Date(end)),
          status: 'APPROVED',
        })
      })
    })
  db.slots.push({
    slotId: 'slot-p1',
    hospitalId: 'hosp-1',
    doctorId: 'sub-doc-1',
    specialtyId: 'cardiology',
    consultationType: 'SPECIALIST',
    startTime: at(8, 10),
    endTime: at(8, 10, 45),
    status: 'PENDING',
  })
  db.slots.push({
    slotId: 'slot-p2',
    hospitalId: 'hosp-2',
    doctorId: 'sub-doc-1',
    specialtyId: 'cardiology',
    consultationType: 'SPECIALIST',
    startTime: at(9, 13),
    endTime: at(9, 14),
    status: 'PENDING',
  })
  const s = db.slots.find(
    (x) =>
      x.doctorId === 'sub-doc-1' && x.status === 'APPROVED' && new Date(x.startTime) > new Date(Date.now() + 864e5),
  )!
  s.status = 'BOOKED'
  const mk = (
    p: Partial<Appointment> &
      Pick<Appointment, 'appointmentId' | 'doctorId' | 'startTime' | 'endTime' | 'status' | 'createdAt'>,
  ): Appointment => ({
    patientId: 'sub-pat-1',
    hospitalId: 'hosp-1',
    slotId: 'old',
    consultationType: 'GENERAL',
    fee: 2000,
    ...p,
  })
  db.appts.push(
    mk({
      appointmentId: 'appt-1',
      doctorId: s.doctorId,
      slotId: s.slotId,
      specialtyId: s.specialtyId,
      startTime: s.startTime,
      endTime: s.endTime,
      consultationType: 'SPECIALIST',
      fee: 3000,
      status: 'CONFIRMED',
      createdAt: at(-2, 10),
    }),
  )
  db.appts.push(
    mk({
      appointmentId: 'appt-0',
      doctorId: 'sub-doc-4',
      specialtyId: GP_ID,
      startTime: at(-6, 9),
      endTime: at(-6, 9, 30),
      status: 'COMPLETED',
      createdAt: at(-9, 10),
    }),
  )
  db.appts.push(
    mk({
      appointmentId: 'appt-x',
      doctorId: 'sub-doc-1',
      slotId: 'old2',
      specialtyId: 'cardiology',
      consultationType: 'SPECIALIST',
      fee: 3000,
      startTime: iso(new Date(Date.now() - 10 * 6e4)),
      endTime: iso(new Date(Date.now() + 20 * 6e4)),
      status: 'CONFIRMED',
      createdAt: at(-3, 10),
    }),
  )
  db.notes.push({
    noteId: 'note-1',
    patientId: 'sub-pat-1',
    appointmentId: 'appt-0',
    doctorId: 'sub-doc-4',
    hospitalId: 'hosp-1',
    content:
      'BP 128/82. Mild seasonal allergies. Prescribed cetirizine 10mg nightly for 14 days. Return if symptoms persist.',
    createdAt: at(-6, 10),
  })
  db.reviews.push({
    reviewId: 'rv-1',
    doctorId: 'sub-doc-4',
    patientId: 'sub-pat-1',
    appointmentId: 'appt-0',
    rating: 5,
    comment: 'Very patient and explained everything clearly. Barely waited at all.',
    createdAt: at(-5, 12),
  })
  db.reviews.push({
    reviewId: 'rv-2',
    doctorId: 'sub-doc-1',
    patientId: 'sub-pat-3',
    appointmentId: 'x1',
    rating: 5,
    comment: 'Thorough heart check-up, and he followed up by email afterwards.',
    createdAt: at(-12, 12),
  })
  db.notices.push({
    notificationId: id('n'),
    userId: 'sub-pat-1',
    type: 'BOOKING_CONFIRMATION',
    channel: 'EMAIL',
    deliveryStatus: 'SENT',
    message: 'Your appointment with Dr. Michael Patel is confirmed.',
    createdAt: at(-2, 10),
  })

  // Five weeks of history at the first hospital (for the statistics charts), plus a few sessions still to come
  // today for the check-in screen. Deterministic, so the demo looks the same on every load.
  let seed = 7
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280
  const patients = ['sub-pat-2', 'sub-pat-3']
  const doctors = docs.map((a) => a)
  for (let d = -35; d <= 0; d++) {
    const weekday = new Date(Date.now() + d * 864e5).getDay()
    if (weekday === 0) continue
    const n = 3 + Math.floor(rnd() * 5)
    for (let k = 0; k < n; k++) {
      const a = doctors[Math.floor(rnd() * doctors.length)]
      const hour = 8 + Math.floor(rnd() * 9)
      const start = at(d, hour, [0, 20, 40][Math.floor(rnd() * 3)])
      if (d === 0 && +new Date(start) > Date.now() - 30 * 6e4) continue // today's later sessions are added below
      const r = rnd()
      db.appts.push(
        mk({
          appointmentId: id('appt'),
          patientId: patients[Math.floor(rnd() * patients.length)],
          doctorId: a.doctorId,
          slotId: 'hist',
          specialtyId: a.specialtyId,
          consultationType: a.specialtyId === GP_ID ? 'GENERAL' : 'SPECIALIST',
          fee: a.specialtyId === GP_ID ? 2000 : 3000,
          startTime: start,
          endTime: iso(new Date(+new Date(start) + 30 * 6e4)),
          status: r < 0.7 ? 'COMPLETED' : r < 0.83 ? 'MISSED' : 'CANCELLED',
          createdAt: at(d - 2, 10),
        }),
      )
    }
  }
  ;[
    ['sub-pat-2', 'sub-doc-4', 20],
    ['sub-pat-3', 'sub-doc-5', 50],
    ['sub-pat-2', 'sub-doc-3', 95],
  ].forEach(([patientId, doctorId, minutes]) => {
    const start = new Date(Date.now() + Number(minutes) * 6e4)
    start.setSeconds(0, 0)
    const doc = db.affiliations.find((a) => a.doctorId === doctorId)!
    db.appts.push(
      mk({
        appointmentId: id('appt'),
        patientId: String(patientId),
        doctorId: String(doctorId),
        slotId: 'today',
        specialtyId: doc.specialtyId,
        consultationType: doc.specialtyId === GP_ID ? 'GENERAL' : 'SPECIALIST',
        fee: doc.specialtyId === GP_ID ? 2000 : 3000,
        startTime: iso(start),
        endTime: iso(new Date(+start + 30 * 6e4)),
        status: 'CONFIRMED',
        createdAt: at(-1, 10),
      }),
    )
  })

  // Sessions already taken: about one booked per doctor per day over the coming week, both general consultations
  // and specialist visits, so every calendar shows a mix of free and busy times.
  const people = [
    'sub-pat-2',
    'sub-pat-3',
    'sub-pat-4',
    'sub-pat-5',
    'sub-pat-6',
    'sub-pat-7',
    'sub-pat-8',
    'sub-pat-9',
  ]
  const REASONS: Record<string, string[]> = {
    dentistry: ['Teeth whitening', 'Sharp pain in a lower molar when I drink something cold'],
    cardiology: ['Chest tightness when I climb stairs', 'Follow-up on my blood pressure readings'],
    dermatology: ['Itchy rash on my arms that keeps coming back'],
    orthopedics: ['Knee pain after football, getting worse for two weeks'],
    paediatrics: ['Routine check-up and vaccinations for my daughter'],
    neurology: ['Headaches most mornings for the past month'],
    ophthalmology: ['Blurry vision when reading, possibly need glasses'],
    gynaecology: ['Antenatal check-up, 28 weeks'],
    endocrinology: ['Reviewing my diabetes medication'],
    urology: ['Follow-up after kidney stone treatment'],
  }
  const reasonFor = (specialtyId: string) => {
    const list = REASONS[specialtyId]
    return list && rnd() < 0.75 ? list[Math.floor(rnd() * list.length)] : undefined
  }
  let turn = 0
  doctorIds.forEach((doctorId) => {
    for (let d = 1; d <= 6; d++) {
      const day = new Date(at(d, 0)).toDateString()
      const open = db.slots.filter(
        (s) => s.doctorId === doctorId && s.status === 'APPROVED' && new Date(s.startTime).toDateString() === day,
      )
      const s = open[Math.floor(rnd() * open.length)]
      if (!s || rnd() < 0.3) continue
      s.status = 'BOOKED'
      db.appts.push(
        mk({
          appointmentId: id('appt'),
          patientId: people[turn++ % people.length],
          hospitalId: s.hospitalId,
          doctorId,
          slotId: s.slotId,
          specialtyId: s.specialtyId,
          consultationType: s.consultationType,
          fee: s.consultationType === 'GENERAL' ? 2000 : 3000,
          startTime: s.startTime,
          endTime: s.endTime,
          status: 'CONFIRMED',
          ...(s.consultationType === 'SPECIALIST' && { note: reasonFor(s.specialtyId) }),
          createdAt: at(-1, 9 + (turn % 8)),
        }),
      )
    }
  })
  ;[
    ['sub-doc-6', 'sub-pat-4', 5, 'Explained my results step by step and answered every question. Very reassuring.'],
    ['sub-doc-9', 'sub-pat-5', 4, 'Gentle with my daughter and the whole visit ran on time.'],
    ['sub-doc-15', 'sub-pat-6', 5, 'Listened properly and the treatment worked within a week.'],
    ['sub-doc-12', 'sub-pat-7', 4, 'Thorough eye test, clear advice about the glasses.'],
    ['sub-doc-11', 'sub-pat-8', 5, 'Took the time to go through every option with me.'],
    ['sub-doc-18', 'sub-pat-9', 4, 'Quick appointment, friendly and practical.'],
  ].forEach(([doctorId, patientId, rating, comment], n) =>
    db.reviews.push({
      reviewId: id('rv'),
      doctorId: String(doctorId),
      patientId: String(patientId),
      appointmentId: 'past' + n,
      rating: Number(rating),
      comment: String(comment),
      createdAt: at(-4 - n, 12),
    }),
  )
})()
