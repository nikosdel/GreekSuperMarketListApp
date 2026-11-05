import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api } from './api';
import { Basket } from './basket';
import { normalizeCatalogProducts } from './catalog-products';
import { EuroPipe, Language, QuantityPipe, TranslatePipe, WhenPipe } from './language';
import { CatalogOffer, CatalogProductGroup, ListDetail, ListItem, Member } from './models';
import { Session } from './session';

interface StoreGroup {
  chainName: string;
  logoUrl: string | null;
  items: ListItem[];
  total: number | null;
}

@Component({
  selector: 'app-list',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, EuroPipe, WhenPipe, QuantityPipe],
  templateUrl: './list-page.html',
})
export class ListPage {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private forms = inject(FormBuilder);
  private basket = inject(Basket);
  private session = inject(Session);
  private language = inject(Language);
  readonly account = this.session.account;
  readonly list = signal<ListDetail | null>(null);
  readonly storeGroups = computed<StoreGroup[]>(() => {
    const list = this.list();
    if (!list) {
      return [];
    }

    const groups = new Map<string, { chainName: string; logoUrl: string | null; items: ListItem[] }>();
    for (const item of list.items) {
      const chainName = item.chain_name.trim();
      const key = chainName.toLocaleLowerCase();
      const group = groups.get(key) ?? { chainName, logoUrl: item.chain_logo_url, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }

    return [...groups.values()]
      .sort((left, right) => left.chainName.localeCompare(right.chainName))
      .map((group) => {
        const prices = group.items.map((item) => this.linePrice(item));
        const total = prices.every((price): price is number => price !== null)
          ? prices.reduce(
              (sum, price, index) => sum + price * Number(group.items[index].quantity),
              0,
            )
          : null;
        return { ...group, total };
      });
  });
  readonly results = signal<CatalogProductGroup[]>([]);
  readonly error = signal('');
  readonly notice = signal('');
  readonly searching = signal(false);
  readonly searched = signal(false);
  readonly adding = signal(false);
  readonly removingMemberId = signal<number | null>(null);
  readonly selectedProduct = signal<CatalogProductGroup | null>(null);
  readonly selectedOfferId = signal<number | null>(null);
  readonly memberDrawerOpen = signal(false);
  readonly form = this.forms.nonNullable.group({ query: [''] });
  private loadTicket = 0;

  constructor() {
    this.route.paramMap.subscribe((params) => {
      const id = Number(params.get('id'));
      if (Number.isSafeInteger(id) && id > 0) {
        void this.load(id);
      }
    });
  }

  isOwner(): boolean {
    return this.list()?.role === 'owner';
  }

  closeMemberDrawer(): void {
    this.memberDrawerOpen.set(false);
  }

  onImageError(event: Event): void {
    if (event.target instanceof HTMLImageElement) {
      event.target.hidden = true;
    }
  }

  linePrice(item: ListDetail['items'][number]): number | null {
    const list = this.list();
    if (!list) {
      return null;
    }
    return list.status === 'saved' ? item.price_at_save : item.current_price;
  }

  listTotal(): number | null {
    const list = this.list();
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

  lineUnit(item: ListDetail['items'][number]): string | null {
    const list = this.list();
    if (!list) {
      return null;
    }
    if (list.status === 'saved') {
      return item.unit_price_at_save === null
        ? null
        : `${this.language.euro(item.unit_price_at_save)} / ${this.language.translate('list.unitPrice')}`;
    }
    return item.unit_price_text;
  }

  async load(id = this.list()?.id): Promise<void> {
    if (!id) {
      return;
    }
    const ticket = ++this.loadTicket;
    this.error.set('');
    try {
      const detail = await this.api.get<ListDetail>(`/lists/${id}`);
      if (ticket !== this.loadTicket) {
        return;
      }
      this.list.set(detail);
      if (detail.status === 'open') {
        this.basket.choose(detail.id);
      }
    } catch (error) {
      if (ticket === this.loadTicket) {
        this.list.set(null);
        this.error.set(error instanceof Error ? error.message : this.language.translate('error.load'));
      }
    }
  }

  async search(): Promise<void> {
    const query = this.form.controls.query.value.trim();
    if (query.length < 2) {
      this.results.set([]);
      this.searched.set(false);
      this.error.set(this.language.translate('error.searchLength'));
      return;
    }
    this.searching.set(true);
    this.searched.set(false);
    this.error.set('');
    this.notice.set('');
    try {
      const body = await this.api.get<{ products: unknown[] }>(
        `/catalog/search?q=${encodeURIComponent(query)}`,
      );
      this.results.set(normalizeCatalogProducts(body.products));
      this.searched.set(true);
    } catch (error) {
      this.results.set([]);
      this.error.set(error instanceof Error ? error.message : this.language.translate('error.load'));
    } finally {
      this.searching.set(false);
    }
  }

  openOffers(product: CatalogProductGroup): void {
    this.selectedProduct.set(product);
    this.selectedOfferId.set(null);
  }

  closeOffers(): void {
    this.selectedProduct.set(null);
    this.selectedOfferId.set(null);
  }

  chooseOffer(offer: CatalogOffer): void {
    this.selectedOfferId.set(offer.id);
  }

  async addSelectedOffer(): Promise<void> {
    const list = this.list();
    const product = this.selectedProduct();
    const offer = product?.offers.find((item) => item.id === this.selectedOfferId());
    if (!list || list.status !== 'open' || !product || !offer || this.adding()) {
      return;
    }
    this.adding.set(true);
    this.error.set('');
    try {
      await this.api.post(`/lists/${list.id}/items`, { product_id: offer.id, quantity: 1 });
      this.notice.set(this.language.translate('list.added', { product: product.name }));
      this.results.set([]);
      this.searched.set(false);
      this.closeOffers();
      await this.load(list.id);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.language.translate('error.save'));
    } finally {
      this.adding.set(false);
    }
  }

  async changeQuantity(itemId: number, input: HTMLInputElement): Promise<void> {
    const list = this.list();
    if (!list || list.status !== 'open') {
      return;
    }

    const currentQuantity = list.items.find((item) => item.id === itemId)?.quantity ?? '1';
    const value = input.value.trim();
    if (!value) {
      input.value = String(Number(currentQuantity));
      this.error.set(this.language.translate('list.quantityWhole'));
      return;
    }

    const quantity = Number(value);
    if (Number.isFinite(quantity) && quantity <= 0) {
      input.value = '0';
      await this.remove(itemId);
      return;
    }
    if (!Number.isSafeInteger(quantity) || quantity > 9999) {
      input.value = String(Number(currentQuantity));
      this.error.set(this.language.translate('list.quantityWhole'));
      return;
    }

    this.error.set('');
    try {
      await this.api.patch(`/lists/${list.id}/items/${itemId}`, { quantity });
      await this.load(list.id);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.language.translate('error.save'));
    }
  }

