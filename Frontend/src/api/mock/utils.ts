// ================================================================= in-browser mock of the backend contract
export const now = () => new Date()

export const iso = (d: Date) => d.toISOString()

export const at = (dayOffset: number, h: number, m = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(h, m, 0, 0)
  return iso(d)
}

export const id = (p: string) => p + '_' + Math.random().toString(36).slice(2, 8)

export const img = (k: string) => `https://images.unsplash.com/${k}?auto=format&fit=crop&w=600&h=700&q=80`
