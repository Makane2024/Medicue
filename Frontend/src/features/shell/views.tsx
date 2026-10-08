import { lazy, type ReactNode, Suspense } from 'react'
import type { Role, User } from '@/api'
import type { Dir } from '@/state/directory'
import { DoctorAppts } from '@/features/doctor/DoctorAppts'
import { DoctorNotes } from '@/features/doctor/DoctorNotes'
import { DoctorSchedule } from '@/features/doctor/DoctorSchedule'
import { HospitalAvailability } from '@/features/hospital-admin/HospitalAvailability'
import { HospitalDoctors } from '@/features/hospital-admin/HospitalDoctors'
import { HospitalOverview } from '@/features/hospital-admin/HospitalOverview'
import { HospitalStaff } from '@/features/hospital-admin/HospitalStaff'
import { NotificationsPage } from '@/features/notifications/NotificationsPage'
import { PatientAppts } from '@/features/patient/PatientAppts'
import { PatientHome } from '@/features/patient/PatientHome'
import { PatientNotes } from '@/features/patient/PatientNotes'
import { Waitlist } from '@/features/patient/Waitlist'
import { PlatformHospitals } from '@/features/platform-admin/PlatformHospitals'
import { PlatformReports } from '@/features/platform-admin/PlatformReports'
import { PlatformUsers } from '@/features/platform-admin/PlatformUsers'
import { ProfilePage } from '@/features/profile/ProfilePage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { CheckIn } from '@/features/staff/CheckIn'

// the spreadsheet reader is a large dependency that only the two admins who import accounts ever need
const LazyBulkImport = lazy(() => import('@/features/import/BulkImport').then((m) => ({ default: m.BulkImport })))
const bulkImport = (props: { caller: 'HOSPITAL_ADMIN' | 'PLATFORM_ADMIN'; hospitalName?: string }) => (
  <Suspense fallback={<div className="p-8 text-center text-sm text-muted">Loading…</div>}>
    <LazyBulkImport {...props} />
  </Suspense>
)

export interface ViewContext {
  user: User
  dir: Dir
  /** Navigate to another view of the current workspace. */
  go: (view: string) => void
  onProfileSaved: (user: User) => void
  onLogout: () => void
}

type Page = (ctx: ViewContext) => ReactNode

// pages every role has
const SHARED: Record<string, Page> = {
  profile: ({ user, onProfileSaved }) => <ProfilePage user={user} onSaved={onProfileSaved} />,
  settings: ({ user, go, onLogout }) => <SettingsPage user={user} go={go} onLogout={onLogout} />,
  alerts: () => <NotificationsPage />,
}

// the keys match the `key` of each role's entries in ./nav.ts
const BY_ROLE: Record<Role, Record<string, Page>> = {
  PATIENT: {
    home: ({ dir, go }) => <PatientHome dir={dir} go={go} />,
    appts: ({ dir }) => <PatientAppts dir={dir} />,
    waitlist: ({ dir }) => <Waitlist dir={dir} />,
    notes: ({ dir }) => <PatientNotes dir={dir} />,
  },
  DOCTOR: {
    schedule: ({ dir }) => <DoctorSchedule dir={dir} />,
    appts: ({ dir, user }) => <DoctorAppts dir={dir} user={user} />,
    notes: ({ dir }) => <DoctorNotes dir={dir} />,
  },
  STAFF: {
    checkin: ({ dir }) => <CheckIn dir={dir} />,
  },
  HOSPITAL_ADMIN: {
    overview: ({ user }) => <HospitalOverview user={user} />,
    checkin: ({ dir }) => <CheckIn dir={dir} />,
    doctors: ({ user, go }) => <HospitalDoctors user={user} go={go} />,
    staff: ({ user }) => <HospitalStaff user={user} />,
    propose: ({ user, dir }) => <HospitalAvailability user={user} dir={dir} />,
    import: ({ user }) => bulkImport({ caller: 'HOSPITAL_ADMIN', hospitalName: user.hospital?.name }),
  },
  PLATFORM_ADMIN: {
    hospitals: () => <PlatformHospitals />,
    users: () => <PlatformUsers />,
    import: () => bulkImport({ caller: 'PLATFORM_ADMIN' }),
    reports: () => <PlatformReports />,
  },
}

export function renderView(view: string, ctx: ViewContext): ReactNode {
  const page = SHARED[view] ?? BY_ROLE[ctx.user.role][view]
  return page ? page(ctx) : null
}
