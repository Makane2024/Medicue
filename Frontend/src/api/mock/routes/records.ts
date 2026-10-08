// Medical notes and the notification feed.

import type { Note } from '../../types'
import { db } from '../db'
import { err, me, str } from '../helpers'
import { RouteMap } from '../types'
import { id, iso, now } from '../utils'

export const recordRoutes: RouteMap = {
  'POST /medical-notes/record': ({ b }) => {
    const d = me()
    const a = db.appts.find((x) => x.appointmentId === str(b, 'appointmentId'))
    const content = str(b, 'content', 10000)
    if (!a || a.doctorId !== d.userId) throw err(403, 'Not authorized')
    if (a.status !== 'COMPLETED') throw err(409, 'A note can only be recorded once the appointment is marked completed')
    const n: Note = {
      noteId: id('note'),
      patientId: a.patientId,
      appointmentId: a.appointmentId,
      doctorId: d.userId,
      hospitalId: a.hospitalId,
      content,
      createdAt: iso(now()),
    }
    db.notes.push(n)
    return { noteId: n.noteId }
  },
  'GET /medical-notes/list': ({ q }) => {
    const u = me()
    if (u.role === 'PATIENT') return { notes: db.notes.filter((n) => n.patientId === u.userId) }
    if (u.role !== 'DOCTOR') throw err(403, 'Not authorized')
    if (!q.patientId) throw err(400, 'patientId is required')
    return { notes: db.notes.filter((n) => n.patientId === q.patientId && n.doctorId === u.userId) }
  },
  'GET /notifications/mine': () => {
    const u = me()
    return {
      notifications: db.notices
        .filter((n) => n.userId === u.userId)
        .slice(0, 50)
        .map(({ userId, ...n }) => n),
    }
  },
}
