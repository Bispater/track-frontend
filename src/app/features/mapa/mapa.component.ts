import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import * as L from 'leaflet';
import { Subscription, firstValueFrom } from 'rxjs';
import { ApiService, TrackResponse, TrackStop, TrackTrip } from '../../core/api.service';
import { StoredVehicle, VehicleStoreService } from '../../core/vehicle-store.service';
import { HotkeysService } from '../../core/hotkeys.service';
import { IconComponent } from '../../shared/icon.component';
import { ageMinutes, fmtDate, fmtNum, relativeTime } from '../../core/format.utils';

/**
 * Mapa · posiciones en vivo + historial por vehículo.
 *  - Marcadores: camión visto desde arriba, rotado según el rumbo, coloreado por estado.
 *  - Varios mapas base (calles, claro, oscuro, satélite, híbrido, relieve) con control Leaflet.
 *  - Panel lateral: lista filtrable de la flota → detalle del vehículo → historial
 *    (recorrido dibujado, km, viajes, paradas) leído de fm-track vía /api/vehicles/:id/track.
 *  - ?v=<id> en la URL preselecciona un vehículo (link desde Vehículos).
 */

type VehState = 'moving' | 'idle' | 'off' | 'stale' | 'nodata';
type StateFilter = 'all' | VehState;
type RangeKey = 'hoy' | 'ayer' | '24h' | '48h' | '7d' | 'dia';

const STATE_LABEL: Record<VehState, string> = {
  moving: 'En movimiento', idle: 'Detenido · motor encendido', off: 'Detenido',
  stale: 'Sin reportes (+24 h)', nodata: 'Sin posición',
};
const VIEW_KEY = 'track-service.map.view.v1';
const BASE_KEY = 'track-service.map.base.v1';
const LABELS_KEY = 'track-service.map.labels.v1';
const COLORS = { route: '#6366f1', casing: '#ffffff', trip: '#fbbd23', start: '#22c55e', end: '#ef4444' };

// Camión visto desde arriba apuntando al norte (0°); se rota con position.direction.
const TRUCK_SVG = `<svg viewBox="0 0 32 48" xmlns="http://www.w3.org/2000/svg">
<rect class="tk-wheel" x="3" y="9" width="4" height="7" rx="1"/><rect class="tk-wheel" x="25" y="9" width="4" height="7" rx="1"/>
<rect class="tk-wheel" x="3" y="33" width="4" height="9" rx="1"/><rect class="tk-wheel" x="25" y="33" width="4" height="9" rx="1"/>
<rect class="tk-body" x="6" y="17" width="20" height="28" rx="2"/>
<rect class="tk-cab" x="7" y="3" width="18" height="13" rx="3"/>
<rect class="tk-glass" x="9.5" y="5" width="13" height="3.5" rx="1"/>
</svg>`;

// Leaflet busca sus imágenes de marcador en la raíz del sitio y da 404 al empaquetar.
// Las servimos desde /assets/leaflet (ver angular.json) y fijamos el icono por defecto.
L.Marker.prototype.options.icon = L.icon({
  iconRetinaUrl: '/assets/leaflet/marker-icon-2x.png',
  iconUrl: '/assets/leaflet/marker-icon.png',
  shadowUrl: '/assets/leaflet/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], tooltipAnchor: [16, -28], shadowSize: [41, 41],
});

