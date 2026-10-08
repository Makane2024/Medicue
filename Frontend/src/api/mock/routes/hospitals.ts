// Hospital registration, the public list of approved hospitals and platform-admin review.

import { isE164, passwordProblem } from '../../rules'
import type { Hospital } from '../../types'
import { db, type MUser } from '../db'
import { docs, samplePdf } from '../documents'
import { err, need, notify, oneOf, str } from '../helpers'
import { RouteMap } from '../types'
import { id, iso, now } from '../utils'

export const hospitalRoutes: RouteMap = {
  'POST /hospitals/register': ({ b }) => {
    const email = str(b, 'email', 254).toLowerCase(),
      password = str(b, 'password', 256)
    const phone = str(b, 'phone', 20)
    if (!isE164(phone)) throw err(400, 'phone must be in E.164 format, e.g. +237650000000')
    const pw = passwordProblem(password)
    if (pw) throw err(400, pw)
    const doc = str(b, 'documentBase64', 8e6)
    if (atob(doc.slice(0, 8)).slice(0, 5) !== '%PDF-') throw err(400, 'documentBase64 must be a PDF file')
    if (db.users.some((u) => u.email === email)) throw err(409, 'An account with this email already exists')
    const h: Hospital = {
      hospitalId: id('hosp'),
      name: str(b, 'hospitalName', 200),
      address: str(b, 'address', 300),
      phone,
      status: 'PENDING',
      createdAt: iso(now()),
    }
    h.verificationDocKey = `verification-docs/${h.hospitalId}.pdf`
    docs[h.hospitalId] = doc
    db.hospitals.push(h)
    db.users.push({
      userId: id('sub'),
      firstName: str(b, 'firstName', 100),
      lastName: str(b, 'lastName', 100),
      email,
      role: 'HOSPITAL_ADMIN',
      hospitalId: h.hospitalId,
      password,
      confirmed: false,
    } as MUser)
    return { message: 'Hospital submitted for review.' }
  },
  'GET /hospitals/approved': () => {
    return {
      hospitals: db.hospitals
        .filter((h) => h.status === 'APPROVED')
        .map(({ hospitalId, name, address, phone }) => ({
          hospitalId,
          name,
          address,
          phone,
        })),
    }
  },
  'GET /hospitals/list': ({ q }) => {
    need('PLATFORM_ADMIN')
    if (!['PENDING', 'APPROVED', 'REJECTED'].includes(q.status))
      throw err(400, 'status query parameter must be PENDING, APPROVED or REJECTED')
    return {
      hospitals: db.hospitals
        .filter((h) => h.status === q.status)
        .map((h) => ({
          ...h,
          verificationDocUrl: 'data:application/pdf;base64,' + (docs[h.hospitalId] ?? btoa(samplePdf(h))),
        })),
    }
  },
  'POST /hospitals/review': ({ b }) => {
    need('PLATFORM_ADMIN')
    const decision = oneOf(b, 'decision', ['APPROVED', 'REJECTED'] as const)
    const h = db.hospitals.find((x) => x.hospitalId === str(b, 'hospitalId'))
    if (!h) throw err(404, 'Hospital not found')
    h.status = decision
    db.users
      .filter((u) => u.hospitalId === h.hospitalId && u.role === 'HOSPITAL_ADMIN')
      .forEach((u) =>
        notify(
          u.userId,
          'HOSPITAL_REVIEWED',
          ['EMAIL'],
          `Your registration of ${h.name} was ${decision.toLowerCase()}.`,
        ),
      )
    return { hospitalId: h.hospitalId, status: decision }
  },
}
