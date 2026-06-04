import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, ClientId, HistoryEntry } from '../../core/api.service';
import { VehicleStoreService } from '../../core/vehicle-store.service';
import { BadgeComponent } from '../../shared/badge.component';
import { IconComponent } from '../../shared/icon.component';
import { SkeletonComponent, SkeletonRowComponent } from '../../shared/skeleton.component';
import { ageMinutes, fmtDate } from '../../core/format.utils';
import { firstValueFrom } from 'rxjs';

interface UnifiedSend extends HistoryEntry {
  service: string;
  patente: string;
  speed: number | string | null;
}

@Component({
  selector: 'app-resumen',
  standalone: true,
  imports: [BadgeComponent, IconComponent, RouterLink, SkeletonComponent, SkeletonRowComponent],
  template: `
    <!-- KPIs -->
    <div class="grid grid-cols-4 gap-4 mb-4">
      <div class="card">
        <div class="card-body flex items-start gap-3">
          <div class="w-9 h-9 rounded flex items-center justify-center" style="background: var(--bg-soft);">
            <app-icon name="truck" [size]="18" />
          </div>
          <div>
            <div class="text-xs text-text-dim uppercase tracking-wide">Vehículos</div>
            <div class="text-3xl font-semibold leading-tight">{{ store.list().length }}</div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-body flex items-start gap-3">
          <div class="w-9 h-9 rounded flex items-center justify-center text-ok" style="background: rgba(54,211,153,0.15);">
            <app-icon name="check" [size]="18" />
          </div>
          <div>
            <div class="text-xs text-text-dim uppercase tracking-wide">Activos (&lt;15m)</div>
            <div class="text-3xl font-semibold leading-tight">{{ activos() }}</div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-body flex items-start gap-3">
          <div class="w-9 h-9 rounded flex items-center justify-center" style="background: var(--bg-soft);">
            <app-icon name="send" [size]="18" />
          </div>
          <div>
            <div class="text-xs text-text-dim uppercase tracking-wide">Envíos 24h</div>
            <div class="text-3xl font-semibold leading-tight">{{ envios24h().length }}</div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-body flex items-start gap-3">
          <div class="w-9 h-9 rounded flex items-center justify-center"
            [class.text-ok]="errores24h() === 0"
            [class.text-warn]="errores24h() > 0"
            [style.background]="errores24h() > 0 ? 'rgba(251,189,35,0.15)' : 'rgba(54,211,153,0.15)'">
            <app-icon [name]="errores24h() > 0 ? 'alert' : 'check'" [size]="18" />
          </div>
          <div>
            <div class="text-xs text-text-dim uppercase tracking-wide">Aceptados / errores 24h</div>
            <div class="text-2xl font-semibold leading-tight">{{ aceptados24h() }} / {{ errores24h() }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Grupos fm-track + Envíos recientes en 2 columnas -->
    <div class="grid grid-cols-2 gap-4 mb-4">
      <div class="card">
        <div class="card-header">
          <app-icon name="users" [size]="16" class="text-text-dim" />
          <h2>Grupos fm-track</h2>
          <div class="flex-1"></div>
          <small class="text-text-dim">{{ store.fmGroups().length }} grupos</small>
        </div>
        @if (store.fmGroups().length === 0) {
          <div class="card-body text-text-dim text-center py-6">
            Esperando primera consulta a fm-track…
          </div>
        } @else {
          <div class="card-body-tight">
            <table class="tbl">
              <thead>
                <tr><th>Nombre</th><th>Vehículos</th><th>Patentes</th></tr>
              </thead>
              <tbody>
                @for (g of store.fmGroups(); track g.id) {
                  <tr>
                    <td class="font-medium">{{ g.name }}</td>
                    <td>{{ g.vehicles.length }}</td>
                    <td class="text-xs text-text-dim">{{ patentesPreview(g.vehicles) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <div class="card">
        <div class="card-header">
          <app-icon name="send" [size]="16" class="text-text-dim" />
          <h2>Envíos recientes</h2>
          <div class="flex-1"></div>
          <a routerLink="/envios" class="text-accent text-xs">Ver todos →</a>
        </div>
        @if (loadingSends()) {
          <div class="card-body-tight">
            <table class="tbl">
              <thead>
                <tr><th>Patente</th><th>Servicio</th><th>Fecha</th><th>Estado</th></tr>
              </thead>
              <tbody>
                @for (i of [0,1,2,3,4]; track i) {
                  <app-skeleton-row [cells]="4" />
                }
              </tbody>
            </table>
          </div>
        } @else if (sends().length === 0) {
          <div class="card-body text-text-dim text-center py-6">
            Aún no se ha enviado nada. Activa el auto-envío en algún grupo para empezar.
          </div>
        } @else {
          <div class="card-body-tight">
            <table class="tbl">
              <thead>
                <tr><th>Patente</th><th>Servicio</th><th>Fecha</th><th>Estado</th></tr>
              </thead>
              <tbody>
                @for (e of recentSends(); track $index) {
                  <tr>
                    <td><b>{{ e.patente || '—' }}</b></td>
                    <td><app-badge kind="muted">{{ e.service }}</app-badge></td>
                    <td>{{ fmtDate(e.ts) }}</td>
                    <td>
                      <app-badge [kind]="e.ok ? (e.accepted ? 'ok' : 'warn') : 'err'">
                        {{ e.error ? 'error' : (e.accepted ? '✓' : (e.ok ? '⚠' : '✗')) }}
                      </app-badge>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    </div>
  `,
})
export class ResumenComponent implements OnInit {
  store = inject(VehicleStoreService);
  api = inject(ApiService);

