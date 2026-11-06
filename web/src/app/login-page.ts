import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Language, TranslatePipe } from './language';
import { Session } from './session';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe],
  templateUrl: './login-page.html',
})
export class LoginPage {
  private session = inject(Session);
  private router = inject(Router);
  private forms = inject(FormBuilder);
  readonly language = inject(Language);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly form = this.forms.nonNullable.group({
    email: ['', Validators.required],
    password: ['', Validators.required],
  });

  async submit(): Promise<void> {
    this.error.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('The email or password is wrong.');
      return;
    }
    this.busy.set(true);
    const value = this.form.getRawValue();
    try {
      await this.session.login(value.email, value.password);
      await this.router.navigateByUrl('/');
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : '';
      this.error.set(message || 'The email or password is wrong.');
    } finally {
      this.busy.set(false);
    }
  }
}
