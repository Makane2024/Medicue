import { useEffect, useState } from 'react'
import { Building2, Heart, Stethoscope } from 'lucide-react'
import { api, type Appointment, OFFER_MIN, prettySpecialty, type WaitEntry } from '@/api'
import { Badge, Button, Card, Countdown, Empty, SectionHead, Select } from '@/components/ui'
import { PaymentSheet } from '@/features/appointments/PaymentSheet'
import { cx } from '@/lib/classNames'
import { displayName, fmtFull } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import { asUser, type Dir } from '@/state/directory'

export function Waitlist({ dir }: { dir: Dir }) {
  const [list, reload] = useLoad(() => api.waitlist())
  const [type, setType] = useState<WaitEntry['preferenceType']>('SPECIALTY')
  const [value, setValue] = useState('')
  const [pay, setPay] = useState<Appointment | null>(null)
  const { busy, run } = useAction()
  const specialties = [...new Map(dir.doctors.map((d) => [d.specialtyId, d.specialty])).entries()]
  // the value sent to the backend: hospitalId, specialtyId (slug) or doctorId, matching the preference type
  const options: [string, string][] =
    type === 'HOSPITAL'
      ? dir.hospitals.map((h) => [h.hospitalId, h.name])
      : type === 'DOCTOR'
        ? dir.doctors.map((d) => [d.doctorId, `${displayName(asUser(d))} · ${d.specialty}`])
        : specialties
  useEffect(() => {
    const t = setInterval(() => {
      reload()
    }, 20000)
    return () => clearInterval(t)
  }, [])
  const label = (w: WaitEntry) => {
    const [t, v] = w.matchKey.split('#')
    return t === 'DOCTOR'
      ? displayName(dir.user(v))
      : t === 'HOSPITAL'
        ? (dir.hospital(v)?.name ?? 'Hospital')
        : prettySpecialty(v)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <Card className="h-fit p-6">
        <h3 className="text-lg font-bold">Join a waitlist</h3>
        <p className="mt-1 text-xs text-muted">
          Only available when nothing matching is open for booking. If a slot frees up, the longest-waiting patient is
          offered it first (checked by doctor, then specialty, then hospital) and has {OFFER_MIN} minutes to claim it.
        </p>
        <div className="mt-5 grid grid-cols-3 gap-1 rounded-full bg-mist p-1">
          {(['HOSPITAL', 'SPECIALTY', 'DOCTOR'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setType(t)
                setValue('')
              }}
              className={cx(
                'h-9 rounded-full text-[11px] font-bold transition',
                type === t ? 'bg-brand text-white' : 'text-muted',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-3">
          <Select label={type.toLowerCase()} value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">Select…</option>
            {options.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <Button
          className="mt-5 w-full"
          disabled={!value || busy}
          onClick={async () => {
            if (await run(() => api.joinWaitlist(type, value), "You're on the waitlist")) {
              setValue('')
              reload()
            }
          }}
        >
          Join waitlist
        </Button>
      </Card>
      <div className="space-y-3">
        <SectionHead title="Your entries" />
        {list
          ?.slice()
          .reverse()
          .map((w) => (
            <Card
              key={w.waitlistId}
              className={cx(
                'flex flex-wrap items-center gap-4 p-4 !rounded-[24px]',
                w.status === 'OFFERED' && 'ring-2 ring-violet-300',
              )}
            >
              <div className="grid size-12 place-items-center rounded-2xl bg-mist text-brand">
                {w.preferenceType === 'DOCTOR' ? (
                  <Stethoscope className="size-5" />
                ) : w.preferenceType === 'HOSPITAL' ? (
                  <Building2 className="size-5" />
                ) : (
                  <Heart className="size-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold">{label(w)}</div>
                <div className="text-xs text-muted">
                  {w.preferenceType} · joined {fmtFull(w.createdAt)}
                </div>
              </div>
              {w.status === 'OFFERED' && w.offerExpiresAt && +new Date(w.offerExpiresAt) > Date.now() ? (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-violet-700">
                    Expires in{' '}
                    <b>
                      <Countdown until={+new Date(w.offerExpiresAt)} onDone={reload} />
                    </b>
                  </span>
                  <Button
                    className="!h-10"
                    disabled={busy}
                    onClick={async () => {
                      const a = await run(() => api.claim(w), 'Slot claimed. Complete payment')
                      if (a) {
                        setPay(a)
                        reload()
                      }
                    }}
                  >
                    Claim slot
                  </Button>
                </div>
              ) : (
                <Badge s={w.status === 'OFFERED' ? 'EXPIRED' : w.status} />
              )}
            </Card>
          ))}
        {list && !list.length && <Empty>You aren't on any waitlists.</Empty>}
      </div>
      {pay && (
        <PaymentSheet
          a={pay}
          dir={dir}
          onClose={() => {
            setPay(null)
            reload()
          }}
          onPaid={() => {
            setPay(null)
            reload()
          }}
        />
      )}
    </div>
  )
}
