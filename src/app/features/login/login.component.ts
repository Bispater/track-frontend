import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme.service';
import { IconComponent, IconName } from '../../shared/icon.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="min-h-screen flex items-center justify-center px-4 relative" style="background: var(--bg);">
      <!-- Toggle de tema, esquina superior derecha -->
      <button class="icon-btn absolute top-5 right-5" (click)="theme.cycle()" [title]="'Tema: ' + theme.mode()">
        <app-icon [name]="themeIcon()" [size]="18" />
      </button>

      <div class="w-full max-w-sm">
        <!-- Marca -->
        <div class="flex flex-col items-center mb-6">
          <div class="brand-square w-14 h-14 rounded-2xl mb-3">
            <app-icon name="route" [size]="28" />
          </div>
          <h1 class="text-xl font-bold m-0">track-service</h1>
          <p class="text-sm text-text-dim m-0">Concentrador GPS · panel de control</p>
        </div>

        <form class="card mb-0" (submit)="$event.preventDefault(); submit()">
          <div class="card-body space-y-4">
            <div>
              <label class="block text-xs font-semibold text-text-dim mb-1.5">Usuario</label>
              <input class="input w-full" type="text" [(ngModel)]="username" name="username"
                placeholder="tu@correo.cl" autocomplete="username" required autofocus />
            </div>
            <div>
              <label class="block text-xs font-semibold text-text-dim mb-1.5">Contraseña</label>
              <input class="input w-full" type="password" [(ngModel)]="password" name="password"
                placeholder="••••••••" autocomplete="current-password" required />
            </div>
            <button class="btn w-full mt-1 py-2.5" type="submit" [disabled]="loading()">
              <app-icon name="logout" [size]="16" />
              {{ loading() ? 'Ingresando…' : 'Ingresar' }}
            </button>
            @if (error()) {
              <div class="flex items-center gap-1.5 text-err text-xs">
                <app-icon name="alert" [size]="14" /> {{ error() }}
              </div>
            }
          </div>
        </form>
        <p class="text-center text-[11px] text-text-dim mt-4">Acceso restringido · sesión protegida por cookie</p>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  theme = inject(ThemeService);
  username = '';
  password = '';
  loading = signal(false);
  error = signal<string | null>(null);

  themeIcon(): IconName {
    const m = this.theme.mode();
    return m === 'light' ? 'sun' : m === 'dark' ? 'moon' : 'monitor';
  }

  async submit() {
    this.error.set(null);
    this.loading.set(true);
    try {
      const r = await this.auth.login(this.username, this.password);
      if (r?.ok) this.router.navigate(['/resumen']);
      else this.error.set('Usuario o contraseña incorrectos');
    } catch (err: any) {
      this.error.set(err?.error?.error || 'No se pudo ingresar');
    } finally {
      this.loading.set(false);
    }
  }
}
