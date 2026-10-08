import { generateTemporaryPassword } from '../lambda/lib/cognito';
import { hasConflict, bufferFor } from '../lambda/lib/scheduling';
import {
  requireEmail,
  requireEnum,
  requireIsoTime,
  requirePhone,
  requireString,
  slugify,
} from '../lambda/lib/validation';
import { HttpError, parseBody, withErrorHandling } from '../lambda/lib/http';
import { getAmount } from '../lambda/lib/constants';
import { buildMessage } from '../lambda/lib/messages';

describe('hasConflict', () => {
  const s = '2026-11-02T09:00:00.000Z';
  const e = '2026-11-02T10:00:00.000Z';

  it('detects overlap', () => {
    expect(hasConflict('2026-11-02T09:30:00.000Z', '2026-11-02T10:30:00.000Z', s, e, 10)).toBe(true);
  });
  it('enforces the buffer', () => {
    // starts 5 minutes after the existing slot ends: too close for a 10 minute buffer
    expect(hasConflict('2026-11-02T10:05:00.000Z', '2026-11-02T11:00:00.000Z', s, e, 10)).toBe(true);
    expect(hasConflict('2026-11-02T10:10:00.000Z', '2026-11-02T11:00:00.000Z', s, e, 10)).toBe(false);
  });
  it('uses a bigger buffer across hospitals', () => {
    expect(bufferFor(true)).toBe(10);
    expect(bufferFor(false)).toBe(90);
  });
});

describe('validation', () => {
  it('requires non-empty strings and trims them', () => {
    expect(requireString({ a: '  x ' }, 'a')).toBe('x');
    expect(() => requireString({ a: '  ' }, 'a')).toThrow(HttpError);
    expect(() => requireString({}, 'a')).toThrow('a is required');
  });
  it('does not trim passwords', () => {
    expect(requireString({ password: ' p ' }, 'password')).toBe(' p ');
  });
  it('validates and lowercases emails', () => {
    expect(requireEmail({ email: 'A@B.com' })).toBe('a@b.com');
    expect(() => requireEmail({ email: 'nope' })).toThrow(HttpError);
  });
  it('requires E.164 phones', () => {
    expect(requirePhone({ phone: '+237650000000' })).toBe('+237650000000');
    expect(() => requirePhone({ phone: '0650000000' })).toThrow(HttpError);
  });
  it('restricts enums', () => {
    expect(requireEnum({ d: 'APPROVED' }, 'd', ['APPROVED', 'REJECTED'] as const)).toBe('APPROVED');
    expect(() => requireEnum({ d: 'BOOKED' }, 'd', ['APPROVED', 'REJECTED'] as const)).toThrow(HttpError);
  });
  it('normalises timestamps to UTC and rejects zone-less ones', () => {
    expect(requireIsoTime({ t: '2026-11-02T10:00:00+01:00' }, 't')).toBe('2026-11-02T09:00:00.000Z');
    expect(() => requireIsoTime({ t: '2026-11-02T10:00:00' }, 't')).toThrow(HttpError);
    expect(() => requireIsoTime({ t: 'tomorrow' }, 't')).toThrow(HttpError);
  });
  it('slugifies specialties', () => {
    expect(slugify(' Pediatric  Cardiology ')).toBe('pediatric-cardiology');
  });
});

describe('http helpers', () => {
  it('rejects missing and invalid bodies with 400', () => {
    expect(() => parseBody({})).toThrow('Request body is required');
    expect(() => parseBody({ body: '{oops' })).toThrow('valid JSON');
    expect(() => parseBody({ body: '[1]' })).toThrow('JSON object');
    expect(parseBody({ body: '{"a":1}' })).toEqual({ a: 1 });
  });

  it('maps errors to status codes and always adds CORS headers', async () => {
    const run = (err: any) =>
      withErrorHandling(async () => {
        throw err;
      })({});
    expect((await run(new HttpError(403, 'no'))).statusCode).toBe(403);
    expect((await run(Object.assign(new Error('x'), { name: 'UsernameExistsException' }))).statusCode).toBe(409);
    expect((await run(Object.assign(new Error('x'), { name: 'NotAuthorizedException' }))).statusCode).toBe(401);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const unknown = await run(new Error('boom'));
    expect(unknown.statusCode).toBe(500);
    expect(JSON.parse(unknown.body).message).toBe('Internal server error'); // no internals leaked
    expect(unknown.headers['Access-Control-Allow-Origin']).toBeDefined();
  });
});

describe('fees and messages', () => {
  it('derives the fee from the consultation type', () => {
    expect(getAmount('GENERAL')).toBe(2000);
    expect(getAmount('SPECIALIST')).toBe(3000);
    expect(getAmount(undefined)).toBe(2000);
  });
  it('builds a message for every notification type used by the backend', () => {
    for (const type of [
      'BOOKING_CONFIRMATION', 'PAYMENT_RESULT', 'CANCELLATION', 'RESCHEDULE', 'MISSED',
      'WAITLIST_OFFER', 'APPOINTMENT_REMINDER', 'SLOT_PROPOSED', 'HOSPITAL_REVIEWED', 'SESSION_COMPLETED',
    ]) {
      expect(buildMessage(type, { appointmentId: 'a1' }).subject).not.toBe('MediCue notification');
    }
  });
});

describe('generateTemporaryPassword', () => {
  it('meets the pool policy and is safe to put in a URL', () => {
    for (let i = 0; i < 200; i++) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(16);
      expect(password).toMatch(/^[A-Za-z0-9]+$/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
    }
  });

  it('is different every time', () => {
    expect(new Set(Array.from({ length: 50 }, () => generateTemporaryPassword())).size).toBe(50);
  });
});
