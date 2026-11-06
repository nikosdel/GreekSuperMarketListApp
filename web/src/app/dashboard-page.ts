import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from './api';
import { TranslatePipe, WhenPipe } from './language';
import { ShoppingList } from './models';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, TranslatePipe, WhenPipe],
  templateUrl: './dashboard-page.html',
})
export class DashboardPage {
  private api = inject(Api);
  readonly lists = signal<ShoppingList[] | null>(null);
  readonly error = signal('');

  constructor() {
    void this.loadHome();
  }

  openLists(): ShoppingList[] {
    return (this.lists() ?? []).filter((list) => list.status === 'open');
  }

  savedLists(): ShoppingList[] {
    return (this.lists() ?? []).filter((list) => list.status === 'saved');
  }

  private async loadHome(): Promise<void> {
    this.error.set('');
    try {
      const body = await this.api.get<{ lists: ShoppingList[] }>('/lists');
      this.lists.set(body.lists);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The home screen did not load.');
    }
  }
}
