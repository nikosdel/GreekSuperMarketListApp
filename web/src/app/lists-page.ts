import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from './api';
import { Basket } from './basket';
import { Language, TranslatePipe } from './language';
import { ShoppingList } from './models';

@Component({
  selector: 'app-lists',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe],
  templateUrl: './lists-page.html',
})
export class ListsPage {
  private api = inject(Api);
  private router = inject(Router);
  private forms = inject(FormBuilder);
  private basket = inject(Basket);
  private language = inject(Language);
  readonly lists = signal<ShoppingList[] | null>(null);
  readonly error = signal('');
  readonly copied = signal(false);
  readonly deletingListId = signal<number | null>(null);
  readonly form = this.forms.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(120)]],
    invite_code: [''],
  });

  constructor() {
    void this.load();
  }

  openLists(): ShoppingList[] {
    return (this.lists() ?? []).filter((list) => list.status === 'open');
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      const body = await this.api.get<{ lists: ShoppingList[] }>('/lists');
      this.lists.set(body.lists);
      await this.basket.load();
    } catch (error) {
      this.lists.set([]);
      this.error.set(error instanceof Error ? error.message : 'The lists did not load.');
    }
  }

  async create(): Promise<void> {
    const title = this.form.controls.title.value.trim();
    if (!title) {
      this.form.controls.title.markAsTouched();
      return;
    }
    this.error.set('');
    try {
      const created = await this.api.post<ShoppingList>('/lists', { title });
      this.basket.choose(created.id);
      await this.basket.load();
      await this.router.navigate(['/lists', created.id]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The list was not created.');
    }
  }

  async join(): Promise<void> {
    const inviteCode = this.form.controls.invite_code.value.trim();
    if (!inviteCode) {
      return;
    }
    this.error.set('');
    try {
      const joined = await this.api.post<{ list_id: number }>('/lists/join', { invite_code: inviteCode });
      this.basket.choose(joined.list_id);
      await this.basket.load();
      await this.router.navigate(['/lists', joined.list_id]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'That invite code did not match an open list.');
    }
  }

  async copy(code: string): Promise<void> {
    if (!code) {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      this.copied.set(true);
      this.error.set('');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.language.translate('error.save'));
    }
  }

  async deleteList(list: ShoppingList): Promise<void> {
    if (list.status !== 'open' || list.role !== 'owner' || this.deletingListId() !== null) {
      return;
    }
    const confirmed = window.confirm(this.language.translate('lists.confirmDelete', { title: list.title }));
    if (!confirmed) {
      return;
    }
    this.error.set('');
    this.deletingListId.set(list.id);
    try {
      await this.api.delete(`/lists/${list.id}`);
      this.lists.update((lists) => lists?.filter((item) => item.id !== list.id) ?? []);
      await this.basket.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.language.translate('error.save'));
    } finally {
      this.deletingListId.set(null);
    }
  }
}
