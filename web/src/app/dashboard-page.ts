import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Api } from './api';
import { Basket } from './basket';
import { categoryPicture } from './category-pictures';
import { euro, when } from './money';
import { ListDetail, ShoppingList } from './models';

interface CategoryChoice {
  name: string;
  products: number;
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard-page.html',
})
export class DashboardPage {
  private api = inject(Api);
  private basket = inject(Basket);
  readonly categories = signal<CategoryChoice[]>([]);
  readonly allLists = signal<ShoppingList[] | null>(null);
  readonly detail = signal<ListDetail | null>(null);
  readonly error = signal('');
  readonly euro = euro;
  readonly when = when;
  readonly activeId = this.basket.activeId;
  private detailTicket = 0;

  constructor() {
    toObservable(this.basket.activeId).pipe(takeUntilDestroyed()).subscribe((id) => {
      void this.loadDetail(id);
    });
    void this.loadHome();
  }

  picture(name: string): string {
    return categoryPicture('', name);
  }

  openLists(): ShoppingList[] {
    return (this.allLists() ?? []).filter((list) => list.status === 'open');
  }

  savedLists(): ShoppingList[] {
    return (this.allLists() ?? []).filter((list) => list.status === 'saved');
  }

  activeList(): ShoppingList | undefined {
    return this.openLists().find((list) => list.id === this.activeId()) ?? this.basket.active();
  }

  preview(): ListDetail['items'] {
    return this.detail()?.items.slice(0, 5) ?? [];
  }

  moreCount(): number {
    const total = this.detail()?.items.length ?? 0;
    return Math.max(0, total - this.preview().length);
  }

  listTotal(): number | null {
    const list = this.detail();
    if (!list?.items.length) {
      return list ? 0 : null;
    }
    let sum = 0;
    let priced = false;
    for (const item of list.items) {
      if (item.current_price === null) {
        continue;
      }
      priced = true;
      sum += item.current_price * Number(item.quantity);
    }
    return priced ? sum : 0;
  }

  private async loadHome(): Promise<void> {
    this.error.set('');
    try {
      const [categories, lists] = await Promise.all([
        this.api.get<{ categories: CategoryChoice[] }>('/catalog/categories?path='),
        this.api.get<{ lists: ShoppingList[] }>('/lists'),
      ]);
      this.categories.set(categories.categories);
      this.allLists.set(lists.lists);
      await this.basket.load();
    } catch (error) {
      this.categories.set([]);
      this.allLists.set([]);
      this.error.set(error instanceof Error ? error.message : 'The home screen did not load.');
    }
  }

  private async loadDetail(id: number | null): Promise<void> {
    const ticket = ++this.detailTicket;
    if (!id) {
      this.detail.set(null);
      return;
    }
    try {
      const detail = await this.api.get<ListDetail>(`/lists/${id}`);
      if (ticket !== this.detailTicket) {
        return;
      }
      this.detail.set(detail.status === 'open' ? detail : null);
    } catch {
      if (ticket === this.detailTicket) {
        this.detail.set(null);
      }
    }
  }
}
