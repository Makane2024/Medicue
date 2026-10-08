import {
  Bell,
  BarChart3,
  Building2,
  CalendarDays,
  CalendarPlus,
  DoorOpen,
  FileSpreadsheet,
  FileText,
  Flag,
  Home,
  Hourglass,
  Settings,
  Stethoscope,
  Users,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { type Role } from '@/api'

export type NavItem = { key: string; label: string; icon: typeof Home }

export const NAV: Record<Role, NavItem[]> = {
  PATIENT: [
    { key: 'home', label: 'Home', icon: Home },
    { key: 'appts', label: 'Appointments', icon: CalendarDays },
    { key: 'waitlist', label: 'Waitlist', icon: Hourglass },
    { key: 'notes', label: 'Medical notes', icon: FileText },
    { key: 'alerts', label: 'Notifications', icon: Bell },
    { key: 'profile', label: 'Profile', icon: UserRound },
    { key: 'settings', label: 'Settings', icon: Settings },
  ],
  DOCTOR: [
    { key: 'schedule', label: 'Schedule requests', icon: CalendarPlus },
    { key: 'appts', label: 'Appointments', icon: CalendarDays },
    { key: 'notes', label: 'Patient notes', icon: FileText },
    { key: 'alerts', label: 'Notifications', icon: Bell },
    { key: 'profile', label: 'Profile', icon: UserRound },
    { key: 'settings', label: 'Settings', icon: Settings },
  ],
  STAFF: [
    { key: 'checkin', label: 'Check-in', icon: DoorOpen },
    { key: 'alerts', label: 'Notifications', icon: Bell },
    { key: 'profile', label: 'Profile', icon: UserRound },
    { key: 'settings', label: 'Settings', icon: Settings },
  ],
  HOSPITAL_ADMIN: [
    { key: 'overview', label: 'Statistics', icon: BarChart3 },
    { key: 'checkin', label: 'Check-in', icon: DoorOpen },
    { key: 'doctors', label: 'Doctors', icon: Stethoscope },
    { key: 'staff', label: 'Staff', icon: UsersRound },
    { key: 'propose', label: 'Availability', icon: CalendarPlus },
    { key: 'import', label: 'Import accounts', icon: FileSpreadsheet },
    { key: 'alerts', label: 'Notifications', icon: Bell },
    { key: 'profile', label: 'Profile', icon: UserRound },
    { key: 'settings', label: 'Settings', icon: Settings },
  ],
  PLATFORM_ADMIN: [
    { key: 'hospitals', label: 'Hospitals', icon: Building2 },
    { key: 'users', label: 'Accounts', icon: Users },
    { key: 'import', label: 'Import accounts', icon: FileSpreadsheet },
    { key: 'reports', label: 'Reported accounts', icon: Flag },
    { key: 'profile', label: 'Profile', icon: UserRound },
    { key: 'settings', label: 'Settings', icon: Settings },
  ],
}

export const navFor = (role: Role) => NAV[role]

export const ROLE_LABEL: Record<Role, string> = {
  PATIENT: 'Patient',
  DOCTOR: 'Doctor',
  STAFF: 'Staff',
  HOSPITAL_ADMIN: 'Hospital admin',
  PLATFORM_ADMIN: 'Platform admin',
}
