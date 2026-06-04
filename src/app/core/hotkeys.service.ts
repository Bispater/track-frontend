import { Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Servicio simple de atajos de teclado globales.
 * Ignora keys cuando el foco está en un input/textarea (excepto Escape).
 */
@Injectable({ providedIn: 'root' })
export class HotkeysService implements OnDestroy {
  private subj = new Subject<string>();
  events = this.subj.asObservable();
  private boundHandler: (e: KeyboardEvent) => void;

  constructor() {
    this.boundHandler = (e) => this.handle(e);
    window.addEventListener('keydown', this.boundHandler);
  }
  ngOnDestroy() {
    window.removeEventListener('keydown', this.boundHandler);
  }

  private handle(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    const inField = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.key === 'Escape') { this.subj.next('escape'); return; }
    if (inField) return;
    if (e.key === '/') { e.preventDefault(); this.subj.next('search'); return; }
  }
}
