import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from './api';
import { categoryPicture } from './category-pictures';
import { euro } from './money';
import { CatalogProduct, ShoppingList } from './models';

interface CategoryChoice {
  name: string;
  products: number;
}

@Component({
  selector: 'app-catalog',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './catalog-page.html',
})
export class CatalogPage {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private forms = inject(FormBuilder);
  readonly path = signal('');
  readonly categories = signal<CategoryChoice[]>([]);
  readonly products = signal<CatalogProduct[] | null>(null);
  readonly total = signal(0);
  readonly chains = signal<string[]>([]);
  readonly lists = signal<ShoppingList[]>([]);
  readonly error = signal('');
  readonly notice = signal('');
  readonly loading = signal(true);
  readonly euro = euro;
  readonly limit = 24;
  readonly form = this.forms.nonNullable.group({
    q: [''],
    chain: [''],
    sort: ['price'],
    offset: [0],
  });

  constructor() {
    void this.api.get<{ chains: string[] }>('/catalog/chains').then((body) => this.chains.set(body.chains));
    void this.api.get<{ lists: ShoppingList[] }>('/lists').then((body) => {
      this.lists.set(body.lists.filter((list) => list.status === 'open'));
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const path = params.get('path') || '';
      this.path.set(path);
      this.form.patchValue({
        q: params.get('q') || '',
        chain: params.get('chain') || '',
        sort: params.get('sort') === 'name' ? 'name' : 'price',
        offset: Number(params.get('offset') || 0),
      }, { emitEvent: false });
      void this.load(path);
    });
  }

  crumbs(): string[] {
    return this.path() ? this.path().split(' > ') : [];
  }

  crumbPath(index: number): string {
    return this.crumbs().slice(0, index + 1).join(' > ');
  }

  parentLabel(): string {
    const crumbs = this.crumbs();
    return crumbs.length <= 1 ? 'All categories' : crumbs[crumbs.length - 2];
  }

  picture(name: string): string {
    return categoryPicture(this.path(), name);
  }

  productPicture(product: CatalogProduct): string {
    const parts = (product.category_path || '').split(' > ').filter(Boolean);
    const name = parts.pop() || product.name;
    return categoryPicture(parts.join(' > '), name);
  }

  async back(): Promise<void> {
    const crumbs = this.crumbs();
    const path = crumbs.length <= 1 ? '' : crumbs.slice(0, -1).join(' > ');
    await this.show({ path, offset: 0 });
  }

  detail(product: CatalogProduct): string {
    const bits = [product.chain_name];
    if (product.unit_price_text) {
      bits.push(product.unit_price_text);
    }
    const leaf = product.category_path?.split(' > ').at(-1);
    if (leaf && leaf !== this.crumbs().at(-1)) {
      bits.push(leaf);
    }
    return bits.join(' · ');
  }

  async choose(name: string): Promise<void> {
    const path = this.path() ? `${this.path()} > ${name}` : name;
    await this.show({ path, offset: 0 });
  }

  async show(change: { path?: string; offset?: number }): Promise<void> {
    const value = this.form.getRawValue();
    await this.router.navigate(['/'], {
      queryParams: {
        path: change.path === undefined ? this.path() : change.path,
        q: value.q.trim(),
        chain: value.chain,
        sort: value.sort,
        offset: change.offset ?? 0,
      },
    });
  }

  async applyFilters(): Promise<void> {
    await this.show({ offset: 0 });
  }

  async page(next: number): Promise<void> {
    await this.show({ offset: Math.max(0, next) });
  }

  async add(product: CatalogProduct, listId: string): Promise<void> {
    if (!listId) {
      return;
    }
    this.error.set('');
    try {
      await this.api.post(`/lists/${listId}/items`, { product_id: product.id, quantity: 1 });
      this.notice.set(`Added ${product.name}.`);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The product was not added.');
    }
  }

  private async load(path: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    const value = this.form.getRawValue();
    try {
      const categories = await this.api.get<{ categories: CategoryChoice[] }>(
        `/catalog/categories?path=${encodeURIComponent(path)}`,
      );
      this.categories.set(categories.categories);
      const query = value.q.trim();
      if (!path && !query && !value.chain) {
        this.products.set(null);
        this.total.set(0);
        return;
      }
      const params = new URLSearchParams({
        path,
        q: query,
        chain: value.chain,
        sort: value.sort,
        offset: String(value.offset || 0),
        limit: String(this.limit),
      });
      const body = await this.api.get<{ products: CatalogProduct[]; total: number }>(`/catalog/products?${params}`);
      this.products.set(body.products);
      this.total.set(body.total);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The catalog did not load.');
      this.products.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
