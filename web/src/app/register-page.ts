import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Session } from './session';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register-page.html',
})
export class RegisterPage {
  private session = inject(Session);
  private router = inject(Router);
  private forms = inject(FormBuilder);
  readonly error = signal('');
  readonly note = signal('');
  readonly busy = signal(false);
  readonly form = this.forms.nonNullable.group({
    display_name: ['', [Validators.required, Validators.maxLength(80)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(200)]],
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
      const created = await this.session.register(value.email, value.display_name.trim(), value.password);
      if (created.email_sent) {
        await this.router.navigateByUrl('/');
      } else {
        this.note.set('Your account is ready. The confirmation email was not sent because this computer has no mail server configured.');
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Registration failed.');
    } finally {
      this.busy.set(false);
    }
  }
}
