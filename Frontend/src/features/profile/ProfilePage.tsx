import { useState } from 'react'
import { Camera, Lock } from 'lucide-react'
import { api, type User } from '@/api'
import { Avatar, Button, Card, Field } from '@/components/ui'
import { ROLE_LABEL } from '@/features/shell/nav'
import { displayName } from '@/lib/format'
import { useAction } from '@/lib/hooks'
import { shrinkImage } from '@/lib/image'
import { toast } from '@/lib/toast'

export function ProfilePage({ user, onSaved }: { user: User; onSaved: (u: User) => void }) {
  const [f, setF] = useState({
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone ?? '',
    bio: user.bio ?? '',
    photo: user.photo ?? '',
  })
  const { busy, run } = useAction()
  const pickPhoto = async (file?: File) => {
    if (!file) return
    try {
      const photo = await shrinkImage(file)
      setF((p) => ({ ...p, photo }))
    } catch (e: any) {
      toast(e.message, false)
    }
  }
  const preview: User = { ...user, ...f, photo: f.photo || undefined }
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <Card className="h-fit p-6 text-center">
        <div className="relative mx-auto w-fit">
          <Avatar u={preview} size="size-32" />
          <label className="absolute bottom-1 right-1 grid size-10 cursor-pointer place-items-center rounded-full bg-brand text-white ring-4 ring-surface transition hover:bg-brand-deep">
            <Camera className="size-4" />
            <input type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
          </label>
        </div>
        <div className="mt-4 text-lg font-bold">{displayName(preview)}</div>
        <div className="text-xs text-muted">
          {ROLE_LABEL[user.role]}
          {user.specialty ? ` · ${user.specialty}` : ''}
          {user.hospital ? ` · ${user.hospital.name}` : ''}
        </div>
        {f.photo && (
          <button
            onClick={() => setF({ ...f, photo: '' })}
            className="mt-3 text-xs font-semibold text-muted hover:text-rose-600"
          >
            Remove photo
          </button>
        )}
      </Card>
      <Card className="p-6 space-y-4">
        <h3 className="text-lg font-bold">Edit profile</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
          <Field label="Last name" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-muted">Email</span>
            <div className="flex h-12 items-center gap-2 rounded-2xl border border-ink/5 px-4 text-sm text-muted">
              <Lock className="size-3.5" />
              <span className="truncate">{user.email}</span>
            </div>
            <span className="mt-1 block text-[11px] text-muted">Your sign-in email can't be changed.</span>
          </div>
          <Field
            label="Phone"
            value={f.phone}
            placeholder="—"
            onChange={(e) => setF({ ...f, phone: e.target.value })}
          />
        </div>
        {user.role === 'DOCTOR' && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">
              About you · shown to patients on your profile
            </span>
            <textarea
              rows={5}
              value={f.bio}
              onChange={(e) => setF({ ...f, bio: e.target.value })}
              className="w-full rounded-2xl bg-mist p-4 text-sm outline-none ring-brand/40 focus:ring-2"
            />
          </label>
        )}
        <Button
          disabled={busy || !f.firstName.trim() || !f.lastName.trim()}
          onClick={async () => {
            const u = await run(
              () =>
                api.updateProfile({
                  firstName: f.firstName.trim(),
                  lastName: f.lastName.trim(),
                  phone: f.phone,
                  bio: user.role === 'DOCTOR' ? f.bio : undefined,
                  photo: f.photo || null,
                }),
              'Profile updated',
            )
            if (u) onSaved(u)
          }}
        >
          Save changes
        </Button>
      </Card>
    </div>
  )
}
