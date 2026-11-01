import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Session } from './session';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.html',
})
export class LoginPage {
  private session = inject(Session);
  private router = inject(Router);
  private forms = inject(FormBuilder);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly form = this.forms.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(10)]],
  });

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const value = this.form.getRawValue();
    try {
      await this.session.login(value.email, value.password);
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Login failed.');
    } finally {
      this.busy.set(false);
    }
  }
}
