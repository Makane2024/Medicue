// The note a patient adds to a specialist appointment ("what are you coming in for"): stored with the
// appointment, and readable only by that patient and their doctor.

const send = jest.fn();
const queryAll = jest.fn();
let caller: Record<string, any>;

jest.mock('../lambda/lib/db', () => ({
  ddb: { send: (...args: unknown[]) => send(...args) },
  queryAll: (...args: unknown[]) => queryAll(...args),
  getUser: async () => caller,
  requireRole: async (_id: string, role: string) => {
    if (caller.role !== role) throw new (require('../lambda/lib/http').HttpError)(403, 'Not authorized');
    return caller;
  },
  isTransactionCanceled: () => false,
}));

import { handler as book } from '../lambda/book-appointment';
import { handler as mine } from '../lambda/my-appointments';

const MIN = 60_000;
const slot = (consultationType: 'SPECIALIST' | 'GENERAL') => ({
  hospitalId: 'h1',
  slotId: 's1',
  doctorId: 'd1',
  specialtyId: 'dentistry',
  consultationType,
  status: 'APPROVED',
  startTime: new Date(Date.now() + 60 * MIN).toISOString(),
  endTime: new Date(Date.now() + 90 * MIN).toISOString(),
});

const call = (fn: (e: any) => Promise<any>, body: unknown = {}) =>
  fn({ body: JSON.stringify(body), requestContext: { authorizer: { claims: { sub: caller.userId } } } }) as Promise<{
    statusCode: number;
    body: string;
  }>;
const written = () =>
  send.mock.calls.map(([c]) => c).find((c) => c.constructor.name === 'TransactWriteCommand')?.input.TransactItems[1].Put.Item;

describe('booking with a note', () => {
  const given = (type: 'SPECIALIST' | 'GENERAL') => {
    send.mockReset().mockImplementation(async (c: { constructor: { name: string } }) =>
      c.constructor.name === 'GetCommand' ? { Item: slot(type) } : {}
    );
    queryAll.mockReset().mockResolvedValue([]);
  };
  const body = (note?: unknown) => ({ hospitalId: 'h1', slotId: 's1', ...(note === undefined ? {} : { note }) });

  beforeEach(() => {
    caller = { userId: 'p1', role: 'PATIENT' };
  });

  it('stores a trimmed note on a specialist appointment', async () => {
    given('SPECIALIST');
    const res = await call(book, body('  Teeth whitening  '));
    expect(res.statusCode).toBe(200);
    expect(written()).toMatchObject({ note: 'Teeth whitening', consultationType: 'SPECIALIST' });
  });

  it('works without a note, and a blank note stores nothing', async () => {
    given('SPECIALIST');
    expect((await call(book, body())).statusCode).toBe(200);
    expect(written()).not.toHaveProperty('note');
    expect((await call(book, body('   '))).statusCode).toBe(200);
    expect(written()).not.toHaveProperty('note');
  });

  it('refuses a note on a general consultation', async () => {
    given('GENERAL');
    const res = await call(book, body('hello'));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/specialist/);
  });

  it('refuses a note over 500 characters, and one that is not text', async () => {
    given('SPECIALIST');
    expect((await call(book, body('x'.repeat(501)))).statusCode).toBe(400);
    expect((await call(book, body('x'.repeat(500)))).statusCode).toBe(200);
    expect((await call(book, body(42))).statusCode).toBe(400);
  });
});

describe('who can read the note', () => {
  const appointment = { appointmentId: 'a1', patientId: 'p1', doctorId: 'd1', hospitalId: 'h1', status: 'CONFIRMED', startTime: '2026-10-10T09:00:00.000Z', note: 'Teeth whitening' };

  const asRole = async (role: string) => {
    caller = { userId: role === 'DOCTOR' ? 'd1' : role === 'PATIENT' ? 'p1' : 'x', role, hospitalId: 'h1' };
    queryAll.mockReset().mockResolvedValue([{ ...appointment }]);
    send.mockReset().mockResolvedValue({ Responses: {}, Item: undefined });
    const res = await call(mine);
    return JSON.parse(res.body).appointments[0];
  };

  it('is shown to the patient and to the doctor', async () => {
    expect((await asRole('PATIENT')).note).toBe('Teeth whitening');
    expect((await asRole('DOCTOR')).note).toBe('Teeth whitening');
  });

  it('is never sent to the hospital admin or to staff', async () => {
    for (const role of ['HOSPITAL_ADMIN', 'STAFF']) {
      const a = await asRole(role);
      expect(a).not.toHaveProperty('note');
      expect(JSON.stringify(a)).not.toContain('Teeth whitening');
      expect(a.appointmentId).toBe('a1'); // the rest of the appointment is still there
    }
  });
});
