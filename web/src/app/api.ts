import { Injectable, inject } from '@angular/core';
import { Session, problem, request } from './session';

@Injectable({ providedIn: 'root' })
export class Api {
  private session = inject(Session);

  get<T>(path: string): Promise<T> {
    return this.send<T>(path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.send<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }

  delete(path: string): Promise<void> {
    return this.send<void>(path, { method: 'DELETE' });
  }

  private async send<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const token = this.session.accessToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const response = await request(path, { ...init, headers });
    if (response.status === 401 && retry && await this.session.useRefresh()) {
      return this.send(path, init, false);
    }
    if (!response.ok) {
      throw new Error(await problem(response));
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }
}
