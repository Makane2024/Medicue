// Adding doctors to a hospital and listing a hospital's doctors.

import { slug } from '../../rules'
import { db, type MUser } from '../db'
import { approvedHospital, err, me, need, str } from '../helpers'
import { RouteMap } from '../types'
import { id } from '../utils'

export const doctorRoutes: RouteMap = {
  'POST /doctors/add': ({ b }) => {
    const ha = need('HOSPITAL_ADMIN')
    approvedHospital(ha.hospitalId!)
    const email = str(b, 'email', 254).toLowerCase(),
      specialty = str(b, 'specialty', 100),
      first = str(b, 'firstName', 100),
      last = str(b, 'lastName', 100)
    let u = db.users.find((x) => x.email === email)
    let created = false
    if (u && u.role !== 'DOCTOR') throw err(409, 'This email already belongs to a non-doctor account')
    if (!u) {
      u = {
        userId: id('sub'),
        firstName: first,
        lastName: last,
        email,
        role: 'DOCTOR',
        specialty,
        password: 'Temp-Passw0rd',
        confirmed: true,
        tempPassword: true,
        ...(typeof b.bio === 'string' && b.bio.trim() ? { bio: b.bio.trim() } : {}),
      } as MUser
      db.users.push(u)
      created = true
    }
    db.affiliations = db.affiliations.filter((a) => !(a.doctorId === u!.userId && a.hospitalId === ha.hospitalId))
    db.affiliations.push({
      doctorId: u.userId,
      hospitalId: ha.hospitalId!,
      specialty,
      specialtyId: slug(specialty),
      status: 'ACTIVE',
    })
    return {
      doctorId: u.userId,
      hospitalId: ha.hospitalId,
      specialtyId: slug(specialty),
      message: created
        ? 'Doctor account created. A temporary password was emailed to the doctor. (Mock: use Temp-Passw0rd)'
        : 'Existing doctor affiliated with your hospital.',
    }
  },
  'GET /doctors/list': ({ q }) => {
    const u = me()
    const hid = str(q, 'hospitalId')
    if (!((u.role === 'HOSPITAL_ADMIN' || u.role === 'STAFF') && u.hospitalId === hid)) approvedHospital(hid)
    return {
      doctors: db.affiliations
        .filter((a) => a.hospitalId === hid && a.status === 'ACTIVE')
        .map((a) => {
          const d = db.users.find((x) => x.userId === a.doctorId)
          return {
            doctorId: a.doctorId,
            hospitalId: a.hospitalId,
            specialty: a.specialty,
            specialtyId: a.specialtyId,
            firstName: d?.firstName,
            lastName: d?.lastName,
            bio: d?.bio,
            photo: d?.photo,
          }
        }),
    }
  },
}
