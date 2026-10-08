import { readSheet } from 'read-excel-file/browser'
import { type BulkRow, isE164, toE164 } from '@/api'
import { buildXlsx, downloadFile } from '@/lib/xlsx'

export type Caller = 'HOSPITAL_ADMIN' | 'PLATFORM_ADMIN'

export const MAX_FILE_BYTES = 2_000_000
export const MAX_ROWS = 500

// the columns of the template, in order; `forCaller` hides the ones that do not apply to the signed-in admin
export const COLUMNS: { key: keyof BulkRow; label: string; hint: string; admin?: Caller }[] = [
  { key: 'role', label: 'role', hint: 'DOCTOR, STAFF or PATIENT (patients: platform admin only)' },
  { key: 'firstName', label: 'firstName', hint: 'required' },
  { key: 'lastName', label: 'lastName', hint: 'required' },
  { key: 'email', label: 'email', hint: 'required, one account per email' },
  { key: 'phone', label: 'phone', hint: 'optional; required for patients. Cameroon numbers may start with 6 or 2' },
  { key: 'specialty', label: 'specialty', hint: 'required for doctors, for example Cardiology' },
  { key: 'dateOfBirth', label: 'dateOfBirth', hint: 'required for patients, as YYYY-MM-DD', admin: 'PLATFORM_ADMIN' },
  {
    key: 'hospital',
    label: 'hospital',
    hint: 'name of an approved hospital; required for doctors and staff',
    admin: 'PLATFORM_ADMIN',
  },
]

export const columnsFor = (caller: Caller) => COLUMNS.filter((c) => !c.admin || c.admin === caller)

const ALIASES: Record<string, keyof BulkRow> = {
  role: 'role',
  firstname: 'firstName',
  givenname: 'firstName',
  prenom: 'firstName',
  lastname: 'lastName',
  surname: 'lastName',
  familyname: 'lastName',
  nom: 'lastName',
  email: 'email',
  emailaddress: 'email',
  mail: 'email',
  phone: 'phone',
  phonenumber: 'phone',
  mobile: 'phone',
  telephone: 'phone',
  tel: 'phone',
  specialty: 'specialty',
  speciality: 'specialty',
  specialite: 'specialty',
  dateofbirth: 'dateOfBirth',
  dob: 'dateOfBirth',
  birthdate: 'dateOfBirth',
  hospital: 'hospital',
  hospitalname: 'hospital',
  clinic: 'hospital',
}

/** CSV with commas, semicolons (French Excel) or tabs, quotes and a BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '')
  const firstLine = text.split(/\r?\n/, 1)[0]
  const delimiter = [';', ',', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

const text = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10) // spreadsheet dates are UTC midnight
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v)
  return String(v).trim()
}

/** "1990-05-12", "12/05/1990" and "12.05.1990" (day first, like most of the world) all become 1990-05-12. */
export function normalizeDate(raw: string): string {
  const m = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : raw
}

export interface ParsedRow {
  /** The row's line number in the file (the header is line 1). */
  line: number
  data: BulkRow
  problem: string | null
}

/** Reads the first sheet of an .xlsx file, or a .csv file, into rows of text. */
export async function readRows(file: File): Promise<string[][]> {
  if (file.size > MAX_FILE_BYTES) throw new Error('The file is larger than 2 MB. Split it into several files.')
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt')) return parseCsv(await file.text())
  if (!name.endsWith('.xlsx'))
    throw new Error('Choose an Excel file (.xlsx) or a CSV file (.csv). Old .xls files must be saved as .xlsx first.')
  try {
    return (await readSheet(file)).map((r) => r.map(text))
  } catch {
    throw new Error('This file could not be read as an Excel workbook.')
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** What is wrong with a row (null if nothing), using the same rules as the backend. */
export function problemWith(r: BulkRow, caller: Caller): string | null {
  const role = r.role
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
  if (!['PATIENT', 'DOCTOR', 'STAFF'].includes(role)) return 'role must be DOCTOR, STAFF or PATIENT'
  if (role === 'PATIENT' && caller === 'HOSPITAL_ADMIN')
    return 'Hospital admins can add doctors and staff, not patients'
  if (!r.firstName) return 'firstName is missing'
  if (!r.lastName) return 'lastName is missing'
  if (!EMAIL.test(r.email)) return 'email is missing or not valid'
  if (r.phone && !isE164(r.phone)) return 'phone is not a valid number'
  if (role === 'PATIENT') {
    if (!r.phone) return 'phone is required for patients'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.dateOfBirth ?? '') || Date.parse(r.dateOfBirth!) > Date.now())
      return 'dateOfBirth must be a past date (YYYY-MM-DD)'
  }
  if (role === 'DOCTOR' && !r.specialty) return 'specialty is missing'
  if (role !== 'PATIENT' && caller === 'PLATFORM_ADMIN' && !r.hospital) return 'hospital is missing'
  return null
}

