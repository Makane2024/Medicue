// Bulk account creation, statistics, suspension and password recovery.

const send = jest.fn();
const cognitoSend = jest.fn();
const queryAll = jest.fn();
const invite = jest.fn();
let caller: Record<string, any>;
let target: Record<string, any> | undefined;

jest.mock('../lambda/lib/db', () => ({
  ddb: { send: (...args: unknown[]) => send(...args) },
  queryAll: (...args: unknown[]) => queryAll(...args),
  getUser: async (id: string) => (id === caller.userId ? caller : target),
  requireRole: async (_id: string, role: string) => {
    if (caller.role !== role) throw new (require('../lambda/lib/http').HttpError)(403, 'Not authorized');
    return caller;
  },
  requireApprovedHospital: async () => ({ hospitalId: 'h1', status: 'APPROVED' }),
  isConditionFailed: () => false,
}));
jest.mock('../lambda/lib/accounts', () => ({ inviteAccount: (...args: unknown[]) => invite(...args) }));
jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
  const actual = jest.requireActual('@aws-sdk/client-cognito-identity-provider');
  return { ...actual, CognitoIdentityProviderClient: jest.fn(() => ({ send: (...args: unknown[]) => cognitoSend(...args) })) };
});

import { handler as bulk } from '../lambda/bulk-create-users';
import { handler as suspend } from '../lambda/suspend-user';
import { handler as forgot } from '../lambda/forgot-password';
import { handler as reset } from '../lambda/reset-password';
import { normalizeRole } from '../lambda/lib/bulk';
import { summarize } from '../lambda/lib/stats';

const call = (fn: (e: any) => Promise<any>, body: unknown) =>
  fn({ body: JSON.stringify(body), requestContext: { authorizer: { claims: { sub: caller?.userId ?? 'x' } } } }) as Promise<{
    statusCode: number;
    body: string;
  }>;
const json = (res: { body: string }) => JSON.parse(res.body);

beforeEach(() => {
  send.mockReset().mockResolvedValue({});
  cognitoSend.mockReset().mockResolvedValue({});
  queryAll.mockReset().mockResolvedValue([]);
  invite.mockReset().mockResolvedValue({ userId: 'new', created: true });
  target = undefined;
});

