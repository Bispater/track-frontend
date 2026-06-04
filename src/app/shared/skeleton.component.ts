import { Component, Input } from '@angular/core';

/**
 * Bloque animado para indicar carga. Más sutil que un spinner.
 * Ejemplos:
 *   <app-skeleton w="120px" h="14px" />
 *   <app-skeleton w="100%" h="40px" round="4px" />
 *   <app-skeleton-row [cells]="6" />
 */
@Component({
  selector: 'app-skeleton',
  standalone: true,
  template: `<span class="sk" [style.width]="w" [style.height]="h" [style.borderRadius]="round"></span>`,
  styles: [`
    .sk {
      display: inline-block;
      background: linear-gradient(90deg,
        var(--bg-soft) 0%,
        var(--border) 50%,
        var(--bg-soft) 100%
      );
      background-size: 200% 100%;
      animation: sk-shimmer 1.4s ease-in-out infinite;
    }
    @keyframes sk-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `],
})
export class SkeletonComponent {
  @Input() w = '100%';
  @Input() h = '14px';
  @Input() round = '4px';
}

@Component({
  selector: 'app-skeleton-row',
  standalone: true,
  imports: [SkeletonComponent],
  template: `
    <tr>
      @for (i of cellsArr; track i) {
        <td><app-skeleton h="14px" [w]="widthFor(i)" /></td>
      }
    </tr>
  `,
})
export class SkeletonRowComponent {
  @Input() cells = 5;
  get cellsArr() { return Array.from({ length: this.cells }, (_, i) => i); }
  // Variar ancho por columna para que se vea más natural
  widthFor(i: number) {
    const widths = ['70%', '90%', '60%', '80%', '50%', '65%', '75%', '85%'];
    return widths[i % widths.length];
  }
}
