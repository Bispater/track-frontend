import { Injectable, effect, signal } from '@angular/core';

export type ThemeMode = 'auto' | 'light' | 'dark';
const STORAGE_KEY = 'track-service.theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  mode = signal<ThemeMode>(this.loadInitial());

  constructor() {
    effect(() => this.apply(this.mode()));
  }

  set(mode: ThemeMode) {
    this.mode.set(mode);
    try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
  }

  cycle() {
    const order: ThemeMode[] = ['auto', 'light', 'dark'];
    const idx = order.indexOf(this.mode());
    this.set(order[(idx + 1) % order.length]);
  }

  private apply(mode: ThemeMode) {
    const root = document.documentElement;
    if (mode === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
  }

  private loadInitial(): ThemeMode {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
      if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
    } catch {}
    return 'auto';
  }
}
