// ALLOWED_ORIGIN is one origin, a comma-separated list of them, or "*". A real origin list also allows credentials,
// which the refresh-token cookie needs; the browser refuses credentialed requests answered with "*".
const ORIGINS = (process.env.ALLOWED_ORIGIN || '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const ANY_ORIGIN = ORIGINS.includes('*');

export const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ANY_ORIGIN ? '*' : ORIGINS[0],
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  ...(ANY_ORIGIN ? {} : { 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' }),
};

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

const requestOrigin = (event: any): string | undefined => event?.headers?.origin ?? event?.headers?.Origin;

/** The CORS headers for this request: with an origin list, the caller's own origin is echoed when it is on the list. */
export function corsHeaders(event?: any): Record<string, string> {
  const origin = requestOrigin(event);
  return !ANY_ORIGIN && origin && ORIGINS.includes(origin)
    ? { ...CORS_HEADERS, 'Access-Control-Allow-Origin': origin }
    : CORS_HEADERS;
}

/** Refuses a browser request from a site that is not on the allow-list (used where a cookie authenticates the call). */
export function requireAllowedOrigin(event: any) {
  const origin = requestOrigin(event);
  if (!ANY_ORIGIN && origin && !ORIGINS.includes(origin)) throw new HttpError(403, 'Origin not allowed');
}

// The refresh token never reaches JavaScript: it lives in an HttpOnly cookie that the browser sends only to /auth/*.
// SameSite=None because the frontend and the API are on different sites.
const REFRESH_COOKIE = 'mc_rt';
const REFRESH_MAX_AGE_S = 30 * 24 * 60 * 60; // the user pool's refresh token validity

const cookieBase = (event: any) => `Path=/${event?.requestContext?.stage ?? 'prod'}/auth; HttpOnly; Secure; SameSite=None`;

export const refreshCookie = (token: string, event: any) =>
  `${REFRESH_COOKIE}=${encodeURIComponent(token)}; Max-Age=${REFRESH_MAX_AGE_S}; ${cookieBase(event)}`;

export const clearRefreshCookie = (event: any) => `${REFRESH_COOKIE}=; Max-Age=0; ${cookieBase(event)}`;

export function readRefreshCookie(event: any): string | undefined {
  const header: string | undefined = event?.headers?.cookie ?? event?.headers?.Cookie;
  const match = header?.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(REFRESH_COOKIE.length + 1)) || undefined : undefined;
}

export const respond = (statusCode: number, body: unknown, headers: Record<string, string> = {}) => ({
  statusCode,
  headers: { ...CORS_HEADERS, ...headers },
  body: JSON.stringify(body),
});

export function parseBody(event: any): Record<string, any> {
  if (!event.body) throw new HttpError(400, 'Request body is required');
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
  return parsed as Record<string, any>;
}

export function callerId(event: any): string {
  const sub = event.requestContext?.authorizer?.claims?.sub;
  if (!sub) throw new HttpError(401, 'Unauthenticated');
  return sub;
}

// Cognito errors that are the caller's fault, mapped to proper 4xx codes.
const COGNITO_ERRORS: Record<string, [number, string?]> = {
  UsernameExistsException: [409, 'An account with this email already exists'],
  InvalidPasswordException: [400],
  InvalidParameterException: [400],
  CodeMismatchException: [400, 'Invalid confirmation code'],
  ExpiredCodeException: [400, 'Confirmation code has expired'],
  NotAuthorizedException: [401, 'Incorrect email or password'],
  UserNotFoundException: [401, 'Incorrect email or password'],
  UserNotConfirmedException: [403, 'Account is not confirmed yet'],
  LimitExceededException: [429, 'Too many attempts, try again later'],
  TooManyRequestsException: [429, 'Too many requests, try again later'],
};

export function withErrorHandling(fn: (event: any) => Promise<any>) {
  return async (event: any) => {
    try {
      const result = await fn(event);
      return { ...result, headers: { ...(result.headers || {}), ...corsHeaders(event) } };
    } catch (err: any) {
      const fail = (status: number, message: string) => {
        const res = respond(status, { message });
        return { ...res, headers: { ...res.headers, ...corsHeaders(event) } };
      };
      if (err instanceof HttpError) return fail(err.statusCode, err.message);
      const mapped = COGNITO_ERRORS[err?.name];
      if (mapped) return fail(mapped[0], mapped[1] || err.message);
      console.error('Unhandled error', err);
      return fail(500, 'Internal server error');
    }
  };
}