describe('bulk create', () => {
  const doctor = { role: 'Doctor', firstName: 'Ada', lastName: 'Obi', email: 'Ada@Mail.com', specialty: 'Cardiology' };
  const staff = { role: 'staff', firstName: 'Bo', lastName: 'Ngu', email: 'bo@mail.com', phone: '+237650000000' };
  const patient = { role: 'PATIENT', firstName: 'Cy', lastName: 'Eto', email: 'cy@mail.com', phone: '+237650000001', dateOfBirth: '1990-04-02' };

  describe('as a hospital admin', () => {
    beforeEach(() => {
      caller = { userId: 'a1', role: 'HOSPITAL_ADMIN', hospitalId: 'h1' };
    });

    it('creates doctors and staff for the admin\'s own hospital and reports each row', async () => {
      const res = await call(bulk, { users: [doctor, staff] });
      expect(res.statusCode).toBe(200);
      expect(json(res)).toMatchObject({ created: 2, failed: 0 });
      expect(invite).toHaveBeenCalledWith(expect.objectContaining({ role: 'DOCTOR', email: 'ada@mail.com', hospitalId: 'h1', specialty: 'Cardiology' }));
      expect(invite).toHaveBeenCalledWith(expect.objectContaining({ role: 'STAFF', hospitalId: 'h1', phone: '+237650000000' }));
    });

    it('refuses patients and keeps going with the other rows', async () => {
      const res = await call(bulk, { users: [patient, staff] });
      const body = json(res);
      expect(body.results[0]).toMatchObject({ status: 'ERROR', message: expect.stringMatching(/not patients/) });
      expect(body.results[1].status).toBe('CREATED');
      expect(body).toMatchObject({ created: 1, failed: 1 });
    });

    it('rejects rows with missing or invalid fields, naming the problem', async () => {
      const res = await call(bulk, {
        users: [
          { ...doctor, specialty: '' },
          { ...staff, email: 'not-an-email' },
          { ...staff, phone: '650000000' },
          { ...staff, role: 'admin' },
          { ...staff, firstName: '' },
        ],
      });
      const messages = json(res).results.map((r: any) => r.message);
      expect(messages[0]).toMatch(/specialty is required/);
      expect(messages[1]).toMatch(/valid email/);
      expect(messages[2]).toMatch(/E.164/);
      expect(messages[3]).toMatch(/PATIENT, DOCTOR or STAFF/);
      expect(messages[4]).toMatch(/firstName is required/);
      expect(invite).not.toHaveBeenCalled();
    });

    it('only creates the first of two rows that share an email', async () => {
      const res = await call(bulk, { users: [staff, { ...staff, firstName: 'Other' }] });
      const body = json(res);
      expect(body.results.map((r: any) => r.status)).toEqual(['CREATED', 'ERROR']);
      expect(body.results[1].message).toMatch(/more than once/);
      expect(invite).toHaveBeenCalledTimes(1);
    });

    it('reports accounts that already exist and Cognito failures as row errors, not as a failed request', async () => {
      invite.mockRejectedValueOnce(Object.assign(new Error('An account with this email already exists'), { statusCode: 409 }));
      const { HttpError } = jest.requireActual('../lambda/lib/http');
      invite.mockReset().mockRejectedValueOnce(new HttpError(409, 'An account with this email already exists')).mockResolvedValue({ userId: 'n', created: false });
      const res = await call(bulk, { users: [staff, doctor] });
      const body = json(res);
      expect(res.statusCode).toBe(200);
      expect(body.results[0]).toMatchObject({ status: 'ERROR', message: 'An account with this email already exists' });
      expect(body.results[1].status).toBe('AFFILIATED');
    });

    it('accepts at most 50 accounts per request and needs a non-empty list', async () => {
      expect((await call(bulk, { users: Array.from({ length: 51 }, (_, i) => ({ ...staff, email: `s${i}@mail.com` })) })).statusCode).toBe(400);
      expect((await call(bulk, { users: [] })).statusCode).toBe(400);
      expect((await call(bulk, {})).statusCode).toBe(400);
    });
  });

  describe('as the platform admin', () => {
    beforeEach(() => {
      caller = { userId: 'p1', role: 'PLATFORM_ADMIN' };
      queryAll.mockResolvedValue([{ hospitalId: 'h9', name: 'Buea Regional Hospital' }]);
    });

    it('creates patients, and doctors or staff at the hospital named in the row (by name or id)', async () => {
      const res = await call(bulk, {
        users: [patient, { ...doctor, hospital: 'buea regional hospital' }, { ...staff, hospital: 'h9' }],
      });
      expect(json(res)).toMatchObject({ created: 3, failed: 0 });
      expect(invite).toHaveBeenCalledWith(expect.objectContaining({ role: 'PATIENT', dateOfBirth: '1990-04-02' }));
      expect(invite).toHaveBeenCalledWith(expect.objectContaining({ role: 'DOCTOR', hospitalId: 'h9' }));
    });

    it('needs a known approved hospital for doctors and staff, and phone and birth date for patients', async () => {
      const res = await call(bulk, {
        users: [doctor, { ...staff, hospital: 'Nowhere Clinic' }, { ...patient, phone: undefined }, { ...patient, dateOfBirth: '2999-01-01' }],
      });
      const messages = json(res).results.map((r: any) => r.message);
      expect(messages[0]).toMatch(/hospital is required/);
      expect(messages[1]).toMatch(/not an approved hospital/);
      expect(messages[2]).toMatch(/phone is required/);
      expect(messages[3]).toMatch(/past date/);
    });
  });

  it('refuses everybody else', async () => {
    for (const role of ['PATIENT', 'DOCTOR', 'STAFF']) {
      caller = { userId: 'x', role, hospitalId: 'h1' };
      expect((await call(bulk, { users: [staff] })).statusCode).toBe(403);
    }
  });

  it('understands role spellings', () => {
    expect(normalizeRole(' Doctor ')).toBe('DOCTOR');
    expect(normalizeRole('staff')).toBe('STAFF');
    expect(() => normalizeRole('HOSPITAL_ADMIN')).toThrow();
    expect(() => normalizeRole(undefined)).toThrow();
  });
});

describe('suspend', () => {
  beforeEach(() => {
    caller = { userId: 'p1', role: 'PLATFORM_ADMIN' };
    target = { userId: 'u9', email: 'u9@mail.com', role: 'DOCTOR' };
  });
  const commands = () => cognitoSend.mock.calls.map(([c]) => c.constructor.name);

  it('disables the Cognito user, signs it out everywhere and flags the row', async () => {
    const res = await call(suspend, { userId: 'u9', suspended: true });
    expect(res.statusCode).toBe(200);
    expect(commands()).toEqual(['AdminDisableUserCommand', 'AdminUserGlobalSignOutCommand']);
    expect(send.mock.calls[0][0].input.ExpressionAttributeValues).toMatchObject({ ':t': true });
  });

  it('reinstates an account', async () => {
    await call(suspend, { userId: 'u9', suspended: false });
    expect(commands()).toEqual(['AdminEnableUserCommand']);
    expect(send.mock.calls[0][0].input.ExpressionAttributeValues).toEqual({ ':f': false });
  });

  it('never suspends platform admins or the caller, and unknown users are a 404', async () => {
    target = { userId: 'u8', email: 'x@y.z', role: 'PLATFORM_ADMIN' };
    expect((await call(suspend, { userId: 'u8', suspended: true })).statusCode).toBe(403);
    expect((await call(suspend, { userId: 'p1', suspended: true })).statusCode).toBe(400);
    target = undefined;
    expect((await call(suspend, { userId: 'nobody', suspended: true })).statusCode).toBe(404);
    expect(cognitoSend).not.toHaveBeenCalled();
  });

  it('is for the platform admin only and needs a true/false flag', async () => {
    expect((await call(suspend, { userId: 'u9', suspended: 'yes' })).statusCode).toBe(400);
    caller = { userId: 'a1', role: 'HOSPITAL_ADMIN' };
    expect((await call(suspend, { userId: 'u9', suspended: true })).statusCode).toBe(403);
  });
});

