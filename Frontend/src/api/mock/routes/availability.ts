// Slot proposals, doctor approval and the schedules each role sees.

import { BUFFER_SAME, MAX_PROPOSAL_SLOTS, MAX_SLOT_H } from '../../rules'
import type { Slot } from '../../types'
import { db } from '../db'
import { approvedHospital, conflict, err, me, MIN_START, need, notify, oneOf, str } from '../helpers'
import { RouteMap } from '../types'
import { id, iso } from '../utils'

export const availabilityRoutes: RouteMap = {
  'POST /availability/propose': ({ b }) => {
    const ha = need('HOSPITAL_ADMIN')
    approvedHospital(ha.hospitalId!)
    const doctorId = str(b, 'doctorId', 64)
    const consultationType = b.consultationType
      ? oneOf(b, 'consultationType', ['GENERAL', 'SPECIALIST'] as const)
      : 'GENERAL'
    if (!Array.isArray(b.slots) || !b.slots.length)
      throw err(400, 'slots must be a non-empty list of { startTime, endTime }')
    if (b.slots.length > MAX_PROPOSAL_SLOTS)
      throw err(400, `You can propose at most ${MAX_PROPOSAL_SLOTS} slots at once`)
    const times = b.slots.map((raw: any, i: number) => {
      const startTime = new Date(str(raw ?? {}, 'startTime', 40)).toISOString(),
        endTime = new Date(str(raw ?? {}, 'endTime', 40)).toISOString()
      const dur = +new Date(endTime) - +new Date(startTime)
      if (dur <= 0) throw err(400, `Slot ${i + 1}: endTime must be after startTime`)
      if (dur > MAX_SLOT_H * 36e5) throw err(400, `Slot ${i + 1}: a slot cannot exceed ${MAX_SLOT_H} hours`)
      if (startTime <= MIN_START()) throw err(400, `Slot ${i + 1}: startTime must be in the future`)
      return { startTime, endTime }
    })
    for (let i = 0; i < times.length; i++)
      for (let j = i + 1; j < times.length; j++)
        if (
          +new Date(times[j].startTime) < +new Date(times[i].endTime) + BUFFER_SAME * 6e4 &&
          +new Date(times[j].endTime) > +new Date(times[i].startTime) - BUFFER_SAME * 6e4
        )
          throw err(409, `Slots ${i + 1} and ${j + 1} overlap or are less than ${BUFFER_SAME} minutes apart`)
    const aff = db.affiliations.find(
      (a) => a.doctorId === doctorId && a.hospitalId === ha.hospitalId && a.status === 'ACTIVE',
    )
    if (!aff) throw err(400, 'This doctor is not affiliated with your hospital')
    times.forEach((t: { startTime: string; endTime: string }, i: number) => {
      if (conflict(doctorId, ha.hospitalId!, t.startTime, t.endTime, undefined, true))
        throw err(409, `Slot ${i + 1}: the doctor already has an overlapping or too-close slot`)
    })
    const created: Slot[] = times.map((t: { startTime: string; endTime: string }) => ({
      slotId: id('slot'),
      hospitalId: ha.hospitalId!,
      doctorId,
      specialtyId: aff.specialtyId,
      consultationType,
      startTime: t.startTime,
      endTime: t.endTime,
      status: 'PENDING',
    }))
    db.slots.push(...created)
    notify(
      doctorId,
      'SLOT_PROPOSED',
      ['EMAIL'],
      created.length > 1
        ? `A hospital proposed ${created.length} availability slots. Open MediCue to approve or reject each one.`
        : `A hospital proposed a slot from ${created[0].startTime} to ${created[0].endTime}.`,
    )
    return { slotIds: created.map((c) => c.slotId), status: 'PENDING' }
  },
  'POST /availability/approve': ({ b }) => {
    const d = me()
    const decision = oneOf(b, 'decision', ['APPROVED', 'REJECTED'] as const)
    const s = db.slots.find((x) => x.slotId === str(b, 'slotId') && x.hospitalId === str(b, 'hospitalId'))
    if (!s || s.doctorId !== d.userId) throw err(403, 'Not authorized')
    if (s.status !== 'PENDING') throw err(409, `Slot is already ${s.status} and can no longer be approved or rejected`)
    if (decision === 'APPROVED') {
      if (s.startTime <= MIN_START()) throw err(409, 'This slot starts in the past')
      if (conflict(s.doctorId, s.hospitalId, s.startTime, s.endTime, s.slotId))
        throw err(409, 'Conflict detected at approval time')
    }
    s.status = decision
    return { slotId: s.slotId, status: decision }
  },
  'GET /availability/pending': () => {
    return {
      slots: db.slots.filter((s) => s.doctorId === me().userId && s.status === 'PENDING' && s.startTime >= MIN_START()),
    }
  },
  'GET /availability/mine': () => {
    const d = need('DOCTOR')
    return { slots: db.slots.filter((s) => s.doctorId === d.userId && s.startTime >= MIN_START()) }
  },
  'GET /availability/hospital': () => {
    const ha = need('HOSPITAL_ADMIN')
    const from = iso(new Date(Date.now() - 864e5))
    return { slots: db.slots.filter((s) => s.hospitalId === ha.hospitalId && s.startTime >= from) }
  },
  'GET /availability/browse': ({ q }) => {
    approvedHospital(str(q, 'hospitalId'))
    const open = db.slots
      .filter((s) => s.hospitalId === q.hospitalId && s.status === 'APPROVED' && s.startTime > MIN_START())
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
    const limit = Math.min(Number(q.limit) || 50, 100)
    const offset = Number(q.nextToken) || 0
    return {
      slots: open.slice(offset, offset + limit),
      nextToken: offset + limit < open.length ? String(offset + limit) : undefined,
    }
  },
}
