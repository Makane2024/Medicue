import { Mail, Smartphone } from 'lucide-react'
import { api } from '@/api'
import { Card, Empty } from '@/components/ui'
import { fmtDay, fmtTime } from '@/lib/format'
import { useLoad } from '@/lib/hooks'

// every role gets notifications: patients (bookings, reminders, waitlist), doctors (slot proposals), hospital admins (review result)
export function NotificationsPage() {
  const [list] = useLoad(() => api.notifications())
  return (
    <div className="space-y-2">
      <p className="mb-4 text-xs text-muted">Messages MediCue sent you by email and SMS, newest first.</p>
      {list?.map((n) => (
        <Card key={n.notificationId} className="flex items-center gap-4 p-4 !rounded-[22px]">
          <div className="grid size-11 place-items-center rounded-2xl bg-brand-soft/50 text-brand">
            {n.channel === 'EMAIL' ? <Mail className="size-5" /> : <Smartphone className="size-5" />}
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold">{n.message}</div>
            <div className="text-xs text-muted">
              {n.type.replace(/_/g, ' ').toLowerCase()} · {n.channel} · {fmtDay(n.createdAt)} {fmtTime(n.createdAt)}
              {n.deliveryStatus === 'FAILED' || n.deliveryStatus === 'PUBLISH_FAILED' ? ' · delivery failed' : ''}
            </div>
          </div>
        </Card>
      ))}
      {list && !list.length && <Empty>All caught up.</Empty>}
    </div>
  )
}
