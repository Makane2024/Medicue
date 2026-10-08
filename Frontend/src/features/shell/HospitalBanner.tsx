import { Hourglass, RefreshCcw } from 'lucide-react'
import { api, type User } from '@/api'
import { AMBER, Button, Card, RED } from '@/components/ui'
import { cx } from '@/lib/classNames'
import { useAction } from '@/lib/hooks'

// a hospital admin can sign in while the hospital is still being reviewed, but nothing is bookable until approval
export function HospitalBanner({ user, onRefresh }: { user: User; onRefresh: (u: User) => void }) {
  const { busy, run } = useAction()
  const rejected = user.hospital?.status === 'REJECTED'
  return (
    <Card className={cx('mb-5 flex flex-wrap items-center gap-3 p-4 !rounded-[24px]', rejected ? RED : AMBER)}>
      <Hourglass className="size-5 shrink-0" />
      <div className="min-w-0 flex-1 text-sm">
        <b>{user.hospital?.name ?? 'Your hospital'}</b>{' '}
        {rejected
          ? 'was rejected by the platform administrators. Contact support to resubmit.'
          : 'is waiting for approval. You can sign in, but you cannot add doctors or propose availability until a platform administrator approves it.'}
      </div>
      <Button
        variant="white"
        className="!h-10"
        disabled={busy}
        onClick={async () => {
          const u = await run(() => api.me())
          if (u) onRefresh(u)
        }}
      >
        <RefreshCcw className="size-4" />
        Check status
      </Button>
    </Card>
  )
}
