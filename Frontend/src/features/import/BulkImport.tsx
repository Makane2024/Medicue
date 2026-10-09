import { useRef, useState } from 'react'
import { CheckCircle2, CircleAlert, Download, FileSpreadsheet, UploadCloud } from 'lucide-react'
import { api, type BulkRowResult, MAX_BULK_USERS } from '@/api'
import { Badge, Button, Card, HScroll } from '@/components/ui'
import { cx } from '@/lib/classNames'
import { downloadFile } from '@/lib/xlsx'
import { toast } from '@/lib/toast'
import {
  type Caller,
  columnsFor,
  downloadTemplate,
  MAX_ROWS,
  type ParsedRow,
  readRows,
  toAccounts,
} from './spreadsheet'

const BATCH = Math.min(25, MAX_BULK_USERS)
const PREVIEW_ROWS = 100

type Phase = 'pick' | 'ready' | 'sending' | 'done'

/**
 * Creates many accounts from one spreadsheet. The file is read in the browser, every row is checked, and the rows
 * that pass are sent in small batches; a bad row never blocks the others, and the result lists what happened to each.
 */
export function BulkImport({ caller, hospitalName }: { caller: Caller; hospitalName?: string }) {
  const [phase, setPhase] = useState<Phase>('pick')
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [results, setResults] = useState<Map<number, BulkRowResult>>(new Map())
  const [sent, setSent] = useState(0)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const cols = columnsFor(caller)

  const valid = rows.filter((r) => !r.problem)
  const invalid = rows.length - valid.length

  const load = async (file?: File) => {
    if (!file) return
    try {
      const parsed = toAccounts(await readRows(file), caller)
      setRows(parsed)
      setFileName(file.name)
      setResults(new Map())
      setPhase('ready')
    } catch (e: any) {
      toast(e.message, false)
    } finally {
      if (input.current) input.current.value = ''
    }
  }

  const send = async () => {
    setPhase('sending')
    setSent(0)
    const done = new Map<number, BulkRowResult>()
    for (let i = 0; i < valid.length; i += BATCH) {
      const batch = valid.slice(i, i + BATCH)
      try {
        const r = await api.bulkCreate(batch.map((b) => b.data))
        r.results.forEach((res) => done.set(batch[res.index].line, res))
      } catch (e: any) {
        batch.forEach((b, k) =>
          done.set(b.line, { index: k, email: b.data.email, status: 'ERROR', message: e.message }),
        )
      }
      setSent(Math.min(i + BATCH, valid.length))
      setResults(new Map(done))
    }
    setPhase('done')
  }

  const reset = () => {
    setPhase('pick')
    setRows([])
    setResults(new Map())
    setFileName('')
  }

  const outcome = (line: number) => results.get(line)
  const count = (s: BulkRowResult['status']) => [...results.values()].filter((r) => r.status === s).length

  const report = () => {
    const lines = [['line', 'email', 'result', 'message']].concat(
      rows.map((r) => {
        const res = outcome(r.line)
        return [
          String(r.line),
          r.data.email,
          res?.status ?? (r.problem ? 'NOT SENT' : ''),
          res?.message ?? r.problem ?? '',
        ]
      }),
    )
    downloadFile(
      'import-report.csv',
      '﻿' + lines.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n'),
      'text/csv',
    )
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[400px_1fr]">
      <Card className="h-fit space-y-4 p-6">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="size-5 text-brand" />
          <h3 className="text-lg font-bold">Import accounts from Excel</h3>
        </div>
        <p className="text-xs text-muted">
          {caller === 'HOSPITAL_ADMIN'
            ? `Create doctors and staff for ${hospitalName ?? 'your hospital'} in one go.`
            : 'Create patients, doctors and staff in one go. Doctors and staff are placed at the hospital named in their row.'}{' '}
          Everyone receives an email with a link and a temporary password and only chooses their own password.
        </p>
        <Button variant="soft" className="w-full" onClick={() => downloadTemplate(caller)}>
          <Download className="size-4" />
          Download the Excel template
        </Button>
        <div>
          <div className="mb-2 text-xs font-semibold text-muted">Columns (the first row of the file)</div>
          <ul className="space-y-1.5 text-xs">
            {cols.map((c) => (
              <li key={c.key} className="rounded-xl bg-mist px-3 py-2">
                <code className="font-bold text-brand-deep">{c.label}</code>
                <span className="text-muted"> · {c.hint}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted">
            Up to {MAX_ROWS} accounts per file. Excel (.xlsx) and CSV files work. A doctor who already has a MediCue
            account is simply linked to the hospital.
          </p>
        </div>
      </Card>

      <div className="space-y-5">
        {phase === 'pick' && (
          <label
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              load(e.dataTransfer.files[0])
            }}
            className={cx(
              'grid min-h-72 cursor-pointer place-items-center rounded-[28px] border-2 border-dashed p-8 text-center transition',
              over ? 'border-brand bg-brand-soft/40' : 'border-ink/15 bg-surface/60 hover:border-brand/60',
            )}
          >
            <input
              ref={input}
              type="file"
              accept=".xlsx,.csv,.txt"
              className="sr-only"
              onChange={(e) => load(e.target.files?.[0])}
            />
            <div>
              <span className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-brand-soft/60 text-brand">
                <UploadCloud className="size-7" />
              </span>
              <div className="font-bold">Drop your Excel file here</div>
              <div className="mt-1 text-xs text-muted">
                or click to choose a file. You can review everything before anything is created.
              </div>
            </div>
          </label>
        )}

        {phase !== 'pick' && (
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{fileName}</div>
                <div className="text-xs text-muted">
                  {rows.length} account{rows.length === 1 ? '' : 's'} · {valid.length} ready
                  {invalid > 0 && (
                    <span className="font-semibold text-rose-600 dark:text-rose-300"> · {invalid} with a problem</span>
                  )}
                </div>
              </div>
              {phase === 'ready' && (
                <>
                  <Button variant="ghost" onClick={reset}>
                    Choose another file
                  </Button>
                  <Button disabled={!valid.length} onClick={send}>
                    Create {valid.length} account{valid.length === 1 ? '' : 's'}
                  </Button>
                </>
              )}
              {phase === 'done' && (
                <>
                  <Button variant="soft" onClick={report}>
                    <Download className="size-4" />
                    Report
                  </Button>
                  <Button onClick={reset}>Import another file</Button>
                </>
              )}
            </div>

            {phase === 'sending' && (
              <div
                className="mt-4"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={valid.length}
                aria-valuenow={sent}
              >
                <div className="h-2 overflow-hidden rounded-full bg-mist">
                  <div
                    className="h-full rounded-full bg-brand transition-all"
                    style={{ width: `${(sent / Math.max(valid.length, 1)) * 100}%` }}
                  />
                </div>
                <div className="mt-1.5 text-xs text-muted">
                  Creating accounts… {sent} of {valid.length}
                </div>
              </div>
            )}

            {phase === 'done' && (
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                {[
                  ['Created', count('CREATED'), 'text-emerald-600 dark:text-emerald-300'],
                  ['Linked', count('AFFILIATED'), 'text-brand-deep'],
                  ['Failed', count('ERROR') + invalid, 'text-rose-600 dark:text-rose-300'],
                ].map(([label, n, tone]) => (
                  <div key={label as string} className="rounded-2xl bg-mist p-3">
                    <div className={cx('text-2xl font-extrabold tabular-nums', tone as string)}>{n as number}</div>
                    <div className="text-[11px] text-muted">{label}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {phase !== 'pick' && (
          <Card className="overflow-hidden p-0">
            <HScroll className="max-h-[32rem] overflow-y-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="sticky top-0 bg-surface text-[11px] uppercase tracking-wider text-muted">
                  <tr>
                    {['Line', 'Role', 'Name', 'Email', 'Details', 'Result'].map((h) => (
                      <th key={h} className="px-4 py-3 font-bold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/5">
                  {rows.slice(0, PREVIEW_ROWS).map((r) => {
                    const res = outcome(r.line)
                    return (
                      <tr key={r.line} className={cx(r.problem && 'bg-rose-50/60 dark:bg-rose-400/10')}>
                        <td className="px-4 py-2.5 text-xs text-muted">{r.line}</td>
                        <td className="px-4 py-2.5 text-xs font-semibold">{r.data.role.toUpperCase()}</td>
                        <td className="px-4 py-2.5">
                          {r.data.firstName} {r.data.lastName}
                        </td>
                        <td className="px-4 py-2.5 text-xs">{r.data.email}</td>
                        <td className="px-4 py-2.5 text-xs text-muted">
                          {[r.data.specialty, caller === 'PLATFORM_ADMIN' ? r.data.hospital : '', r.data.phone]
                            .filter(Boolean)
                            .join(' · ')}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {res ? (
                            res.status === 'ERROR' ? (
                              <span className="flex items-start gap-1.5 font-semibold text-rose-600 dark:text-rose-300">
                                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                                {res.message}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-300">
                                <CheckCircle2 className="size-3.5" />
                                {res.status === 'CREATED' ? 'Created · invitation sent' : 'Linked to the hospital'}
                              </span>
                            )
                          ) : r.problem ? (
                            <span className="flex items-start gap-1.5 font-semibold text-rose-600 dark:text-rose-300">
                              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                              {r.problem}
                            </span>
                          ) : (
                            <Badge s="READY" />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </HScroll>
            {rows.length > PREVIEW_ROWS && (
              <div className="border-t border-ink/5 px-4 py-3 text-xs text-muted">
                Showing the first {PREVIEW_ROWS} of {rows.length} rows. All of them are imported.
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
