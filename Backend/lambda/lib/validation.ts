import { HttpError } from './http';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function requireString(body: Record<string, any>, key: string, opts: { min?: number; max?: number } = {}): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, `${key} is required`);
  }
  // Passwords are never trimmed.
  const result = key.toLowerCase().includes('password') ? value : value.trim();
  if (opts.min !== undefined && result.length < opts.min) {
    throw new HttpError(400, `${key} must be at least ${opts.min} characters`);
  }
  if (result.length > (opts.max ?? 500)) {
    throw new HttpError(400, `${key} must be at most ${opts.max ?? 500} characters`);
  }
  return result;
}

export function requireEmail(body: Record<string, any>, key = 'email'): string {
  const value = requireString(body, key, { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(value)) throw new HttpError(400, `${key} must be a valid email address`);
  return value;
}

export function requirePhone(body: Record<string, any>, key = 'phone'): string {
  const value = requireString(body, key, { max: 20 });
  if (!E164_RE.test(value)) throw new HttpError(400, `${key} must be in E.164 format, e.g. +237650000000`);
  return value;
}

export function requireDate(body: Record<string, any>, key: string): string {
  const value = requireString(body, key, { max: 10 });
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value)) || Date.parse(value) > Date.now()) {
    throw new HttpError(400, `${key} must be a past date formatted YYYY-MM-DD`);
  }
  return value;
}

export function requireEnum<T extends string>(body: Record<string, any>, key: string, allowed: readonly T[]): T {
  const value = body[key];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new HttpError(400, `${key} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

/** Accepts an ISO-8601 timestamp with an explicit zone and normalises it to UTC ("...Z"). */
export function requireIsoTime(body: Record<string, any>, key: string): string {
  const value = requireString(body, key, { max: 40 });
  const shapeOk = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value);
  if (!shapeOk || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${key} must be an ISO-8601 timestamp with a timezone, e.g. 2026-11-02T09:00:00Z`);
  }
  return new Date(value).toISOString();
}

export function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
