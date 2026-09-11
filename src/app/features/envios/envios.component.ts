import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { ApiService, ClientId, HistoryEntry } from '../../core/api.service';
import { BadgeComponent } from '../../shared/badge.component';
import { JsonPanelComponent } from '../../shared/json-panel.component';
import { IconComponent } from '../../shared/icon.component';
import { SkeletonRowComponent } from '../../shared/skeleton.component';
import { HotkeysService } from '../../core/hotkeys.service';
import { fmtDate } from '../../core/format.utils';
import { Subscription, firstValueFrom } from 'rxjs';

interface UnifiedSend extends HistoryEntry {
  service: string;
  kind: ClientId;
  patente: string;
  eventTs?: string | null;
  speed: number | string | null;
  key: string; // estable para tracking
}

const PAGE_SIZE = 100;
// Tope máximo de envíos visibles en la tabla. Los historiales se purgan en el server cada 7 días,
// pero igual capamos para no inflar el DOM si hay mucha actividad.
const MAX_VISIBLE = 1000;
const RETENTION_DAYS = 7;

@Component({
  selector: 'app-envios',
  standalone: true,
  imports: [BadgeComponent, JsonPanelComponent, IconComponent, SkeletonRowComponent],
  template: `
    <div class="card">
      <div class="card-header">
        <h2>Resultados de envíos</h2>
        <div class="flex-1"></div>
        <span class="badge badge-muted" [title]="'Historial se purga cada ' + RETENTION + ' días · tope visual ' + MAX">
          {{ filtered().length }} de {{ entries().length }} envíos
        </span>
        <button class="btn btn-ghost flex items-center gap-1.5" (click)="refresh()">
          <app-icon name="refresh" [size]="14" />
          Refrescar
        </button>
      </div>
      <div class="toolbar">
        <div class="relative">
          <app-icon name="search" [size]="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" />
          <input #searchInput class="input pl-8" type="search" placeholder="Filtrar por patente…  (/)"
            [value]="search()" (input)="search.set(inputV($event))" />
        </div>
        <select class="input" [value]="serviceFilter()" (change)="serviceFilter.set(inputV($event))">
          <option value="">Todos los servicios</option>
          <option value="Falabella">Falabella</option>
          <option value="Wise">Wise</option>
          <option value="Drivin">Drivin</option>
          <option value="Bermann">Bermann</option>
          <option value="DS">DS</option>
          <option value="Qanalytics">Qanalytics</option>
        </select>
        <select class="input" [value]="resultFilter()" (change)="resultFilter.set(inputV($event))">
          <option value="">Todos los resultados</option>
          <option value="accepted">✓ Aceptados</option>
          <option value="rejected">⚠ Rechazo lógico</option>
          <option value="error">✗ Errores</option>
        </select>

        <div class="flex items-center gap-1.5 flex-wrap">
          <button class="btn btn-ghost px-2.5 py-1.5 text-xs" [class.selected-day]="isDay(0)" (click)="selectDay(0)" title="Solo hoy">Hoy</button>
          <button class="btn btn-ghost px-2.5 py-1.5 text-xs" [class.selected-day]="isDay(1)" (click)="selectDay(1)" title="Solo ayer">Ayer</button>
          <button class="btn btn-ghost px-2.5 py-1.5 text-xs" (click)="lastWeek()" title="Últimos 7 días">7 días</button>
          <span class="text-text-dim text-xs mx-1">|</span>
          <label class="text-xs text-text-dim">Desde</label>
          <input class="input" type="date" [value]="dateFrom()" [max]="dateTo() || todayStr"
            (change)="dateFrom.set(inputV($event))" />
          <label class="text-xs text-text-dim">Hasta</label>
          <input class="input" type="date" [value]="dateTo()" [min]="dateFrom()" [max]="todayStr"
            (change)="dateTo.set(inputV($event))" />
          @if (dateFrom() || dateTo()) {
            <button class="btn btn-ghost px-2 py-1.5 text-xs" (click)="clearDates()" title="Limpiar filtro de fecha">✕ limpiar</button>
          }
        </div>

        @if (openKeys().size > 0) {
          <small class="text-warn ml-2 flex items-center gap-1">
            <app-icon name="alert" [size]="12" />
            ⏸ auto-refresh pausado · cierra los detalles para reanudar
          </small>
        } @else {
          <small class="text-text-dim ml-2">auto-refresca cada 5s · click en una fila para ver detalle</small>
        }
      </div>
      <div class="card-body-tight">
        <table class="tbl">
          <thead>
            <tr>
              <th>Patente</th><th>Fecha evento (GPS)</th><th>Fecha envío</th>
              <th>Velocidad</th><th>Servicio</th><th>Estado</th><th style="width:60px"></th>
            </tr>
          </thead>
          <tbody>
            @if (loading() && entries().length === 0) {
              @for (i of [0,1,2,3,4,5,6]; track i) {
                <app-skeleton-row [cells]="7" />
              }
            }
            @for (e of visible(); track e.key) {
              <tr (click)="toggleOpen(e)" [class.selected]="openKeys().has(e.key)">
                <td><b>{{ e.patente || '—' }}</b></td>
                <td>{{ fmtDate(e.eventTs) }}</td>
                <td>{{ fmtDate(e.ts) }}</td>
                <td>{{ e.speed ?? '—' }}</td>
                <td><app-badge kind="muted">{{ e.service }}</app-badge></td>
                <td>
                  <app-badge [kind]="statusKind(e)">{{ statusLabel(e) }}</app-badge>
                </td>
                <td>
                  <button class="btn btn-ghost flex items-center justify-center px-2 py-1" (click)="$event.stopPropagation(); toggleOpen(e)" title="Ver detalle">
                    <app-icon name="eye" [size]="14" />
                  </button>
                </td>
              </tr>
              @if (openKeys().has(e.key)) {
                <tr style="background: var(--bg-soft);">
                  <td colspan="7" style="padding: 0;">
                    <div class="p-4">
                      <div class="grid grid-cols-3 gap-4">
                        <app-json-panel title="fm-track · raw" [content]="e.raw ?? '(no disponible · envío anterior a esta versión)'" />
                        <app-json-panel title="Payload enviado" [content]="e.payload ?? '(sin payload · no se construyó)'" />
                        <app-json-panel title="Respuesta" [content]="e.error ? e.error : (e.response ?? '')" />
                      </div>
                      <div class="grid mt-3 text-sm" style="grid-template-columns: 120px 1fr; gap: 4px 16px;">
                        <span class="text-text-dim">Servicio</span><span>{{ e.service }}</span>
                        <span class="text-text-dim">Vehicle ID</span><span class="font-mono text-xs">{{ e.vehicleId }}</span>
                        <span class="text-text-dim">HTTP</span><span>{{ e.status ?? 0 }}</span>
                        <span class="text-text-dim">Aceptado</span><span>{{ e.accepted ? 'sí' : 'no' }}</span>
                        @if (e.url) {
                          <span class="text-text-dim">URL</span><span class="text-xs font-mono break-all">{{ e.url }}</span>
                        }
                        @if (e.groupId) {
                          <span class="text-text-dim">Grupo</span><span class="font-mono text-xs">{{ e.groupId }}</span>
                        }
                      </div>
                    </div>
                  </td>
                </tr>
              }
            }
            @if (filtered().length === 0) {
              <tr><td colspan="7" class="text-center text-text-dim py-10">Sin resultados</td></tr>
            }
            @if (filtered().length > visibleCount() && visibleCount() < MAX) {
              <tr><td colspan="7" class="text-center py-3" style="background: var(--bg-soft);">
                <button class="btn btn-ghost" (click)="loadMore()">
                  Ver más ({{ remainingToShow() }} restantes)
                </button>
              </td></tr>
            } @else if (visibleCount() >= MAX && filtered().length > MAX) {
              <tr><td colspan="7" class="text-center py-3 text-text-dim text-xs" style="background: var(--bg-soft);">
                Mostrando los primeros {{ MAX }} envíos · {{ filtered().length - MAX }} ocultos
                · el historial completo se purga cada {{ RETENTION }} días
              </td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .selected-day {
      background: var(--accent) !important;
      color: #fff !important;
      border-color: var(--accent) !important;
    }
  `],
})
export class EnviosComponent implements OnInit, OnDestroy {
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  api = inject(ApiService);
  private hotkeys = inject(HotkeysService);
  private hkSub?: Subscription;
  entries = signal<UnifiedSend[]>([]);
  loading = signal(true);
  search = signal('');
  serviceFilter = signal('');
  resultFilter = signal('');
  dateFrom = signal('');   // 'YYYY-MM-DD' (filtra por fecha de envío)
  dateTo = signal('');
  visibleCount = signal(PAGE_SIZE);
  openKeys = signal(new Set<string>());
  fmtDate = fmtDate;
  MAX = MAX_VISIBLE;
  RETENTION = RETENTION_DAYS;
  remainingToShow = computed(() => Math.min(this.filtered().length, this.MAX) - this.visibleCount());

  filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const sf = this.serviceFilter();
    const rf = this.resultFilter();
    const from = this.dateFrom() ? new Date(this.dateFrom() + 'T00:00:00').getTime() : null;
    const to = this.dateTo() ? new Date(this.dateTo() + 'T23:59:59.999').getTime() : null;
    return this.entries().filter((e) => {
      if (q && !String(e.patente || '').toLowerCase().includes(q)) return false;
      if (sf && e.service !== sf) return false;
      if (rf === 'accepted' && !e.accepted) return false;
      if (rf === 'rejected' && (!e.ok || e.accepted)) return false;
      if (rf === 'error' && e.ok) return false;
      if (from != null || to != null) {
        const t = new Date(e.ts).getTime();
        if (from != null && t < from) return false;
        if (to != null && t > to) return false;
      }
      return true;
    });
  });
  visible = computed(() => this.filtered().slice(0, this.visibleCount()));

  private timer?: ReturnType<typeof setInterval>;

  async ngOnInit() {
    await this.refresh();
    this.timer = setInterval(() => {
      // Pausa el refresh si hay alguna fila expandida — no perder la vista del usuario
      if (this.openKeys().size === 0) this.refresh();
    }, 5000);
    this.hkSub = this.hotkeys.events.subscribe((ev) => {
      if (ev === 'escape') this.openKeys.set(new Set());
      else if (ev === 'search') this.searchInput?.nativeElement.focus();
    });
  }
  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.hkSub?.unsubscribe();
  }

  // ---- Filtros de fecha ----
  private toDateStr(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  get todayStr() { return this.toDateStr(new Date()); }
  // Filtra un único día (offset 0 = hoy, 1 = ayer, …)
  selectDay(offset: number) {
    const s = this.toDateStr(new Date(Date.now() - offset * 86400000));
    this.dateFrom.set(s);
    this.dateTo.set(s);
    this.visibleCount.set(PAGE_SIZE);
  }
  // ¿El filtro actual es exactamente ese día? (para resaltar el botón activo)
  isDay(offset: number): boolean {
    const s = this.toDateStr(new Date(Date.now() - offset * 86400000));
    return this.dateFrom() === s && this.dateTo() === s;
  }
  lastWeek() {
    const now = new Date();
    const from = new Date(now.getTime() - 6 * 86400000); // 7 días inclusive (hoy + 6 atrás)
    this.dateFrom.set(this.toDateStr(from));
    this.dateTo.set(this.toDateStr(now));
    this.visibleCount.set(PAGE_SIZE);
  }
  clearDates() { this.dateFrom.set(''); this.dateTo.set(''); }

  loadMore() { this.visibleCount.update((n) => Math.min(n + PAGE_SIZE, MAX_VISIBLE)); }
  toggleOpen(e: UnifiedSend) {
    this.openKeys.update((s) => {
      const n = new Set(s);
      if (n.has(e.key)) n.delete(e.key); else n.add(e.key);
      return n;
    });
  }
  inputV(ev: Event): string { return (ev.target as HTMLInputElement).value; }

  // Color de la insignia de estado
  statusKind(e: UnifiedSend): 'ok' | 'warn' | 'err' | 'muted' {
    if (e.error) return 'err';
    if (e.accepted) return 'ok';
    if (e.skipped) return 'muted';
    if (!e.ok) return 'err';
    return 'warn'; // rechazo lógico / duplicado
  }
  // Texto claro: aceptado / sin cambios / duplicado / rechazado / error
  statusLabel(e: UnifiedSend): string {
    if (e.error) return 'error';
    if (e.accepted) return '✓ aceptado';
    if (e.skipped) return 'sin cambios';
    if (e.message) return e.message.replace(/^\d+:\s*/, ''); // "5: Registro duplicado" → "Registro duplicado"
    if (e.ok) return e.response?.message || 'rechazado';
    return 'HTTP ' + (e.status || 0);
  }

  async refresh() {
    const clients: ClientId[] = ['falabella', 'wise', 'drivin', 'bermann', 'ds', 'qanalytics'];
    const labels: Record<ClientId, string> = { falabella: 'Falabella', wise: 'Wise', drivin: 'Drivin', bermann: 'Bermann', ds: 'DS', qanalytics: 'Qanalytics' };
    try {
      const results = await Promise.all(
        clients.map((c) => firstValueFrom(this.api.clientHistory(c, 500)).catch(() => ({ entries: [] as HistoryEntry[] })))
      );
      const merged: UnifiedSend[] = [];
      for (let i = 0; i < clients.length; i++) {
        const c = clients[i]; const r = results[i];
        for (const e of r.entries || []) merged.push(this.normalize(e, c, labels[c]));
      }
      merged.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      this.entries.set(merged);
    } finally {
      this.loading.set(false);
    }
  }

  private normalize(e: HistoryEntry, client: ClientId, service: string): UnifiedSend {
    const key = `${client}-${e.ts}-${e.vehicleId}`;
    if (client === 'falabella') return { ...e, kind: client, service, key, patente: e.payload?.vehicleId || e.vehicleId, eventTs: e.payload?.timestamp, speed: e.payload?.speed?.value ?? null };
    if (client === 'wise') { const p0 = e.payload?.posicion?.[0]; return { ...e, kind: client, service, key, patente: p0?.patente || e.vehicleId, eventTs: p0?.fecha_hora, speed: p0?.velocidad ?? null }; }
    if (client === 'drivin') { const p0 = e.payload?._json?.[0] || e.payload?.positions?.[0]; return { ...e, kind: client, service, key, patente: p0?.vehicle_code || e.vehicleId, eventTs: p0?.timestamp ? new Date(Number(p0.timestamp)).toISOString() : null, speed: p0?.speed != null ? Math.round(Number(p0.speed) * 3.6) : null }; }
    if (client === 'ds') return { ...e, kind: client, service, key, patente: e.payload?.patente || e.vehicleId, eventTs: e.payload?.fechahora, speed: e.payload?.velocidad ?? null };
    // bermann
    return { ...e, kind: client, service, key, patente: e.payload?.patente || e.vehicleId, eventTs: e.payload?.fecha, speed: e.payload?.velocidad ?? null };
  }
}
