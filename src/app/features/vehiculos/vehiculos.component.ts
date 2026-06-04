import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { VehicleStoreService } from '../../core/vehicle-store.service';
import { BadgeComponent } from '../../shared/badge.component';
import { IconComponent } from '../../shared/icon.component';
import { JsonPanelComponent } from '../../shared/json-panel.component';
import { ToastService } from '../../core/toast.service';
import { HotkeysService } from '../../core/hotkeys.service';
import { ageMinutes, fmtDate, fmtNum, relativeTime, statusFromAge } from '../../core/format.utils';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-vehiculos',
  standalone: true,
  imports: [BadgeComponent, IconComponent, JsonPanelComponent],
  template: `
    <div class="card">
      <div class="card-header">
        <h2>Vehículos</h2>
        <span class="badge badge-muted">{{ filtered().length }} de {{ store.list().length }}</span>
        @if (openId()) {
          <span class="text-warn text-xs ml-2">⏸ refresh pausado · cierra el detalle</span>
        }
        <div class="flex-1"></div>
      </div>
      <div class="toolbar">
        <div class="relative">
          <app-icon name="search" [size]="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" />
          <input #searchInput class="input pl-8" type="search" placeholder="Patente, nombre o IMEI…  (/)"
            [value]="search()" (input)="search.set(input($event))" style="min-width: 240px;" />
        </div>
        <select class="input" [value]="groupFilter()" (change)="groupFilter.set(input($event))">
          <option value="">Todos los grupos</option>
          @for (g of store.fmGroups(); track g.id) {
            <option [value]="g.id">{{ g.name }} ({{ g.vehicles.length }})</option>
          }
        </select>
        <div class="flex-1"></div>
        <button class="btn btn-ghost flex items-center gap-1.5" (click)="clearCache()" title="Borra localStorage y vuelve a consultar fm-track">
          <app-icon name="refresh" [size]="14" />
          Limpiar caché
        </button>
      </div>
      <div class="card-body-tight">
        <table class="tbl">
          <thead>
            <tr>
              <th style="width: 28px;"></th>
              <th>Nombre</th><th>IMEI</th><th>Grupos fm-track</th>
              <th>Última posición</th><th>Antigüedad</th>
              <th>Velocidad</th><th>Estado</th><th>Consultado</th>
            </tr>
          </thead>
          <tbody>
            @for (v of filtered(); track v.id) {
              <tr (click)="toggle(v.id)" [class.selected]="openId() === v.id">
                <td>
                  <span class="inline-block transition-transform text-text-dim"
                    [style.transform]="openId() === v.id ? 'rotate(90deg)' : 'rotate(0deg)'">
                    <app-icon name="chevron-right" [size]="14" />
                  </span>
                </td>
                <td class="font-medium">{{ v.name }}</td>
                <td class="text-text-dim">{{ v.imei }}</td>
                <td>
                  @if (groupsOf(v.id); as gs) {
                    @if (gs.length) {
                      <div class="flex flex-wrap gap-1">
                        @for (g of gs; track g.id) {
                          <app-badge kind="muted">{{ g.name }}</app-badge>
                        }
                      </div>
                    } @else {
                      <app-badge kind="muted">—</app-badge>
                    }
                  }
                </td>
                <td>{{ v.position ? fmtDate(v.position.ts) : '—' }}</td>
                <td>{{ v.position ? relativeTime(v.position.ts) : '—' }}</td>
                <td>{{ v.position?.speed != null ? fmtNum(v.position?.speed, 1) + ' km/h' : '—' }}</td>
                <td><app-badge [kind]="status(v).cls">{{ status(v).label }}</app-badge></td>
                <td class="text-text-dim"><small>{{ relativeTime(v.lastCheckedAt) }}</small></td>
              </tr>
              @if (openId() === v.id) {
                <tr style="background: var(--bg-soft);">
                  <td colspan="9" style="padding: 0;">
                    <div class="p-5 space-y-4">
                      <div class="grid gap-x-4 gap-y-1 text-sm" style="grid-template-columns: 160px 1fr;">
                        <div class="text-text-dim">ID</div><div class="font-mono text-xs">{{ v.id }}</div>
                        <div class="text-text-dim">IMEI</div><div class="font-mono text-xs">{{ v.imei }}</div>
                        <div class="text-text-dim">Modelo</div><div>{{ v.model || '—' }}</div>
                        <div class="text-text-dim">Patente</div><div>{{ v.plate || '—' }}</div>
                        @if (v.position; as p) {
                          <div class="text-text-dim">Latitud</div><div class="font-mono text-xs">{{ fmtNum(p.lat, 6) }}</div>
                          <div class="text-text-dim">Longitud</div><div class="font-mono text-xs">{{ fmtNum(p.lng, 6) }}</div>
                          <div class="text-text-dim">Velocidad</div><div>{{ p.speed != null ? fmtNum(p.speed, 1) + ' km/h' : '—' }}</div>
                          <div class="text-text-dim">Dirección</div><div>{{ p.direction != null ? fmtNum(p.direction, 0) + '°' : '—' }}</div>
                          <div class="text-text-dim">Altitud</div><div>{{ p.altitude != null ? fmtNum(p.altitude, 0) + ' m' : '—' }}</div>
                          <div class="text-text-dim">Satélites</div><div>{{ p.sats != null ? p.sats : '—' }}</div>
                          <div class="text-text-dim">HDOP</div><div>{{ p.hdop != null ? p.hdop : '—' }}</div>
                          <div class="text-text-dim">Ignición</div><div>{{ p.ignition || '—' }}</div>
                          <div class="text-text-dim">GPS time</div><div>{{ fmtDate(p.ts) }}</div>
                        }
                      </div>
                      <div class="grid grid-cols-2 gap-4">
                        <app-json-panel title="fm-track · objeto crudo" [content]="v.raw" />
                        @if (v.position) {
                          <app-json-panel title="fm-track · posición cruda" [content]="v.position.raw" />
                        }
                      </div>
                    </div>
                  </td>
                </tr>
              }
            }
            @if (filtered().length === 0) {
              <tr><td colspan="9" class="text-center py-12">
                @if (store.list().length === 0) {
                  <div class="text-text-dim">
                    <app-icon name="truck" [size]="32" class="mx-auto block mb-3 opacity-40" />
                    <div class="font-medium text-text mb-1">Esperando datos de fm-track…</div>
                    <div class="text-xs">El polling automático cargará los vehículos en unos segundos.</div>
                  </div>
                } @else {
                  <div class="text-text-dim">Sin resultados para los filtros aplicados</div>
                }
              </td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class VehiculosComponent implements OnInit, OnDestroy {
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  store = inject(VehicleStoreService);
  private toast = inject(ToastService);
  private hotkeys = inject(HotkeysService);
  private hkSub?: Subscription;
  search = signal('');
  groupFilter = signal('');
  openId = signal<string | null>(null);

  ngOnInit() {
    this.hkSub = this.hotkeys.events.subscribe((ev) => {
      if (ev === 'escape') this.openId.set(null);
      else if (ev === 'search') this.searchInput?.nativeElement.focus();
    });
  }
  ngOnDestroy() { this.hkSub?.unsubscribe(); }

  clearCache() {
    if (!confirm('¿Borrar caché localStorage de vehículos?')) return;
    this.store.clear();
    this.store.poll();
    this.toast.ok('Caché borrado · consultando fm-track de nuevo');
  }

  fmtDate = fmtDate;
  fmtNum = fmtNum;
  relativeTime = relativeTime;

  filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const gid = this.groupFilter();
    return this.store.list().filter((v) => {
      if (gid && !(this.store.groupsByVehicle().get(v.id) || []).some((g) => g.id === gid)) return false;
      if (!q) return true;
      return String(v.name).toLowerCase().includes(q) ||
        String(v.imei).toLowerCase().includes(q) ||
        String(v.plate || '').toLowerCase().includes(q);
    });
  });

  toggle(id: string) { this.openId.set(this.openId() === id ? null : id); }
  status(v: any) { return statusFromAge(v.position ? ageMinutes(v.position.ts) : null); }
  groupsOf(id: string) { return this.store.groupsByVehicle().get(id) || []; }
  input(ev: Event): string { return (ev.target as HTMLInputElement).value; }
}
