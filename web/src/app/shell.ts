import { Component, DestroyRef, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { Api } from './api';
import { Basket } from './basket';
import { when } from './money';
import { Notice } from './models';
import { Session } from './session';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
})
export class Shell {
  private session = inject(Session);
  private router = inject(Router);
  private api = inject(Api);
  private bellRoot = viewChild<ElementRef<HTMLElement>>('bellRoot');
  private basket = inject(Basket);
  readonly account = this.session.account;
  readonly openLists = this.basket.lists;
  readonly activeId = this.basket.activeId;
  readonly menuOpen = signal(false);
  readonly bellOpen = signal(false);
  readonly notices = signal<Notice[]>([]);
  readonly unread = signal(0);
  readonly section = signal('Catalog');
  readonly when = when;

  constructor() {
    this.followRoute(this.router.url);
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((event) => {
      this.followRoute(event.urlAfterRedirects);
      this.menuOpen.set(false);
    });
    void this.basket.load().catch(() => undefined);
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

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
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
    } catch {
      this.unread.set(0);
    }
  }

  async openNotice(notice: Notice): Promise<void> {
    this.bellOpen.set(false);
    if (!notice.read_at) {
      await this.api.post(`/notifications/${notice.id}/read`).catch(() => undefined);
      this.unread.update((count) => Math.max(0, count - 1));
      this.notices.update((rows) => rows.map((row) => row.id === notice.id ? { ...row, read_at: new Date().toISOString() } : row));
    }
    await this.router.navigate(['/lists', notice.list_id]);
  }

  chooseList(raw: string): void {
    const id = Number(raw);
    if (Number.isSafeInteger(id) && id > 0) {
      this.basket.choose(id);
    }
  }

  cartLink(): string[] {
    const id = this.activeId();
    return id ? ['/lists', String(id)] : ['/lists'];
  }

  async logout(): Promise<void> {
    await this.session.logout();
    await this.router.navigateByUrl('/login');
  }

  private followRoute(url: string): void {
    if (url.startsWith('/history')) {
      this.section.set('History');
    } else if (url.startsWith('/lists')) {
      this.section.set('Lists');
    } else {
      this.section.set('Catalog');
    }
  }
}
