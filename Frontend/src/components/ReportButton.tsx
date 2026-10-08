import { Flag } from 'lucide-react'
import { api } from '@/api'
import { Button } from '@/components/ui'
import { useAction } from '@/lib/hooks'

export function ReportButton({ userId, label = 'Report' }: { userId: string; label?: string }) {
  const { busy, run } = useAction()
  return (
    <Button
      variant="ghost"
      className="!h-10 !px-4 text-xs"
      disabled={busy}
      onClick={() => {
        if (confirm('Report this account to the platform administrators?'))
          run(() => api.report(userId), 'Report submitted')
      }}
    >
      <Flag className="size-3.5" />
      {label}
    </Button>
  )
}
