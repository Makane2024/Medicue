import { useMemo } from 'react'
import { api, type DoctorInfo, type Hospital, type Role, type User } from '@/api'
import { useLoad } from '@/lib/hooks'

// Names come from the real contract: approved hospitals, each hospital's doctors (GET /doctors/list) and the
// display names the backend embeds in every appointment (patientName / doctorName / hospitalName).
export const nameRegistry = new Map<string, User>()

export const learnName = (userId: string | undefined, full: string | undefined, role: Role) => {
  if (!userId || !full || nameRegistry.has(userId)) return
  const [firstName, ...rest] = full.split(' ')
  nameRegistry.set(userId, { userId, firstName, lastName: rest.join(' '), email: '', role })
}

export async function loadAppointments() {
  const list = await api.appointments()
  list.forEach((a) => {
    learnName(a.patientId, a.patientName, 'PATIENT')
    learnName(a.doctorId, a.doctorName, 'DOCTOR')
  })
  return list
}

export const asUser = (d: DoctorInfo): User => ({
  userId: d.doctorId,
  firstName: d.firstName ?? '',
  lastName: d.lastName ?? '',
  email: '',
  role: 'DOCTOR',
  specialty: d.specialty,
})

export function useDirectory(me: User) {
  const [hospitals] = useLoad(() => api.approvedHospitals())
  const [doctors] = useLoad(async () => {
    if (me.role === 'PLATFORM_ADMIN' || me.role === 'DOCTOR') return [] as DoctorInfo[]
    const ids =
      me.role === 'HOSPITAL_ADMIN' || me.role === 'STAFF'
        ? [me.hospitalId!]
        : (await api.approvedHospitals()).map((h) => h.hospitalId)
    return (await Promise.all(ids.map((h) => api.doctors(h).catch(() => [] as DoctorInfo[])))).flat()
  })
  return useMemo(() => {
    const docUsers = (doctors ?? []).map(asUser)
    const approved: Hospital[] = (hospitals ?? []).map((h) => ({ ...h, status: 'APPROVED' as const, createdAt: '' }))
    // a hospital admin also sees their own hospital while it is still pending
    const own: Hospital[] =
      me.hospital && me.hospitalId && !approved.some((h) => h.hospitalId === me.hospitalId)
        ? [
            {
              hospitalId: me.hospitalId,
              name: me.hospital.name,
              address: me.hospital.address ?? '',
              phone: '',
              status: me.hospital.status,
              createdAt: '',
            },
          ]
        : []
    return {
      user: (id: string): User | undefined =>
        docUsers.find((u) => u.userId === id) ?? nameRegistry.get(id) ?? (id === me.userId ? me : undefined),
      hospital: (id: string) => [...approved, ...own].find((h) => h.hospitalId === id),
      doctors: doctors ?? [],
      hospitals: approved,
    }
  }, [hospitals, doctors, me])
}

export type Dir = ReturnType<typeof useDirectory>
