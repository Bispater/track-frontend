import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-toggle-switch',
  standalone: true,
  imports: [FormsModule],
  template: `
    <label class="toggle">
      <input type="checkbox" [(ngModel)]="checked" (ngModelChange)="checkedChange.emit($event)" />
      <span class="track"></span>
      <span class="knob"></span>
    </label>
  `,
})
export class ToggleSwitchComponent {
  @Input() checked = false;
  @Output() checkedChange = new EventEmitter<boolean>();
}
