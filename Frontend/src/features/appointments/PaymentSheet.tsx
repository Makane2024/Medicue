import { useState } from 'react'
import { Smartphone, X } from 'lucide-react'
import { api, type Appointment, HOLD_MIN, paymentSimulation } from '@/api'
import { Badge, Button, Card, Countdown } from '@/components/ui'
import { displayName, fmtFull, fmtTime } from '@/lib/format'
import { useAction } from '@/lib/hooks'
import { toast } from '@/lib/toast'
import type { Dir } from '@/state/directory'

export function PaymentSheet({
  a,
  dir,
  onClose,
  onPaid,
}: {
  a: Appointment
  dir: Dir
  onClose: () => void
  onPaid: () => void
}) {
  const [expired, setExpired] = useState(false)
  const { busy, run } = useAction()
  const pay = async (outcome: 'SUCCESS' | 'FAILED') => {
    const r = await run(() => api.pay(a.appointmentId, outcome))
    if (!r) return
    if (r.paymentStatus === 'SUCCESS') {
      toast('Payment received · appointment CONFIRMED', true)
      onPaid()
    } else {
      toast('Payment failed · slot released', false)
      onClose()
    }
  }
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-black/40 p-3 backdrop-blur-sm sm:place-items-center">
      <Card className="w-full max-w-md p-6">
        <div className="flex items-center justify-between">
          <Badge s="PENDING_PAYMENT" />
          <button onClick={onClose}>
            <X className="size-5 text-muted" />
          </button>
        </div>
        <div className="mt-5 flex items-end justify-between">
          <div>
            <div className="text-xs text-muted">Slot held for you</div>
            <div className="text-4xl font-bold text-brand">
              {expired ? (
                '0:00'
              ) : (
                <Countdown
                  until={+new Date(a.createdAt) + HOLD_MIN * 6e4}
                  onDone={() => setExpired(true)}
                />
              )}
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-bold">{displayName(dir.user(a.doctorId))}</div>
            <div className="text-muted">
              {fmtFull(a.startTime)} · {fmtTime(a.startTime)}
            </div>
          </div>
        </div>
        <div className="my-5 flex items-center justify-between rounded-2xl bg-mist p-4">
          <span className="text-sm text-muted">
            {a.consultationType === 'GENERAL' ? 'General' : 'Specialist'} consultation
          </span>
          <b>{a.fee.toLocaleString()} XAF</b>
        </div>
        {expired ? (
          <div className="space-y-3">
            <p className="text-sm text-rose-600">
              The {HOLD_MIN}-minute hold expired. The slot was released back to availability.
            </p>
            <Button variant="soft" className="w-full" onClick={onClose}>
              Back
            </Button>
          </div>
        ) : (
          <>
            <Button className="w-full !h-12" disabled={busy} onClick={() => pay('SUCCESS')}>
              <Smartphone className="size-4" />
              Pay {a.fee.toLocaleString()} XAF with MTN MoMo
            </Button>
            {paymentSimulation && (
              <button
                disabled={busy}
                onClick={() => pay('FAILED')}
                className="mt-3 w-full text-xs font-semibold text-muted hover:text-rose-600"
              >
                Simulate a failed payment
              </button>
            )}
            <p className="mt-3 text-center text-[11px] text-muted">
              {paymentSimulation ? 'Prototype · mock provider, no real charge' : 'Payments are processed securely'}
            </p>
          </>
        )}
      </Card>
    </div>
  )
}
