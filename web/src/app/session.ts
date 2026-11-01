import { Injectable, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

const API = 'http://127.0.0.1:3000';
const REFRESH_KEY = 'supermarket.refresh';

export interface Account {
  id: number;
  email: string;
  display_name: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

@Injectable({ providedIn: 'root' })
export class Session {
  readonly account = signal<Account | null>(null);
  private access = signal<string | null>(null);

  accessToken(): string | null {
    return this.access();
  }

  async ready(): Promise<boolean> {
    if (this.access()) {
      return true;
    }
    const refresh = localStorage.getItem(REFRESH_KEY);
    if (!refresh) {
      return false;
    }
    return this.useRefresh(refresh);
  }

  async register(email: string, displayName: string, password: string): Promise<void> {
    const created = await request('/users', {
      method: 'POST',
      body: JSON.stringify({ email, display_name: displayName, password }),
    });
    if (!created.ok) {
      throw new Error(await problem(created));
    }
    await this.login(email, password);
  }

  async login(email: string, password: string): Promise<void> {
    const response = await request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({ grant_type: 'password', username: email, password }),
    });
    if (!response.ok) {
      throw new Error(await problem(response));
    }
    await this.store(await response.json() as TokenPair);
  }

  async logout(): Promise<void> {
    const refresh = localStorage.getItem(REFRESH_KEY);
    const token = this.access();
    this.clear();
    if (!refresh || !token) {
      return;
    }
    await request('/oauth/revoke', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ token: refresh }),
    }).catch(() => undefined);
  }

  async useRefresh(refresh = localStorage.getItem(REFRESH_KEY)): Promise<boolean> {
    if (!refresh) {
      this.clear();
      return false;
    }
    const response = await request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refresh }),
    });
    if (!response.ok) {
      this.clear();
      return false;
    }
    await this.store(await response.json() as TokenPair);
    return true;
  }

  private async store(pair: TokenPair): Promise<void> {
    this.access.set(pair.access_token);
    localStorage.setItem(REFRESH_KEY, pair.refresh_token);
    const me = await request('/users/me', {
      headers: { Authorization: `Bearer ${pair.access_token}` },
    });
    if (!me.ok) {
      this.clear();
      throw new Error(await problem(me));
    }
    this.account.set(await me.json() as Account);
  }

  private clear(): void {
    this.access.set(null);
    this.account.set(null);
    localStorage.removeItem(REFRESH_KEY);
  }
}

export const signedIn: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);
  const ok = await session.ready();
  return ok ? true : router.createUrlTree(['/login']);
};

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${API}${path}`, { ...init, headers });
}

export async function problem(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: string; error_description?: string };
    return body.message || body.error_description || 'The request failed.';
  } catch {
    return 'The request failed.';
  }
}
