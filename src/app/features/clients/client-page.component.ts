import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService, ClientId, GroupConfig } from '../../core/api.service';
import { VehicleStoreService } from '../../core/vehicle-store.service';
import { ToggleSwitchComponent } from '../../shared/toggle-switch.component';
import { LoadingCardComponent } from '../../shared/loading-card.component';
import { BadgeComponent } from '../../shared/badge.component';
import { IconComponent } from '../../shared/icon.component';
import { ToastService } from '../../core/toast.service';
import { fmtDate } from '../../core/format.utils';
import { firstValueFrom } from 'rxjs';

/**
 * Página genérica reutilizable para cada cliente (TMS / Wise / Drivin / Bermann).
 * Recibe el clientId vía route data. Carga config + grupos, renderiza la lista de grupos
 * con dropdown, intervalo, toggle auto-envío y botón "Enviar grupo".
 */
@Component({
  selector: 'app-client-page',
  standalone: true,
  imports: [ToggleSwitchComponent, LoadingCardComponent, BadgeComponent, IconComponent],
  template: `
    @if (loading()) {
      <app-loading-card msg="Cargando grupos…" />
    } @else {
      <!-- Entorno y endpoints (Test vs Producción) -->
      <div class="card">
        <div class="card-header">
          <app-icon name="globe" [size]="18" />
          <h2>Entorno y endpoints</h2>
          <div class="flex-1"></div>
          <app-badge kind="muted">{{ hasTestProd() ? 'Test + Producción' : 'Solo producción' }}</app-badge>
        </div>
        <div class="card-body space-y-3">
          @for (e of endpoints(); track e.env) {
            <div>
              <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                <span class="env-chip" [class.env-test]="e.env === 'test'" [class.env-prod]="e.env === 'prod'">{{ e.env }}</span>
                <span class="text-sm font-semibold">{{ e.label }}</span>
                <span [class]="e.configured ? 'badge badge-ok' : 'badge badge-err'">
                  {{ e.configured ? 'credenciales ok' : 'sin credenciales' }}
                </span>
              </div>
              <div class="url-box" [class.is-test]="e.env === 'test'" [class.is-prod]="e.env === 'prod'">
                <app-icon name="link" [size]="13" />
                <span>{{ e.url || '— no configurada —' }}</span>
              </div>
            </div>
          }
          @if (hasTestProd()) {
            <p class="text-xs text-text-dim pt-0.5">
              El entorno se elige por grupo (más abajo). El color indica a dónde van las posiciones:
              <span class="env-chip env-test">test</span> = UAT,
              <span class="env-chip env-prod">prod</span> = producción real.
            </p>
          }
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h2>Grupos (sincronizados desde fm-track)</h2></div>
        <div class="card-body">
          @if (groupList().length === 0) {
            <div class="text-center text-text-dim py-8">
              No hay grupos asignados a este cliente. Define <code>{{ envHint() }}_GROUPS</code> en .env.
            </div>
          } @else {
            @for (g of groupList(); track g.id) {
              <div class="card" style="margin-bottom: 10px;">
                <div class="card-header cursor-pointer select-none" (click)="toggleOpen(g.id)">
                  <span class="inline-block transition-transform" [style.transform]="openId() === g.id ? 'rotate(90deg)' : 'rotate(0deg)'" style="color: var(--text-dim); width: 14px;">▸</span>
                  <span class="font-semibold text-[15px]">{{ g.name }}</span>
                  @if (hasTestProd()) {
                    <span class="env-chip" [class.env-test]="activeEnv(g) === 'test'" [class.env-prod]="activeEnv(g) === 'prod'">{{ activeEnv(g) }}</span>
                  }
                  <app-badge kind="muted">{{ g.vehicles.length }} vehículos</app-badge>
                  <app-badge [kind]="g.enabled ? 'ok' : 'muted'">{{ g.enabled ? 'auto · cada ' + g.intervalSec + 's' : 'auto pausado' }}</app-badge>
                  <div class="flex-1"></div>
                  <button class="btn inline-flex items-center gap-2" [disabled]="sendingGroupId() === g.id" (click)="$event.stopPropagation(); sendGroup(g)">
                    @if (sendingGroupId() === g.id) { <span class="spin spin-light"></span> Enviando… } @else { Enviar grupo }
                  </button>
                </div>
                @if (openId() === g.id) {
                  <div class="card-body">
                    @if (hasTestProd()) {
                      <div class="flex items-center gap-3 p-2.5 mb-3 rounded flex-wrap" style="background: var(--bg-soft); border: 1px solid var(--border);">
                        <span class="font-semibold text-sm">Entorno de envío</span>
                        <div class="seg">
                          <button type="button" [class.on-test]="activeEnv(g) === 'test'" (click)="updateGroup(g, { env: 'test' })">TEST</button>
                          <button type="button" [class.on-prod]="activeEnv(g) === 'prod'" (click)="updateGroup(g, { env: 'prod' })">PROD</button>
                        </div>
                        @if (activeEnv(g) === 'prod') {
                          <span class="text-xs" style="color:#ef4444;">⚠ enviando a producción real</span>
                        }
                      </div>
                    }
                    <div class="mb-3">
                      <div class="text-xs text-text-dim mb-1">Enviando posiciones a:</div>
                      <div class="url-box" [class.is-test]="activeUrl(g).env === 'test'" [class.is-prod]="activeUrl(g).env === 'prod'">
                        <app-icon name="link" [size]="13" />
                        <span>{{ activeUrl(g).url || '— no configurada —' }}</span>
                      </div>
                    </div>
                    <div class="flex items-center gap-4 p-2.5 mb-3 rounded" style="background: var(--bg-soft); border: 1px solid var(--border);">
                      <span class="font-semibold">Auto-envío</span>
                      <app-toggle-switch [checked]="g.enabled" (checkedChange)="updateGroup(g, { enabled: $event })" />
                      <span [class.text-ok]="g.enabled" [class.text-text-dim]="!g.enabled">
                        {{ g.enabled ? 'Enviando automáticamente' : 'Pausado' }}
                      </span>
                    </div>
                    <div class="flex gap-3 mb-3 items-end">
                      <label class="text-xs text-text-dim block">
                        Intervalo (seg)
                        <input class="input block mt-1" type="number" min="5" [value]="g.intervalSec"
                          (change)="onIntervalChange(g, $event)" style="width: 90px;" />
                      </label>
                    </div>
                    @if (g.lastRunAt) {
                      <small class="text-text-dim">último: {{ fmtDate(g.lastRunAt) }} · {{ g.lastSummary?.accepted ?? 0 }}/{{ g.lastSummary?.total ?? 0 }} aceptados</small>
                    } @else {
                      <small class="text-text-dim">sin envíos automáticos aún</small>
                    }
                    <div class="flex flex-wrap gap-2 mt-3">
                      @for (vid of g.vehicles; track vid) {
                        <button class="veh-send" [disabled]="isSending(vid)" (click)="sendOne(g, vid)"
                          [title]="'Enviar posición de ' + labelFor(vid)">
                          <span>{{ labelFor(vid) }}</span>
                          @if (isSending(vid)) { <span class="spin"></span> } @else { <span class="veh-send-arrow">↗</span> }
                        </button>
                      }
                    </div>
                  </div>
                }
              </div>
            }
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .veh-send {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 7px 12px; font-size: 13px; font-weight: 600;
      background: var(--bg-soft); border: 1px solid var(--border);
      border-radius: 8px; color: var(--text); cursor: pointer;
    }
    .veh-send:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    .veh-send:disabled { opacity: 0.7; cursor: default; }
    .veh-send-arrow { color: var(--accent); }
    .spin {
      width: 13px; height: 13px; border-radius: 50%; display: inline-block; flex: none;
      border: 2px solid var(--accent-soft); border-top-color: var(--accent);
      animation: veh-spin 0.6s linear infinite;
    }
    .spin-light { border-color: rgba(255, 255, 255, 0.35); border-top-color: #fff; }
    @keyframes veh-spin { to { transform: rotate(360deg); } }
  `],
})
export class ClientPageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  store = inject(VehicleStoreService);

  client = signal<ClientId>('falabella');
  cfg = signal<any>({});
  groups = signal<Record<string, GroupConfig>>({});
  loading = signal(true);
  openId = signal<string | null>(null);
  // Envíos en curso: ids de vehículos con send-one activo y grupo con send activo
  sendingIds = signal<Set<string>>(new Set());
  sendingGroupId = signal<string | null>(null);
  fmtDate = fmtDate;

  groupList = computed(() => Object.values(this.groups()));
  envHint = computed(() => this.client().toUpperCase());

  // ¿Este cliente distingue Test vs Producción? (solo Falabella hoy)
  hasTestProd = computed(() => this.client() === 'falabella');

  // Endpoints disponibles del cliente, con su entorno, URL y si tiene credenciales.
  endpoints = computed<{ env: 'test' | 'prod'; label: string; url: string; configured: boolean }[]>(() => {
    const cfg = this.cfg() || {};
    if (this.client() === 'falabella') {
      return [
        { env: 'test', label: 'Test (UAT)', url: cfg.testUrl || '', configured: !!cfg.apikeyTestConfigured },
        { env: 'prod', label: 'Producción', url: cfg.prodUrl || '', configured: !!cfg.apikeyProdConfigured },
      ];
    }
    // Wise / Drivin / Bermann / Qanalytics: una sola URL. Por defecto es producción,
    // salvo que el backend indique env 'test' (ej: Qanalytics apuntando a la API _test).
    const configured = !!(cfg.tokenConfigured ?? cfg.keyConfigured ?? cfg.credentialsConfigured);
    const env: 'test' | 'prod' = cfg.env === 'test' ? 'test' : 'prod';
    return [{ env, label: env === 'test' ? 'Test' : 'Producción', url: cfg.url || '', configured }];
  });

  // Entorno activo de un grupo (Falabella usa g.env; default 'test').
  // Otros clientes: el env que declare su config (ej: Qanalytics test), default prod.
  activeEnv(g: GroupConfig): 'test' | 'prod' {
    if (this.client() !== 'falabella') return (this.cfg() || {}).env === 'test' ? 'test' : 'prod';
    return g.env === 'prod' ? 'prod' : 'test';
  }
  // URL a la que realmente se envía según el entorno activo del grupo.
  activeUrl(g: GroupConfig): { env: 'test' | 'prod'; url: string } {
    const cfg = this.cfg() || {};
    if (this.client() !== 'falabella') return { env: this.activeEnv(g), url: cfg.url || '' };
    const env = this.activeEnv(g);
    return { env, url: env === 'prod' ? (cfg.prodUrl || '') : (cfg.testUrl || '') };
  }

  async ngOnInit() {
    const c = this.route.snapshot.data['client'] as ClientId;
    this.client.set(c);
    if (this.store.list().length === 0) this.store.poll();
    await this.refresh();
  }

  async refresh() {
    this.loading.set(true);
    try {
      const [cfg, gr] = await Promise.all([
        firstValueFrom(this.api.clientConfig(this.client())),
        firstValueFrom(this.api.clientGroups(this.client())),
      ]);
      this.cfg.set(cfg);
      this.groups.set(gr.groups || {});
    } finally {
      this.loading.set(false);
    }
  }

  toggleOpen(id: string) { this.openId.set(this.openId() === id ? null : id); }

  labelFor(vid: string) {
    const v = this.store.list().find((x) => x.id === vid);
    return v?.plate || v?.name || vid.slice(0, 8);
  }

  async updateGroup(g: GroupConfig, patch: Partial<GroupConfig>) {
    try {
      const updated = await firstValueFrom(this.api.updateClientGroup(this.client(), g.id, patch));
      this.groups.update((cur) => ({ ...cur, [g.id]: { ...cur[g.id], ...updated } }));
    } catch {}
  }

  onIntervalChange(g: GroupConfig, event: Event) {
    const value = Number((event.target as HTMLInputElement).value) || g.intervalSec;
    this.updateGroup(g, { intervalSec: Math.max(5, value) });
  }

  isSending(vid: string) { return this.sendingIds().has(vid); }

  async sendOne(g: GroupConfig, vid: string) {
    if (this.isSending(vid)) return;
    const label = this.labelFor(vid);
    this.sendingIds.update((s) => new Set(s).add(vid));
    try {
      const r: any = await firstValueFrom(this.api.sendOne(this.client(), { vehicleId: vid, groupId: g.id }));
      console.log(`[${this.client()} send-one]`, r);
      if (r.accepted) this.toast.ok(`${label}: ✓ aceptado`);
      else if (r.ok) this.toast.warn(`${label}: ${r.response?.message || r.message || 'rechazo lógico'}`);
      else this.toast.err(`${label}: HTTP ${r.status ?? 0} · ${r.error || r.response?.error || ''}`);
    } catch (err: any) {
      this.toast.err(`${label}: ${err?.message || err}`);
    } finally {
      this.sendingIds.update((s) => { const n = new Set(s); n.delete(vid); return n; });
    }
  }

  async sendGroup(g: GroupConfig) {
    if (this.sendingGroupId() === g.id) return;
    this.sendingGroupId.set(g.id);
    try {
      const r = await firstValueFrom(this.api.sendGroup(this.client(), g.id));
      const results = r.results || [];
      const accepted = results.filter((x) => x.accepted).length;
      const failed = results.filter((x) => !x.ok).length;
      console.log(`[${this.client()} send-group "${g.name}"]`, r);
      if (failed) this.toast.err(`Grupo "${g.name}": ${accepted} aceptados · ${failed} fallidos`);
      else if (accepted === results.length) this.toast.ok(`Grupo "${g.name}": ${accepted} aceptados`);
      else this.toast.warn(`Grupo "${g.name}": ${accepted}/${results.length} aceptados (resto sin tracking)`);
      await this.refresh();
    } catch (err: any) {
      this.toast.err(`Grupo "${g.name}": ${err?.message || err}`);
    } finally {
      this.sendingGroupId.set(null);
    }
  }
}
