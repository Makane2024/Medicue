// Staff, statistics, hospital location, bulk import and the platform admin's user directory.
// Same routes, rules and response shapes as Backend/lambda (add-staff, hospital-stats, bulk-create-users ...).

import { isE164 } from '../../rules'
import type { BulkRowResult, DirectoryRole, Role } from '../../types'
import { db, type MUser } from '../db'
import { approvedHospital, deleteUser, err, me, need, str } from '../helpers'
import { summarize } from '../stats'
import { RouteMap } from '../types'
import { id } from '../utils'

const PAGE = 50
const ROLES: DirectoryRole[] = ['PATIENT', 'DOCTOR', 'STAFF', 'HOSPITAL_ADMIN']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const emailOf = (b: any) => {
  const e = str(b, 'email', 254).toLowerCase()
  if (!EMAIL.test(e)) throw err(400, 'email must be a valid email address')
  return e
}

const slug = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// a created account is invited: it signs in with a temporary password and chooses its own (mock: Temp-Passw0rd)
const invite = (u: Omit<MUser, 'password' | 'confirmed' | 'tempPassword' | 'userId'>) => {
  const created: MUser = { ...u, userId: id('sub'), password: 'Temp-Passw0rd', confirmed: true, tempPassword: true }
  db.users.push(created)
  return created
}

/** The account a bulk row describes; throws the row's problem. Mirrors Backend/lambda/lib/bulk.ts + accounts.ts. */
function createRow(raw: any, caller: MUser): 'CREATED' | 'AFFILIATED' {
  if (!raw || typeof raw !== 'object') throw err(400, 'The row is not valid')
  const row: Record<string, string> = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, v == null ? '' : String(v).trim()]),
  )
  const role = row.role.toUpperCase().replace(/[\s-]+/g, '_') as Role
  if (!['PATIENT', 'DOCTOR', 'STAFF'].includes(role)) throw err(400, 'role must be PATIENT, DOCTOR or STAFF')
  if (caller.role === 'HOSPITAL_ADMIN' && role === 'PATIENT')
    throw err(403, 'Hospital admins can create doctors and staff, not patients')
  const firstName = str(row, 'firstName', 100),
    lastName = str(row, 'lastName', 100),
    email = emailOf(row)
  if (row.phone && !isE164(row.phone)) throw err(400, 'phone must be in E.164 format, e.g. +237650000000')
  const phone = row.phone || undefined

  if (role === 'PATIENT') {
    if (!phone) throw err(400, 'phone is required for patients')
    const dob = str(row, 'dateOfBirth', 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || +new Date(dob) > Date.now())
      throw err(400, 'dateOfBirth must be a past date formatted YYYY-MM-DD')
  }

  let hospitalId = caller.hospitalId
  if (role !== 'PATIENT' && caller.role === 'PLATFORM_ADMIN') {
    const wanted = str(row, 'hospital', 200).toLowerCase()
    const h = db.hospitals.find(
      (x) => x.status === 'APPROVED' && (x.hospitalId.toLowerCase() === wanted || x.name.toLowerCase() === wanted),
    )
    if (!h) throw err(400, `hospital "${row.hospital}" is not an approved hospital`)
    hospitalId = h.hospitalId
  }
  const specialty = role === 'DOCTOR' ? str(row, 'specialty', 100) : undefined
  if (specialty && !slug(specialty)) throw err(400, 'specialty must contain letters or digits')

  const existing = db.users.find((u) => u.email === email)
  if (existing) {
    if (role !== 'DOCTOR' || existing.role !== 'DOCTOR')
      throw err(
        409,
        existing.role === role
          ? 'An account with this email already exists'
          : `This email already belongs to a ${existing.role.toLowerCase().replace('_', ' ')} account`,
      )
    db.affiliations = db.affiliations.filter((a) => !(a.doctorId === existing.userId && a.hospitalId === hospitalId))
    db.affiliations.push({
      doctorId: existing.userId,
      hospitalId: hospitalId!,
      specialty: specialty!,
      specialtyId: slug(specialty!),
      status: 'ACTIVE',
    })
    return 'AFFILIATED'
  }

  const u = invite({
    firstName,
    lastName,
    email,
    role,
    ...(phone ? { phone } : {}),
    ...(role !== 'PATIENT' ? { hospitalId } : {}),
    ...(specialty ? { specialty } : {}),
  })
  if (role === 'DOCTOR')
    db.affiliations.push({
      doctorId: u.userId,
      hospitalId: hospitalId!,
      specialty: specialty!,
      specialtyId: slug(specialty!),
      status: 'ACTIVE',
    })
  return 'CREATED'
}

