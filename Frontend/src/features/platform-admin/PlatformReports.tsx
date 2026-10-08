import { Flag, Trash2 } from 'lucide-react'
import { api } from '@/api'
import { AMBER, Avatar, Button, Card, Empty, RED } from '@/components/ui'
import { ROLE_LABEL } from '@/features/shell/nav'
import { cx } from '@/lib/classNames'
import { displayName } from '@/lib/format'
import { useAction, useLoad } from '@/lib/hooks'

export function PlatformReports() {
  const [list, reload] = useLoad(api.reportedUsers)
  const { busy, run } = useAction()
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Accounts reported by other users, most reported first. Deleting an account cancels its upcoming appointments.
      </p>
      {list?.map((u) => {
        const n = u.reportCount ?? 0
        return (
          <Card key={u.userId} className="flex flex-wrap items-center gap-4 p-4 !rounded-[24px]">
            <Avatar u={u} />
            <div className="min-w-0 flex-1">
              <div className="font-bold">{displayName(u)}</div>
              <div className="truncate text-xs text-muted">
                {ROLE_LABEL[u.role]} · {u.email}
              </div>
            </div>
            <span
              className={cx(
                'flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-bold',
                n >= 5 ? RED : n >= 3 ? AMBER : 'bg-mist text-muted',
              )}
            >
              <Flag className="size-3.5" />
              {n} report{n === 1 ? '' : 's'}
            </span>
            <Button
              variant="danger"
              className="!h-10"
              disabled={busy}
              onClick={async () => {
                if (!confirm(`Delete ${displayName(u)}'s account permanently?`)) return
                if (await run(() => api.deleteUser(u.userId), 'Account deleted')) reload()
              }}
            >
              <Trash2 className="size-4" />
              Delete account
            </Button>
          </Card>
        )
      })}
      {list && !list.length && <Empty>No reported accounts.</Empty>}
    </div>
  )
}
