import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { api, type User } from '@/api'
import { Button, Card, Field } from '@/components/ui'
import { useAction } from '@/lib/hooks'
import { toast } from '@/lib/toast'

const EMPTY = { firstName: '', lastName: '', email: '', specialty: '', bio: '' }

/** Creates a doctor's account and links it to the hospital. They get an emailed link and choose their own password. */
export function AddDoctorForm({ user, onAdded }: { user: User; onAdded: () => void }) {
  const [f, setF] = useState(EMPTY)
  const { busy, run } = useAction()
  const approved = user.hospital?.status === 'APPROVED'
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }))

  return (
    <Card className="h-fit space-y-3 p-6">
      <div className="flex items-center gap-2">
        <UserPlus className="size-5 text-brand" />
        <h3 className="text-lg font-bold">Add a doctor</h3>
      </div>
      <p className="text-xs text-muted">
        Creates the doctor's account and links it to your hospital. They receive an email with a link and a temporary
        password, and choose their own at their first sign-in. If they already work at another hospital on MediCue, they
        are simply linked to yours. To add many at once, use <b>Import accounts</b>.
      </p>
      {!approved && (
        <p className="rounded-2xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">
          Available once the platform administrators approve your hospital.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field id="add-doctor-first" label="First name" value={f.firstName} onChange={set('firstName')} />
        <Field label="Last name" value={f.lastName} onChange={set('lastName')} />
      </div>
      <Field label="Email" type="email" value={f.email} onChange={set('email')} />
      <Field
        label="Specialty"
        placeholder="e.g. Cardiology or General Practice"
        value={f.specialty}
        onChange={set('specialty')}
      />
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-muted">Description</span>
        <textarea
          rows={4}
          value={f.bio}
          onChange={set('bio')}
          placeholder="Experience, areas of focus, languages spoken…"
          className="w-full rounded-2xl bg-mist p-4 text-sm outline-none ring-brand/40 focus:ring-2"
        />
      </label>
      <Button
        className="w-full"
        disabled={busy || !approved || !f.email || !f.specialty || !f.firstName || !f.lastName}
        onClick={async () => {
          const r = await run(() => api.addDoctor(f))
          if (r) {
            toast(r.message, true)
            setF(EMPTY)
            onAdded()
          }
        }}
      >
        Create doctor
      </Button>
    </Card>
  )
}
