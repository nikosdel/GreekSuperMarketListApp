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
  readonly section = signal('Dashboard');
  readonly places = signal<Place[]>([{ label: 'Dashboard', commands: ['/'], query: {} }]);
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
    const bare = url.split('#')[0];
    const path = bare.split('?')[0];
    const params = new URLSearchParams(bare.includes('?') ? bare.slice(bare.indexOf('?') + 1) : '');
    const home: Place = { label: 'Dashboard', commands: ['/'], query: {} };
    if (path.startsWith('/history')) {
      this.section.set('History');
      this.places.set([home, { label: 'History', commands: ['/history'], query: {} }]);
    } else if (/^\/lists\/\d+/.test(path)) {
      this.section.set('Shopping list');
      this.places.set([
        home,
        { label: 'Lists', commands: ['/lists'], query: {} },
        { label: 'Shopping list', commands: [path], query: {} },
      ]);
    } else if (path.startsWith('/lists')) {
      this.section.set('Lists');
      this.places.set([home, { label: 'Lists', commands: ['/lists'], query: {} }]);
    } else if (path.startsWith('/catalog')) {
      const shelf = params.get('path') || '';
      const crumbs = shelf ? shelf.split(' > ').filter(Boolean) : [];
      const places: Place[] = [home, { label: 'Categories', commands: ['/catalog'], query: {} }];
      crumbs.forEach((name, index) => {
        places.push({
          label: name,
          commands: ['/catalog'],
          query: { path: crumbs.slice(0, index + 1).join(' > ') },
        });
      });
      if (!crumbs.length && (params.get('q') || params.get('chain'))) {
        places.push({ label: 'Products', commands: ['/catalog'], query: Object.fromEntries(params.entries()) });
      }
      this.places.set(places);
      this.section.set(crumbs.at(-1) || (places.at(-1)?.label ?? 'Categories'));
    } else {
      this.section.set('Dashboard');
      this.places.set([home]);
    }
  }
}

interface Place {
  label: string;
  commands: string[];
  query: Record<string, string>;
}
