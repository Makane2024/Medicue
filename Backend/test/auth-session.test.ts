// The refresh token lives in an HttpOnly cookie; /auth/refresh turns it into an ID token and /auth/logout ends it.

process.env.ALLOWED_ORIGIN = 'https://app.example.com,http://localhost:5173';

const cognitoSend = jest.fn();
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: (...args: unknown[]) => cognitoSend(...args) })),
  InitiateAuthCommand: jest.fn((input) => ({ input, kind: 'InitiateAuth' })),
  RevokeTokenCommand: jest.fn((input) => ({ input, kind: 'RevokeToken' })),
}));

const secretJson = jest.fn();
jest.mock('../lambda/lib/secrets', () => ({ getSecretJson: (...args: unknown[]) => secretJson(...args) }));

// required after ALLOWED_ORIGIN is set: the origin list is read when the module loads
const { authSession } = require('../lambda/auth');
const { clearRefreshCookie, readRefreshCookie, refreshCookie } = require('../lambda/lib/http');
const { sealToken, sessionCookieHeader } = require('../lambda/lib/cookie-seal');

const event = (resource: string, headers: Record<string, string> = {}) => ({
  resource,
  headers: { origin: 'https://app.example.com', ...headers },
  requestContext: { stage: 'prod' },
});
const json = (res: any) => JSON.parse(res.body);

let cookie: string; // a valid session cookie for the refresh token "rt1"

beforeEach(async () => {
  cognitoSend.mockReset();
  secretJson.mockReset().mockResolvedValue({ key: 'key-one' });
  cookie = 'mc_rt=' + encodeURIComponent(await sealToken('rt1'));
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('refresh-token cookie', () => {
  it('is HttpOnly, Secure, cross-site and limited to the auth routes', () => {
    const cookie = refreshCookie('a.b/c=d', event('/auth/login'));
    expect(cookie).toMatch(/^mc_rt=a\.b%2Fc%3Dd; Max-Age=\d+; Path=\/prod\/auth; HttpOnly; Secure; SameSite=None$/);
    expect(clearRefreshCookie(event('/auth/logout'))).toContain('Max-Age=0');
  });

  it('is read back from the Cookie header', () => {
    const own = refreshCookie('a.b/c=d', event('/auth/login')).split(';')[0];
    expect(readRefreshCookie({ headers: { cookie: `other=1; ${own}` } })).toBe('a.b/c=d');
    expect(readRefreshCookie({ headers: {} })).toBeUndefined();
  });
});

describe('POST /auth/refresh', () => {
  it('answers with no session when there is no cookie, without calling Cognito', async () => {
    const res: any = await authSession(event('/auth/refresh'));
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({});
    expect(cognitoSend).not.toHaveBeenCalled();
  });

  it('returns a new ID token and nothing else', async () => {
    cognitoSend.mockResolvedValue({ AuthenticationResult: { IdToken: 'id', AccessToken: 'acc' } });
    const res: any = await authSession(event('/auth/refresh', { cookie }));
    expect(json(res)).toEqual({ idToken: 'id' });
    expect(cognitoSend.mock.calls[0][0].input).toMatchObject({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: { REFRESH_TOKEN: 'rt1' },
    });
  });

  it('clears the cookie when the refresh token is expired, revoked or the account is suspended', async () => {
    cognitoSend.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAuthorizedException' }));
    const res: any = await authSession(event('/auth/refresh', { cookie }));
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({});
    expect(res.headers['Set-Cookie']).toContain('Max-Age=0');
  });

  it('echoes an allowed origin with credentials and refuses any other site', async () => {
    const ok: any = await authSession(event('/auth/refresh', { origin: 'http://localhost:5173' }));
    expect(ok.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(ok.headers['Access-Control-Allow-Credentials']).toBe('true');
    const evil: any = await authSession(event('/auth/refresh', { origin: 'https://evil.example', cookie }));
    expect(evil.statusCode).toBe(403);
    expect(cognitoSend).not.toHaveBeenCalled();
  });
});

describe('POST /auth/logout', () => {
  it('revokes the refresh token and clears the cookie', async () => {
    cognitoSend.mockResolvedValue({});
    const res: any = await authSession(event('/auth/logout', { cookie }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Set-Cookie']).toContain('Max-Age=0');
    expect(cognitoSend.mock.calls[0][0]).toMatchObject({ kind: 'RevokeToken', input: { Token: 'rt1' } });
  });

  it('still clears the cookie when revoking fails', async () => {
    cognitoSend.mockRejectedValue(new Error('boom'));
    const res: any = await authSession(event('/auth/logout', { cookie }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Set-Cookie']).toContain('Max-Age=0');
  });
});

describe('session cookie encryption', () => {
  const cookieValue = (header: Record<string, string>) => header['Set-Cookie'].split(';')[0].slice('mc_rt='.length);

  it('does not contain the refresh token', async () => {
    const header = await sessionCookieHeader('very-secret-refresh-token', event('/auth/login'));
    expect(header['Set-Cookie']).not.toContain('very-secret-refresh-token');
    expect(header['Set-Cookie']).toContain('HttpOnly');
  });

  it('is rejected when altered or sealed with a different key, and readable after a key rotation', async () => {
    const sealed = decodeURIComponent(cookieValue(await sessionCookieHeader('rt-x', event('/auth/login'))));
    const refreshWith = async (value: string) => {
      cognitoSend.mockResolvedValue({ AuthenticationResult: { IdToken: 'id' } });
      return json(await authSession(event('/auth/refresh', { cookie: 'mc_rt=' + encodeURIComponent(value) })));
    };
    expect(await refreshWith(sealed)).toEqual({ idToken: 'id' });

    const parts = sealed.split('.');
    expect(await refreshWith([parts[0], parts[1], (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1), parts[3]].join('.'))).toEqual({});

    secretJson.mockResolvedValue({ key: 'key-two' }); // rotated without keeping the old key: everyone is signed out
    expect(await refreshWith(sealed)).toEqual({});
    secretJson.mockResolvedValue({ key: 'key-two', previousKey: 'key-one' }); // during a rotation the old cookies still work
    expect(await refreshWith(sealed)).toEqual({ idToken: 'id' });
  });

  it('still lets the user sign in, without a cookie, when the key cannot be read', async () => {
    secretJson.mockRejectedValue(new Error('AccessDenied'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await sessionCookieHeader('rt1', event('/auth/login'))).toEqual({});
  });
});
