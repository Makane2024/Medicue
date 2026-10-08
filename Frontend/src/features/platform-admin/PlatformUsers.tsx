import { useEffect, useState } from 'react'
import { Ban, Search, ShieldCheck, Trash2 } from 'lucide-react'
import { api, type DirectoryRole, type ManagedUser } from '@/api'
import { Avatar, Badge, Button, Card, Empty } from '@/components/ui'
import { cx } from '@/lib/classNames'
import { useAction } from '@/lib/hooks'
import { toast } from '@/lib/toast'

const TABS: [DirectoryRole, string][] = [
  ['PATIENT', 'Patients'],
  ['DOCTOR', 'Doctors'],
  ['STAFF', 'Staff'],
  ['HOSPITAL_ADMIN', 'Hospital admins'],
]

const detail = (u: ManagedUser) =>
  [u.role === 'DOCTOR' ? u.specialty : '', u.hospitalName, u.phone].filter(Boolean).join(' · ') || u.email

/**
 * Every account on the platform, grouped by kind. The platform admin can suspend an account (it cannot sign in
 * until reinstated) or delete it for good.
 */
export function PlatformUsers() {
  const [role, setRole] = useState<DirectoryRole>('PATIENT')
  const [users, setUsers] = useState<ManagedUser[] | null>(null)
  const [next, setNext] = useState<string | undefined>()
  const [counts, setCounts] = useState<Partial<Record<DirectoryRole, number>>>({})
  const [query, setQuery] = useState('')
  const { busy, run } = useAction()

  const load = async (token?: string) => {
    const page = await api.users(role, token)
    setUsers((prev) => (token && prev ? [...prev, ...page.users] : page.users))
    setNext(page.nextToken)
    if (page.counts) setCounts(page.counts)
  }

  useEffect(() => {
    let live = true
    setUsers(null)
    api
      .users(role)
      .then((page) => {
        if (!live) return
        setUsers(page.users)
        setNext(page.nextToken)
        if (page.counts) setCounts(page.counts)
      })
      .catch((e) => live && toast(e.message, false))
    return () => {
      live = false
    }
  }, [role])

  const q = query.trim().toLowerCase()
  const shown = (users ?? []).filter(
    (u) =>
      !q ||
      `${u.firstName} ${u.lastName} ${u.email} ${u.hospitalName ?? ''} ${u.specialty ?? ''}`.toLowerCase().includes(q),
  )
  const patch = (id: string, change: Partial<ManagedUser>) =>
    setUsers((prev) => prev && prev.map((u) => (u.userId === id ? { ...u, ...change } : u)))

  const toggle = async (u: ManagedUser) => {
    const suspend = !u.suspended
    if (
      suspend &&
      !confirm(
        `Suspend ${u.firstName} ${u.lastName}? They will be signed out and cannot sign in until you reinstate the account.`,
      )
    )
      return
    if (await run(() => api.suspendUser(u.userId, suspend), suspend ? 'Account suspended' : 'Account reinstated'))
      patch(u.userId, { suspended: suspend })
  }

  const remove = async (u: ManagedUser) => {
    if (
      !confirm(
        `Permanently delete ${u.firstName} ${u.lastName}'s account? Their upcoming appointments are cancelled. This cannot be undone.`,
      )
    )
      return
    if (await run(() => api.deleteUser(u.userId), 'Account deleted')) {
      setUsers((prev) => prev && prev.filter((x) => x.userId !== u.userId))
      setCounts((c) => ({ ...c, [role]: Math.max((c[role] ?? 1) - 1, 0) }))
    }
  }

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap gap-1 rounded-full bg-mist p-1" role="tablist" aria-label="Kind of account">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={role === key}
              onClick={() => {
                setRole(key)
                setQuery('')
              }}
              className={cx(
                'flex h-10 items-center gap-2 rounded-full px-4 text-xs font-bold transition',
                role === key ? 'bg-brand text-white shadow' : 'text-muted hover:text-ink',
              )}
            >
              {label}
              {counts[key] !== undefined && (
                <span className={cx('rounded-full px-1.5 text-[10px]', role === key ? 'bg-white/25' : 'bg-ink/10')}>
                  {counts[key]}
                </span>
              )}
            </button>
          ))}
        </div>
        <label className="relative ml-auto block w-full sm:w-72">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email or hospital"
            className="h-11 w-full rounded-full bg-mist pl-11 pr-4 text-sm outline-none ring-brand/40 placeholder:text-muted/70 focus:ring-2"
          />
        </label>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {shown.map((u) => (
          <Card key={u.userId} className={cx('p-4 !rounded-[24px]', u.suspended && 'opacity-80')}>
            <div className="flex items-center gap-3">
              <Avatar u={{ ...u, role: u.role }} size="size-12" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">
                  {u.role === 'DOCTOR' ? 'Dr. ' : ''}
                  {u.firstName} {u.lastName}
                </div>
                <div className="truncate text-xs text-muted">{u.email}</div>
                <div className="truncate text-xs text-muted">{detail(u)}</div>
              </div>
              {u.suspended ? (
                <Badge s="SUSPENDED" />
              ) : (
                (u.reportCount ?? 0) > 0 && <Badge s={`${u.reportCount} REPORT${u.reportCount === 1 ? '' : 'S'}`} />
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant={u.suspended ? 'soft' : 'white'}
                className="!h-9 !px-4 text-xs"
                disabled={busy}
                onClick={() => toggle(u)}
              >
                {u.suspended ? <ShieldCheck className="size-3.5" /> : <Ban className="size-3.5" />}
                {u.suspended ? 'Reinstate' : 'Suspend'}
              </Button>
              {u.role !== 'HOSPITAL_ADMIN' && (
                <Button variant="danger" className="!h-9 !px-4 text-xs" disabled={busy} onClick={() => remove(u)}>
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              )}
            </div>
          </Card>
        ))}
        {users && !shown.length && (
          <div className="md:col-span-2 2xl:col-span-3">
            <Empty>{query ? 'No account matches your search.' : 'No accounts of this kind yet.'}</Empty>
          </div>
        )}
      </div>

      {role === 'HOSPITAL_ADMIN' && users && users.length > 0 && (
        <p className="text-xs text-muted">
          Hospital admins are removed together with their hospital (Hospitals → Delete).
        </p>
      )}
      {next && (
        <div className="text-center">
          <Button variant="soft" disabled={busy} onClick={() => run(() => load(next))}>
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}