export const adminRoutes: RouteMap = {
  'POST /staff/add': ({ b }) => {
    const ha = need('HOSPITAL_ADMIN')
    approvedHospital(ha.hospitalId!)
    const email = emailOf(b)
    const phone = typeof b.phone === 'string' && b.phone.trim() ? b.phone.trim() : undefined
    if (phone && !isE164(phone)) throw err(400, 'phone must be in E.164 format, e.g. +237650000000')
    if (db.users.some((u) => u.email === email)) throw err(409, 'An account with this email already exists')
    const u = invite({
      firstName: str(b, 'firstName', 100),
      lastName: str(b, 'lastName', 100),
      email,
      role: 'STAFF',
      hospitalId: ha.hospitalId,
      ...(phone ? { phone } : {}),
    })
    return {
      staffId: u.userId,
      message: 'Staff account created. A temporary password was emailed. (Mock: use Temp-Passw0rd)',
    }
  },
  'GET /staff/list': () => {
    const ha = need('HOSPITAL_ADMIN')
    return {
      staff: db.users
        .filter((u) => u.role === 'STAFF' && u.hospitalId === ha.hospitalId)
        .map((u) => ({
          staffId: u.userId,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          phone: u.phone,
          suspended: u.suspended === true,
        }))
        .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)),
    }
  },
  'POST /staff/remove': ({ b }) => {
    const ha = need('HOSPITAL_ADMIN')
    const s = db.users.find((u) => u.userId === str(b, 'staffId'))
    if (!s || s.role !== 'STAFF' || s.hospitalId !== ha.hospitalId)
      throw err(404, 'Staff member not found at this hospital')
    deleteUser(s.userId)
    return { ok: true }
  },

  'GET /stats/hospital': ({ q }) => {
    const ha = need('HOSPITAL_ADMIN')
    const from = Date.parse(q.from ?? ''),
      to = Date.parse(q.to ?? '')
    if (Number.isNaN(from)) throw err(400, 'from must be an ISO-8601 timestamp')
    if (Number.isNaN(to)) throw err(400, 'to must be an ISO-8601 timestamp')
    if (to < from) throw err(400, 'to must not be before from')
    if (to - from > 62 * 864e5) throw err(400, 'The window can span at most 62 days')
    const tz = q.tzOffsetMinutes === undefined ? 0 : Number(q.tzOffsetMinutes)
    return summarize(
      db.appts.filter((a) => a.hospitalId === ha.hospitalId),
      new Date(from).toISOString(),
      new Date(to).toISOString(),
      tz,
    )
  },

  'POST /users/bulk-create': ({ b }) => {
    const caller = me()
    if (caller.role !== 'HOSPITAL_ADMIN' && caller.role !== 'PLATFORM_ADMIN') throw err(403, 'Not authorized')
    if (!Array.isArray(b.users) || !b.users.length) throw err(400, 'users must be a non-empty list')
    if (b.users.length > 50) throw err(400, 'Send at most 50 accounts per request')
    if (caller.role === 'HOSPITAL_ADMIN') approvedHospital(caller.hospitalId!)
    const seen = new Set<string>()
    const results: BulkRowResult[] = b.users.map((raw: any, index: number) => {
      const email = typeof raw?.email === 'string' ? raw.email.trim().toLowerCase() : undefined
      try {
        if (email && seen.has(email)) throw err(409, 'This email appears more than once in the file')
        const status = createRow(raw, caller as MUser)
        if (email) seen.add(email)
        return { index, email, status }
      } catch (e: any) {
        if (email && !seen.has(email) && e.status !== 409) seen.add(email)
        return { index, email, status: 'ERROR' as const, message: e.message }
      }
    })
    const count = (s: string) => results.filter((r) => r.status === s).length
    return { created: count('CREATED'), affiliated: count('AFFILIATED'), failed: count('ERROR'), results }
  },

  'GET /users/list': ({ q }) => {
    need('PLATFORM_ADMIN')
    const role = q.role as DirectoryRole
    if (!ROLES.includes(role)) throw err(400, `role must be one of: ${ROLES.join(', ')}`)
    const all = db.users.filter((u) => u.role === role)
    const offset = q.nextToken ? Number(q.nextToken) : 0
    const page = all.slice(offset, offset + PAGE)
    return {
      users: page.map((u) => ({
        userId: u.userId,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        phone: u.phone,
        role: u.role,
        specialty: u.specialty,
        hospitalId: u.hospitalId,
        hospitalName: db.hospitals.find((h) => h.hospitalId === u.hospitalId)?.name,
        suspended: u.suspended === true,
        reportCount: u.reportCount,
      })),
      nextToken: offset + PAGE < all.length ? String(offset + PAGE) : undefined,
      counts: q.nextToken
        ? undefined
        : Object.fromEntries(ROLES.map((r) => [r, db.users.filter((u) => u.role === r).length])),
    }
  },
  'POST /users/suspend': ({ b }) => {
    const admin = need('PLATFORM_ADMIN')
    if (typeof b.suspended !== 'boolean') throw err(400, 'suspended must be true or false')
    const u = db.users.find((x) => x.userId === str(b, 'userId'))
    if (!u) throw err(404, 'User not found')
    if (u.userId === admin.userId) throw err(400, 'You cannot suspend your own account')
    if (u.role === 'PLATFORM_ADMIN') throw err(403, 'Platform admins cannot be suspended')
    u.suspended = b.suspended
    return { userId: u.userId, suspended: u.suspended }
  },
}
