import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from './api';
import { Basket } from './basket';
import { normalizeCatalogProducts } from './catalog-products';
import { EuroPipe, Language, QuantityPipe, TranslatePipe, WhenPipe } from './language';
import { CatalogChain, CatalogOffer, CatalogProductGroup, ListDetail, ListItem } from './models';

interface CategoryChoice {
  name: string;
  image_url: string | null;
  products: number;
}

interface BasketStoreGroup {
  chainName: string;
  logoUrl: string | null;
  items: ListItem[];
  total: number | null;
}

@Component({
  selector: 'app-catalog',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, EuroPipe, WhenPipe, QuantityPipe],
  templateUrl: './catalog-page.html',
})
export class CatalogPage {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private forms = inject(FormBuilder);
  private basket = inject(Basket);
  private language = inject(Language);
  readonly path = signal('');
  readonly categories = signal<CategoryChoice[]>([]);
  readonly products = signal<CatalogProductGroup[] | null>(null);
  readonly total = signal(0);
  readonly chains = signal<CatalogChain[]>([]);
  readonly shopsOpen = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly loading = signal(true);
  readonly basketDetail = signal<ListDetail | null>(null);
  readonly basketLoading = signal(false);
  readonly basketSaving = signal(false);
  readonly basketUpdatingItemId = signal<number | null>(null);
  readonly basketOpen = signal(
    typeof window === 'undefined' || !window.matchMedia('(max-width: 820px)').matches,
  );
  readonly basketGroups = computed<BasketStoreGroup[]>(() => {
    const detail = this.basketDetail();
    if (!detail) {
      return [];
    }

    const groups = new Map<string, { chainName: string; logoUrl: string | null; items: ListItem[] }>();
    for (const item of detail.items) {
      const chainName = item.chain_name.trim();
      const key = chainName.toLocaleLowerCase();
      const group = groups.get(key) ?? { chainName, logoUrl: item.logo_url || item.chain_logo_url, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }

    return [...groups.values()]
      .sort((left, right) => left.chainName.localeCompare(right.chainName))
      .map((group) => {
        const prices = group.items.map((item) => item.current_price);
        const total = prices.every((price): price is number => price !== null)
          ? prices.reduce(
              (sum, price, index) => sum + price * Number(group.items[index].quantity),
              0,
            )
          : null;
        return { ...group, total };
      });
  });
  readonly basketTotal = computed<number | null>(() => {
    const groups = this.basketGroups();
    return groups.length && groups.every((group) => group.total !== null)
      ? groups.reduce((sum, group) => sum + (group.total ?? 0), 0)
      : null;
  });
  readonly selectedProduct = signal<CatalogProductGroup | null>(null);
  readonly selectedOfferId = signal<number | null>(null);
  readonly adding = signal(false);
  readonly limit = 24;
  readonly form = this.forms.nonNullable.group({
    q: [''],
    chain: [''],
    sort: ['price'],
    offset: [0],
  });
  private loadTicket = 0;
  private basketTicket = 0;

  constructor() {
    void this.loadChains();
    void this.loadOpenLists();
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

  parentQuery(): { path?: string } {
    const crumbs = this.crumbs();
    if (crumbs.length <= 1) {
      return {};
    }
    return { path: crumbs.slice(0, -1).join(' > ') };
  }

  heading(): string {
    if (this.path()) {
      return this.crumbs().at(-1) || this.language.translate('catalog.categories');
    }
    const value = this.form.getRawValue();
    return value.q.trim() || value.chain
      ? this.language.translate('catalog.results')
      : this.language.translate('catalog.categories');
  }

  showCategoryChoices(): boolean {
    const value = this.form.getRawValue();
    return Boolean(this.path()) || (!value.q.trim() && !value.chain);
  }

  shelfQuery(name: string): { path: string } {
    return { path: this.categoryPath(name) };
  }

  categoryPath(name: string): string {
    return this.path() ? `${this.path()} > ${name}` : name;
  }

  selectCategory(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.value !== this.path()) {
      void this.show({ path: target.value, offset: 0 });
    }
  }

  activeList() {
    return this.basket.active();
  }

  openLists() {
    return this.basket.lists();
  }

  selectList(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }
    const id = Number(target.value);
    if (Number.isSafeInteger(id) && this.basket.lists().some((list) => list.id === id)) {
      this.basket.choose(id);
      void this.loadBasketDetail(id);
    }
  }

  toggleBasket(): void {
    this.basketOpen.update((open) => !open);
  }

  itemPrice(item: ListItem): number | null {
    return item.current_price;
  }

