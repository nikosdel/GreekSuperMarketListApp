import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from './api';
import { ShoppingList } from './models';

@Component({
  selector: 'app-lists',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './lists-page.html',
})
export class ListsPage {
  private api = inject(Api);
  private router = inject(Router);
  private forms = inject(FormBuilder);
  readonly lists = signal<ShoppingList[] | null>(null);
  readonly error = signal('');
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
      await this.router.navigate(['/lists', joined.list_id]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'That invite code did not match an open list.');
    }
  }
}