  async remove(itemId: number): Promise<void> {
    const list = this.list();
    if (!list || list.status !== 'open') {
      return;
    }
    this.error.set('');
    try {
      await this.api.delete(`/lists/${list.id}/items/${itemId}`);
      await this.load(list.id);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.language.translate('error.save'));
    }
  }

  async removeMember(member: Member): Promise<void> {
    const list = this.list();
    if (!list || list.status !== 'open' || !this.isOwner() || member.id === this.account()?.id) {
      return;
    }
    const confirmed = window.confirm(this.language.translate('list.removeMemberConfirm', {
      member: member.display_name,
      list: list.title,
    }));
    if (!confirmed) {
      return;
    }
    this.removingMemberId.set(member.id);
    this.error.set('');
    try {
      await this.api.delete(`/lists/${list.id}/members/${member.id}`);
      this.notice.set(this.language.translate('list.memberRemoved'));
      await this.load(list.id);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.language.translate('error.save'));
    } finally {
      this.removingMemberId.set(null);
    }
  }

  async save(): Promise<void> {
    const list = this.list();
    if (!list || list.status !== 'open') {
      return;
    }
    this.error.set('');
    try {
      await this.api.post(`/lists/${list.id}/save`);
      this.results.set([]);
      this.notice.set(this.language.translate('list.savedNotice'));
      await this.load(list.id);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.language.translate('error.save'));
    }
  }

  async copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      this.notice.set(this.language.translate('lists.copySuccess'));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.language.translate('error.save'));
    }
  }
}
