const ORIGIN = process.env.ALLOWED_ORIGIN || '*';

export const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export const respond = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: CORS_HEADERS,
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
      return { ...result, headers: { ...CORS_HEADERS, ...(result.headers || {}) } };
    } catch (err: any) {
      if (err instanceof HttpError) return respond(err.statusCode, { message: err.message });
      const mapped = COGNITO_ERRORS[err?.name];
      if (mapped) return respond(mapped[0], { message: mapped[1] || err.message });
      console.error('Unhandled error', err);
      return respond(500, { message: 'Internal server error' });
    }
  };
}
