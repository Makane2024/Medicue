// Typed wrappers over the backend routes. The screens only talk to the API through this object.
// Routes and payloads here must match Backend/lib/api-stack.ts (checked by Backend/test/stacks.test.ts).

import { call } from './client'
import { ApiError } from './errors'
import { hashPassword } from './passwordHash'
import { HOLD_MIN, toE164 } from './rules'
import {
  type Appointment,
  type AppointmentStats,
  type BulkRow,
  type BulkRowResult,
  type DirectoryRole,
  type ManagedUser,
  type StaffMember,
  type ConsultationType,
  type DoctorInfo,
  type Hospital,
  type HospitalStatus,
  type LoginResult,
  type Note,
  type Notice,
  type Review,
  type Slot,
  type User,
  type WaitEntry,
} from './types'

// ----------------------------------------------------------------- typed API (what the UI uses)
export const api = {
  signup: async (f: {
    firstName: string
    lastName: string
    email: string
    password: string
    phone: string
    dateOfBirth: string
  }) =>
    call<{ message: string }>('POST', '/patients/signup', {
      ...f,
      email: f.email.trim().toLowerCase(),
      password: await hashPassword(f.password, f.email),
      phone: toE164(f.phone),
    }),
  confirm: (email: string, confirmationCode: string) =>
    call('POST', '/patients/confirm-signup', { email: email.trim().toLowerCase(), confirmationCode }),
  // `temporary`: the one-time password from an invitation email. The server generated it, so it is sent as is.
  async login(email: string, password: string, temporary = false): Promise<LoginResult> {
    const addr = email.trim().toLowerCase()
    const hashed = temporary ? password : await hashPassword(password, email)
    let r: any
    try {
      r = await call<any>('POST', '/auth/login', { email: addr, password: hashed })
    } catch (e) {
      if (temporary || !(e instanceof ApiError) || e.status !== 401) throw e
      // An account from before passwords were hashed: sign in with the raw one, once, and the server swaps it for the hash.
      r = await call<any>('POST', '/auth/login', { email: addr, password, upgradeTo: hashed })
    }
    return r.challenge === 'NEW_PASSWORD_REQUIRED'
      ? { kind: 'challenge', session: r.session, message: r.message }
      : { kind: 'tokens', idToken: r.idToken }
  },
  // completes a doctor's first login (account created by a hospital admin with an emailed temporary password)
  async newPassword(email: string, newPassword: string, session: string) {
    const r = await call<any>('POST', '/auth/new-password', {
      email: email.trim().toLowerCase(),
      newPassword: await hashPassword(newPassword, email),
      session,
    })
    return r.idToken as string
  },
  // the backend does not send the caller's own id; `userId` is '' for the signed-in user
  // the session cookie is HttpOnly: these only ask the server to use or end it
  logout: () => call('POST', '/auth/logout', {}),
  me: async (): Promise<User> => ({ ...(await call<User>('GET', '/users/me')), userId: '' }),

  approvedHospitals: async () => (await call<{ hospitals: Hospital[] }>('GET', '/hospitals/approved')).hospitals,
  // platform admin only; each item carries a short-lived verificationDocUrl
  hospitalsByStatus: async (status: HospitalStatus) =>
    (await call<{ hospitals: Hospital[] }>('GET', `/hospitals/list?status=${status}`)).hospitals,
  reviewHospital: (hospitalId: string, decision: 'APPROVED' | 'REJECTED') =>
    call('POST', '/hospitals/review', { hospitalId, decision }),
  registerHospital: async (f: {
    firstName: string
    lastName: string
    email: string
    password: string
    hospitalName: string
    address: string
    phone: string
    documentBase64: string
  }) =>
    call<{ message: string }>('POST', '/hospitals/register', {
      ...f,
      email: f.email.trim().toLowerCase(),
      password: await hashPassword(f.password, f.email),
      phone: toE164(f.phone),
    }),

  addDoctor: (f: { firstName: string; lastName: string; email: string; specialty: string; bio?: string }) =>
    call<{ doctorId: string; message: string }>('POST', '/doctors/add', { ...f, email: f.email.trim().toLowerCase() }),
  doctors: async (hospitalId: string) =>
    (await call<{ doctors: DoctorInfo[] }>('GET', `/doctors/list?hospitalId=${hospitalId}`)).doctors,

  // bookable slots of an approved hospital; follows the backend's nextToken pagination
  async browse(hospitalId: string): Promise<Slot[]> {
    const out: Slot[] = []
    let next: string | undefined
    for (let i = 0; i < 5; i++) {
      const r = await call<{ slots: Slot[]; nextToken?: string }>(
        'GET',
        `/availability/browse?hospitalId=${hospitalId}&limit=100${next ? `&nextToken=${encodeURIComponent(next)}` : ''}`,
      )
      out.push(...r.slots)
      next = r.nextToken
      if (!next) break
    }
    return out
  },
  // up to MAX_PROPOSAL_SLOTS slots for one doctor, with the exact times the admin chose; all or nothing
  proposeSlots: (f: {
    doctorId: string
    consultationType: ConsultationType
    slots: { startTime: string; endTime: string }[]
  }) => call<{ slotIds: string[]; status: string }>('POST', '/availability/propose', f),
  approveSlot: (s: Pick<Slot, 'hospitalId' | 'slotId'>, decision: 'APPROVED' | 'REJECTED') =>
    call('POST', '/availability/approve', { hospitalId: s.hospitalId, slotId: s.slotId, decision }),
  pendingSlots: async () => (await call<{ slots: Slot[] }>('GET', '/availability/pending')).slots,
  mySlots: async () => (await call<{ slots: Slot[] }>('GET', '/availability/mine')).slots,
  hospitalSlots: async () => (await call<{ slots: Slot[] }>('GET', '/availability/hospital')).slots,

  async book(slot: Slot, note?: string): Promise<Appointment> {
    const reason = note?.trim()
    const r = await call<{ appointmentId: string; amount: number; payBefore: string }>('POST', '/appointments/book', {
      hospitalId: slot.hospitalId,
      slotId: slot.slotId,
      ...(reason ? { note: reason } : {}),
    })
    return {
      appointmentId: r.appointmentId,
      patientId: '', // the caller's id is never sent to the browser
      doctorId: slot.doctorId,
      hospitalId: slot.hospitalId,
      slotId: slot.slotId,
      specialtyId: slot.specialtyId,
      startTime: slot.startTime,
      endTime: slot.endTime,
      consultationType: slot.consultationType,
      fee: r.amount,
      ...(reason ? { note: reason } : {}),
      status: 'PENDING_PAYMENT',
      createdAt: new Date(+new Date(r.payBefore) - HOLD_MIN * 6e4).toISOString(),
    }
  },
  pay: (appointmentId: string, outcome: 'SUCCESS' | 'FAILED') =>
    call<{ appointmentId: string; paymentStatus: 'SUCCESS' | 'FAILED'; amount: number }>('POST', '/appointments/pay', {
      appointmentId,
      simulateOutcome: outcome,
    }),
  appointments: async () => (await call<{ appointments: Appointment[] }>('GET', '/appointments/mine')).appointments,
  cancel: (appointmentId: string) => call('POST', '/appointments/cancel', { appointmentId }),
  reschedule: (appointmentId: string, slot: Pick<Slot, 'hospitalId' | 'slotId'>) =>
    call<{ newAppointmentId: string }>('POST', '/appointments/reschedule', {
      appointmentId,
      newHospitalId: slot.hospitalId,
      newSlotId: slot.slotId,
    }),
  // hospital staff / admin: the patient has arrived and signed in
  checkIn: (appointmentId: string) => call('POST', '/appointments/check-in', { appointmentId }),
  // the doctor: the consultation is over
  completeAppointment: (appointmentId: string) => call('POST', '/appointments/complete', { appointmentId }),

  joinWaitlist: (type: 'HOSPITAL' | 'SPECIALTY' | 'DOCTOR', value: string) =>
    call<{ waitlistId: string }>('POST', '/waitlist/join', {
      preferenceType: type,
      ...(type === 'HOSPITAL'
        ? { hospitalId: value }
        : type === 'DOCTOR'
          ? { doctorId: value }
          : { specialtyId: value }),
    }),
  waitlist: async () => (await call<{ entries: WaitEntry[] }>('GET', '/waitlist/mine')).entries,
  async claim(w: WaitEntry): Promise<Appointment> {
    const r = await call<{ appointmentId: string }>('POST', '/waitlist/claim', { waitlistId: w.waitlistId })
    const a = (await api.appointments()).find((x) => x.appointmentId === r.appointmentId)
    if (!a) throw new ApiError(500, 'Claimed, but the appointment could not be loaded')
    return a
  },

  recordNote: (appointmentId: string, content: string) =>
    call<{ noteId: string }>('POST', '/medical-notes/record', { appointmentId, content }),
  // patients get their own notes; a doctor must name the patient and sees only notes they wrote
  notes: async (patientId?: string) =>
    (await call<{ notes: Note[] }>('GET', `/medical-notes/list${patientId ? `?patientId=${patientId}` : ''}`)).notes,
  notifications: async () => (await call<{ notifications: Notice[] }>('GET', '/notifications/mine')).notifications,

  // own profile; the email can't change and only doctors have a bio. A null photo removes it.
  updateProfile: async (f: { firstName: string; lastName: string; phone: string; bio?: string; photo: string | null }) => ({
    ...(await call<User>('POST', '/users/update-profile', { ...f, phone: f.phone.trim() ? toE164(f.phone) : '' })),
    userId: '',
  }),

  report: (userId: string) => call('POST', '/users/report', { userId }),
  // platform admin only, most reported first
  reportedUsers: async () => (await call<{ users: User[] }>('GET', '/users/reported')).users,
  deleteUser: (userId: string) => call('POST', '/users/delete', { userId }),
  deleteHospital: (hospitalId: string) =>
    call<{ ok: true; doctorsRemoved: number }>('POST', '/hospitals/delete', { hospitalId }),
  removeDoctor: (doctorId: string) => call('POST', '/doctors/remove', { doctorId }),

  doctorReviews: async (doctorId: string) =>
    (await call<{ reviews: Review[] }>('GET', `/reviews/doctor?doctorId=${doctorId}`)).reviews,
  myReviews: async () => (await call<{ reviews: Review[] }>('GET', '/reviews/mine')).reviews,
  createReview: (appointmentId: string, rating: number, comment: string) =>
    call<Review>('POST', '/reviews/create', { appointmentId, rating, comment }),

  // password recovery: both answer generically, so they say nothing about whether an account exists
  forgotPassword: (email: string) => call('POST', '/auth/forgot-password', { email: email.trim().toLowerCase() }),
  resetPassword: async (email: string, code: string, newPassword: string) =>
    call('POST', '/auth/reset-password', {
      email: email.trim().toLowerCase(),
      code: code.trim(),
      newPassword: await hashPassword(newPassword, email),
    }),

  // hospital admin
  stats: (from: Date, to: Date) =>
    call<AppointmentStats>(
      'GET',
      `/stats/hospital?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&tzOffsetMinutes=${from.getTimezoneOffset()}`,
    ),
  addStaff: (f: { firstName: string; lastName: string; email: string; phone?: string }) =>
    call<{ staffId: string; message: string }>('POST', '/staff/add', {
      ...f,
      email: f.email.trim().toLowerCase(),
      phone: f.phone?.trim() ? toE164(f.phone) : undefined,
    }),
  staff: async () => (await call<{ staff: StaffMember[] }>('GET', '/staff/list')).staff,
  removeStaff: (staffId: string) => call('POST', '/staff/remove', { staffId }),

  // hospital admin (own hospital: doctors and staff) or platform admin (also patients, any approved hospital)
  bulkCreate: (users: BulkRow[]) =>
    call<{ created: number; affiliated: number; failed: number; results: BulkRowResult[] }>(
      'POST',
      '/users/bulk-create',
      { users },
    ),

  // platform admin: the user directory, one page at a time (counts come with the first page only)
  users: (role: DirectoryRole, nextToken?: string) =>
    call<{ users: ManagedUser[]; nextToken?: string; counts?: Record<DirectoryRole, number> }>(
      'GET',
      `/users/list?role=${role}${nextToken ? `&nextToken=${encodeURIComponent(nextToken)}` : ''}`,
    ),
  suspendUser: (userId: string, suspended: boolean) => call('POST', '/users/suspend', { userId, suspended }),
}
