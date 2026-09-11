import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ApiService, ClientId } from '../../core/api.service';
import { VehicleStoreService } from '../../core/vehicle-store.service';
import { LoadingCardComponent } from '../../shared/loading-card.component';
import { IconComponent } from '../../shared/icon.component';
import { fmtDate } from '../../core/format.utils';
import { firstValueFrom } from 'rxjs';

/**
 * Métricas · dashboard de gráficos sobre send_history (endpoint /api/stats/sends).
 * Paleta categórica validada (CVD-safe) por cliente, fija por entidad:
 * falabella=azul, wise=naranjo, drivin=aqua, bermann=amarillo, ds=magenta, qanalytics=verde.
 */

interface SeriesRow { bucket: string; client: string; aceptados: number; rechazados: number; errores: number; }
interface ClientRow { client: string; total: number; aceptados: number; rechazados: number; errores: number; vehiculos: number; }
interface ErrorRow { vehicle_id: string; client: string; fallos: number; ultimo: string; detalle: string; }

const CLIENT_ORDER: ClientId[] = ['falabella', 'wise', 'drivin', 'bermann', 'ds', 'qanalytics'];
const CLIENT_LABEL: Record<string, string> = {
  falabella: 'Falabella', wise: 'Wise', drivin: 'Drivin', bermann: 'Bermann', ds: 'DS', qanalytics: 'Qanalytics',
};

// Geometría del gráfico de columnas
const W = 760, H = 230, PL = 40, PR = 10, PT = 10, PB = 24;

interface Seg { x: number; y: number; w: number; h: number; client: string; top: boolean; }
interface TipRow { label: string; value: number; color: string; }

