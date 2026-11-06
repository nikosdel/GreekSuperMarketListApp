import { Component, DestroyRef, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { Api } from './api';
import { Language, TranslatePipe, WhenPipe } from './language';
import { Notice } from './models';
import { Session } from './session';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe, WhenPipe],
  templateUrl: './shell.html',
})
export class Shell {
  private session = inject(Session);
  private router = inject(Router);
  private api = inject(Api);
  private bellRoot = viewChild<ElementRef<HTMLElement>>('bellRoot');
  private languageService = inject(Language);
  readonly account = this.session.account;
  readonly language = this.languageService;
  readonly bellOpen = signal(false);
  readonly notices = signal<Notice[]>([]);
  readonly unread = signal(0);
  readonly noticeError = signal('');

  constructor() {
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      this.bellOpen.set(false);
    });
    void this.loadNotices();
    const timer = setInterval(() => void this.loadNotices(), 30000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  @HostListener('document:click', ['$event'])
  closeBell(event: MouseEvent): void {
    const root = this.bellRoot()?.nativeElement;
    if (!this.bellOpen() || !root || root.contains(event.target as Node)) {
      return;
    }
    this.bellOpen.set(false);
  }

  toggleBell(event: Event): void {
    event.stopPropagation();
    this.bellOpen.update((open) => !open);
  }

  async loadNotices(): Promise<void> {
    try {
      const body = await this.api.get<{ notifications: Notice[]; unread_count: number }>('/notifications');
      this.notices.set(body.notifications);
      this.unread.set(body.unread_count);
      this.noticeError.set('');
    } catch (error) {
      this.noticeError.set(error instanceof Error ? error.message : this.language.translate('notices.error'));
    }
  }

  async openNotice(notice: Notice): Promise<void> {
    if (!notice.read_at) {
      try {
        await this.api.post(`/notifications/${notice.id}/read`);
        this.unread.update((count) => Math.max(0, count - 1));
        this.notices.update((rows) => rows.map((row) =>
          row.id === notice.id ? { ...row, read_at: new Date().toISOString() } : row,
        ));
      } catch (error) {
        this.noticeError.set(error instanceof Error ? error.message : this.language.translate('error.save'));
        return;
      }
    }
    this.bellOpen.set(false);
    await this.router.navigate(['/lists', notice.list_id]);
  }

  async logout(): Promise<void> {
    await this.session.logout();
    await this.router.navigateByUrl('/login');
  }
}
