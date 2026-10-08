import { useEffect, useState } from 'react'
import { Terminal } from 'lucide-react'
import { isMock, type LogEntry, onLog } from '@/api'

export function ApiConsole() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => onLog((l) => setLogs((p) => [l, ...p].slice(0, 30))), [])
  return (
    <div className="fixed bottom-24 right-4 z-30 lg:bottom-5">
      {open && (
        <div className="mb-2 max-h-72 w-80 overflow-auto rounded-3xl bg-[#12152b] p-3 font-mono text-[11px] text-white/80 shadow-2xl">
          {logs.map((l, i) => (
            <div key={i} className="flex gap-2 py-0.5">
              <span className={l.status < 300 ? 'text-emerald-400' : 'text-rose-400'}>{l.status}</span>
              <span className="text-brand-soft">{l.method}</span>
              <span className="truncate">{l.path}</span>
            </div>
          ))}
          {!logs.length && <div className="text-white/40">No requests yet</div>}
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="ml-auto flex h-10 items-center gap-2 rounded-full bg-[#12152b] px-4 text-xs font-semibold text-white shadow-lg"
      >
        <Terminal className="size-3.5" />
        {isMock ? 'Mock API' : 'API'} · {logs[0] ? `${logs[0].method} ${logs[0].path}` : 'idle'}
      </button>
    </div>
  )
}
