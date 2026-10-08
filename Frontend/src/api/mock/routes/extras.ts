// Profile editing, reports, account/hospital removal, doctor removal and reviews. Same routes and shapes as the backend.

import type { Review } from '../../types'
import { db } from '../db'
import { deleteUser, err, me, need, notify } from '../helpers'
import { RouteMap } from '../types'
import { id, iso, now } from '../utils'

const reported = new Set<string>() // `${reportedId}:${reporterId}`, one report per pair like the backend

export const extraRoutes: RouteMap = {
  'POST /users/update-profile': ({ b }) => {
    const u = me()
    for (const k of ['firstName', 'lastName', 'photo'] as const) if (b[k] !== undefined) (u as any)[k] = b[k]
    if (typeof b.phone === 'string' && b.phone.trim()) u.phone = b.phone // an empty phone means "unchanged"
    if (u.role === 'DOCTOR' && b.bio !== undefined) u.bio = b.bio
    const { password, confirmed, tempPassword, suspended, userId, ...profile } = u as any // as the backend: no credentials, no own id
    return profile
  },
  'POST /users/report': ({ b }) => {
    const u = db.users.find((x) => x.userId === b.userId)
    if (!u) throw err(404, 'User not found')
    if (u.userId === me().userId) throw err(400, "You can't report yourself")
    if (reported.has(`${u.userId}:${me().userId}`)) throw err(409, 'You already reported this account')
    reported.add(`${u.userId}:${me().userId}`)
    u.reportCount = (u.reportCount ?? 0) + 1
    return { ok: true }
  },
  'GET /users/reported': () => {
    need('PLATFORM_ADMIN')
    return {
      users: db.users
        .filter((u) => (u.reportCount ?? 0) > 0)
        .sort((a, b) => b.reportCount! - a.reportCount!)
        .map(({ password, confirmed, tempPassword, ...u }: any) => u), // never the stored credentials
    }
  },
  'POST /users/delete': ({ b }) => {
    need('PLATFORM_ADMIN')
    const u = db.users.find((x) => x.userId === b.userId)
    if (!u) throw err(404, 'User not found')
    if (u.role === 'PLATFORM_ADMIN') throw err(403, 'Platform admins cannot be deleted')
    if (u.role === 'HOSPITAL_ADMIN')
      throw err(409, 'Hospital admin accounts are removed together with their hospital. Delete the hospital instead.')
    deleteUser(u.userId)
    return { ok: true }
  },
  'POST /hospitals/delete': ({ b }) => {
    need('PLATFORM_ADMIN')
    const h = db.hospitals.find((x) => x.hospitalId === b.hospitalId)
    if (!h) throw err(404, 'Hospital not found')
    const ids = db.affiliations.filter((a) => a.hospitalId === h.hospitalId).map((a) => a.doctorId)
    db.affiliations = db.affiliations.filter((a) => a.hospitalId !== h.hospitalId)
    ids.forEach(deleteUser)
    db.users.filter((u) => u.hospitalId === h.hospitalId).forEach((u) => deleteUser(u.userId))
    db.slots = db.slots.filter((s) => s.hospitalId !== h.hospitalId)
    db.appts.forEach((a) => {
      if (a.hospitalId === h.hospitalId && ['CONFIRMED', 'PENDING_PAYMENT'].includes(a.status)) {
        a.status = 'CANCELLED'
        notify(
          a.patientId,
          'CANCELLATION',
          ['EMAIL'],
          `${h.name} was removed from MediCue; your appointment was cancelled.`,
        )
      }
    })
    db.hospitals = db.hospitals.filter((x) => x !== h)
    return { ok: true, doctorsRemoved: ids.length }
  },
  'POST /doctors/remove': ({ b }) => {
    const ha = need('HOSPITAL_ADMIN')
    if (!db.affiliations.some((a) => a.doctorId === b.doctorId && a.hospitalId === ha.hospitalId))
      throw err(404, 'Doctor is not at this hospital')
    const here = db.slots.filter((s) => s.doctorId === b.doctorId && s.hospitalId === ha.hospitalId)
    if (here.some((s) => ['BOOKED', 'OFFERED'].includes(s.status) && s.startTime > iso(now())))
      throw err(409, 'This doctor has upcoming bookings. Wait until they are completed or cancelled.')
    db.affiliations = db.affiliations.filter((a) => !(a.doctorId === b.doctorId && a.hospitalId === ha.hospitalId))
    db.slots = db.slots.filter((s) => !here.includes(s) || !['PENDING', 'APPROVED'].includes(s.status))
    return { ok: true }
  },
  'GET /reviews/doctor': ({ q }) => {
    const reviews = db.reviews
      .filter((r) => r.doctorId === q.doctorId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ ...r, patientName: db.users.find((u) => u.userId === r.patientId)?.firstName }))
    return { reviews }
  },
  'GET /reviews/mine': () => {
    return { reviews: db.reviews.filter((r) => r.patientId === me().userId) }
  },
  'POST /reviews/create': ({ b }) => {
    const p = need('PATIENT')
    const a = db.appts.find((x) => x.appointmentId === b.appointmentId)
    if (!a || a.patientId !== p.userId || a.status !== 'COMPLETED')
      throw err(403, 'You can only review doctors after a completed session')
    if (db.reviews.some((r) => r.appointmentId === a.appointmentId)) throw err(409, 'You already reviewed this session')
    const rating = Math.round(Number(b.rating))
    if (rating < 1 || rating > 5) throw err(400, 'Rating must be 1 to 5')
    const rv: Review = {
      reviewId: id('rv'),
      doctorId: a.doctorId,
      patientId: p.userId,
      appointmentId: a.appointmentId,
      rating,
      comment: String(b.comment ?? ''),
      createdAt: iso(now()),
    }
    db.reviews.push(rv)
    return rv
  },
}