@Component({
  selector: 'app-metricas',
  standalone: true,
  imports: [LoadingCardComponent, IconComponent],
  template: `
    <!-- Filtros: una fila, arriba, escopa todo lo de abajo -->
    <div class="flex items-center gap-2 mb-4 flex-wrap">
      <div class="seg-range">
        @for (r of ranges; track r.hours) {
          <button type="button" [class.on]="hours() === r.hours" (click)="setRange(r.hours)">{{ r.label }}</button>
        }
      </div>
      <div class="flex-1"></div>
      <span class="text-xs text-text-dim">se conservan {{ retentionDays }} días de historial</span>
      <button class="icon-btn" (click)="refresh()" title="Actualizar"><app-icon name="refresh" [size]="16" /></button>
    </div>

    @if (loading()) {
      <app-loading-card msg="Cargando métricas…" />
    } @else {
      <div [style.opacity]="refreshing() ? 0.55 : 1" style="transition: opacity 0.15s;">

        <!-- KPI row -->
        <div class="grid gap-3 mb-4" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));">
          <div class="card kpi">
            <div class="kpi-label">Envíos</div>
            <div class="kpi-value">{{ fmtN(totales().total) }}</div>
            <div class="kpi-sub">
              @if (deltaEnvios() !== null) {
                <span [class]="deltaClass(deltaEnvios()!, 'neutral')">{{ signo(deltaEnvios()!) }}{{ deltaEnvios() }}%</span>
                vs período anterior
              } @else { en el rango }
            </div>
          </div>
          <div class="card kpi">
            <div class="kpi-label">Tasa de aceptación</div>
            <div class="kpi-value">{{ tasa() }}%</div>
            <div class="kpi-sub">
              @if (deltaTasa() !== null) {
                <span [class]="deltaClass(deltaTasa()!, 'up-good')">{{ signo(deltaTasa()!) }}{{ deltaTasa() }} pts</span>
                vs período anterior
              } @else { {{ fmtN(totales().aceptados) }} aceptados }
            </div>
          </div>
          <div class="card kpi">
            <div class="kpi-label">Errores</div>
            <div class="kpi-value">{{ fmtN(totales().errores) }}</div>
            <div class="kpi-sub">envíos con fallo de conexión o HTTP</div>
          </div>
          <div class="card kpi">
            <div class="kpi-label">Vehículos reportando</div>
            <div class="kpi-value">{{ fmtN(vehiculosReportando()) }}</div>
            <div class="kpi-sub">con al menos 1 envío aceptado</div>
          </div>
        </div>

        <!-- Chart 1: columnas apiladas por cliente -->
        <div class="card mb-4">
          <div class="card-header">
            <app-icon name="chart" [size]="16" />
            <h2>Envíos por {{ bucket() === 'hour' ? 'hora' : 'día' }}</h2>
            <div class="flex-1"></div>
            <button class="btn-ghost-sm" (click)="showTable.set(!showTable())">{{ showTable() ? 'ver gráfico' : 'ver tabla' }}</button>
          </div>
          <div class="card-body">
            <!-- Leyenda: identidad por swatch + texto en tokens de texto -->
            <div class="flex flex-wrap gap-x-4 gap-y-1 mb-3">
              @for (c of activeClients(); track c) {
                <span class="leg"><span class="sw" [style.background]="color(c)"></span>{{ label(c) }}</span>
              }
            </div>
            @if (!haySeries()) {
              <div class="text-center text-text-dim py-8">Sin envíos en el rango seleccionado.</div>
            } @else if (showTable()) {
              <div style="overflow-x: auto;">
                <table class="mtable">
                  <thead><tr><th>{{ bucket() === 'hour' ? 'Hora' : 'Día' }}</th>
                    @for (c of activeClients(); track c) { <th class="num">{{ label(c) }}</th> }
                    <th class="num">Total</th></tr></thead>
                  <tbody>
                    @for (b of bucketsDesc(); track b.key) {
                      <tr><td>{{ b.label }}</td>
                        @for (c of activeClients(); track c) { <td class="num">{{ b.byClient[c] || 0 }}</td> }
                        <td class="num strong">{{ b.total }}</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <div class="chart-wrap" (pointermove)="onMove($event)" (pointerleave)="hoverIdx.set(-1)">
                <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" width="100%" style="display:block;">
                  <!-- grid recesivo -->
                  @for (t of yTicks(); track t.v) {
                    <line [attr.x1]="pl" [attr.x2]="w - pr" [attr.y1]="t.y" [attr.y2]="t.y" class="grid-line" />
                    <text [attr.x]="pl - 6" [attr.y]="t.y + 3" text-anchor="end" class="ax">{{ fmtN(t.v) }}</text>
                  }
                  <line [attr.x1]="pl" [attr.x2]="w - pr" [attr.y1]="h - pb" [attr.y2]="h - pb" class="base-line" />
                  <!-- highlight de columna en hover -->
                  @if (hoverIdx() >= 0) {
                    <rect [attr.x]="slotX(hoverIdx())" [attr.y]="pt" [attr.width]="slotW()" [attr.height]="h - pt - pb" class="hl" />
                  }
                  <!-- segmentos -->
                  @for (s of segs(); track $index) {
                    @if (s.top) { <path [attr.d]="topPath(s)" [attr.fill]="color(s.client)" /> }
                    @else { <rect [attr.x]="s.x" [attr.y]="s.y" [attr.width]="s.w" [attr.height]="s.h" [attr.fill]="color(s.client)" /> }
                  }
                  <!-- etiquetas X -->
                  @for (lb of xLabels(); track lb.x) {
                    <text [attr.x]="lb.x" [attr.y]="h - 8" text-anchor="middle" class="ax">{{ lb.text }}</text>
                  }
                </svg>
                @if (hoverIdx() >= 0 && tip(); as t) {
                  <div class="tip" [style.left.px]="tipX()" [style.top.px]="8">
                    <div class="tip-title">{{ t.title }}</div>
                    @for (r of t.rows; track r.label) {
                      <div class="tip-row"><span class="key" [style.background]="r.color"></span>
                        <span class="v">{{ fmtN(r.value) }}</span><span class="l">{{ r.label }}</span></div>
                    }
                    <div class="tip-row total"><span class="v">{{ fmtN(t.total) }}</span><span class="l">total</span></div>
                  </div>
                }
              </div>
            }
          </div>
        </div>

        <div class="grid gap-4 mb-4" style="grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));">
          <!-- Chart 2: resultado por cliente (barras horizontales apiladas, colores de estado) -->
          <div class="card">
            <div class="card-header"><h2>Resultado por cliente</h2></div>
            <div class="card-body" (pointerleave)="tip2.set(null)" style="position: relative;">
              <div class="flex flex-wrap gap-x-4 gap-y-1 mb-3">
                <span class="leg"><span class="sw" style="background: var(--ok);"></span>✓ aceptados</span>
                <span class="leg"><span class="sw" style="background: var(--warn);"></span>! rechazados</span>
                <span class="leg"><span class="sw" style="background: var(--err);"></span>✕ errores</span>
              </div>
              @if (byClient().length === 0) {
                <div class="text-center text-text-dim py-8">Sin envíos en el rango seleccionado.</div>
              }
              @for (c of byClient(); track c.client) {
                <div class="hrow">
                  <span class="hname">{{ label(c.client) }}</span>
                  <div class="hbar">
                    @for (p of hSegs(c); track p.kind) {
                      <div class="hseg" [class.last]="p.last" [style.width.%]="p.pct" [style.background]="p.color"
                        (pointerenter)="onSeg($event, c, p)"></div>
                    }
                  </div>
                  <span class="hval">{{ fmtN(c.total) }}</span>
                </div>
              }
              @if (tip2(); as t) {
                <div class="tip" [style.left.px]="t.x" [style.top.px]="t.y">
                  <div class="tip-title">{{ t.title }}</div>
                  <div class="tip-row"><span class="key" [style.background]="t.color"></span>
                    <span class="v">{{ fmtN(t.value) }}</span><span class="l">{{ t.label }} · {{ t.pct }}%</span></div>
                </div>
              }
            </div>
          </div>

          <!-- Tabla: vehículos con fallos (vista de tabla / relief) -->
          <div class="card">
            <div class="card-header"><h2>Vehículos con fallos</h2></div>
            <div class="card-body">
              @if (topErrors().length === 0) {
                <div class="text-center text-text-dim py-8">Sin fallos en el rango 🎉</div>
              } @else {
                <table class="mtable">
                  <thead><tr><th>Patente</th><th>Servicio</th><th class="num">Fallos</th><th>Último</th><th>Detalle</th></tr></thead>
                  <tbody>
                    @for (e of topErrors(); track e.vehicle_id + e.client) {
                      <tr>
                        <td class="strong">{{ plate(e.vehicle_id) }}</td>
                        <td><span class="leg"><span class="sw" [style.background]="color(e.client)"></span>{{ label(e.client) }}</span></td>
                        <td class="num strong">{{ e.fallos }}</td>
                        <td class="text-text-dim whitespace-nowrap">{{ fmtDate(e.ultimo) }}</td>
                        <td class="text-text-dim detalle">{{ e.detalle }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    /* Paleta categórica validada (dark por defecto, como el tema de la app) */
    :host {
      --c-falabella: #3987e5; --c-wise: #d95926; --c-drivin: #199e70;
      --c-bermann: #c98500; --c-ds: #d55181; --c-qanalytics: #008300;
    }
    @media (prefers-color-scheme: light) {
      :host {
        --c-falabella: #2a78d6; --c-wise: #eb6834; --c-drivin: #1baf7a;
        --c-bermann: #eda100; --c-ds: #e87ba4; --c-qanalytics: #008300;
      }
    }
    :host-context(html[data-theme='dark']) {
      --c-falabella: #3987e5; --c-wise: #d95926; --c-drivin: #199e70;
      --c-bermann: #c98500; --c-ds: #d55181; --c-qanalytics: #008300;
    }
    :host-context(html[data-theme='light']) {
      --c-falabella: #2a78d6; --c-wise: #eb6834; --c-drivin: #1baf7a;
      --c-bermann: #eda100; --c-ds: #e87ba4; --c-qanalytics: #008300;
    }
    .seg-range { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .seg-range button {
      padding: 6px 14px; font-size: 13px; font-weight: 600; background: transparent;
      border: none; color: var(--text-dim); cursor: pointer;
    }
    .seg-range button + button { border-left: 1px solid var(--border); }
    .seg-range button.on { background: var(--accent); color: #fff; }
    .kpi { padding: 14px 16px; }
    .kpi-label { font-size: 12px; color: var(--text-dim); font-weight: 600; }
    .kpi-value { font-size: 27px; font-weight: 650; line-height: 1.25; margin: 2px 0; }
    .kpi-sub { font-size: 11.5px; color: var(--text-dim); }
    .kpi-sub .up { color: var(--ok); font-weight: 700; }
    .kpi-sub .down { color: var(--err); font-weight: 700; }
    .kpi-sub .flat { color: var(--text-dim); font-weight: 700; }
    .leg { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-dim); }
    .sw { width: 10px; height: 10px; border-radius: 3px; flex: none; display: inline-block; }
    .chart-wrap { position: relative; }
    .grid-line { stroke: var(--border); stroke-width: 1; }
    .base-line { stroke: var(--text-dim); stroke-opacity: 0.45; stroke-width: 1; }
    .ax { font-size: 10px; fill: var(--text-dim); }
    .hl { fill: var(--accent-soft); }
    .tip {
      position: absolute; z-index: 5; pointer-events: none; min-width: 130px;
      background: var(--bg-elev); border: 1px solid var(--border); border-radius: 8px;
      box-shadow: var(--shadow); padding: 8px 10px; font-size: 12px;
    }
    .tip-title { color: var(--text-dim); font-size: 11px; margin-bottom: 4px; }
    .tip-row { display: flex; align-items: center; gap: 6px; padding: 1px 0; }
    .tip-row .key { width: 10px; height: 3px; border-radius: 2px; flex: none; }
    .tip-row .v { font-weight: 700; min-width: 34px; text-align: right; font-variant-numeric: tabular-nums; }
    .tip-row .l { color: var(--text-dim); }
    .tip-row.total { border-top: 1px solid var(--border); margin-top: 3px; padding-top: 3px; }
    .hrow { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .hname { width: 84px; font-size: 12.5px; font-weight: 600; flex: none; text-align: right; }
    .hbar { flex: 1; display: flex; gap: 2px; height: 18px; }
    .hseg { height: 100%; min-width: 2px; }
    .hseg.last { border-radius: 0 4px 4px 0; }
    .hval { width: 52px; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; flex: none; }
    .mtable { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .mtable th {
      text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--text-dim); padding: 6px 8px; border-bottom: 1px solid var(--border);
    }
    .mtable td { padding: 6px 8px; border-bottom: 1px solid var(--border); }
    .mtable tr:last-child td { border-bottom: none; }
    .mtable .num { text-align: right; font-variant-numeric: tabular-nums; }
    .mtable .strong { font-weight: 700; }
    .mtable .detalle { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .btn-ghost-sm {
      padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer;
      background: transparent; border: 1px solid var(--border); color: var(--text-dim);
    }
    .btn-ghost-sm:hover { color: var(--accent); border-color: var(--accent); }
  `],
})
export class MetricasComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  store = inject(VehicleStoreService);

  readonly ranges = [
    { hours: 24, label: '24 h' },
    { hours: 48, label: '48 h' },
    { hours: 168, label: '7 días' },
  ];
  readonly retentionDays = 7;
  readonly w = W; readonly h = H; readonly pl = PL; readonly pr = PR; readonly pt = PT; readonly pb = PB;
  fmtDate = fmtDate;

  hours = signal(24);
  loading = signal(true);
  refreshing = signal(false);
  showTable = signal(false);
  hoverIdx = signal(-1);
  tipX = signal(0);
  tip2 = signal<{ x: number; y: number; title: string; label: string; value: number; pct: string; color: string } | null>(null);

  bucket = signal<'hour' | 'day'>('hour');
  series = signal<SeriesRow[]>([]);
  byClient = signal<ClientRow[]>([]);
  topErrors = signal<ErrorRow[]>([]);
  prev = signal<{ total: number; aceptados: number }>({ total: 0, aceptados: 0 });

  private timer?: ReturnType<typeof setInterval>;

  // ---- derivados ----
  totales = computed(() => {
    let total = 0, aceptados = 0, rechazados = 0, errores = 0;
    for (const c of this.byClient()) { total += c.total; aceptados += c.aceptados; rechazados += c.rechazados; errores += c.errores; }
    return { total, aceptados, rechazados, errores };
  });
  tasa = computed(() => { const t = this.totales(); return t.total ? Math.round((t.aceptados / t.total) * 100) : 0; });
  vehiculosReportando = computed(() => {
    // distintos por cliente pueden repetirse entre clientes; sumamos el máximo aproximado: usa el mayor
    return this.byClient().reduce((m, c) => Math.max(m, c.vehiculos), 0);
  });
  deltaEnvios = computed(() => {
    const p = this.prev(); if (!p.total) return null;
    return Math.round(((this.totales().total - p.total) / p.total) * 100);
  });
  deltaTasa = computed(() => {
    const p = this.prev(); if (!p.total) return null;
    return this.tasa() - Math.round((p.aceptados / p.total) * 100);
  });

  activeClients = computed<string[]>(() => {
    const present = new Set(this.byClient().map((c) => c.client));
    const known: string[] = CLIENT_ORDER.filter((c) => present.has(c));
    const extra = this.byClient().map((c) => c.client).filter((c) => !(CLIENT_ORDER as string[]).includes(c));
    return known.concat(extra);
  });
  haySeries = computed(() => this.series().length > 0);

  // Ejes de tiempo completos (rellena buckets vacíos)
  buckets = computed(() => {
    const step = this.bucket() === 'hour' ? 3600e3 : 86400e3;
    const n = this.bucket() === 'hour' ? this.hours() : Math.round(this.hours() / 24);
    const nowB = Math.floor(Date.now() / step) * step;
    const map = new Map<number, Record<string, number>>();
    for (const r of this.series()) {
      const k = +new Date(r.bucket);
      const cur = map.get(k) || {};
      cur[r.client] = (cur[r.client] || 0) + r.aceptados + r.rechazados + r.errores;
      map.set(k, cur);
    }
    const out: { key: number; label: string; byClient: Record<string, number>; total: number }[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const k = nowB - i * step;
      const byClient = map.get(k) || {};
      const total = Object.values(byClient).reduce((a, b) => a + b, 0);
      const d = new Date(k);
      const label = this.bucket() === 'hour'
        ? `${String(d.getHours()).padStart(2, '0')}h`
        : `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      out.push({ key: k, label, byClient, total });
    }
    return out;
  });
  bucketsDesc = computed(() => [...this.buckets()].reverse().filter((b) => b.total > 0));

  maxY = computed(() => Math.max(1, ...this.buckets().map((b) => b.total)));
  yTicks = computed(() => {
    const max = this.maxY();
    const raw = max / 3;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const nice = [1, 2, 5, 10].map((x) => x * mag).find((x) => x >= raw) || mag * 10;
    const ticks: { v: number; y: number }[] = [];
    for (let v = nice; v <= max * 1.02; v += nice) ticks.push({ v, y: this.yFor(v) });
    return ticks;
  });
  slotW = computed(() => (W - PL - PR) / Math.max(1, this.buckets().length));
  private yFor(v: number) { return H - PB - (v / this.maxY()) * (H - PT - PB) * 0.96; }
  slotX(i: number) { return PL + i * this.slotW(); }

  segs = computed<Seg[]>(() => {
    const out: Seg[] = [];
    const slot = this.slotW();
    const barW = Math.min(22, Math.max(3, slot * 0.62));
    const order = this.activeClients();
    this.buckets().forEach((b, i) => {
      if (!b.total) return;
      const x = this.slotX(i) + (slot - barW) / 2;
      let yBase = H - PB;
      const present = order.filter((c) => (b.byClient[c] || 0) > 0);
      present.forEach((c, j) => {
        const v = b.byClient[c] || 0;
        const hPx = (H - PT - PB) * 0.96 * (v / this.maxY());
        const gap = j > 0 ? 2 : 0;
        const y = yBase - hPx;
        out.push({ x, y: y - gap, w: barW, h: Math.max(1, hPx), client: c, top: j === present.length - 1 });
        yBase = y - gap;
      });
    });
    return out;
  });

  // path con esquinas superiores redondeadas (data-end), base cuadrada
  topPath(s: Seg) {
    const r = Math.min(3, s.w / 2, s.h);
    return `M ${s.x} ${s.y + s.h} V ${s.y + r} Q ${s.x} ${s.y} ${s.x + r} ${s.y} H ${s.x + s.w - r} Q ${s.x + s.w} ${s.y} ${s.x + s.w} ${s.y + r} V ${s.y + s.h} Z`;
  }

  xLabels = computed(() => {
    const bs = this.buckets();
    const every = bs.length > 30 ? 6 : bs.length > 14 ? 3 : 1;
    return bs.map((b, i) => ({ x: this.slotX(i) + this.slotW() / 2, text: b.label, i }))
      .filter((l) => l.i % every === 0);
  });

  tip = computed(() => {
    const i = this.hoverIdx();
    const b = this.buckets()[i];
    if (!b) return null;
    const rows: TipRow[] = this.activeClients()
      .filter((c) => (b.byClient[c] || 0) > 0)
      .map((c) => ({ label: this.label(c), value: b.byClient[c], color: this.color(c) }));
    return { title: b.label, rows, total: b.total };
  });

  // ---- interacción ----
  onMove(ev: PointerEvent) {
    const el = ev.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const xSvg = ((ev.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((xSvg - PL) / this.slotW());
    const idx = i >= 0 && i < this.buckets().length ? i : -1;
    this.hoverIdx.set(idx);
    if (idx >= 0) {
      const px = ((this.slotX(idx) + this.slotW() / 2) / W) * rect.width;
      this.tipX.set(Math.min(Math.max(px - 65, 4), rect.width - 150));
    }
  }
  onSeg(ev: PointerEvent, c: ClientRow, p: { kind: string; label: string; value: number; pct: number; color: string }) {
    const seg = ev.currentTarget as HTMLElement;
    const wrap = seg.closest('.card-body') as HTMLElement;
    const sr = seg.getBoundingClientRect(); const wr = wrap.getBoundingClientRect();
    this.tip2.set({
      x: Math.min(sr.left - wr.left + sr.width / 2 - 65, wr.width - 150),
      y: sr.top - wr.top - 58,
      title: this.label(c.client), label: p.label, value: p.value,
      pct: c.total ? ((p.value / c.total) * 100).toFixed(1) : '0', color: p.color,
    });
  }

  hSegs(c: ClientRow) {
    const parts = [
      { kind: 'ok', label: 'aceptados', value: c.aceptados, color: 'var(--ok)' },
      { kind: 'warn', label: 'rechazados', value: c.rechazados, color: 'var(--warn)' },
      { kind: 'err', label: 'errores', value: c.errores, color: 'var(--err)' },
    ].filter((p) => p.value > 0);
    const maxTotal = Math.max(1, ...this.byClient().map((x) => x.total));
    return parts.map((p, i) => ({ ...p, pct: (p.value / maxTotal) * 100, last: i === parts.length - 1 }));
  }

  // ---- helpers ----
  color(client: string) { return `var(--c-${client}, var(--accent))`; }
  label(client: string) { return CLIENT_LABEL[client] || client; }
  fmtN(n: number) { return (n ?? 0).toLocaleString('es-CL'); }
  signo(n: number) { return n > 0 ? '+' : ''; }
  deltaClass(n: number, mode: 'up-good' | 'neutral') {
    if (n === 0) return 'flat';
    if (mode === 'neutral') return 'flat';
    return n > 0 ? 'up' : 'down';
  }
  plate(vid: string) {
    const v = this.store.list().find((x) => x.id === vid);
    return v?.plate || v?.name || vid.slice(0, 8);
  }

  setRange(h: number) {
    if (this.hours() === h) return;
    this.hours.set(h);
    this.refresh();
  }

  async refresh() {
    if (!this.loading()) this.refreshing.set(true);
    try {
      const r = await firstValueFrom(this.api.sendStats(this.hours()));
      this.bucket.set(r.bucket === 'day' ? 'day' : 'hour');
      this.series.set(r.series || []);
      this.byClient.set(r.byClient || []);
      this.topErrors.set(r.topErrors || []);
      this.prev.set(r.prev || { total: 0, aceptados: 0 });
    } finally {
      this.loading.set(false);
      this.refreshing.set(false);
    }
  }

  ngOnInit() {
    if (this.store.list().length === 0) this.store.poll();
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 60_000);
  }
  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }
}
