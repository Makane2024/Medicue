// A notification that can never be delivered is recorded as failed and dropped; a temporary problem is retried.

const ddbSend = jest.fn();
const sesSend = jest.fn();
const snsSend = jest.fn();
let user: Record<string, any> | undefined;

jest.mock('../lambda/lib/db', () => ({ ddb: { send: (...args: unknown[]) => ddbSend(...args) } }));
jest.mock('@aws-sdk/client-ses', () => ({
  SESClient: jest.fn(() => ({ send: (...args: unknown[]) => sesSend(...args) })),
  SendEmailCommand: jest.fn((input) => ({ input })),
}));
jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn(() => ({ send: (...args: unknown[]) => snsSend(...args) })),
  PublishCommand: jest.fn((input) => ({ input })),
}));

import { handler } from '../lambda/notification-worker';

const record = (channel: 'EMAIL' | 'SMS') => ({
  body: JSON.stringify({
    detail: { recipientId: 'u1', notificationId: 'n1', channel, type: 'CANCELLATION', payload: { appointmentId: 'a1' } },
  }),
});
const run = (channel: 'EMAIL' | 'SMS' = 'EMAIL') => handler({ Records: [record(channel)] });
const statuses = () =>
  ddbSend.mock.calls
    .map(([c]) => c.input?.ExpressionAttributeValues)
    .filter((v) => v && (':sent' in v || ':failed' in v))
    .map((v) => (':sent' in v ? 'SENT' : 'FAILED'));

beforeEach(() => {
  ddbSend.mockReset().mockImplementation(async (c: { constructor: { name: string } }) =>
    c.constructor.name === 'GetCommand' ? { Item: user } : {}
  );
  sesSend.mockReset().mockResolvedValue({});
  snsSend.mockReset().mockResolvedValue({});
  user = { userId: 'u1', email: 'a@b.cd', phone: '+237650000000' };
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('notification worker', () => {
  it('delivers and marks the notification sent', async () => {
    await run();
    expect(sesSend).toHaveBeenCalledTimes(1);
    expect(statuses()).toEqual(['SENT']);
  });

  it('records an address the provider refuses as failed, without retrying', async () => {
    sesSend.mockRejectedValue(Object.assign(new Error('Email address is not verified'), { name: 'MessageRejected' }));
    await expect(run()).resolves.toBeUndefined();
    expect(statuses()).toEqual(['FAILED']);
  });

  it('records a missing recipient, email or phone as failed, without retrying', async () => {
    user = { userId: 'u1' };
    await expect(run('EMAIL')).resolves.toBeUndefined();
    await expect(run('SMS')).resolves.toBeUndefined();
    user = undefined;
    await expect(run()).resolves.toBeUndefined();
    expect(statuses()).toEqual(['FAILED', 'FAILED', 'FAILED']);
    expect(sesSend).not.toHaveBeenCalled();
    expect(snsSend).not.toHaveBeenCalled();
  });

  it('still retries a temporary problem, so SQS can try again and finally use the dead-letter queue', async () => {
    sesSend.mockRejectedValue(Object.assign(new Error('Throttled'), { name: 'ThrottlingException' }));
    await expect(run()).rejects.toThrow('Throttled');
    expect(statuses()).toEqual(['FAILED']);
  });
});
