import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  msg: string;
  kind: 'ok' | 'warn' | 'err' | 'info';
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  toasts = signal<Toast[]>([]);

  show(msg: string, kind: Toast['kind'] = 'info', ttl = 3200) {
    const id = this.nextId++;
    this.toasts.update((arr) => [...arr, { id, msg, kind }]);
    setTimeout(() => this.dismiss(id), ttl);
  }
  ok(msg: string) { this.show(msg, 'ok'); }
  warn(msg: string) { this.show(msg, 'warn'); }
  err(msg: string) { this.show(msg, 'err', 5000); }

  dismiss(id: number) {
    this.toasts.update((arr) => arr.filter((t) => t.id !== id));
  }
}
