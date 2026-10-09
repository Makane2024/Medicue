// Domain types shared by the whole app. They mirror the JSON the backend returns.

export type Role = 'PATIENT' | 'DOCTOR' | 'STAFF' | 'HOSPITAL_ADMIN' | 'PLATFORM_ADMIN'

export type SlotStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'BOOKED' | 'OFFERED'

export type ApptStatus =
  'PENDING_PAYMENT' | 'CONFIRMED' | 'ARRIVED' | 'CANCELLED' | 'EXPIRED' | 'RESCHEDULED' | 'COMPLETED' | 'MISSED'

export type ConsultationType = 'GENERAL' | 'SPECIALIST'

export type HospitalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface User {
  userId: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  role: Role
  hospitalId?: string
  hospital?: { name: string; status: HospitalStatus; address?: string }
  specialty?: string
  photo?: string
  bio?: string
  reportCount?: number
}

export interface Hospital {
  hospitalId: string
  name: string
  address: string
  phone: string
  status: HospitalStatus
  verificationDocKey?: string
  verificationDocUrl?: string
  createdAt: string
}

export interface DoctorInfo {
  doctorId: string
  hospitalId: string
  specialty: string
  specialtyId: string
  firstName?: string
  lastName?: string
  bio?: string
  photo?: string
}

export interface Slot {
  slotId: string
  hospitalId: string
  doctorId: string
  specialtyId: string
  consultationType: ConsultationType
  startTime: string
  endTime: string
  status: SlotStatus
  offeredTo?: string
  offerExpiresAt?: string
}

export interface Appointment {
  appointmentId: string
  patientId: string
  doctorId: string
  hospitalId: string
  slotId: string
  specialtyId?: string
  startTime: string
  endTime: string
  consultationType: ConsultationType
  fee: number
  status: ApptStatus
  createdAt: string
  /** Why the patient is coming (specialist visits). Only the patient and the doctor ever receive it. */
  note?: string
  patientName?: string
  doctorName?: string
  hospitalName?: string
}

export interface WaitEntry {
  waitlistId: string
  patientId: string
  preferenceType: 'HOSPITAL' | 'SPECIALTY' | 'DOCTOR'
  matchKey: string
  status: 'WAITING' | 'OFFERED' | 'CLAIMED' | 'EXPIRED'
  hospitalId?: string | null
  slotId?: string
  offerExpiresAt?: string
  createdAt: string
}

export interface Note {
  noteId: string
  patientId: string
  appointmentId: string
  doctorId: string
  hospitalId: string
  content: string
  createdAt: string
}

export interface Review {
  reviewId: string
  doctorId: string
  patientId: string
  appointmentId: string
  rating: number
  comment: string
  patientName?: string // first name only, filled in by the backend when listing a doctor's reviews
  createdAt: string
}

/** Statistics of a hospital's appointments between two instants (GET /stats/hospital). */
export interface AppointmentStats {
  from: string
  to: string
  total: number
  totals: Record<string, number>
  days: { date: string; counts: Record<string, number> }[]
}

export interface StaffMember {
  staffId: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  suspended: boolean
  createdAt?: string
}

/** An account as the platform admin sees it in the user directory. */
export interface ManagedUser {
  userId: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  role: Role
  specialty?: string
  hospitalId?: string
  hospitalName?: string
  suspended: boolean
  reportCount?: number
  createdAt?: string
}

export type DirectoryRole = 'PATIENT' | 'DOCTOR' | 'STAFF' | 'HOSPITAL_ADMIN'

/** One account of a bulk import (the columns of the spreadsheet). */
export interface BulkRow {
  role: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  dateOfBirth?: string
  specialty?: string
  hospital?: string
}

export interface BulkRowResult {
  index: number
  email?: string
  status: 'CREATED' | 'AFFILIATED' | 'ERROR'
  message?: string
}

export interface Notice {
  notificationId: string
  type: string
  channel: 'EMAIL' | 'SMS'
  message: string
  deliveryStatus: string
  createdAt: string
}

export type LoginResult = { kind: 'tokens'; idToken: string } | { kind: 'challenge'; session: string; message: string }
