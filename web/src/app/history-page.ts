import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from './api';
import { TranslatePipe, WhenPipe } from './language';
import { ShoppingList } from './models';

@Component({
  selector: 'app-history',
  imports: [RouterLink, TranslatePipe, WhenPipe],
  templateUrl: './history-page.html',
})
export class HistoryPage {
  private api = inject(Api);
  readonly lists = signal<ShoppingList[] | null>(null);
  readonly error = signal('');

  constructor() {
    void this.load();
  }

  saved(): ShoppingList[] {
    return (this.lists() ?? []).filter((list) => list.status === 'saved');
  }

  async load(): Promise<void> {
    try {
      const body = await this.api.get<{ lists: ShoppingList[] }>('/lists');
      this.lists.set(body.lists);
    } catch (error) {
      this.lists.set([]);
      this.error.set(error instanceof Error ? error.message : 'History did not load.');
    }
  }
}
