import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Api } from './api';
import { Basket } from './basket';
import { categoryPicture } from './category-pictures';
import { amount, euro, when } from './money';
import { CatalogProduct, ListDetail, ShoppingList } from './models';

interface CategoryChoice {
  name: string;
  products: number;
}

@Component({
  selector: 'app-dashboard',
  imports: [ReactiveFormsModule],
  templateUrl: './dashboard-page.html',
})
export class DashboardPage {
  private api = inject(Api);
  private forms = inject(FormBuilder);
  private basket = inject(Basket);
  private route = inject(ActivatedRoute);
  readonly path = signal('');
  readonly categories = signal<CategoryChoice[]>([]);
  readonly products = signal<CatalogProduct[] | null>(null);
  readonly total = signal(0);
  readonly chains = signal<string[]>([]);
  readonly allLists = signal<ShoppingList[] | null>(null);
  readonly detail = signal<ListDetail | null>(null);
  readonly catalogError = signal('');
  readonly catalogNotice = signal('');
  readonly listError = signal('');
  readonly listNotice = signal('');
  readonly listsError = signal('');
  readonly loadingShelf = signal(true);
  readonly loadingProducts = signal(false);
  readonly euro = euro;
  readonly amount = amount;
  readonly when = when;
  readonly limit = 12;
  readonly activeId = this.basket.activeId;
  readonly form = this.forms.nonNullable.group({
    q: [''],
    chain: [''],
    sort: ['price'],
    offset: [0],
  });
  readonly listForm = this.forms.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(120)]],
    invite_code: [''],
  });
  private detailTicket = 0;
  private lockedDetailId: number | null = null;
  private skipPicks = new Set<number>();

  constructor() {
    void this.api.get<{ chains: string[] }>('/catalog/chains').then((body) => this.chains.set(body.chains)).catch(() => undefined);
    toObservable(this.basket.pick).pipe(takeUntilDestroyed()).subscribe((pick) => {
      if (this.skipPicks.delete(pick)) {
        return;
      }
      this.lockedDetailId = null;
      void this.loadDetail(this.basket.activeId());
    });
    this.route.fragment.pipe(takeUntilDestroyed()).subscribe((fragment) => {
      if (fragment === 'shopping-list') {
        this.scrollList();
      }
    });
    void this.loadShelf();
    void this.refreshLists();
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

  openLists(): ShoppingList[] {
    return (this.allLists() ?? []).filter((list) => list.status === 'open');
  }

  savedLists(): ShoppingList[] {
    return (this.allLists() ?? []).filter((list) => list.status === 'saved');
  }

  shelfTitle(): string {
    return this.crumbs().at(-1) || 'All categories';
  }

  detailLine(product: CatalogProduct): string {
    const bits = [product.chain_name];
    if (product.unit_price_text) {
      bits.push(product.unit_price_text);
    }
    return bits.join(' · ');
  }

  linePrice(item: ListDetail['items'][number]): number | null {
    const list = this.detail();
    if (!list) {
      return null;
    }
    return list.status === 'saved' ? item.price_at_save : item.current_price;
  }

  lineUnit(item: ListDetail['items'][number]): string | null {
    const list = this.detail();
    if (!list) {
      return null;
    }
    if (list.status === 'saved') {
      return item.unit_price_at_save === null ? null : `${euro(item.unit_price_at_save)} unit`;
    }
    return item.unit_price_text;
  }

  listTotal(): number | null {
    const list = this.detail();
    if (!list) {
      return null;
    }
    let sum = 0;
    let priced = false;
    for (const item of list.items) {
      const price = this.linePrice(item);
      if (price === null) {
        continue;
      }
      priced = true;
      sum += price * Number(item.quantity);
    }
    return priced ? sum : null;
  }

  async chooseCategory(name: string): Promise<void> {
    const path = this.path() ? `${this.path()} > ${name}` : name;
    await this.go(path);
  }

  async back(): Promise<void> {
    const crumbs = this.crumbs();
    const path = crumbs.length <= 1 ? '' : crumbs.slice(0, -1).join(' > ');
    await this.go(path);
  }

  async go(path: string): Promise<void> {
    this.path.set(path);
    this.form.patchValue({ offset: 0 });
    await this.loadShelf();
  }

  async applyFilters(): Promise<void> {
    this.form.patchValue({ offset: 0 });
    await this.loadProducts();
  }

  async page(next: number): Promise<void> {
    this.form.controls.offset.setValue(Math.max(0, next));
    await this.loadProducts();
  }

  async add(product: CatalogProduct): Promise<void> {
    const list = this.basket.active();
    if (!list) {
      this.catalogError.set('Create a list in Open lists, then add products here.');
      document.getElementById('open-lists')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    this.catalogError.set('');
    try {
      await this.api.post(`/lists/${list.id}/items`, { product_id: product.id, quantity: 1 });
      this.catalogNotice.set(`Added ${product.name} to ${list.title}.`);
      this.lockedDetailId = null;
      if (this.basket.activeId() !== list.id) {
        this.basket.choose(list.id);
      }
      await this.loadDetail(list.id);
      await this.refreshLists();
    } catch (error) {
      this.catalogError.set(error instanceof Error ? error.message : 'The product was not added.');
    }
  }

  useOpen(id: number): void {
    this.lockedDetailId = null;
    this.listNotice.set('');
    this.basket.choose(id);
    this.scrollList();
  }

  viewSaved(id: number): void {
    this.lockedDetailId = id;
    this.listNotice.set('');
    void this.loadDetail(id);
    this.scrollList();
  }

  backToOpen(): void {
    this.lockedDetailId = null;
    this.listNotice.set('');
    void this.loadDetail(this.basket.activeId());
  }

  async create(): Promise<void> {
    const title = this.listForm.controls.title.value.trim();
    if (!title) {
      this.listForm.controls.title.markAsTouched();
      return;
    }
    this.listsError.set('');
    try {
      const created = await this.api.post<ShoppingList>('/lists', { title });
      this.listForm.controls.title.setValue('');
      this.lockedDetailId = null;
      this.basket.choose(created.id);
      await this.refreshLists();
      this.listNotice.set(`Created ${created.title}.`);
      this.scrollList();
    } catch (error) {
      this.listsError.set(error instanceof Error ? error.message : 'The list was not created.');
    }
  }

  async join(): Promise<void> {
    const inviteCode = this.listForm.controls.invite_code.value.trim();
    if (!inviteCode) {
      return;
    }
    this.listsError.set('');
    try {
      const joined = await this.api.post<{ list_id: number }>('/lists/join', { invite_code: inviteCode });
      this.listForm.controls.invite_code.setValue('');
      this.lockedDetailId = null;
      this.basket.choose(joined.list_id);
      await this.refreshLists();
      this.listNotice.set('Joined the list.');
      this.scrollList();
    } catch (error) {
      this.listsError.set(error instanceof Error ? error.message : 'That invite code did not match an open list.');
    }
  }

  async copy(code: string | null): Promise<void> {
    if (!code) {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      this.listNotice.set('Invite code copied.');
    } catch {
      this.listNotice.set(code);
    }
  }

  async changeQuantity(itemId: number, raw: string): Promise<void> {
    const list = this.detail();
    const quantity = Number(raw);
    if (!list || list.status !== 'open' || !Number.isFinite(quantity) || quantity <= 0) {
      return;
    }
    this.listError.set('');
    try {
      await this.api.patch(`/lists/${list.id}/items/${itemId}`, { quantity });
      await this.loadDetail(list.id);
      await this.refreshLists();
    } catch (error) {
      this.listError.set(error instanceof Error ? error.message : 'The quantity was not changed.');
    }
  }

  async remove(itemId: number): Promise<void> {
    const list = this.detail();
    if (!list || list.status !== 'open') {
      return;
    }
    this.listError.set('');
    try {
      await this.api.delete(`/lists/${list.id}/items/${itemId}`);
      await this.loadDetail(list.id);
      await this.refreshLists();
    } catch (error) {
      this.listError.set(error instanceof Error ? error.message : 'The product was not removed.');
    }
  }

  async save(): Promise<void> {
    const list = this.detail();
    if (!list || list.status !== 'open') {
      return;
    }
    this.listError.set('');
    try {
      this.lockedDetailId = list.id;
      if (this.basket.activeId() === list.id) {
        this.skipPicks.add(this.basket.pick() + 1);
      }
      await this.api.post(`/lists/${list.id}/save`);
      this.listNotice.set('Saved. The prices are locked.');
      await this.refreshLists();
      await this.loadDetail(list.id);
    } catch (error) {
      this.skipPicks.clear();
      this.lockedDetailId = null;
      this.listError.set(error instanceof Error ? error.message : 'The list was not saved.');
    }
  }

  private async loadShelf(): Promise<void> {
    this.loadingShelf.set(true);
    this.catalogError.set('');
    try {
      const categories = await this.api.get<{ categories: CategoryChoice[] }>(
        `/catalog/categories?path=${encodeURIComponent(this.path())}`,
      );
      this.categories.set(categories.categories);
      await this.loadProducts();
    } catch (error) {
      this.categories.set([]);
      this.catalogError.set(error instanceof Error ? error.message : 'The catalog did not load.');
    } finally {
      this.loadingShelf.set(false);
    }
  }

  private async loadProducts(): Promise<void> {
    const value = this.form.getRawValue();
    const path = this.path();
    const query = value.q.trim();
    if (!path && !query && !value.chain) {
      this.products.set(null);
      this.total.set(0);
      return;
    }
    this.loadingProducts.set(true);
    this.catalogError.set('');
    try {
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
      this.products.set([]);
      this.catalogError.set(error instanceof Error ? error.message : 'The products did not load.');
    } finally {
      this.loadingProducts.set(false);
    }
  }

  private async refreshLists(): Promise<void> {
    try {
      const body = await this.api.get<{ lists: ShoppingList[] }>('/lists');
      this.allLists.set(body.lists);
      await this.basket.load();
    } catch (error) {
      this.allLists.set([]);
      this.listsError.set(error instanceof Error ? error.message : 'The lists did not load.');
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
      this.detail.set(detail);
      this.listError.set('');
    } catch (error) {
      if (ticket !== this.detailTicket) {
        return;
      }
      this.detail.set(null);
      this.listError.set(error instanceof Error ? error.message : 'That list is not available.');
    }
  }

  private scrollList(): void {
    setTimeout(() => {
      document.getElementById('shopping-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 40);
  }
}
