// The doctor invitation email links to  <app>/#/first-login?email=<email>&tp=<temporary password>
// The data sits in the URL fragment, which browsers never send to a server. It is read once and removed
// from the address bar so it does not linger in the history or get shared by accident.

export interface Invite {
  email: string
  tempPassword: string
}

let cached: Invite | null | undefined

/** Reads (and clears) the invitation link data. Safe to call repeatedly, e.g. from React strict mode. */
export function consumeInvite(): Invite | null {
  if (cached !== undefined) return cached
  cached = null
  const hash = window.location.hash
  if (!hash.startsWith('#/first-login')) return cached

  // Parsed by hand: URLSearchParams would turn a "+" in an email address into a space.
  const params: Record<string, string> = {}
  for (const pair of hash.slice(hash.indexOf('?') + 1).split('&')) {
    const eq = pair.indexOf('=')
    if (eq < 1) continue
    try {
      params[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1))
    } catch {
      params[pair.slice(0, eq)] = pair.slice(eq + 1)
    }
  }
  window.history.replaceState(null, '', window.location.pathname + window.location.search)

  // Cognito's {username} is not guaranteed to be the email address, so anything else is left for the doctor to type.
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(params.email ?? '') ? params.email : ''
  cached = { email, tempPassword: params.tp ?? '' }
  return cached
}