  async changeBasketQuantity(itemId: number, input: HTMLInputElement): Promise<void> {
    const list = this.activeList();
    const detail = this.basketDetail();
    if (!list || !detail || detail.status !== 'open') {
      return;
    }

    const item = detail.items.find((row) => row.id === itemId);
    const value = input.value.trim();
    const quantity = Number(value);
    if (value && Number.isFinite(quantity) && quantity <= 0) {
      await this.removeBasketItem(itemId);
      return;
    }
    if (!value || !Number.isSafeInteger(quantity) || quantity > 9999) {
      input.value = String(Number(item?.quantity ?? 1));
      this.error.set(this.language.translate('list.quantityWhole'));
      return;
    }

    this.basketUpdatingItemId.set(itemId);
    this.error.set('');
    try {
      await this.api.patch(`/lists/${list.id}/items/${itemId}`, { quantity });
      await this.loadBasketDetail(list.id);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.language.translate('error.save'));
      input.value = String(Number(item?.quantity ?? 1));
    } finally {
      this.basketUpdatingItemId.set(null);
    }
  }

  async removeBasketItem(itemId: number): Promise<void> {
    const list = this.activeList();
    if (!list) {
      return;
    }

    this.basketUpdatingItemId.set(itemId);
    this.error.set('');
    try {
      await this.api.delete(`/lists/${list.id}/items/${itemId}`);
      await this.loadBasketDetail(list.id);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.language.translate('error.save'));
    } finally {
      this.basketUpdatingItemId.set(null);
    }
  }

  async saveBasketList(): Promise<void> {
    const list = this.activeList();
    if (!list || this.basketSaving()) {
      return;
    }

    this.basketSaving.set(true);
    this.error.set('');
    try {
      await this.api.post(`/lists/${list.id}/save`);
      this.notice.set(this.language.translate('list.savedNotice'));
      await this.loadOpenLists();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.language.translate('error.save'));
    } finally {
      this.basketSaving.set(false);
    }
  }

  resultRange(): string {
    const start = this.total() === 0 ? 0 : this.form.controls.offset.value + 1;
    const end = Math.min(this.form.controls.offset.value + this.limit, this.total());
    return `${start}–${end} / ${this.total()}`;
  }

  openOffers(product: CatalogProductGroup): void {
    this.selectedProduct.set(product);
    this.selectedOfferId.set(null);
  }

  onImageError(event: Event): void {
    if (event.target instanceof HTMLImageElement) {
      event.target.hidden = true;
      event.target.closest('.category-image')?.classList.remove('has-image');
    }
  }

  closeOffers(): void {
    this.selectedProduct.set(null);
    this.selectedOfferId.set(null);
  }

  chooseOffer(offer: CatalogOffer): void {
    this.selectedOfferId.set(offer.id);
  }

  async show(change: { path?: string; offset?: number }): Promise<void> {
    const value = this.form.getRawValue();
    await this.router.navigate(['/catalog'], {
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

  async addSelectedOffer(): Promise<void> {
    const product = this.selectedProduct();
    const offer = product?.offers.find((item) => item.id === this.selectedOfferId());
    if (!product || !offer || this.adding()) {
      return;
    }
    const list = this.activeList();
    if (!list) {
      this.closeOffers();
      this.notice.set(this.language.translate('catalog.noList'));
      await this.router.navigateByUrl('/lists');
      return;
    }
    this.adding.set(true);
    this.error.set('');
    try {
      await this.api.post(`/lists/${list.id}/items`, { product_id: offer.id, quantity: 1 });
      this.notice.set(this.language.translate('list.added', { product: product.name }));
      this.closeOffers();
      await this.loadBasketDetail(list.id);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.language.translate('error.save'));
    } finally {
      this.adding.set(false);
    }
  }

  private async loadOpenLists(): Promise<void> {
    try {
      await this.basket.load();
      await this.loadBasketDetail(this.activeList()?.id);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.language.translate('error.load'));
    }
  }

  private async loadBasketDetail(id = this.activeList()?.id): Promise<void> {
    const ticket = ++this.basketTicket;
    if (!id) {
      this.basketDetail.set(null);
      this.basketLoading.set(false);
      return;
    }

    this.basketLoading.set(true);
    try {
      const detail = await this.api.get<ListDetail>(`/lists/${id}`);
      if (ticket === this.basketTicket && this.activeList()?.id === id) {
        this.basketDetail.set(detail);
      }
    } catch (error) {
      if (ticket === this.basketTicket) {
        this.basketDetail.set(null);
        this.error.set(error instanceof Error ? error.message : this.language.translate('error.load'));
      }
    } finally {
      if (ticket === this.basketTicket) {
        this.basketLoading.set(false);
      }
    }
  }

  selectedChain(): CatalogChain | undefined {
    const name = this.form.controls.chain.value;
    return this.chains().find((chain) => chain.name === name);
  }

  toggleShops(event: Event): void {
    event.stopPropagation();
    this.shopsOpen.update((open) => !open);
  }

  pickShop(name: string): void {
    this.form.controls.chain.setValue(name);
    this.shopsOpen.set(false);
  }

  @HostListener('document:click')
  closeShops(): void {
    this.shopsOpen.set(false);
  }

  private async loadChains(): Promise<void> {
    try {
      const body = await this.api.get<{ chains: CatalogChain[] }>('/catalog/chains');
      this.chains.set(body.chains);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.language.translate('error.load'));
    }
  }

  private async load(path: string): Promise<void> {
    const ticket = ++this.loadTicket;
    this.loading.set(true);
    this.error.set('');
    const value = this.form.getRawValue();
    const query = value.q.trim();
    const browsing = !query && !value.chain;
    this.categories.set([]);
    this.products.set(null);
    this.total.set(0);
    try {
      const categoriesBody = await this.api.get<{
        categories: Array<{ name: string; image_url?: string | null; products: number }>;
      }>(`/catalog/categories?path=${encodeURIComponent(path)}`);
      if (ticket !== this.loadTicket) {
        return;
      }
      this.categories.set(categoriesBody.categories.map((category) => ({
        ...category,
        image_url: category.image_url ?? null,
      })));
      if (browsing && !path) {
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
      const body = await this.api.get<{ products: unknown[]; total?: number }>(
        `/catalog/products?${params}`,
      );
      if (ticket !== this.loadTicket) {
        return;
      }
      const products = normalizeCatalogProducts(body.products);
      this.products.set(products);
      this.total.set(body.total ?? products.length);
    } catch (error) {
      if (ticket === this.loadTicket) {
        this.error.set(error instanceof Error ? error.message : this.language.translate('error.load'));
        this.products.set([]);
        this.total.set(0);
      }
    } finally {
      if (ticket === this.loadTicket) {
        this.loading.set(false);
      }
    }
  }
}
