/** A mocked route: receives the JSON body (b) and query string (q), returns the JSON response or throws an ApiError. */
export type RouteMap = Record<string, (req: { b: any; q: Record<string, string> }) => unknown>
