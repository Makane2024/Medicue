// Check-in (hospital staff or admin: the patient has arrived) and complete (doctor: the session is over).

const send = jest.fn();
let caller: Record<string, any>;

jest.mock('../lambda/lib/db', () => ({
  ddb: { send: (...args: unknown[]) => send(...args) },
  getUser: async () => caller,
  requireRole: async (_id: string, role: string) => {
    if (caller.role !== role) throw new (require('../lambda/lib/http').HttpError)(403, 'Not authorized');
    return caller;
  },
  isConditionFailed: (err: any) => err?.name === 'ConditionalCheckFailedException',
}));

jest.mock('../lambda/lib/notify', () => ({ sendNotification: jest.fn() }));

import { handler as checkIn } from '../lambda/check-in-appointment';
import { sendNotification } from '../lambda/lib/notify';
import { handler as complete } from '../lambda/complete-appointment';

const MIN = 60_000;
const at = (offsetMinutes: number) => new Date(Date.now() + offsetMinutes * MIN).toISOString();

const appointment = (over: Record<string, any> = {}) => ({
  appointmentId: 'a1',
  hospitalId: 'h1',
  doctorId: 'd1',
  patientId: 'p1',
  status: 'CONFIRMED',
  startTime: at(-5),
  endTime: at(25),
  ...over,
});

const call = (fn: (e: any) => Promise<any>, body: unknown = { appointmentId: 'a1' }) =>
  fn({ body: JSON.stringify(body), requestContext: { authorizer: { claims: { sub: caller.userId } } } }) as Promise<{
    statusCode: number;
    body: string;
  }>;
const message = (res: { body: string }) => JSON.parse(res.body).message as string;
const updates = () => send.mock.calls.map(([c]) => c).filter((c) => c.constructor.name === 'UpdateCommand');

const given = (item: Record<string, any> | undefined) =>
  send.mockImplementation(async (command: { constructor: { name: string } }) =>
    command.constructor.name === 'GetCommand' ? { Item: item } : {}
  );

beforeEach(() => {
  send.mockReset();
  caller = { userId: 'u1', role: 'STAFF', hospitalId: 'h1' };
});

describe('check-in', () => {
  it('lets staff check in a confirmed appointment at their hospital', async () => {
    given(appointment());
    const res = await call(checkIn);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('ARRIVED');
    const input = updates()[0].input;
    expect(input.ExpressionAttributeValues).toMatchObject({ ':arrived': 'ARRIVED', ':confirmed': 'CONFIRMED', ':by': 'u1' });
  });

  it('lets the hospital admin check in as well', async () => {
    caller = { userId: 'u2', role: 'HOSPITAL_ADMIN', hospitalId: 'h1' };
    given(appointment());
    expect((await call(checkIn)).statusCode).toBe(200);
  });

  it('refuses patients, doctors and the platform admin', async () => {
    for (const role of ['PATIENT', 'DOCTOR', 'PLATFORM_ADMIN']) {
      caller = { userId: 'u3', role, hospitalId: 'h1' };
      given(appointment());
      expect((await call(checkIn)).statusCode).toBe(403);
    }
    expect(updates()).toHaveLength(0);
  });

  it('refuses staff of another hospital', async () => {
    caller = { userId: 'u4', role: 'STAFF', hospitalId: 'other' };
    given(appointment());
    expect((await call(checkIn)).statusCode).toBe(403);
  });

  it('refuses an appointment that is not confirmed, or already checked in', async () => {
    for (const status of ['PENDING_PAYMENT', 'CANCELLED', 'COMPLETED', 'MISSED']) {
      given(appointment({ status }));
      expect((await call(checkIn)).statusCode).toBe(409);
    }
    given(appointment({ status: 'ARRIVED' }));
    const res = await call(checkIn);
    expect(res.statusCode).toBe(409);
    expect(message(res)).toMatch(/already checked in/);
  });

  it('allows check-in up to 2 hours early but not earlier, and never after the appointment ended', async () => {
    given(appointment({ startTime: at(110), endTime: at(140) }));
    expect((await call(checkIn)).statusCode).toBe(200);
    given(appointment({ startTime: at(130), endTime: at(160) }));
    expect((await call(checkIn)).statusCode).toBe(409);
    given(appointment({ startTime: at(-60), endTime: at(-30) }));
    expect((await call(checkIn)).statusCode).toBe(409);
  });

  it('answers 404 for an unknown appointment', async () => {
    given(undefined);
    expect((await call(checkIn)).statusCode).toBe(404);
  });
});

describe('complete', () => {
  beforeEach(() => {
    caller = { userId: 'd1', role: 'DOCTOR' };
  });

  it('lets the doctor complete an appointment whose patient has arrived', async () => {
    given(appointment({ status: 'ARRIVED' }));
    const res = await call(complete);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('COMPLETED');
    expect(updates()[0].input.ExpressionAttributeValues).toMatchObject({ ':completed': 'COMPLETED', ':arrived': 'ARRIVED' });
  });

  it('invites the patient to review the doctor once the session is completed', async () => {
    (sendNotification as jest.Mock).mockClear();
    given(appointment({ status: 'ARRIVED' }));
    await call(complete);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect((sendNotification as jest.Mock).mock.calls[0][2]).toMatchObject({ recipientId: 'p1', type: 'SESSION_COMPLETED' });
  });

  it('sends nothing when the session cannot be completed', async () => {
    (sendNotification as jest.Mock).mockClear();
    given(appointment({ status: 'CONFIRMED' }));
    await call(complete);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('refuses a patient who has not been checked in', async () => {
    given(appointment({ status: 'CONFIRMED' }));
    const res = await call(complete);
    expect(res.statusCode).toBe(409);
    expect(message(res)).toMatch(/checked in/);
    expect(updates()).toHaveLength(0);
  });

  it("refuses another doctor's appointment and non-doctors", async () => {
    given(appointment({ status: 'ARRIVED', doctorId: 'someone-else' }));
    expect((await call(complete)).statusCode).toBe(403);
    caller = { userId: 'u1', role: 'STAFF', hospitalId: 'h1' };
    given(appointment({ status: 'ARRIVED' }));
    expect((await call(complete)).statusCode).toBe(403);
  });
});
