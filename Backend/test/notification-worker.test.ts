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

const secretJson = jest.fn();
jest.mock('../lambda/lib/secrets', () => ({ getSecretJson: (...args: unknown[]) => secretJson(...args) }));
const fetchMock = jest.fn();
(global as any).fetch = fetchMock;

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
  secretJson.mockReset().mockResolvedValue({ provider: 'twilio', accountSid: '', authToken: 'x', from: '' });
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 201 });
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

  describe('SMS through the third-party service', () => {
    const configured = { provider: 'twilio', accountSid: 'AC1', authToken: 'tok', from: '+15550001111' };

    it('uses SNS while the secret holds no account yet', async () => {
      await run('SMS');
      expect(snsSend).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends through the service with the credentials from Secrets Manager', async () => {
      secretJson.mockResolvedValue(configured);
      await run('SMS');
      expect(snsSend).not.toHaveBeenCalled();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('/Accounts/AC1/Messages.json');
      expect(init.headers.Authorization).toBe('Basic ' + Buffer.from('AC1:tok').toString('base64'));
      expect(init.body).toContain('To=%2B237650000000');
      expect(statuses()).toEqual(['SENT']);
    });

    it('falls back to SNS when the secret cannot be read', async () => {
      secretJson.mockRejectedValue(new Error('AccessDenied'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      await run('SMS');
      expect(snsSend).toHaveBeenCalledTimes(1);
      expect(statuses()).toEqual(['SENT']);
    });

    it('drops a number the service refuses and retries a server error', async () => {
      secretJson.mockResolvedValue(configured);
      fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
      await expect(run('SMS')).resolves.toBeUndefined();
      expect(statuses()).toEqual(['FAILED']);
      fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
      await expect(run('SMS')).rejects.toThrow('503');
    });
  });
});
