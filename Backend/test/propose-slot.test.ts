// Rules of POST /availability/propose, tested against a mocked database: at most 5 slots per request,
// exact times chosen by the admin, no clashes between the slots or with the doctor's existing slots.

const send = jest.fn();
const queryAll = jest.fn();

jest.mock('../lambda/lib/db', () => ({
  ddb: { send: (...args: unknown[]) => send(...args) },
  queryAll: (...args: unknown[]) => queryAll(...args),
  requireRole: async () => ({ userId: 'admin-1', role: 'HOSPITAL_ADMIN', hospitalId: 'h1' }),
  requireApprovedHospital: async () => ({ hospitalId: 'h1', status: 'APPROVED' }),
}));
jest.mock('../lambda/lib/notify', () => ({ sendNotification: jest.fn() }));

import { proposeSlot as handler } from '../lambda/availability';
import { sendNotification } from '../lambda/lib/notify';

const MIN = 60_000;
const base = Date.now() + 2 * 24 * 60 * MIN; // two days ahead
const at = (offsetMinutes: number) => new Date(base + offsetMinutes * MIN).toISOString();
const slot = (from: number, to: number) => ({ startTime: at(from), endTime: at(to) });

const call = (body: unknown) =>
  handler({
    body: JSON.stringify(body),
    requestContext: { authorizer: { claims: { sub: 'admin-1' } } },
  }) as Promise<{ statusCode: number; body: string }>;

const propose = (slots: unknown[]) => call({ doctorId: 'd1', consultationType: 'GENERAL', slots });
const message = (res: { body: string }) => JSON.parse(res.body).message as string;

beforeEach(() => {
  send.mockReset();
  queryAll.mockReset();
  queryAll.mockResolvedValue([]); // the doctor has no other slots
  (sendNotification as jest.Mock).mockClear();
  // first call: the affiliation lookup, later calls: the transaction
  send.mockImplementation(async (command: { constructor: { name: string } }) =>
    command.constructor.name === 'GetCommand' ? { Item: { specialtyId: 'cardiology', status: 'ACTIVE' } } : {}
  );
});

const writtenItems = () => {
  const tx = send.mock.calls.map(([c]) => c).find((c) => c.constructor.name === 'TransactWriteCommand');
  return tx ? tx.input.TransactItems.map((i: any) => i.Put.Item) : [];
};

describe('proposing slots', () => {
  it('accepts up to 5 slots with exactly the times the admin chose, all pending', async () => {
    const chosen = [slot(0, 30), slot(40, 70), slot(80, 110), slot(120, 150), slot(160, 190)];
    const res = await propose(chosen);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).slotIds).toHaveLength(5);
    const items = writtenItems();
    expect(items).toHaveLength(5);
    expect(items.map((i: any) => [i.startTime, i.endTime])).toEqual(chosen.map((s) => [s.startTime, s.endTime]));
    expect(items.every((i: any) => i.status === 'PENDING' && i.doctorId === 'd1' && i.hospitalId === 'h1')).toBe(true);
  });

  it('refuses more than 5 slots at once and writes nothing', async () => {
    const res = await propose([0, 40, 80, 120, 160, 200].map((m) => slot(m, m + 30)));
    expect(res.statusCode).toBe(400);
    expect(message(res)).toMatch(/at most 5 slots/);
    expect(writtenItems()).toHaveLength(0);
  });

  it('refuses an empty list and the old single-slot body', async () => {
    expect((await propose([])).statusCode).toBe(400);
    const legacy = await call({ doctorId: 'd1', ...slot(0, 30) });
    expect(legacy.statusCode).toBe(400);
  });

  it('refuses slots that overlap each other', async () => {
    const res = await propose([slot(0, 60), slot(30, 90)]);
    expect(res.statusCode).toBe(409);
    expect(message(res)).toMatch(/Slots 1 and 2 overlap/);
    expect(writtenItems()).toHaveLength(0);
  });

  it('refuses slots closer together than the 10 minute buffer, wherever they are in the list', async () => {
    const res = await propose([slot(0, 30), slot(100, 130), slot(139, 170)]); // 9 minutes after slot 2
    expect(res.statusCode).toBe(409);
    expect(message(res)).toMatch(/Slots 2 and 3/);
  });

  it('allows slots exactly 10 minutes apart, in any order', async () => {
    const res = await propose([slot(40, 70), slot(0, 30)]);
    expect(res.statusCode).toBe(200);
  });

  it('refuses a slot that clashes with a slot the doctor already has', async () => {
    queryAll.mockResolvedValue([
      { slotId: 'old', hospitalId: 'h1', doctorId: 'd1', status: 'PENDING', ...slot(20, 50) }, // own unanswered proposal
    ]);
    const res = await propose([slot(0, 30)]);
    expect(res.statusCode).toBe(409);
    expect(message(res)).toMatch(/Slot 1: the doctor already has/);
    expect(writtenItems()).toHaveLength(0);
  });

  it("does not let another hospital's unanswered proposal block this hospital", async () => {
    queryAll.mockResolvedValue([{ slotId: 'x', hospitalId: 'other', doctorId: 'd1', status: 'PENDING', ...slot(0, 30) }]);
    expect((await propose([slot(0, 30)])).statusCode).toBe(200);
  });

  it('validates each slot: end after start, not in the past, not longer than 12 hours', async () => {
    expect((await propose([slot(30, 0)])).statusCode).toBe(400);
    expect((await propose([slot(-3 * 24 * 60, -3 * 24 * 60 + 30)])).statusCode).toBe(400);
    expect((await propose([slot(0, 13 * 60)])).statusCode).toBe(400);
  });

  it('sends the doctor one notification for the whole batch', async () => {
    await propose([slot(0, 30), slot(40, 70), slot(80, 110)]);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect((sendNotification as jest.Mock).mock.calls[0][2].payload).toMatchObject({ count: 3 });
  });
});
