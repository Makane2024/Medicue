import { useEffect, useState } from 'react'
import { ArrowUpRight, Check, FileText, X } from 'lucide-react'
import type { Hospital } from '@/api'
import { Button } from '@/components/ui'

export function DocViewer({
  h,
  busy,
  onClose,
  onDecide,
}: {
  h: Hospital
  busy: boolean
  onClose: () => void
  onDecide?: (d: 'APPROVED' | 'REJECTED') => void
}) {
  const [file, setFile] = useState<{ src: string; name: string } | null>(null)
  const [failed, setFailed] = useState('')
  // the list endpoint returns a short-lived presigned link to the private S3 object (verificationDocUrl)
  useEffect(() => {
    let src = ''
    const url = h.verificationDocUrl
    if (!url) {
      setFailed('No document link available. Reload the list and try again.')
      return
    }
    ;(async () => {
      src = url.startsWith('data:') ? URL.createObjectURL(await (await fetch(url)).blob()) : url
      setFile({ src, name: h.verificationDocKey?.split('/').pop() ?? 'verification.pdf' })
    })().catch((e) => setFailed(e.message))
    return () => {
      if (src.startsWith('blob:')) URL.revokeObjectURL(src)
    }
  }, [h.hospitalId, h.verificationDocUrl])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm animate-rise"
      onClick={onClose}
    >
      <div
        className="flex h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-ink/5 px-5 py-4">
          <div className="grid size-10 place-items-center rounded-2xl bg-brand-soft/50 text-brand">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold">{h.name}</div>
            <div className="truncate font-mono text-[11px] text-muted">
              {file?.name ?? h.verificationDocKey} · link expires in 15 min
            </div>
          </div>
          {file && (
            <a
              href={file.src}
              target="_blank"
              rel="noreferrer"
              download={file.name}
              className="hidden h-10 items-center gap-1.5 rounded-full bg-mist px-4 text-xs font-bold sm:flex"
            >
              <ArrowUpRight className="size-4" />
              New tab
            </a>
          )}
          <button onClick={onClose} className="grid size-10 place-items-center rounded-full bg-mist" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 bg-mist">
          {file ? (
            <iframe src={file.src} title="Verification document" className="h-full w-full" />
          ) : (
            <div className="grid h-full place-items-center p-6 text-center text-sm text-muted">
              {failed || 'Loading document…'}
            </div>
          )}
        </div>
        {onDecide && (
          <div className="flex items-center gap-2 border-t border-ink/5 px-5 py-3">
            <span className="flex-1 text-xs text-muted">Check the registration details match before approving.</span>
            <Button variant="soft" disabled={busy} onClick={() => onDecide('REJECTED')}>
              Reject
            </Button>
            <Button disabled={busy} onClick={() => onDecide('APPROVED')}>
              <Check className="size-4" />
              Approve
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