/** Rows of text (first row = column titles) -> accounts to create, each with its problem if it has one. */
export function toAccounts(rows: string[][], caller: Caller): ParsedRow[] {
  const header = (rows[0] ?? []).map((h) => ALIASES[h.toLowerCase().replace(/[^a-z]/g, '')])
  const missing = (['role', 'firstName', 'lastName', 'email'] as const).filter((k) => !header.includes(k))
  if (missing.length) throw new Error(`The first row must contain these column titles: ${missing.join(', ')}.`)

  const out: ParsedRow[] = []
  rows.slice(1).forEach((cells, i) => {
    if (cells.every((c) => !c || !c.trim())) return // blank line
    const data: BulkRow = { role: '', firstName: '', lastName: '', email: '' }
    header.forEach((key, col) => {
      if (key) data[key] = (cells[col] ?? '').trim()
    })
    data.email = data.email.toLowerCase()
    if (data.phone) data.phone = toE164(data.phone)
    else delete data.phone
    if (data.dateOfBirth) data.dateOfBirth = normalizeDate(data.dateOfBirth)
    else delete data.dateOfBirth
    if (!data.specialty) delete data.specialty
    if (!data.hospital) delete data.hospital
    out.push({ line: i + 2, data, problem: problemWith(data, caller) })
  })

  // the same email twice in one file: only the first can be created
  const seen = new Set<string>()
  for (const r of out) {
    if (!r.data.email) continue
    if (seen.has(r.data.email)) r.problem ??= 'this email appears more than once in the file'
    seen.add(r.data.email)
  }
  if (out.length > MAX_ROWS)
    throw new Error(`The file has ${out.length} accounts. Import at most ${MAX_ROWS} at a time.`)
  if (!out.length) throw new Error('The file has no accounts below the column titles.')
  return out
}

/** The Excel template: column titles and one example row per role the admin may create. */
export function downloadTemplate(caller: Caller) {
  const cols = columnsFor(caller)
  const examples: Record<string, Partial<BulkRow>>[] = [
    {
      doctor: {
        role: 'DOCTOR',
        firstName: 'Michael',
        lastName: 'Patel',
        email: 'm.patel@example.com',
        phone: '+237670000001',
        specialty: 'Cardiology',
        hospital: 'Your hospital name',
      },
    },
    {
      staff: {
        role: 'STAFF',
        firstName: 'Joelle',
        lastName: 'Mbarga',
        email: 'j.mbarga@example.com',
        phone: '+237670000002',
        hospital: 'Your hospital name',
      },
    },
    ...(caller === 'PLATFORM_ADMIN'
      ? [
          {
            patient: {
              role: 'PATIENT',
              firstName: 'Sarah',
              lastName: 'Alex',
              email: 'sarah@example.com',
              phone: '+237670000003',
              dateOfBirth: '1992-04-18',
            },
          },
        ]
      : []),
  ]
  const rows = [
    cols.map((c) => c.label),
    ...examples.map((e) => cols.map((c) => String(Object.values(e)[0][c.key] ?? ''))),
  ]
  downloadFile(
    'medicue-accounts-template.xlsx',
    buildXlsx(
      'Accounts',
      rows,
      cols.map((c) => Math.max(c.label.length + 4, 18)),
    ),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
}
