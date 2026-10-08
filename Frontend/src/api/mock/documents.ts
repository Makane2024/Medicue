import type { Hospital } from '../types'

// uploaded verification PDFs (stand-in for the private S3 bucket)
export const docs: Record<string, string> = {}

// builds a small one-page PDF so seeded hospitals have something to open
export function samplePdf(h: Hospital) {
  const esc = (t: string) =>
    t
      .normalize('NFD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/([()\\])/g, '\\$1')
  const lines: [number, number, string][] = [
    [20, 760, 'REPUBLIC OF CAMEROON - MINISTRY OF PUBLIC HEALTH'],
    [16, 720, 'Certificate of Registration of a Health Facility'],
    [12, 670, `Facility name: ${h.name}`],
    [12, 650, `Address: ${h.address}`],
    [12, 630, `Telephone: ${h.phone}`],
    [12, 610, `Registration no.: MINSANTE/${h.hospitalId.toUpperCase()}/2026`],
    [12, 570, 'This certifies that the above facility is authorised to provide'],
    [12, 554, 'outpatient and general medical consultation services under the'],
    [12, 538, 'supervision of a licensed medical director.'],
    [12, 480, 'Valid until: 31 December 2028'],
    [12, 420, 'Signed: Regional Delegate of Public Health'],
  ]
  const stream = lines.map(([sz, y, t]) => `BT /F1 ${sz} Tf 60 ${y} Td (${esc(t)}) Tj ET`).join('\n')
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offs: number[] = []
  objs.forEach((o, i) => {
    offs.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const x = out.length
  out +=
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')
  return out + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`
}