describe('password recovery', () => {
  it('forgot-password answers the same whether or not the account exists', async () => {
    const ok = await call(forgot, { email: 'a@b.cd' });
    cognitoSend.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'UserNotFoundException' }));
    const missing = await call(forgot, { email: 'nobody@b.cd' });
    expect(ok.statusCode).toBe(200);
    expect(missing.statusCode).toBe(200);
    expect(missing.body).toBe(ok.body);
  });

  it('forgot-password still reports rate limiting and bad input', async () => {
    cognitoSend.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'LimitExceededException' }));
    expect((await call(forgot, { email: 'a@b.cd' })).statusCode).toBe(429);
    expect((await call(forgot, { email: 'nope' })).statusCode).toBe(400);
  });

  const HASH = 'Mc1!' + 'ab12cd34'.repeat(8);

  it('reset-password refuses a raw password', async () => {
    expect((await call(reset, { email: 'a@b.cd', code: '123456', newPassword: 'Str0ngPass' })).statusCode).toBe(400);
    expect(cognitoSend).not.toHaveBeenCalled();
  });

  it('reset-password sends the code and the new password', async () => {
    const res = await call(reset, { email: 'a@b.cd', code: '123456', newPassword: HASH });
    expect(res.statusCode).toBe(200);
    expect(cognitoSend.mock.calls[0][0].input).toMatchObject({ Username: 'a@b.cd', ConfirmationCode: '123456', Password: HASH });
  });

  it('reset-password maps wrong codes and weak passwords to 400, and unknown accounts look like wrong codes', async () => {
    cognitoSend.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'CodeMismatchException' }));
    expect((await call(reset, { email: 'a@b.cd', code: '000000', newPassword: HASH })).statusCode).toBe(400);
    cognitoSend.mockRejectedValueOnce(Object.assign(new Error('Password did not conform'), { name: 'InvalidPasswordException' }));
    expect((await call(reset, { email: 'a@b.cd', code: '123456', newPassword: HASH })).statusCode).toBe(400);
    cognitoSend.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'UserNotFoundException' }));
    const res = await call(reset, { email: 'ghost@b.cd', code: '123456', newPassword: HASH });
    expect(res.statusCode).toBe(400);
    expect(json(res).message).toMatch(/Invalid or expired/);
  });
});

describe('statistics', () => {
  it('counts per status and per day, listing empty days too', () => {
    const appts = [
      { startTime: '2026-10-05T08:00:00.000Z', status: 'COMPLETED' },
      { startTime: '2026-10-05T09:00:00.000Z', status: 'MISSED' },
      { startTime: '2026-10-07T10:00:00.000Z', status: 'CANCELLED' },
      { startTime: '2026-10-07T11:00:00.000Z', status: 'COMPLETED' },
      { startTime: '2026-10-20T11:00:00.000Z', status: 'COMPLETED' }, // outside the window
    ];
    const s = summarize(appts, '2026-10-05T00:00:00.000Z', '2026-10-11T23:59:59.999Z', 0);
    expect(s.total).toBe(4);
    expect(s.totals).toMatchObject({ COMPLETED: 2, MISSED: 1, CANCELLED: 1, ARRIVED: 0 });
    expect(s.days.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(s.days[0].counts).toEqual({ COMPLETED: 1, MISSED: 1 });
    expect(s.days[1].counts).toEqual({});
  });

  it("puts late-evening appointments on the viewer's own day", () => {
    // UTC+1 (getTimezoneOffset = -60): 23:30 UTC on the 5th is 00:30 on the 6th locally
    const appts = [{ startTime: '2026-10-05T23:30:00.000Z', status: 'COMPLETED' }];
    const s = summarize(appts, '2026-10-04T23:00:00.000Z', '2026-10-06T22:59:59.999Z', -60);
    expect(s.days.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-06']);
    expect(s.days[1].counts).toEqual({ COMPLETED: 1 });
  });
});