  sends = signal<UnifiedSend[]>([]);
  loadingSends = signal(true);
  fmtDate = fmtDate;

  recentSends = computed(() => this.sends().slice(0, 10));
  activos = computed(() => this.store.list().filter(v => v.position && (ageMinutes(v.position.ts) ?? Infinity) < 15).length);
  envios24h = computed(() => {
    const dayAgo = Date.now() - 86400 * 1000;
    return this.sends().filter(e => new Date(e.ts).getTime() >= dayAgo);
  });
  aceptados24h = computed(() => this.envios24h().filter(e => e.accepted).length);
  errores24h = computed(() => this.envios24h().filter(e => !e.ok).length);

  async ngOnInit() {
    if (this.store.list().length === 0) await this.store.poll();
    await this.loadAllHistories();
  }

  patentesPreview(vehicleIds: string[]): string {
    const list = this.store.list();
    const names = vehicleIds.map((id) => list.find((v) => v.id === id)?.plate || list.find((v) => v.id === id)?.name || id.slice(0, 8));
    if (names.length <= 5) return names.join(', ');
    return names.slice(0, 5).join(', ') + ` +${names.length - 5}`;
  }

  private async loadAllHistories() {
    this.loadingSends.set(true);
    const clients: ClientId[] = ['falabella', 'wise', 'drivin', 'bermann'];
    const labels: Record<ClientId, string> = { falabella: 'Falabella', wise: 'Wise', drivin: 'Drivin', bermann: 'Bermann' };
    try {
      const results = await Promise.all(
        clients.map((c) =>
          firstValueFrom(this.api.clientHistory(c, 500)).catch(() => ({ entries: [] as HistoryEntry[] }))
        )
      );
      const merged: UnifiedSend[] = [];
      for (let i = 0; i < clients.length; i++) {
        const c = clients[i]; const r = results[i];
        for (const e of r.entries || []) merged.push(this.normalize(e, c, labels[c]));
      }
      merged.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      this.sends.set(merged);
    } finally {
      this.loadingSends.set(false);
    }
  }

  private normalize(e: HistoryEntry, client: ClientId, service: string): UnifiedSend {
    if (client === 'falabella') return { ...e, service, patente: e.payload?.vehicleId || e.vehicleId, speed: e.payload?.speed?.value ?? null };
    if (client === 'wise') { const p0 = e.payload?.posicion?.[0]; return { ...e, service, patente: p0?.patente || e.vehicleId, speed: p0?.velocidad ?? null }; }
    if (client === 'drivin') { const p0 = e.payload?._json?.[0] || e.payload?.positions?.[0]; return { ...e, service, patente: p0?.vehicle_code || e.vehicleId, speed: p0?.speed != null ? Math.round(Number(p0.speed) * 3.6) : null }; }
    return { ...e, service, patente: e.payload?.patente || e.vehicleId, speed: e.payload?.velocidad ?? null };
  }
}
