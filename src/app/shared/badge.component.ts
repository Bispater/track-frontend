import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-badge',
  standalone: true,
  template: `<span class="badge" [class.badge-ok]="kind === 'ok'" [class.badge-warn]="kind === 'warn'"
    [class.badge-err]="kind === 'err'" [class.badge-muted]="kind === 'muted'">
    <ng-content></ng-content>
  </span>`,
})
export class BadgeComponent {
  @Input() kind: 'ok' | 'warn' | 'err' | 'muted' | 'default' = 'default';
}
