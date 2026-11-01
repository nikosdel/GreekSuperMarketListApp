import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from './api';
import { when } from './money';
import { Notice } from './models';

@Component({
  selector: 'app-notices',
  imports: [RouterLink],
  templateUrl: './notices-page.html',
})
export class NoticesPage {
  private api = inject(Api);
  readonly notices = signal<Notice[] | null>(null);
  readonly error = signal('');
  readonly when = when;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    try {
      const body = await this.api.get<{ notifications: Notice[] }>('/notifications');
      this.notices.set(body.notifications);
    } catch (error) {
      this.notices.set([]);
      this.error.set(error instanceof Error ? error.message : 'Notices did not load.');
    }
  }

  async markRead(notice: Notice): Promise<void> {
    if (notice.read_at) {
      return;
    }
    try {
      await this.api.post(`/notifications/${notice.id}/read`);
      this.notices.update((rows) =>
        (rows ?? []).map((row) => row.id === notice.id ? { ...row, read_at: new Date().toISOString() } : row),
      );
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'That notice stayed unread.');
    }
  }
}