function loadJson<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
function saveJson(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}
function dayStr(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

@Component({
  selector: 'app-mapa',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="map-shell card">
      <!-- ===== Mapa ===== -->
      <div class="map-area">
        <div #mapEl class="map-el"></div>
        <div class="map-toolbar">
          <button class="mt-btn" (click)="fitFleet()" title="Ver toda la flota"><app-icon name="expand" [size]="15" /></button>
          <button class="mt-btn" [class.on]="labels()" (click)="toggleLabels()" title="Mostrar nombres (desde zoom 10)"><app-icon name="tag" [size]="15" /></button>
          @if (selectedId()) {
            <button class="mt-btn" [class.on]="follow()" (click)="toggleFollow()" title="Seguir al vehículo seleccionado"><app-icon name="crosshair" [size]="15" /></button>
          }
        </div>
        <div class="map-legend">
          <span class="badge badge-muted">{{ countVisible() }} en el mapa</span>
          <span><i class="dot st-moving"></i>En movimiento</span>
          <span><i class="dot st-idle"></i>Motor encendido</span>
          <span><i class="dot st-off"></i>Detenido</span>
          <span><i class="dot st-stale"></i>Sin reportes</span>
        </div>
      </div>

      <!-- ===== Panel lateral ===== -->
      <aside class="map-panel">
        @if (selected(); as v) {
          <div class="panel-head">
            <button class="btn-ghost-sm" (click)="select(null)" title="Volver a la flota (Esc)">← Flota</button>
            <div class="flex-1 min-w-0">
              <div class="font-bold text-[15px] truncate">{{ v.name }}</div>
              <div class="text-[11px] text-text-dim truncate">{{ v.plate || v.imei }}</div>
            </div>
            <i class="dot big" [class]="'dot big st-' + stateOf(v)" [title]="stateLabel(v)"></i>
          </div>
          <div class="panel-scroll">
            @if (v.position; as p) {
              <div class="state-line st-text-{{ stateOf(v) }}">{{ stateLabel(v) }}</div>
              <div class="kv">
                <div><span class="k">Velocidad</span><span class="v">{{ fmtNum(p.speed ?? 0, 0) }} km/h</span></div>
                <div><span class="k">Rumbo</span><span class="v">{{ compass(p.direction) }}</span></div>
                <div><span class="k">Ignición</span><span class="v">{{ p.ignition || '—' }}</span></div>
                <div><span class="k">Último reporte</span><span class="v">{{ relativeTime(p.ts) }}</span></div>
              </div>
              <div class="hint">
                {{ fmtDate(p.ts) }} ·
                <a class="lnk" [href]="gmaps(p.lat!, p.lng!)" target="_blank" rel="noopener">Google Maps <app-icon name="external" [size]="11" /></a>
                · <button class="lnk" (click)="centerOn(v.id)">centrar</button>
              </div>
            } @else {
              <div class="empty">Este vehículo no tiene posición reciente.</div>
            }

            <div class="sec-title"><app-icon name="history" [size]="14" /> Historial</div>
            <div class="range-row">
              <div class="seg-range">
                @for (r of ranges; track r.key) {
                  <button type="button" [class.on]="range() === r.key" (click)="setRange(r.key)">{{ r.label }}</button>
                }
              </div>
              <input class="input day-input" type="date" [value]="day()" [max]="todayStr" (change)="setDay(input($event))" title="Un día específico" />
            </div>

            @if (trackLoading()) {
              <div class="empty"><span class="spin"></span> Consultando recorrido en fm-track…</div>
            } @else if (trackError()) {
              <div class="empty text-err">{{ trackError() }} <button class="lnk" (click)="loadTrack()">reintentar</button></div>
            } @else {
              @if (track(); as t) {
              @if (!t.pointsTotal) {
                <div class="empty">Sin posiciones reportadas en el rango.</div>
              } @else {
                <div class="kpis">
                  <div class="kpi">
                    <div class="kpi-label">Distancia</div>
                    <div class="kpi-value">{{ fmtNum(t.summary.distanceKm, 1) }} <small>km</small></div>
                    <div class="kpi-sub">{{ t.summary.odometerKm != null ? 'odómetro: ' + fmtNum(t.summary.odometerKm, 1) + ' km' : 'según GPS' }}</div>
                  </div>
                  <div class="kpi">
                    <div class="kpi-label">Viajes</div>
                    <div class="kpi-value">{{ t.summary.trips }}</div>
                    <div class="kpi-sub">{{ t.summary.stops }} paradas</div>
                  </div>
                  <div class="kpi">
                    <div class="kpi-label">En movimiento</div>
                    <div class="kpi-value">{{ fmtDur(t.summary.movingSec) }}</div>
                    <div class="kpi-sub">detenido {{ fmtDur(t.summary.stoppedSec) }}</div>
                  </div>
                  <div class="kpi">
                    <div class="kpi-label">Velocidad máx.</div>
                    <div class="kpi-value">{{ t.summary.maxSpeed }} <small>km/h</small></div>
                    <div class="kpi-sub">promedio {{ fmtNum(t.summary.avgSpeed, 0) }} km/h</div>
                  </div>
                </div>
                <div class="hint">
                  {{ t.pointsTotal }} posiciones · {{ fmtDate(t.summary.firstTs) }} → {{ fmtDate(t.summary.lastTs) }}
                  @if (t.truncated) { <span class="text-warn"> · muestra parcial (rango muy largo)</span> }
                </div>

                <div class="sec-title">Viajes <span class="cnt">{{ t.trips.length }}</span>
                  @if (selectedTrip() !== null) { <button class="lnk ml-auto" (click)="clearTrip()">quitar resaltado</button> }
                </div>
                @if (!t.trips.length) { <div class="empty">Sin desplazamientos en el rango.</div> }
                @for (tr of t.trips; track tr.idx) {
                  <button class="ev-row" [class.on]="selectedTrip() === tr.idx" (click)="focusTrip(tr)">
                    <span class="ev-n">{{ tr.idx + 1 }}</span>
                    <span class="ev-main">
                      <b>{{ fmtT(tr.startTs) }}</b> → <b>{{ fmtT(tr.endTs) }}</b>
                      <small>{{ fmtDur(tr.durationSec) }} · máx {{ tr.maxSpeed }} km/h · prom {{ fmtNum(tr.avgSpeed, 0) }} km/h</small>
                    </span>
                    <span class="ev-val">{{ fmtNum(tr.distanceKm, 1) }} km</span>
                  </button>
                }

                <div class="sec-title">Paradas <span class="cnt">{{ t.stops.length }}</span></div>
                @if (!t.stops.length) { <div class="empty">Sin paradas de 5 min o más.</div> }
                @for (st of t.stops; track st.idx) {
                  <button class="ev-row" (click)="focusStop(st)">
                    <span class="ev-n stop" [class.off]="st.ignitionOff">{{ st.idx + 1 }}</span>
                    <span class="ev-main">
                      <b>{{ fmtT(st.startTs) }}</b> → <b>{{ st.ongoing ? 'ahora' : fmtT(st.endTs) }}</b>
                      <small>{{ st.ignitionOff ? 'motor apagado' : 'motor encendido' }} · {{ fmtNum(st.lat, 5) }}, {{ fmtNum(st.lng, 5) }}</small>
                    </span>
                    <span class="ev-val">{{ fmtDur(st.durationSec) }}</span>
                  </button>
                }
              }
              }
            }
          </div>
        } @else {
          <div class="panel-head">
            <div class="relative flex-1">
              <app-icon name="search" [size]="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" />
              <input #searchInput class="input pl-8 w-full" type="search" placeholder="Patente, nombre o IMEI…  (/)"
                [value]="search()" (input)="search.set(input($event))" />
            </div>
          </div>
          <div class="chips">
            @for (f of filters; track f.key) {
              <button class="chip" [class.on]="stateFilter() === f.key" (click)="stateFilter.set(f.key)">
                @if (f.key !== 'all') { <i class="dot" [class]="'dot st-' + f.key"></i> }
                {{ f.label }} <b>{{ counts()[f.key] }}</b>
              </button>
            }
          </div>
          <div class="panel-scroll">
            @for (v of filtered(); track v.id) {
              <button class="veh-row" (click)="select(v.id, true)">
                <i class="dot" [class]="'dot st-' + stateOf(v)"></i>
                <span class="veh-name">{{ v.name }}</span>
                <span class="veh-meta">{{ v.position?.speed != null ? fmtNum(v.position?.speed, 0) + ' km/h' : '—' }}</span>
                <span class="veh-meta dim">{{ v.position ? relativeTime(v.position.ts) : 'sin posición' }}</span>
              </button>
            }
            @if (!filtered().length) {
              <div class="empty">{{ store.list().length ? 'Sin vehículos para el filtro.' : 'Esperando datos de fm-track…' }}</div>
            }
          </div>
        }
      </aside>
    </div>
  `,
  styles: [`
    .map-shell {
      display: grid; grid-template-columns: 1fr 360px; margin-bottom: 0;
      height: calc(100vh - 110px); min-height: 520px;
    }
    @media (max-width: 1000px) { .map-shell { grid-template-columns: 1fr; grid-template-rows: 1fr 340px; } }
    .map-area { position: relative; min-width: 0; min-height: 0; }
    .map-el { position: absolute; inset: 0; }
    .map-toolbar { position: absolute; top: 10px; left: 54px; z-index: 800; display: flex; gap: 6px; }
    .mt-btn {
      width: 32px; height: 32px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center;
      background: var(--bg-elev); color: var(--text-dim); border: 1px solid var(--border); box-shadow: var(--shadow); cursor: pointer;
    }
    .mt-btn:hover { color: var(--text); }
    .mt-btn.on { background: var(--accent); color: #fff; border-color: var(--accent); }
    .map-legend {
      position: absolute; left: 10px; bottom: 10px; z-index: 800; display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
      padding: 5px 10px; border-radius: 8px; font-size: 11px; color: var(--text);
      background: var(--bg-elev); border: 1px solid var(--border); box-shadow: var(--shadow);
    }
    .map-legend span { display: inline-flex; align-items: center; gap: 5px; }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #64748b; flex: none; }
    .dot.big { width: 12px; height: 12px; }
    .dot.st-moving { background: #22c55e; } .dot.st-idle { background: #f59e0b; } .dot.st-stale { background: #ef4444; }
    .dot.st-nodata { background: transparent; border: 1.5px solid var(--text-dim); }
    .st-text-moving { color: #22c55e; } .st-text-idle { color: #f59e0b; } .st-text-stale { color: #ef4444; }
    .st-text-off, .st-text-nodata { color: var(--text-dim); }
    .state-line { padding: 10px 14px 0; font-size: 12px; font-weight: 700; }

    .map-panel { display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--border); background: var(--bg-elev); }
    @media (max-width: 1000px) { .map-panel { border-left: none; border-top: 1px solid var(--border); } }
    .panel-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
    .panel-scroll { flex: 1; overflow: auto; min-height: 0; padding-bottom: 12px; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg-soft); }
    .chip {
      display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 11.5px; cursor: pointer;
      background: var(--bg-elev); color: var(--text-dim); border: 1px solid var(--border);
    }
    .chip b { font-weight: 700; color: var(--text); }
    .chip.on { background: var(--accent); color: #fff; border-color: var(--accent); }
    .chip.on b { color: #fff; }
    .veh-row {
      display: grid; grid-template-columns: 12px 1fr auto auto; gap: 10px; align-items: center; width: 100%;
      padding: 8px 14px; border: none; border-bottom: 1px solid var(--border); background: transparent; color: var(--text);
      text-align: left; cursor: pointer; font-size: 13px;
    }
    .veh-row:hover { background: var(--bg-soft); }
    .veh-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .veh-meta { font-size: 11.5px; font-variant-numeric: tabular-nums; }
    .veh-meta.dim { color: var(--text-dim); min-width: 62px; text-align: right; }
    .empty { padding: 16px 14px; color: var(--text-dim); font-size: 12.5px; display: flex; align-items: center; gap: 8px; }
    .hint { padding: 6px 14px 4px; font-size: 11px; color: var(--text-dim); display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .lnk { color: var(--accent); background: none; border: none; padding: 0; cursor: pointer; font-size: inherit; display: inline-flex; align-items: center; gap: 3px; text-decoration: none; }
    .lnk:hover { text-decoration: underline; }
    .kv { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; padding: 8px 14px 4px; }
    .kv > div { display: flex; flex-direction: column; }
    .kv .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim); font-weight: 600; }
    .kv .v { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .sec-title {
      display: flex; align-items: center; gap: 6px; padding: 12px 14px 6px; font-size: 11px; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--text-dim); font-weight: 700;
    }
    .sec-title .cnt { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 999px; padding: 0 7px; font-size: 10.5px; color: var(--text); }
    .range-row { display: flex; align-items: center; gap: 8px; padding: 0 14px 8px; flex-wrap: wrap; }
    .seg-range { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .seg-range button { padding: 4px 9px; font-size: 12px; font-weight: 600; background: transparent; border: none; color: var(--text-dim); cursor: pointer; }
    .seg-range button + button { border-left: 1px solid var(--border); }
    .seg-range button.on { background: var(--accent); color: #fff; }
    .day-input { padding: 3px 6px; font-size: 12px; }
    .kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 4px 14px; }
    .kpi { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
    .kpi-label { font-size: 10.5px; color: var(--text-dim); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .kpi-value { font-size: 20px; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums; }
    .kpi-value small { font-size: 11px; font-weight: 600; color: var(--text-dim); }
    .kpi-sub { font-size: 11px; color: var(--text-dim); }
    .ev-row {
      display: grid; grid-template-columns: 24px 1fr auto; gap: 10px; align-items: center; width: 100%;
      padding: 7px 14px; border: none; border-bottom: 1px solid var(--border); background: transparent; color: var(--text);
      text-align: left; cursor: pointer; font-size: 12.5px;
    }
    .ev-row:hover { background: var(--bg-soft); }
    .ev-row.on { background: rgba(251, 189, 35, 0.14); }
    .ev-n {
      width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      background: var(--accent); color: #fff; font-size: 11px; font-weight: 700;
    }
    .ev-n.stop { background: #f59e0b; } .ev-n.stop.off { background: #64748b; }
    .ev-main { display: flex; flex-direction: column; min-width: 0; }
    .ev-main small { color: var(--text-dim); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ev-val { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .btn-ghost-sm { padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer; background: transparent; border: 1px solid var(--border); color: var(--text-dim); white-space: nowrap; }
    .btn-ghost-sm:hover { color: var(--accent); border-color: var(--accent); }
    .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--border); border-top-color: var(--accent); animation: spin 0.7s linear infinite; flex: none; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
})
export class MapaComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapEl') mapEl!: ElementRef<HTMLDivElement>;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  store = inject(VehicleStoreService);
  private api = inject(ApiService);
  private hotkeys = inject(HotkeysService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private hkSub?: Subscription;
  private resizeObs?: ResizeObserver;

  private map?: L.Map;
  private markers = new Map<string, L.Marker>();
  private markerKeys = new Map<string, string>();
  private markersLayer = L.layerGroup();
  private routeLayer = L.layerGroup();
  private tripLayer = L.layerGroup();
  private zoom = 6;
  private fitted = false;
  private restoredView = false;
  private pendingSelect: string | null = null;
  private reqSeq = 0;

  // ---- estado UI ----
  search = signal('');
  stateFilter = signal<StateFilter>('all');
  selectedId = signal<string | null>(null);
  follow = signal(false);
  labels = signal(loadJson<boolean>(LABELS_KEY) ?? true);
  countVisible = signal(0);
  range = signal<RangeKey>('hoy');
  day = signal('');
  track = signal<TrackResponse | null>(null);
  trackLoading = signal(false);
  trackError = signal<string | null>(null);
  selectedTrip = signal<number | null>(null);
  readonly todayStr = dayStr(new Date());

  readonly ranges: { key: RangeKey; label: string }[] = [
    { key: 'hoy', label: 'Hoy' }, { key: 'ayer', label: 'Ayer' }, { key: '24h', label: '24 h' },
    { key: '48h', label: '48 h' }, { key: '7d', label: '7 días' },
  ];
  readonly filters: { key: StateFilter; label: string }[] = [
    { key: 'all', label: 'Todos' }, { key: 'moving', label: 'Moviéndose' }, { key: 'idle', label: 'Encendidos' },
    { key: 'off', label: 'Detenidos' }, { key: 'stale', label: 'Sin reportes' },
  ];

  fmtDate = fmtDate;
  fmtNum = fmtNum;
  relativeTime = relativeTime;

  selected = computed(() => {
    const id = this.selectedId();
    return id ? this.store.list().find((v) => v.id === id) || null : null;
  });
  counts = computed(() => {
    const c: Record<StateFilter, number> = { all: 0, moving: 0, idle: 0, off: 0, stale: 0, nodata: 0 };
    for (const v of this.store.list()) { c.all++; c[this.stateOf(v)]++; }
    return c;
  });
  filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const f = this.stateFilter();
    return this.store.list().filter((v) => {
      if (f !== 'all' && this.stateOf(v) !== f) return false;
      if (!q) return true;
      return String(v.name).toLowerCase().includes(q) || String(v.imei).toLowerCase().includes(q) || String(v.plate || '').toLowerCase().includes(q);
    });
  });

  constructor() {
    // Cada poll del store (10 s) actualiza los marcadores sin recrearlos.
    // Solo se rastrea lastPollAt; refresh() escribe signals (countVisible, selección), por eso
    // corre en untracked y el effect permite escrituras.
    effect(() => {
      this.store.lastPollAt();
      if (this.map) untracked(() => this.refresh());
    }, { allowSignalWrites: true });
  }

  ngOnInit() {
    this.pendingSelect = this.route.snapshot.queryParamMap.get('v');
    this.hkSub = this.hotkeys.events.subscribe((ev) => {
      if (ev === 'escape') {
        if (this.selectedTrip() !== null) this.clearTrip();
        else if (this.selectedId()) this.select(null);
      } else if (ev === 'search') {
        if (this.selectedId()) this.select(null);
        setTimeout(() => this.searchInput?.nativeElement.focus());
      }
    });
  }

  ngAfterViewInit() {
    const view = loadJson<{ center: L.LatLngTuple; zoom: number }>(VIEW_KEY);
    this.restoredView = Boolean(view);
    const map = L.map(this.mapEl.nativeElement, { preferCanvas: true, zoomControl: true })
      .setView(view?.center || [-33.45, -70.66], view?.zoom || 6);
    this.map = map;
    this.zoom = map.getZoom();

    const bases = this.buildBaseLayers();
    const storedBase = loadJson<string>(BASE_KEY);
    const initial = storedBase && bases[storedBase] ? storedBase : 'Calles';
    bases[initial].addTo(map);
    this.markersLayer.addTo(map);
    this.routeLayer.addTo(map);
    this.tripLayer.addTo(map);
    L.control.layers(bases, { 'Vehículos': this.markersLayer, 'Recorrido': this.routeLayer }, { position: 'topright' }).addTo(map);

    map.on('baselayerchange', (e: L.LayersControlEvent) => saveJson(BASE_KEY, e.name));
    map.on('zoomend', () => {
      const prevBucket = this.iconSize();
      this.zoom = map.getZoom();
      if (this.iconSize() !== prevBucket || this.zoom >= 9) this.refreshIcons();
      this.saveView();
    });
    map.on('moveend', () => this.saveView());
    map.on('dragstart', () => this.follow.set(false));
    map.on('click', () => { if (this.selectedId()) this.select(null); });

    // El contenedor cambia de tamaño con el panel/ventana: Leaflet debe recalcular.
    this.resizeObs = new ResizeObserver(() => map.invalidateSize());
    this.resizeObs.observe(this.mapEl.nativeElement);
    this.refresh();
  }

  ngOnDestroy() {
    this.hkSub?.unsubscribe();
    this.resizeObs?.disconnect();
    this.map?.remove();
  }

  // ---------- capas base ----------
  private buildBaseLayers(): Record<string, L.Layer> {
    const osmAttr = '© OpenStreetMap';
    const cartoAttr = '© OpenStreetMap © CARTO';
    const esriAttr = 'Tiles © Esri — Maxar, Earthstar Geographics';
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: esriAttr });
    const satLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
    return {
      'Calles': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: osmAttr }),
      'Claro': L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 20, subdomains: 'abcd', attribution: cartoAttr }),
      'Oscuro': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, subdomains: 'abcd', attribution: cartoAttr }),
      'Satélite': sat,
      'Híbrido': L.layerGroup([
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: esriAttr }),
        satLabels,
      ]),
      'Relieve': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenStreetMap, SRTM · © OpenTopoMap' }),
    };
  }

  private saveView() {
    if (!this.map) return;
    const c = this.map.getCenter();
    saveJson(VIEW_KEY, { center: [c.lat, c.lng], zoom: this.map.getZoom() });
  }

  // ---------- estado de vehículo ----------
  stateOf(v: StoredVehicle): VehState {
    const p = v.position;
    if (!p || p.lat == null || p.lng == null) return 'nodata';
    const age = ageMinutes(p.ts);
    if (age == null || age > 24 * 60) return 'stale';
    if (age <= 15 && (p.speed ?? 0) > 3) return 'moving';
    if (age <= 15 && p.ignition === 'ON') return 'idle';
    return 'off';
  }
  stateLabel(v: StoredVehicle) { return STATE_LABEL[this.stateOf(v)]; }

  // ---------- marcadores ----------
  private iconSize() {
    const z = this.zoom;
    return z >= 12 ? 36 : z >= 9 ? 28 : z >= 7 ? 20 : 14;
  }
  private labelsVisible() { return this.labels() && this.zoom >= 10; }
  private iconKey(v: StoredVehicle) {
    const dir = Math.round((v.position?.direction ?? 0) / 5) * 5;
    return `${this.stateOf(v)}|${dir}|${this.iconSize()}|${v.id === this.selectedId() ? 1 : 0}|${this.labelsVisible() ? v.name : ''}`;
  }
  private buildIcon(v: StoredVehicle): L.DivIcon {
    const size = this.iconSize();
    const sel = v.id === this.selectedId();
    const dir = Math.round(v.position?.direction ?? 0);
    const html =
      `<div class="veh-marker st-${this.stateOf(v)}${sel ? ' sel' : ''}" style="width:${size}px;height:${size}px">` +
      `<div class="veh-rot" style="transform:rotate(${dir}deg)">${TRUCK_SVG}</div>` +
      (this.labelsVisible() ? `<span class="veh-label">${esc(v.name)}</span>` : '') +
      `</div>`;
    return L.divIcon({ html, className: 'veh-icon', iconSize: [size, size], iconAnchor: [size / 2, size / 2], tooltipAnchor: [0, -size / 2] });
  }
  private tooltipHtml(v: StoredVehicle) {
    const p = v.position!;
    return `<b>${esc(v.name)}</b>${v.plate ? ' · ' + esc(v.plate) : ''}<br>` +
      `${fmtNum(p.speed ?? 0, 0)} km/h · ${esc(STATE_LABEL[this.stateOf(v)])}<br>` +
      `<span style="color:var(--text-dim)">${esc(relativeTime(p.ts))}</span>`;
  }

  refresh() {
    if (!this.map) return;
    const seen = new Set<string>();
    const bounds: L.LatLngTuple[] = [];
    for (const v of this.store.list()) {
      const p = v.position;
      if (!p || p.lat == null || p.lng == null) continue;
      seen.add(v.id);
      const ll: L.LatLngTuple = [p.lat, p.lng];
      bounds.push(ll);
      const key = this.iconKey(v);
      let m = this.markers.get(v.id);
      if (!m) {
        m = L.marker(ll, { icon: this.buildIcon(v), riseOnHover: true });
        m.bindTooltip(this.tooltipHtml(v), { direction: 'top', opacity: 1 });
        m.on('click', (e) => { L.DomEvent.stopPropagation(e); this.select(v.id, false); });
        m.addTo(this.markersLayer);
        this.markers.set(v.id, m);
        this.markerKeys.set(v.id, key);
      } else {
        if (!m.getLatLng().equals(ll)) m.setLatLng(ll);
        if (this.markerKeys.get(v.id) !== key) { m.setIcon(this.buildIcon(v)); this.markerKeys.set(v.id, key); }
        m.setTooltipContent(this.tooltipHtml(v));
      }
      m.setZIndexOffset(v.id === this.selectedId() ? 1000 : 0);
    }
    for (const [id, m] of this.markers) {
      if (!seen.has(id)) { m.remove(); this.markers.delete(id); this.markerKeys.delete(id); }
    }
    this.countVisible.set(bounds.length);

    if (!this.fitted && bounds.length) {
      this.fitted = true;
      if (!this.restoredView && !this.pendingSelect) this.map.fitBounds(bounds, { padding: [40, 40] });
    }
    if (this.pendingSelect && this.store.list().some((v) => v.id === this.pendingSelect)) {
      const id = this.pendingSelect;
      this.pendingSelect = null;
      this.select(id, true);
    }
    if (this.follow() && this.selectedId()) {
      const m = this.markers.get(this.selectedId()!);
      if (m) this.map.panTo(m.getLatLng(), { animate: true });
    }
  }

  private refreshIcons() {
    for (const v of this.store.list()) {
      const m = this.markers.get(v.id);
      if (!m) continue;
      const key = this.iconKey(v);
      if (this.markerKeys.get(v.id) !== key) { m.setIcon(this.buildIcon(v)); this.markerKeys.set(v.id, key); }
    }
  }

  fitFleet() {
    if (!this.map || !this.markers.size) return;
    const pts = [...this.markers.values()].map((m) => m.getLatLng());
    this.map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
  }
  toggleLabels() {
    this.labels.set(!this.labels());
    saveJson(LABELS_KEY, this.labels());
    this.refreshIcons();
  }
  toggleFollow() {
    this.follow.set(!this.follow());
    if (this.follow() && this.selectedId()) this.centerOn(this.selectedId()!);
  }
  centerOn(id: string) {
    const m = this.markers.get(id);
    if (m && this.map) this.map.setView(m.getLatLng(), Math.max(this.map.getZoom(), 13), { animate: true });
  }

  // ---------- selección ----------
  select(id: string | null, center = false) {
    if (this.selectedId() === id) { if (id && center) this.centerOn(id); return; }
    this.selectedId.set(id);
    this.selectedTrip.set(null);
    this.track.set(null);
    this.trackError.set(null);
    this.clearRoute();
    this.refreshIcons();
    for (const [mid, m] of this.markers) m.setZIndexOffset(mid === id ? 1000 : 0);
    this.router.navigate([], { relativeTo: this.route, queryParams: { v: id || null }, queryParamsHandling: 'merge', replaceUrl: true });
    if (id) {
      if (center) this.centerOn(id);
      this.loadTrack();
    } else {
      this.follow.set(false);
    }
  }

  // ---------- historial ----------
  setRange(r: RangeKey) { this.range.set(r); this.day.set(''); this.loadTrack(); }
  setDay(v: string) {
    if (!v) { this.setRange('hoy'); return; }
    this.day.set(v); this.range.set('dia'); this.loadTrack();
  }
  private rangeBounds(): { from: Date; to: Date } {
    const now = new Date(); now.setSeconds(0, 0);
    const h = 3600 * 1000;
    switch (this.range()) {
      case 'ayer': { const to = startOfDay(now); return { from: new Date(to.getTime() - 24 * h), to }; }
      case '24h': return { from: new Date(now.getTime() - 24 * h), to: now };
      case '48h': return { from: new Date(now.getTime() - 48 * h), to: now };
      case '7d': return { from: new Date(now.getTime() - 7 * 24 * h), to: now };
      case 'dia': {
        const [y, m, d] = this.day().split('-').map(Number);
        const from = new Date(y, m - 1, d);
        const to = new Date(Math.min(from.getTime() + 24 * h, now.getTime()));
        return { from, to };
      }
      default: return { from: startOfDay(now), to: now };
    }
  }
  private rangeIsMultiDay() { return ['24h', '48h', '7d'].includes(this.range()); }

  async loadTrack() {
    const id = this.selectedId();
    if (!id) return;
    const { from, to } = this.rangeBounds();
    if (from >= to) { this.track.set(null); this.trackError.set('Rango vacío'); return; }
    const seq = ++this.reqSeq;
    this.trackLoading.set(true);
    this.trackError.set(null);
    this.selectedTrip.set(null);
    this.tripLayer.clearLayers();
    try {
      const t = await firstValueFrom(this.api.vehicleTrack(id, from.toISOString(), to.toISOString()));
      if (seq !== this.reqSeq) return;
      this.track.set(t);
      this.drawRoute(t);
    } catch (e: any) {
      if (seq !== this.reqSeq) return;
      this.trackError.set(e?.error?.error || e?.message || 'No se pudo cargar el recorrido');
      this.clearRoute();
    } finally {
      if (seq === this.reqSeq) this.trackLoading.set(false);
    }
  }

  private clearRoute() { this.routeLayer.clearLayers(); this.tripLayer.clearLayers(); }

  private drawRoute(t: TrackResponse) {
    this.clearRoute();
    if (!this.map || !t.path.length) return;
    const latlngs = t.path.map((r) => [r[0], r[1]] as L.LatLngTuple);
    if (latlngs.length > 1) {
      L.polyline(latlngs, { color: COLORS.casing, weight: 7, opacity: 0.6, lineJoin: 'round' }).addTo(this.routeLayer);
      L.polyline(latlngs, { color: COLORS.route, weight: 3.5, opacity: 0.95, lineJoin: 'round' }).addTo(this.routeLayer);
    }
    L.circleMarker(latlngs[0], { radius: 6, color: '#fff', weight: 2, fillColor: COLORS.start, fillOpacity: 1 })
      .bindTooltip(`Inicio · ${this.fmtT(t.summary.firstTs)}`).addTo(this.routeLayer);
    if (latlngs.length > 1) {
      L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: COLORS.end, fillOpacity: 1 })
        .bindTooltip(`Fin · ${this.fmtT(t.summary.lastTs)}`).addTo(this.routeLayer);
    }
    for (const s of t.stops) {
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: 'stop-icon', html: `<span class="stop-pin${s.ignitionOff ? ' off' : ''}">${s.idx + 1}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
        zIndexOffset: 500,
      })
        .bindTooltip(`Parada ${s.idx + 1} · ${this.fmtDur(s.durationSec)}<br>${this.fmtT(s.startTs)} → ${s.ongoing ? 'ahora' : this.fmtT(s.endTs)}<br>${s.ignitionOff ? 'motor apagado' : 'motor encendido'}`)
        .on('click', (e) => { L.DomEvent.stopPropagation(e); this.focusStop(s); })
        .addTo(this.routeLayer);
    }
    if (latlngs.length > 1 && !this.follow()) this.map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 15 });
  }

  focusTrip(tr: TrackTrip) {
    const t = this.track();
    if (!t || !this.map) return;
    if (this.selectedTrip() === tr.idx) { this.clearTrip(); return; }
    this.selectedTrip.set(tr.idx);
    this.tripLayer.clearLayers();
    const s = Date.parse(tr.startTs) / 1000, e = Date.parse(tr.endTs) / 1000;
    const pts = t.path.filter((r) => r[2] >= s && r[2] <= e).map((r) => [r[0], r[1]] as L.LatLngTuple);
    if (pts.length > 1) {
      L.polyline(pts, { color: COLORS.trip, weight: 6, opacity: 0.95, lineJoin: 'round' }).addTo(this.tripLayer);
      this.map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 });
    } else {
      this.map.setView([tr.start.lat, tr.start.lng], 14);
    }
    this.follow.set(false);
  }
  clearTrip() { this.selectedTrip.set(null); this.tripLayer.clearLayers(); }
  focusStop(s: TrackStop) {
    if (!this.map) return;
    this.follow.set(false);
    this.map.setView([s.lat, s.lng], Math.max(this.map.getZoom(), 15), { animate: true });
  }

  // ---------- formato ----------
  fmtT(ts: string | null | undefined) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return this.rangeIsMultiDay()
      ? d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  fmtDur(sec: number) {
    if (!Number.isFinite(sec) || sec < 0) return '—';
    if (sec < 60) return `${Math.round(sec)} s`;
    const m = Math.round(sec / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return `${h} h ${String(m % 60).padStart(2, '0')} min`;
  }
  compass(deg: number | null | undefined) {
    if (deg == null || !Number.isFinite(Number(deg))) return '—';
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    const d = ((Number(deg) % 360) + 360) % 360;
    return `${names[Math.round(d / 45) % 8]} · ${Math.round(d)}°`;
  }
  gmaps(lat: number, lng: number) { return `https://www.google.com/maps?q=${lat},${lng}`; }
  input(ev: Event): string { return (ev.target as HTMLInputElement).value; }
}
