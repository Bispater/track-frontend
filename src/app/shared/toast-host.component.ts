import { Component, inject } from '@angular/core';
import { ToastService } from '../core/toast.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-toast-host',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="fixed bottom-5 right-5 flex flex-col gap-2 z-[9999] max-w-sm">
      @for (t of toast.toasts(); track t.id) {
        <div class="card flex items-center gap-2 px-4 py-2.5 shadow-lg" [class]="kindClass(t.kind)" style="margin: 0;">
          <app-icon [name]="iconFor(t.kind)" [size]="16" />
          <span class="text-sm flex-1">{{ t.msg }}</span>
          <button class="text-text-dim hover:text-text" (click)="toast.dismiss(t.id)">
            <app-icon name="x" [size]="14" />
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-ok { border-left: 3px solid var(--ok); }
    .toast-warn { border-left: 3px solid var(--warn); }
    .toast-err { border-left: 3px solid var(--err); }
    .toast-info { border-left: 3px solid var(--accent); }
  `],
})
export class ToastHostComponent {
  toast = inject(ToastService);
  kindClass(k: string) { return 'toast-' + k; }
  iconFor(k: string): any {
    return k === 'ok' ? 'check' : k === 'err' ? 'alert' : k === 'warn' ? 'alert' : 'check';
  }
}
