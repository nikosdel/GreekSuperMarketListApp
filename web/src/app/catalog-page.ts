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
  path?: string;
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
  readonly categories = signal<CategoryChoice[]>([]);
  readonly subcategories = signal<CategoryChoice[]>([]);
  readonly selectedCategories = signal<string[]>([]);
  readonly selectedSubcategories = signal<string[]>([]);
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
      const legacyPath = params.get('path') || '';
      const legacyParts = legacyPath ? legacyPath.split(' > ') : [];
      const categories = params.getAll('category');
      const subcategories = params.getAll('subcategory');
      const selectedSubcategories = subcategories.length
        ? subcategories
        : legacyParts.length > 1 ? [legacyParts.join(' > ')] : [];
      this.selectedCategories.set(
        categories.length
          ? categories
          : legacyParts.length ? legacyParts.slice(0, 1) : selectedSubcategories.map((path) => path.split(' > ')[0]),
      );
      this.selectedSubcategories.set(selectedSubcategories);
      this.form.patchValue({
        q: params.get('q') || '',
        chain: params.get('chain') || '',
        sort: params.get('sort') === 'name' ? 'name' : 'price',
        offset: Number(params.get('offset') || 0),
      }, { emitEvent: false });
      void this.load();
    });
  }

  heading(): string {
    const value = this.form.getRawValue();
    return value.q.trim() || value.chain || this.selectedCategories().length || this.selectedSubcategories().length
      ? this.language.translate('catalog.results')
      : this.language.translate('catalog.title');
  }

  subcategoryName(path: string): string {
    return path.split(' > ').at(-1) || path;
  }

  toggleCategory(category: string, checked: boolean): void {
    const selected = this.selectedCategories();
    const next = checked
      ? [...selected, category]
      : selected.filter((item) => item !== category);
    this.selectedCategories.set(next);
    this.selectedSubcategories.update((paths) =>
      paths.filter((path) => next.some((parent) => path.startsWith(`${parent} > `))),
    );
    void this.applyFilters();
  }

  toggleSubcategory(path: string, checked: boolean): void {
    const selected = this.selectedSubcategories();
    this.selectedSubcategories.set(
      checked ? [...selected, path] : selected.filter((item) => item !== path),
    );
    void this.applyFilters();
  }

  removeCategoryFilter(category: string): void {
    this.selectedCategories.update((items) => items.filter((item) => item !== category));
    this.selectedSubcategories.update((paths) =>
      paths.filter((path) => !path.startsWith(`${category} > `)),
    );
    void this.applyFilters();
  }

  removeSubcategoryFilter(path: string): void {
    this.selectedSubcategories.update((items) => items.filter((item) => item !== path));
    void this.applyFilters();
  }

  removeShopFilter(): void {
    this.form.controls.chain.setValue('');
    void this.applyFilters();
  }

  removeSearchFilter(): void {
    this.form.controls.q.setValue('');
    void this.applyFilters();
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

  async show(change: { offset?: number } = {}): Promise<void> {
    const value = this.form.getRawValue();
    await this.router.navigate(['/catalog'], {
      queryParams: {
        path: null,
        category: this.selectedCategories().length ? this.selectedCategories() : null,
        subcategory: this.selectedSubcategories().length ? this.selectedSubcategories() : null,
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
    void this.applyFilters();
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

  private async load(): Promise<void> {
    const ticket = ++this.loadTicket;
    this.loading.set(true);
    this.error.set('');
    const value = this.form.getRawValue();
    const query = value.q.trim();
    this.categories.set([]);
    this.subcategories.set([]);
    this.products.set(null);
    this.total.set(0);
    try {
      const categoriesBody = await this.api.get<{
        categories: Array<{ name: string; image_url?: string | null; products: number }>;
      }>('/catalog/categories');
      if (ticket !== this.loadTicket) {
        return;
      }
      this.categories.set(categoriesBody.categories.map((category) => ({
        ...category,
        image_url: category.image_url ?? null,
      })));
      const selectedCategories = this.selectedCategories();
      if (selectedCategories.length) {
        const subcategoryResults = await Promise.all(selectedCategories.map(async (category) => {
          const response = await this.api.get<{ categories: CategoryChoice[] }>(
            `/catalog/categories?path=${encodeURIComponent(category)}`,
          );
          return response.categories.map((subcategory) => ({
            ...subcategory,
            image_url: subcategory.image_url ?? null,
            path: `${category} > ${subcategory.name}`,
          }));
        }));
        if (ticket !== this.loadTicket) {
          return;
        }
        this.subcategories.set(subcategoryResults.flat());
      }
      const params = new URLSearchParams({
        q: query,
        chain: value.chain,
        sort: value.sort,
        offset: String(value.offset || 0),
        limit: String(this.limit),
      });
      for (const category of selectedCategories) {
        params.append('category', category);
      }
      for (const subcategory of this.selectedSubcategories()) {
        params.append('subcategory', subcategory);
      }
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
