import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { VehicleStoreService } from '../../core/vehicle-store.service';
import { firstValueFrom } from 'rxjs';

/**
 * Informe de servicio por cliente, en formato documento A4 (siempre claro,
 * independiente del tema de la app). Se descarga como PDF con Imprimir →
 * Guardar como PDF, que produce salida vectorial nítida.
 * Se abre desde Métricas: /#/reporte?client=<id>&hours=<24|48|168>
 */

interface SeriesRow { bucket: string; client: string; aceptados: number; rechazados: number; errores: number; }
interface Bucket { key: number; label: string; aceptados: number; rechazados: number; errores: number; total: number; }

const CLIENT_LABEL: Record<string, string> = {
  falabella: 'TMS Falabella', wise: 'Wise (Wisetrack)', drivin: 'Drivin', bermann: 'Bermann', ds: 'DS', qanalytics: 'Qanalytics',
};

// Documento: colores fijos (estado sobre papel blanco)
const C_OK = '#0ca30c', C_WARN = '#e08e00', C_ERR = '#d03b3b', C_ACCENT = '#4f46e5';
const W = 700, H = 190, PL = 44, PR = 6, PT = 8, PB = 20;

@Component({
  selector: 'app-reporte',
  standalone: true,
  template: `
    <div class="wrap">
      <div class="toolbar no-print">
        <button class="tbtn" (click)="volver()">← Volver</button>
        <div class="flex-1"></div>
        <button class="tbtn primary" (click)="imprimir()">Imprimir / Guardar como PDF</button>
      </div>

      @if (cargando()) {
        <div class="page"><p class="muted">Cargando informe…</p></div>
      } @else if (errorMsg()) {
        <div class="page"><p class="muted">No se pudo generar el informe: {{ errorMsg() }}</p></div>
      } @else {
        <div class="page">
          <!-- Encabezado -->
          <div class="head">
            <div class="brand">
              <svg viewBox="0 0 64 64" width="34" height="34" aria-hidden="true">
                <rect width="64" height="64" rx="14" fill="#6366f1"/>
                <path d="M32 10c-8.6 0-15.5 6.9-15.5 15.4C16.5 36.8 32 54 32 54s15.5-17.2 15.5-28.6C47.5 16.9 40.6 10 32 10z" fill="#fff"/>
                <circle cx="32" cy="25.5" r="6.2" fill="#6366f1"/>
              </svg>
              <div>
                <div class="brand-name">PROASEG</div>
                <div class="brand-sub">Concentrador GPS</div>
              </div>
            </div>
            <div class="head-right">
              <div class="doc-type">Informe de servicio</div>
              <div class="muted">Generado el {{ generado }}</div>
            </div>
          </div>

          <h1>{{ clientLabel() }}</h1>
          <p class="periodo">Período: <strong>{{ periodo() }}</strong> · Transmisión de posiciones GPS vía integración API</p>

          <!-- KPIs -->
          <div class="kpis">
            <div class="kpi">
              <div class="kpi-l">Envíos realizados</div>
              <div class="kpi-v">{{ fmtN(tot().total) }}</div>
            </div>
            <div class="kpi">
              <div class="kpi-l">Entregas aceptadas</div>
              <div class="kpi-v">{{ fmtN(tot().aceptados) }} <span class="kpi-pct">({{ tasa() }}%)</span></div>
            </div>
            <div class="kpi">
              <div class="kpi-l">Disponibilidad del servicio</div>
              <div class="kpi-v" [style.color]="uptimeColor()">{{ uptimePct() }}%</div>
            </div>
            <div class="kpi">
              <div class="kpi-l">Vehículos reportando</div>
              <div class="kpi-v">{{ fmtN(vehiculos()) }}</div>
            </div>
          </div>

          <!-- Gráfico -->
          <h2>Envíos por {{ bucket() === 'hour' ? 'hora' : 'día' }}</h2>
          <div class="leg-row">
            <span class="leg"><span class="sw" [style.background]="cOk"></span>✓ aceptados</span>
            <span class="leg"><span class="sw" [style.background]="cWarn"></span>! rechazados</span>
            <span class="leg"><span class="sw" [style.background]="cErr"></span>✕ errores</span>
          </div>
          <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" width="100%" style="display:block;">
            @for (t of yTicks(); track t.v) {
              <line [attr.x1]="pl" [attr.x2]="w - pr" [attr.y1]="t.y" [attr.y2]="t.y" stroke="#e5e7ee" stroke-width="1" />
              <text [attr.x]="pl - 6" [attr.y]="t.y + 3" text-anchor="end" class="ax">{{ fmtTick(t.v) }}</text>
            }
            <line [attr.x1]="pl" [attr.x2]="w - pr" [attr.y1]="h - pb" [attr.y2]="h - pb" stroke="#9aa1b5" stroke-width="1" />
            @for (s of segs(); track $index) {
              <rect [attr.x]="s.x" [attr.y]="s.y" [attr.width]="s.w" [attr.height]="s.h" [attr.fill]="s.color" />
            }
            @for (lb of xLabels(); track lb.x) {
              <text [attr.x]="lb.x" [attr.y]="h - 6" text-anchor="middle" class="ax">{{ lb.text }}</text>
            }
          </svg>

          <!-- Disponibilidad -->
          <h2>Disponibilidad</h2>
          <div class="up-row">
            <div class="meter"><div class="meter-fill" [style.width.%]="uptimePct()" [style.background]="uptimeColor()"></div></div>
            <div class="up-txt"><strong>{{ uptimeOn() }} de {{ buckets().length }}</strong> {{ bucket() === 'hour' ? 'horas' : 'días' }} con envíos aceptados</div>
          </div>
          <p class="note">Un {{ bucket() === 'hour' ? 'bloque de 1 hora' : 'día' }} se considera "en línea" cuando el servicio entregó al menos una posición aceptada por la plataforma del cliente.</p>

          <!-- Detalle -->
          <h2>Detalle por {{ bucket() === 'hour' ? 'hora' : 'día' }}</h2>
          <table>
            <thead><tr>
              <th>{{ bucket() === 'hour' ? 'Hora' : 'Día' }}</th>
              <th class="num">Envíos</th><th class="num">Aceptados</th>
              <th class="num">Rechazados</th><th class="num">Errores</th><th class="num">% aceptación</th>
            </tr></thead>
            <tbody>
              @for (b of buckets(); track b.key) {
                <tr>
                  <td>{{ b.label }}</td>
                  <td class="num">{{ fmtN(b.total) }}</td>
                  <td class="num">{{ fmtN(b.aceptados) }}</td>
                  <td class="num">{{ b.rechazados ? fmtN(b.rechazados) : '—' }}</td>
                  <td class="num" [style.color]="b.errores ? cErr : null">{{ b.errores ? fmtN(b.errores) : '—' }}</td>
                  <td class="num">{{ b.total ? ((b.aceptados / b.total) * 100).toFixed(1) + '%' : '—' }}</td>
                </tr>
              }
            </tbody>
            <tfoot><tr>
              <td>Total</td>
              <td class="num">{{ fmtN(tot().total) }}</td>
              <td class="num">{{ fmtN(tot().aceptados) }}</td>
              <td class="num">{{ fmtN(tot().rechazados) }}</td>
              <td class="num">{{ fmtN(tot().errores) }}</td>
              <td class="num">{{ tasa() }}%</td>
            </tr></tfoot>
          </table>

          @if (fallos().length) {
            <h2>Vehículos con incidencias</h2>
            <table>
              <thead><tr><th>Patente</th><th class="num">Fallos</th><th>Último</th><th>Detalle</th></tr></thead>
              <tbody>
                @for (e of fallos(); track e.vehicle_id) {
                  <tr>
                    <td>{{ plate(e.vehicle_id) }}</td>
                    <td class="num">{{ fmtN(e.fallos) }}</td>
                    <td>{{ fmtFecha(e.ultimo) }}</td>
                    <td class="det">{{ e.detalle }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }

          <div class="foot">
            PROASEG · Concentrador GPS · informe generado automáticamente a partir del registro de envíos ·
            los datos cubren exclusivamente el período indicado
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #eceef4; }
    .wrap { max-width: 860px; margin: 0 auto; padding: 16px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
    .flex-1 { flex: 1; }
    .tbtn {
      padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
      background: #fff; border: 1px solid #cdd3e1; color: #333a4d;
    }
    .tbtn.primary { background: ${'#4f46e5'}; border-color: ${'#4f46e5'}; color: #fff; }
    .page {
      background: #fff; color: #16181d; border-radius: 10px; padding: 34px 38px;
      box-shadow: 0 2px 14px rgba(20, 26, 50, 0.12);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-name { font-weight: 800; font-size: 17px; letter-spacing: 0.01em; }
    .brand-sub { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7186; font-weight: 600; }
    .head-right { text-align: right; }
    .doc-type { font-weight: 700; font-size: 13px; color: ${'#4f46e5'}; }
    .muted { color: #6b7186; font-size: 12px; }
    h1 { font-size: 23px; margin: 4px 0 2px; }
    .periodo { margin: 0 0 18px; color: #3c4257; font-size: 13px; }
    h2 { font-size: 14px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e7ee; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .kpi { border: 1px solid #e5e7ee; border-radius: 8px; padding: 10px 12px; }
    .kpi-l { font-size: 11px; color: #6b7186; font-weight: 600; }
    .kpi-v { font-size: 21px; font-weight: 700; margin-top: 2px; }
    .kpi-pct { font-size: 13px; color: #6b7186; font-weight: 600; }
    .leg-row { display: flex; gap: 16px; margin-bottom: 6px; }
    .leg { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: #3c4257; }
    .sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .ax { font-size: 9px; fill: #6b7186; }
    .up-row { display: flex; align-items: center; gap: 14px; }
    .meter { flex: 1; height: 12px; border-radius: 6px; background: #eceef4; overflow: hidden; }
    .meter-fill { height: 100%; border-radius: 6px; min-width: 2px; }
    .up-txt { font-size: 13px; flex: none; }
    .note { font-size: 11px; color: #6b7186; margin: 6px 0 0; }
    table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7186; padding: 5px 8px; border-bottom: 1px solid #d7dbe6; }
    td { padding: 4.5px 8px; border-bottom: 1px solid #eef0f5; }
    tfoot td { border-top: 1.5px solid #d7dbe6; border-bottom: none; font-weight: 700; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .det { color: #6b7186; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e5e7ee; font-size: 10px; color: #9aa1b5; }
    @media print {
      :host { background: #fff; }
      .wrap { max-width: none; padding: 0; }
      .no-print { display: none !important; }
      .page { box-shadow: none; border-radius: 0; padding: 0; }
      tr, .kpi, .up-row { break-inside: avoid; }
      h2 { break-after: avoid; }
    }
    /* Sin esto, el navegador elimina los fondos (medidor, swatches) al imprimir */
    :host, .page { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  `],
})
export class ReporteComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private store = inject(VehicleStoreService);

  readonly w = W; readonly h = H; readonly pl = PL; readonly pr = PR; readonly pt = PT; readonly pb = PB;
  readonly cOk = C_OK; readonly cWarn = C_WARN; readonly cErr = C_ERR;
  readonly generado = new Date().toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'short' });

  cargando = signal(true);
  errorMsg = signal<string | null>(null);
  client = signal('');
  hours = signal(24);
  bucket = signal<'hour' | 'day'>('hour');
  series = signal<SeriesRow[]>([]);
  fallos = signal<{ vehicle_id: string; fallos: number; ultimo: string; detalle: string }[]>([]);
  vehiculos = signal(0);

  clientLabel = computed(() => CLIENT_LABEL[this.client()] || this.client());

  buckets = computed<Bucket[]>(() => {
    const step = this.bucket() === 'hour' ? 3600e3 : 86400e3;
    const n = this.bucket() === 'hour' ? this.hours() : Math.round(this.hours() / 24);
    const nowB = Math.floor(Date.now() / step) * step;
    const map = new Map<number, SeriesRow>();
    for (const r of this.series()) map.set(+new Date(r.bucket), r);
    const out: Bucket[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const k = nowB - i * step;
      const r = map.get(k);
      const d = new Date(k);
      const label = this.bucket() === 'hour'
        ? `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`
        : d.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: '2-digit' });
      const aceptados = r?.aceptados || 0, rechazados = r?.rechazados || 0, errores = r?.errores || 0;
      out.push({ key: k, label, aceptados, rechazados, errores, total: aceptados + rechazados + errores });
    }
    return out;
  });

  tot = computed(() => {
    let total = 0, aceptados = 0, rechazados = 0, errores = 0;
    for (const b of this.buckets()) { total += b.total; aceptados += b.aceptados; rechazados += b.rechazados; errores += b.errores; }
    return { total, aceptados, rechazados, errores };
  });
  tasa = computed(() => { const t = this.tot(); return t.total ? Math.round((t.aceptados / t.total) * 100) : 0; });
  uptimeOn = computed(() => this.buckets().filter((b) => b.aceptados > 0).length);
  uptimePct = computed(() => { const n = this.buckets().length; return n ? Math.round((this.uptimeOn() / n) * 100) : 0; });
  uptimeColor = computed(() => (this.uptimePct() >= 90 ? C_OK : this.uptimePct() >= 60 ? C_WARN : C_ERR));

  periodo = computed(() => {
    const bs = this.buckets();
    if (!bs.length) return '—';
    const f = (k: number) => new Date(k).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const rango = this.hours() === 168 ? '7 días' : `${this.hours()} horas`;
    return `${f(bs[0].key)} — ${f(Date.now())} (${rango})`;
  });

  maxY = computed(() => Math.max(1, ...this.buckets().map((b) => b.total)));
  yTicks = computed(() => {
    const max = this.maxY(); const raw = max / 3;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const nice = [1, 2, 5, 10].map((x) => x * mag).find((x) => x >= raw) || mag * 10;
    const ticks: { v: number; y: number }[] = [];
    for (let v = nice; v <= max * 1.02; v += nice) ticks.push({ v, y: this.yFor(v) });
    return ticks;
  });
  private yFor(v: number) { return H - PB - (v / this.maxY()) * (H - PT - PB) * 0.96; }
  private slotW() { return (W - PL - PR) / Math.max(1, this.buckets().length); }

  segs = computed(() => {
    const out: { x: number; y: number; w: number; h: number; color: string }[] = [];
    const slot = this.slotW();
    const barW = Math.min(20, Math.max(3, slot * 0.62));
    this.buckets().forEach((b, i) => {
      if (!b.total) return;
      const x = PL + i * slot + (slot - barW) / 2;
      let yBase = H - PB;
      const parts = [
        { v: b.aceptados, color: C_OK }, { v: b.rechazados, color: C_WARN }, { v: b.errores, color: C_ERR },
      ].filter((p) => p.v > 0);
      parts.forEach((p, j) => {
        const hPx = (H - PT - PB) * 0.96 * (p.v / this.maxY());
        const gap = j > 0 ? 1.5 : 0;
        const y = yBase - hPx;
        out.push({ x, y: y - gap, w: barW, h: Math.max(1, hPx), color: p.color });
        yBase = y - gap;
      });
    });
    return out;
  });
  xLabels = computed(() => {
    const bs = this.buckets();
    const every = bs.length > 30 ? 6 : bs.length > 14 ? 3 : 1;
    return bs.map((b, i) => ({
      x: PL + i * this.slotW() + this.slotW() / 2,
      text: this.bucket() === 'hour' ? b.label.slice(-5) : b.label,
      i,
    })).filter((l) => l.i % every === 0);
  });

  fmtN(n: number) { return (n ?? 0).toLocaleString('es-CL'); }
  fmtTick(n: number) {
    if (n >= 1e6) return (n / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' M';
    if (n >= 1000) return (n / 1000).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' k';
    return String(n);
  }
  fmtFecha(iso: string) { return new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  plate(vid: string) {
    const v = this.store.list().find((x) => x.id === vid);
    return v?.plate || v?.name || vid.slice(0, 8);
  }
  imprimir() { window.print(); }
  volver() { history.back(); }

  async ngOnInit() {
    const qp = this.route.snapshot.queryParamMap;
    const client = qp.get('client') || '';
    const hours = Number(qp.get('hours')) || 24;
    this.client.set(client);
    this.hours.set([24, 48, 168].includes(hours) ? hours : 24);
    if (!client) { this.errorMsg.set('falta el parámetro client'); this.cargando.set(false); return; }
    if (this.store.list().length === 0) this.store.poll();
    try {
      const r = await firstValueFrom(this.api.sendStats(this.hours()));
      this.bucket.set(r.bucket === 'day' ? 'day' : 'hour');
      this.series.set((r.series || []).filter((s: SeriesRow) => s.client === client));
      this.fallos.set((r.topErrors || []).filter((e: any) => e.client === client).slice(0, 6));
      this.vehiculos.set((r.byClient || []).find((c: any) => c.client === client)?.vehiculos || 0);
    } catch (err: any) {
      this.errorMsg.set(err?.error?.error || err?.message || String(err));
    } finally {
      this.cargando.set(false);
    }
  }
}
