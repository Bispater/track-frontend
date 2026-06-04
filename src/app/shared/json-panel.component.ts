import { Component, Input, signal } from '@angular/core';

@Component({
  selector: 'app-json-panel',
  standalone: true,
  template: `
    <div>
      <div class="flex items-center gap-2 mb-1.5">
        <h2 class="text-xs m-0 text-text-dim flex-1">{{ title }}</h2>
        <button class="btn btn-ghost px-2 py-0.5 text-[11px]" (click)="toggleExpand()">{{ expanded() ? '⤡ contraer' : '⤢ expandir' }}</button>
        <button class="btn btn-ghost px-2 py-0.5 text-[11px]" (click)="copy()">{{ copiedFlag() ? '✓ copiado' : '⎘ copiar' }}</button>
      </div>
      <pre class="json-pre" [style.maxHeight]="expanded() ? 'none' : '240px'">{{ jsonText }}</pre>
    </div>
  `,
})
export class JsonPanelComponent {
  @Input() title = 'JSON';
  @Input() set content(v: any) { this.jsonText = typeof v === 'string' ? v : JSON.stringify(v, null, 2); }
  jsonText = '';
  expanded = signal(false);
  copiedFlag = signal(false);

  toggleExpand() { this.expanded.update(v => !v); }
  async copy() {
    try {
      await navigator.clipboard.writeText(this.jsonText);
      this.copiedFlag.set(true);
      setTimeout(() => this.copiedFlag.set(false), 1400);
    } catch {}
  }
}
