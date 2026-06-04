import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  private router = inject(Router);

  // Estado reactivo basado en signals
  authEnabled = signal(false);
  username = signal<string | null>(null);
  authenticated = signal(false);

  async checkSession() {
    try {
      const me = await firstValueFrom(this.api.me());
      this.authEnabled.set(me.authEnabled);
      this.authenticated.set(me.authenticated);
      this.username.set(me.username);
      return me;
    } catch {
      this.authenticated.set(false);
      this.username.set(null);
      return null;
    }
  }

  async login(username: string, password: string) {
    const r = await firstValueFrom(this.api.login({ username, password }));
    if (r?.ok) {
      this.authenticated.set(true);
      this.username.set(r.username);
    }
    return r;
  }

  async logout() {
    try { await firstValueFrom(this.api.logout()); } catch {}
    this.authenticated.set(false);
    this.username.set(null);
    this.router.navigate(['/login']);
  }
}
