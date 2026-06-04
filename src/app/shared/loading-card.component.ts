import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-loading-card',
  standalone: true,
  template: `
    <div class="card">
      <div class="card-body text-center text-text-dim py-10 flex items-center justify-center gap-2">
        <span class="inline-block w-3.5 h-3.5 rounded-full border-2 border-border" style="border-top-color: var(--accent); animation: spin 0.7s linear infinite;"></span>
        <span>{{ msg }}</span>
      </div>
    </div>
  `,
  styles: [`
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
})
export class LoadingCardComponent {
  @Input() msg = 'Cargando…';
}
