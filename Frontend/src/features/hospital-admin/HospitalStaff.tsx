import { useState } from 'react'
import { Mail, Phone, Trash2, UserPlus } from 'lucide-react'
import { api, type StaffMember, type User } from '@/api'
import { Avatar, Badge, Button, Card, Empty, Field } from '@/components/ui'
import { useAction, useLoad } from '@/lib/hooks'
import { toast } from '@/lib/toast'

const EMPTY = { firstName: '', lastName: '', email: '', phone: '' }

/** The hospital's reception staff: they check patients in when they arrive. Created by the hospital admin. */
export function HospitalStaff({ user }: { user: User }) {
  const [staff, reload] = useLoad(api.staff)
  const [f, setF] = useState(EMPTY)
  const { busy, run } = useAction()
  const approved = user.hospital?.status === 'APPROVED'
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }))

  const remove = async (s: StaffMember) => {
    if (!confirm(`Delete ${s.firstName} ${s.lastName}'s account? They will no longer be able to sign in.`)) return
    if (await run(() => api.removeStaff(s.staffId), 'Staff member removed')) reload()
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div>
        <p className="mb-4 text-xs text-muted">
          Staff sign in with their own account and can check patients in when they arrive. They cannot change
          availability, add doctors or see medical notes.
        </p>
        <div className="grid h-fit gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {staff?.map((s) => (
            <Card key={s.staffId} className="p-4 !rounded-[24px]">
              <div className="flex items-center gap-3">
                <Avatar
                  u={{ userId: s.staffId, firstName: s.firstName, lastName: s.lastName, email: s.email, role: 'STAFF' }}
                  size="size-14"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">
                    {s.firstName} {s.lastName}
                  </div>
                  <div className="flex items-center gap-1.5 truncate text-xs text-muted">
                    <Mail className="size-3 shrink-0" />
                    {s.email}
                  </div>
                  {s.phone && (
                    <div className="flex items-center gap-1.5 text-xs text-muted">
                      <Phone className="size-3 shrink-0" />
                      {s.phone}
                    </div>
                  )}
                </div>
                <button
                  aria-label={`Delete ${s.firstName} ${s.lastName}`}
                  disabled={busy}
                  onClick={() => remove(s)}
                  className="grid size-10 place-items-center rounded-full text-muted transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-400/15"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              {s.suspended && (
                <div className="mt-3">
                  <Badge s="SUSPENDED" />
                </div>
              )}
            </Card>
          ))}
          {staff && !staff.length && (
            <div className="sm:col-span-2">
              <Empty>No staff yet. Add the people who work your front desk.</Empty>
            </div>
          )}
        </div>
      </div>

      <Card className="h-fit space-y-3 p-6">
        <div className="flex items-center gap-2">
          <UserPlus className="size-5 text-brand" />
          <h3 className="text-lg font-bold">Add a staff member</h3>
        </div>
        <p className="text-xs text-muted">
          They receive an email with a link and a temporary password, and only have to choose their own password. To add
          many people at once, use <b>Import accounts</b>.
        </p>
        {!approved && (
          <p className="rounded-2xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">
            Available once the platform administrators approve your hospital.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" value={f.firstName} onChange={set('firstName')} />
          <Field label="Last name" value={f.lastName} onChange={set('lastName')} />
        </div>
        <Field label="Email" type="email" value={f.email} onChange={set('email')} />
        <Field
          label="Phone (optional)"
          type="tel"
          placeholder="+237 6XX XX XX XX"
          value={f.phone}
          onChange={set('phone')}
        />
        <Button
          className="w-full"
          disabled={busy || !approved || !f.email || !f.firstName || !f.lastName}
          onClick={async () => {
            const r = await run(() => api.addStaff(f))
            if (r) {
              toast(r.message, true)
              setF(EMPTY)
              reload()
            }
          }}
        >
          Create staff account
        </Button>
      </Card>
    </div>
  )
}
