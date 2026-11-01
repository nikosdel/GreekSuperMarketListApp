import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api } from './api';
import { amount, euro, when } from './money';
import { CatalogProduct, ListDetail } from './models';

@Component({
  selector: 'app-list',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './list-page.html',
})
export class ListPage {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private forms = inject(FormBuilder);
  readonly list = signal<ListDetail | null>(null);
  readonly results = signal<CatalogProduct[]>([]);
  readonly error = signal('');
  readonly notice = signal('');
  readonly searching = signal(false);
  readonly euro = euro;
  readonly amount = amount;
  readonly when = when;
  readonly form = this.forms.nonNullable.group({ query: [''] });

  constructor() {
    this.route.paramMap.subscribe((params) => {
      const id = Number(params.get('id'));
      if (Number.isSafeInteger(id) && id > 0) {
        void this.load(id);
      }
    });
  }

  linePrice(item: ListDetail['items'][number]): number | null {
    const list = this.list();
    if (!list) {
      return null;
    }
    return list.status === 'saved' ? item.price_at_save : item.current_price;
  }

  lineUnit(item: ListDetail['items'][number]): string | null {
    const list = this.list();
    if (!list) {
      return null;
    }
    if (list.status === 'saved') {
      return item.unit_price_at_save === null ? null : `${euro(item.unit_price_at_save)} unit`;
    }
    return item.unit_price_text;
  }

  async load(id = this.list()?.id): Promise<void> {
    if (!id) {
      return;
    }
    this.error.set('');
    try {
      this.list.set(await this.api.get<ListDetail>(`/lists/${id}`));
    } catch (error) {
      this.list.set(null);
      this.error.set(error instanceof Error ? error.message : 'That list is not available.');
    }
  }

  async search(): Promise<void> {
    const query = this.form.controls.query.value.trim();
    if (query.length < 2) {
      this.error.set('Type at least two letters of the product name.');
      return;
    }
    this.searching.set(true);
    this.error.set('');
    try {
      const body = await this.api.get<{ products: CatalogProduct[] }>(`/catalog/search?q=${encodeURIComponent(query)}`);
      this.results.set(body.products);
      if (!body.products.length) {
        this.notice.set('No catalog products matched that name.');
      } else {
        this.notice.set('');
      }
    } catch (error) {
      this.results.set([]);
      this.error.set(error instanceof Error ? error.message : 'The search failed.');
    } finally {
      this.searching.set(false);
    }
  }

  async add(product: CatalogProduct): Promise<void> {
    const list = this.list();
    if (!list) {
      return;
    }
    this.error.set('');
    try {
      await this.api.post(`/lists/${list.id}/items`, { product_id: product.id, quantity: 1 });
      this.notice.set(`Added ${product.name}.`);
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The product was not added.');
    }
  }

  async changeQuantity(itemId: number, raw: string): Promise<void> {
    const list = this.list();
    const quantity = Number(raw);
    if (!list || !Number.isFinite(quantity) || quantity <= 0) {
      return;
    }
    this.error.set('');
    try {
      await this.api.patch(`/lists/${list.id}/items/${itemId}`, { quantity });
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The quantity was not changed.');
    }
  }

  async remove(itemId: number): Promise<void> {
    const list = this.list();
    if (!list) {
      return;
    }
    this.error.set('');
    try {
      await this.api.delete(`/lists/${list.id}/items/${itemId}`);
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The product was not removed.');
    }
  }

  async save(): Promise<void> {
    const list = this.list();
    if (!list) {
      return;
    }
    this.error.set('');
    try {
      await this.api.post(`/lists/${list.id}/save`);
      this.results.set([]);
      this.notice.set('Saved. The prices are locked.');
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The list was not saved.');
    }
  }

  async copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      this.notice.set('Invite code copied.');
    } catch {
      this.notice.set(code);
    }
  }
}
