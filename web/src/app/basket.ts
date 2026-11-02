import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api';
import { ShoppingList } from './models';

const KEY = 'supermarket.activeList';

@Injectable({ providedIn: 'root' })
export class Basket {
  private api = inject(Api);
  readonly lists = signal<ShoppingList[]>([]);
  readonly activeId = signal<number | null>(readId());

  active(): ShoppingList | undefined {
    return this.lists().find((list) => list.id === this.activeId());
  }

  async load(): Promise<void> {
    const body = await this.api.get<{ lists: ShoppingList[] }>('/lists');
    const open = body.lists.filter((list) => list.status === 'open');
    this.lists.set(open);
    if (!open.some((list) => list.id === this.activeId())) {
      this.choose(open[0]?.id ?? null);
    }
  }

  choose(id: number | null): void {
    this.activeId.set(id);
    if (id) {
      localStorage.setItem(KEY, String(id));
    } else {
      localStorage.removeItem(KEY);
    }
  }
}

function readId(): number | null {
  const id = Number(localStorage.getItem(KEY));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
