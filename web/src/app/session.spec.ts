import { TestBed } from '@angular/core/testing';
import { Session } from './session';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Session', () => {
  beforeEach(() => {
    localStorage.removeItem('supermarket.refresh');
    TestBed.configureTestingModule({ providers: [Session] });
  });

  afterEach(() => {
    localStorage.removeItem('supermarket.refresh');
  });

  it('refreshes an expired access token before allowing a protected route', async () => {
    const tokenPairs = [
      { access_token: 'expired-access', refresh_token: 'refresh-1', expires_in: 0, token_type: 'bearer' },
      { access_token: 'fresh-access', refresh_token: 'refresh-2', expires_in: 900, token_type: 'bearer' },
    ];
    let tokenIndex = 0;
    spyOn(window, 'fetch').and.callFake(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/oauth/token')) {
        tokenIndex += 1;
        return jsonResponse(tokenPairs[tokenIndex - 1]);
      }
      if (url.endsWith('/users/me')) {
        return jsonResponse({ id: 1, email: 'shopper@example.test', display_name: 'Shopper' });
      }
      return jsonResponse({}, 404);
    });

    const session = TestBed.inject(Session);
    await session.login('shopper@example.test', 'a-long-password');

    expect(await session.ready()).toBeTrue();
    expect(tokenIndex).toBe(2);
    expect(localStorage.getItem('supermarket.refresh')).toBe('refresh-2');
  });

  it('clears an invalid refresh token so protected routes can return to login', async () => {
    localStorage.setItem('supermarket.refresh', 'expired-refresh');
    spyOn(window, 'fetch').and.resolveTo(jsonResponse({ error: 'invalid_grant' }, 401));

    const session = TestBed.inject(Session);

    expect(await session.ready()).toBeFalse();
    expect(localStorage.getItem('supermarket.refresh')).toBeNull();
  });
});
