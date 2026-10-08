import { useState } from 'react'
import { FileUp } from 'lucide-react'
import { api, isE164, passwordProblem, toE164 } from '@/api'
import { Button, Field } from '@/components/ui'
import { useAction } from '@/lib/hooks'
import { toast } from '@/lib/toast'
import type { AuthForm } from './useAuthForm'

// The backend accepts the PDF inside the JSON body, which API Gateway caps well below this once base64-encoded.
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024

const readAsBase64 = (file: File) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.readAsDataURL(file)
  })

export function HospitalForm({ form, onDone }: { form: AuthForm; onDone: () => void }) {
  const [doc, setDoc] = useState<File | null>(null)
  const { busy, run } = useAction()
  const { val } = form

  const submit = async () => {
    const problem = passwordProblem(val('password'))
    if (problem) return toast(problem, false)
    const phone = toE164(val('phone'))
    if (!isE164(phone)) return toast('Enter the phone number with its country code, e.g. +237 233 42 11 00', false)
    if (!doc) return
    if (doc.size > MAX_DOCUMENT_BYTES) return toast('The PDF must be 4 MB or smaller', false)

    const registered = await run(
      async () =>
        api.registerHospital({
          firstName: val('adminFirstName'),
          lastName: val('adminLastName'),
          email: val('email'),
          password: val('password'),
          hospitalName: val('name'),
          address: val('address'),
          phone,
          documentBase64: await readAsBase64(doc),
        }),
      'Submitted for review. Confirm your admin email to sign in.',
    )
    if (registered) onDone()
  }

  const incomplete =
    !doc || !val('name') || !val('address') || !val('adminFirstName') || !val('adminLastName') || !val('email')

  return (
    <div className="space-y-4">
      <h2 className="text-3xl font-extrabold tracking-tight">Register your hospital</h2>
      <p className="-mt-2 text-sm text-muted">
        A platform administrator reviews every application before it goes live.
      </p>
      <Field label="Hospital name" value={val('name')} onChange={form.set('name')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Address" value={val('address')} onChange={form.set('address')} />
        <Field label="Phone" placeholder="+237 233 42 11 00" value={val('phone')} onChange={form.set('phone')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Admin first name" value={val('adminFirstName')} onChange={form.set('adminFirstName')} />
        <Field label="Admin last name" value={val('adminLastName')} onChange={form.set('adminLastName')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Admin email" type="email" value={val('email')} onChange={form.set('email')} />
        <Field label="Password" type="password" value={val('password')} onChange={form.set('password')} />
      </div>
      <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-brand/40 bg-brand-soft/20 p-4">
        <FileUp className="text-brand" />
        <div className="flex-1 text-sm">
          <div className="font-semibold">{doc?.name ?? 'Verification document (PDF, max 4 MB)'}</div>
          <div className="text-xs text-muted">Stored privately · S3 encrypted · never public</div>
        </div>
        <input type="file" accept="application/pdf" hidden onChange={(e) => setDoc(e.target.files?.[0] ?? null)} />
      </label>
      <Button className="w-full !h-12" disabled={busy || incomplete} onClick={submit}>
        Submit for verification
      </Button>
    </div>
  )
}
