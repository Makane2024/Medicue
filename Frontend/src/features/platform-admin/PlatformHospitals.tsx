import { useState } from 'react'
import { Building2, Eye, FileText, Trash2 } from 'lucide-react'
import { api, type Hospital } from '@/api'
import { Badge, Button, Card, Empty } from '@/components/ui'
import { cx } from '@/lib/classNames'
import { fmtFull } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'
import { DocViewer } from './DocViewer'

export function PlatformHospitals() {
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING')
  const [list, reload] = useLoad(() => api.hospitalsByStatus(status), [status])
  const { busy, run } = useAction()
  const [doc, setDoc] = useState<Hospital | null>(null)
  const review = async (hospitalId: string, decision: 'APPROVED' | 'REJECTED') => {
    if (await run(() => api.reviewHospital(hospitalId, decision), `Hospital ${decision.toLowerCase()}`)) reload()
  }
  const remove = async (h: Hospital) => {
    if (
      !confirm(
        `Permanently delete ${h.name}? This removes the hospital, its admin accounts, its doctors and their availability. Upcoming appointments will be cancelled.`,
      )
    )
      return
    if (await run(() => api.deleteHospital(h.hospitalId), `${h.name} deleted`)) reload()
  }
  return (
    <div>
      <div className="mb-5 inline-flex gap-1 rounded-full bg-surface p-1">
        {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={cx(
              'h-10 rounded-full px-5 text-xs font-bold transition',
              status === s ? 'bg-brand text-white' : 'text-muted',
            )}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {list?.map((h) => (
          <Card key={h.hospitalId} className="p-5">
            <div className="flex items-start gap-3">
              <div className="grid size-12 place-items-center rounded-2xl bg-brand-soft/50 text-brand">
                <Building2 className="size-5" />
              </div>
              <div className="flex-1">
                <div className="font-bold">{h.name}</div>
                <div className="text-xs text-muted">
                  {h.address} · {h.phone}
                </div>
                <div className="mt-0.5 text-xs text-muted">Submitted {fmtFull(h.createdAt)}</div>
              </div>
              <Badge s={h.status} />
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-2xl bg-mist px-4 py-3 text-xs">
              <FileText className="size-4 text-brand" />
              <span className="flex-1 font-mono truncate">{h.verificationDocKey ?? 'verification document'}</span>
              <button
                onClick={() => setDoc(h)}
                className="flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 font-bold text-brand transition hover:bg-brand hover:text-white"
              >
                <Eye className="size-3.5" />
                Open
              </button>
            </div>
            <div className="mt-4 flex gap-2">
              {h.status === 'PENDING' && (
                <>
                  <Button
                    variant="soft"
                    className="flex-1"
                    disabled={busy}
                    onClick={() => review(h.hospitalId, 'REJECTED')}
                  >
                    Reject
                  </Button>
                  <Button className="flex-1" disabled={busy} onClick={() => review(h.hospitalId, 'APPROVED')}>
                    Approve
                  </Button>
                </>
              )}
              {h.status !== 'PENDING' && (
                <Button
                  variant="soft"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => review(h.hospitalId, h.status === 'APPROVED' ? 'REJECTED' : 'APPROVED')}
                >
                  {h.status === 'APPROVED' ? 'Revoke approval' : 'Approve after all'}
                </Button>
              )}
              <Button variant="danger" disabled={busy} onClick={() => remove(h)}>
                <Trash2 className="size-4" />
                Delete
              </Button>
            </div>
          </Card>
        ))}
        {list && !list.length && (
          <div className="md:col-span-2">
            <Empty>No {status.toLowerCase()} hospitals.</Empty>
          </div>
        )}
      </div>
      {doc && (
        <DocViewer
          h={doc}
          busy={busy}
          onClose={() => setDoc(null)}
          onDecide={
            doc.status === 'PENDING'
              ? async (d) => {
                  await review(doc.hospitalId, d)
                  setDoc(null)
                }
              : undefined
          }
        />
      )}
    </div>
  )
}
