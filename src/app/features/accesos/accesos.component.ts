import { Component, ElementRef, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ApiService, ApiAccess, ApiAccessVehicle } from '../../core/api.service';
import { VehicleStoreService } from '../../core/vehicle-store.service';
import { ToastService } from '../../core/toast.service';
import { fmtDate, fmtNum, relativeTime } from '../../core/format.utils';
import { IconComponent } from '../../shared/icon.component';
import { ToggleSwitchComponent } from '../../shared/toggle-switch.component';
import { JsonPanelComponent } from '../../shared/json-panel.component';

interface Draft { nombre: string; usuario: string; limiteMinuto: number; patentes: string[]; }
interface Revealed { nombre: string; usuario: string; token: string; limiteMinuto: number; nuevo: boolean; }

// Misma regla que el backend: solo letras y dígitos, en mayúsculas ("ab-1234" → "AB1234")
const plain = (s: string) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
// "Transportes Pérez Ltda." → "transportes-perez-ltda"
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const USUARIO_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;
const errMsg = (err: any, fb: string) => err?.error?.error || err?.message || fb;

/**
 * Accesos API: credenciales de solo lectura para que un cliente consulte la última posición
 * de las patentes que se le autorizan (GET /api/externo/v1/posiciones). El token completo
 * solo se ve al crearlo o regenerarlo.
 */
@Component({
  selector: 'app-accesos',
  standalone: true,
  imports: [NgTemplateOutlet, IconComponent, ToggleSwitchComponent, JsonPanelComponent],
  template: `
    @if (revealed(); as c) {
      <div class="card mb-4" style="border-color: var(--accent);">
        <div class="card-header">
          <app-icon name="key" [size]="16" />
          <h2>{{ c.nuevo ? 'Acceso creado' : 'Token nuevo' }} · {{ c.nombre }}</h2>
          <div class="flex-1"></div>
          <button class="btn btn-ghost" (click)="revealed.set(null)">Listo</button>
        </div>
        <div class="card-body space-y-3">
          <div class="text-sm text-warn flex items-center gap-1.5">
            <app-icon name="alert" [size]="14" />
            Copia el token ahora: no se vuelve a mostrar. Si se pierde, se genera uno nuevo.
          </div>
          <div class="grid gap-2 text-sm items-center" style="grid-template-columns: 80px 1fr;">
            <div class="text-text-dim">URL</div>
            <div class="url-box"><span class="flex-1">{{ endpointUrl() }}</span>
              <button class="icon-btn copy-btn" (click)="copy(endpointUrl(), 'URL copiada')" title="Copiar"><app-icon name="copy" [size]="14" /></button></div>
            <div class="text-text-dim">Usuario</div>
            <div class="url-box"><span class="flex-1">{{ c.usuario }}</span>
              <button class="icon-btn copy-btn" (click)="copy(c.usuario, 'Usuario copiado')" title="Copiar"><app-icon name="copy" [size]="14" /></button></div>
            <div class="text-text-dim">Token</div>
            <div class="url-box"><span class="flex-1">{{ c.token }}</span>
              <button class="icon-btn copy-btn" (click)="copy(c.token, 'Token copiado')" title="Copiar"><app-icon name="copy" [size]="14" /></button></div>
          </div>
          <button class="btn flex items-center gap-1.5" (click)="copy(instructions(c), 'Instrucciones copiadas')">
            <app-icon name="copy" [size]="14" /> Copiar instrucciones para el cliente
          </button>
        </div>
      </div>
    }

    <div class="card">
      <div class="card-header">
        <h2>Accesos API</h2>
        <span class="badge badge-muted">{{ accesos().length }}</span>
        <div class="flex-1"></div>
        <button class="btn flex items-center gap-1.5" (click)="startNew()" [disabled]="editing() === 'new'">
          <app-icon name="plus" [size]="14" /> Nuevo acceso
        </button>
      </div>
      <div class="toolbar text-sm">
        <span class="text-text-dim">Endpoint</span>
        <div class="url-box flex-1" style="min-width: 280px;">
          <span class="flex-1">GET {{ endpointUrl() }}</span>
          <button class="icon-btn copy-btn" (click)="copy(endpointUrl(), 'URL copiada')" title="Copiar"><app-icon name="copy" [size]="14" /></button>
        </div>
      </div>
      <div class="px-[18px] py-2.5 text-xs text-text-dim border-b" style="border-color: var(--border);">
        Solo lectura. Cada acceso ve la última posición (patente, latitud, longitud, fecha y hora de Chile, velocidad y encendido)
        únicamente de las patentes que le autorices. Responde con los datos ya recolectados: no genera consultas a fm-track.
      </div>

      @if (editing() === 'new') {
        <div class="p-[18px] border-b" style="border-color: var(--border); background: var(--bg-soft);">
          <div class="font-semibold text-sm mb-3">Nuevo acceso</div>
          <ng-container *ngTemplateOutlet="editor" />
        </div>
      }

      <div class="card-body-tight">
        <table class="tbl">
          <thead>
            <tr>
              <th style="width: 28px;"></th>
              <th>Nombre</th><th>Usuario</th><th>Patentes</th><th>Límite</th>
              <th>Último uso</th><th>Consultas</th><th>Activo</th>
            </tr>
          </thead>
          <tbody>
            @for (a of accesos(); track a.id) {
              <tr (click)="toggleRow(a)" [class.selected]="editing() === a.id">
                <td>
                  <span class="inline-block transition-transform text-text-dim"
                    [style.transform]="editing() === a.id ? 'rotate(90deg)' : 'rotate(0deg)'">
                    <app-icon name="chevron-right" [size]="14" />
                  </span>
                </td>
                <td class="font-medium">{{ a.nombre }}</td>
                <td class="font-mono text-xs">{{ a.usuario }}</td>
                <td>
                  {{ a.patentes.length }}
                  @if (unknownCount(a.patentes); as n) {
                    <span class="badge badge-warn ml-1" title="Patentes que no corresponden a ningún vehículo de fm-track">{{ n }} sin vehículo</span>
                  }
                </td>
                <td>{{ a.limiteMinuto }}/min</td>
                <td>
                  {{ a.lastUsedAt ? relativeTime(a.lastUsedAt) : 'nunca' }}
                  @if (a.lastIp) { <div class="text-[11px] text-text-dim font-mono">{{ a.lastIp }}</div> }
                </td>
                <td>
                  {{ fmtNum(a.consultas) }}
                  @if (a.limitadas) {
                    <div class="text-[11px] text-warn" title="Consultas rechazadas por pasar el límite por minuto">{{ fmtNum(a.limitadas) }} sobre el límite</div>
                  }
                </td>
                <td (click)="$event.stopPropagation()">
                  <app-toggle-switch [checked]="a.enabled" (checkedChange)="setEnabled(a, $event)" />
                </td>
              </tr>
              @if (editing() === a.id) {
                <tr class="no-hover" style="background: var(--bg-soft);">
                  <td colspan="8" style="padding: 0;">
                    <div class="p-5 space-y-4">
                      <ng-container *ngTemplateOutlet="editor" />
                      <div class="text-xs text-text-dim">
                        Token terminado en <span class="font-mono">…{{ a.tokenFin }}</span> ·
                        creado {{ fmtDate(a.createdAt) }}{{ a.createdBy ? ' por ' + a.createdBy : '' }}
                      </div>
                      <div class="flex flex-wrap gap-2">
                        <button class="btn btn-ghost flex items-center gap-1.5" (click)="loadPreview(a)">
                          <app-icon name="eye" [size]="14" /> Ver lo que recibe el cliente
                        </button>
                        <button class="btn btn-ghost flex items-center gap-1.5" (click)="regenerate(a)">
                          <app-icon name="refresh" [size]="14" /> Regenerar token
                        </button>
                        <button class="btn btn-ghost flex items-center gap-1.5 text-err" (click)="remove(a)">
                          <app-icon name="x" [size]="14" /> Eliminar acceso
                        </button>
                      </div>
                      @if (preview(); as p) {
                        <app-json-panel title="Respuesta actual de la API para este acceso" [content]="p" />
                      }
                    </div>
                  </td>
                </tr>
              }
            }
            @if (!accesos().length) {
              <tr class="no-hover"><td colspan="8" class="text-center py-12">
                <div class="text-text-dim">
                  <app-icon name="key" [size]="32" class="mx-auto block mb-3 opacity-40" />
                  @if (loading()) {
                    <div>Cargando…</div>
                  } @else {
                    <div class="font-medium text-text mb-1">Sin accesos todavía</div>
                    <div class="text-xs">Crea uno con «Nuevo acceso» y entrega al cliente la URL, el usuario y el token.</div>
                  }
                </div>
              </td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    <ng-template #editor>
      <div class="space-y-4">
        <div class="flex flex-wrap gap-3 items-end">
          <label class="field">
            <span>Nombre</span>
            <input class="input" [value]="draft().nombre" (input)="setNombre(val($event))" placeholder="Empresa o contacto" style="min-width: 260px;" />
          </label>
          @if (editing() === 'new') {
            <label class="field">
              <span>Usuario</span>
              <input class="input font-mono" [value]="draft().usuario" (input)="setUsuario(val($event))" placeholder="empresa-x" style="min-width: 200px;" />
            </label>
          }
          <label class="field">
            <span>Consultas por minuto</span>
            <input class="input" type="number" min="1" max="60" [value]="draft().limiteMinuto" (input)="setLimite(val($event))" style="width: 120px;" />
          </label>
        </div>

        <div>
          <div class="text-xs font-semibold text-text-dim mb-1.5">Patentes autorizadas ({{ draft().patentes.length }})</div>
          <div class="flex flex-wrap gap-1.5">
            @for (p of draft().patentes; track p) {
              <span class="chip" [class.chip-warn]="!knownPlates().has(p)"
                [title]="knownPlates().has(p) ? '' : 'No hay ningún vehículo con esta patente en fm-track'">
                {{ p }}<button (click)="removePlate(p)" title="Quitar">×</button>
              </span>
            } @empty {
              <span class="text-xs text-text-dim">Ninguna todavía: pégalas o márcalas en la lista.</span>
            }
          </div>
        </div>

        <div class="grid gap-4" style="grid-template-columns: minmax(220px, 1fr) 2fr;">
          <div>
            <div class="text-xs font-semibold text-text-dim mb-1.5">Pegar patentes</div>
            <textarea class="input w-full font-mono" rows="6" placeholder="DFBY49, AB-1234&#10;una por línea o separadas por coma"
              [value]="pasteText()" (input)="pasteText.set(val($event))"></textarea>
            <button class="btn btn-ghost mt-1.5 flex items-center gap-1.5" (click)="addPasted()" [disabled]="!pasteText().trim()">
              <app-icon name="plus" [size]="14" /> Agregar
            </button>
          </div>
          <div class="min-w-0">
            <div class="flex gap-2 mb-1.5 items-center">
              <input class="input flex-1 min-w-0" type="search" placeholder="Buscar patente o nombre…" [value]="pickSearch()" (input)="pickSearch.set(val($event))" />
              <select class="input" [value]="pickGroup()" (change)="pickGroup.set(val($event))">
                <option value="">Todos los grupos</option>
                @for (g of store.fmGroups(); track g.id) {
                  <option [value]="g.id">{{ g.name }} ({{ g.vehicles.length }})</option>
                }
              </select>
              <button class="btn btn-ghost whitespace-nowrap" (click)="addVisible()" [disabled]="!pickList().length" title="Agrega todas las patentes de la lista filtrada">Marcar todas</button>
            </div>
            <div class="pick-list">
              @for (v of pickList(); track v.id) {
                <label class="pick-row">
                  <input type="checkbox" [checked]="draftSet().has(v.patente)" (change)="togglePlate(v.patente)" />
                  <span class="font-mono font-semibold">{{ v.patente }}</span>
                  @if (v.nombre && plain(v.nombre) !== v.patente) {
                    <span class="text-text-dim truncate">{{ v.nombre }}</span>
                  }
                  <span class="flex-1"></span>
                  <span class="text-[11px] text-text-dim whitespace-nowrap">{{ v.fechaHora ? relativeTime(v.fechaHora) : 'sin posición' }}</span>
                </label>
              } @empty {
                <div class="text-xs text-text-dim p-3">{{ vehicles().length ? 'Sin vehículos para el filtro.' : 'Cargando vehículos…' }}</div>
              }
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button class="btn" (click)="save()" [disabled]="saving() || !canSave()">
            {{ editing() === 'new' ? 'Crear acceso' : 'Guardar cambios' }}
          </button>
          <button class="btn btn-ghost" (click)="cancel()">Cancelar</button>
          @if (formHint(); as h) { <span class="text-xs text-text-dim">{{ h }}</span> }
        </div>
      </div>
    </ng-template>
  `,
  styles: [`
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field > span { font-size: 11px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
    .chip {
      display: inline-flex; align-items: center; gap: 2px; padding: 2px 2px 2px 8px; border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; font-weight: 600;
      background: var(--bg-elev); border: 1px solid var(--border);
    }
    .chip button { border: none; background: transparent; color: var(--text-dim); cursor: pointer; padding: 0 5px; font-size: 15px; line-height: 1; }
    .chip button:hover { color: var(--err); }
    .chip-warn { border-color: var(--warn); color: var(--warn); }
    .pick-list { max-height: 264px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elev); }
    .pick-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; font-size: 13px; cursor: pointer; border-bottom: 1px solid var(--border); }
    .pick-row:last-child { border-bottom: none; }
    .pick-row:hover { background: var(--bg-soft); }
    .copy-btn { width: 28px; height: 28px; }
    .tbl tbody tr.no-hover:hover { background: var(--bg-soft); cursor: default; }
  `],
})
export class AccesosComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  store = inject(VehicleStoreService);

  accesos = signal<ApiAccess[]>([]);
  endpoint = signal('/api/externo/v1/posiciones');
  vehicles = signal<ApiAccessVehicle[]>([]);
  loading = signal(true);
  saving = signal(false);
  /** 'new' = formulario de alta; id = acceso abierto; null = nada */
  editing = signal<string | null>(null);
  draft = signal<Draft>({ nombre: '', usuario: '', limiteMinuto: 2, patentes: [] });
  revealed = signal<Revealed | null>(null);
  preview = signal<any>(null);
  pasteText = signal('');
  pickSearch = signal('');
  pickGroup = signal('');
  private usuarioTouched = false;
  private timer?: ReturnType<typeof setInterval>;

  endpointUrl = computed(() => location.origin + this.endpoint());
  knownPlates = computed(() => new Set(this.vehicles().map((v) => v.patente).filter(Boolean)));
  draftSet = computed(() => new Set(this.draft().patentes));
  pickList = computed(() => {
    const q = this.pickSearch().trim().toLowerCase();
    const qp = plain(q);
    const g = this.pickGroup() ? this.store.fmGroups().find((x) => x.id === this.pickGroup()) : null;
    const inGroup = g ? new Set((g.vehicles || []).map(String)) : null;
    return this.vehicles()
      .filter((v) => v.patente)
      .filter((v) => !inGroup || inGroup.has(v.id))
      .filter((v) => !q || v.nombre.toLowerCase().includes(q) || (qp && v.patente.includes(qp)))
      .sort((a, b) => a.patente.localeCompare(b.patente));
  });
  canSave = computed(() => {
    const d = this.draft();
    return d.nombre.trim().length > 0 && Number.isInteger(d.limiteMinuto) && d.limiteMinuto >= 1 && d.limiteMinuto <= 60
      && (this.editing() !== 'new' || USUARIO_RE.test(d.usuario));
  });
  formHint = computed(() => {
    const d = this.draft();
    if (!d.nombre.trim()) return 'Falta el nombre';
    if (this.editing() === 'new' && !USUARIO_RE.test(d.usuario)) return 'Usuario: 3 a 40 caracteres (minúsculas, números, punto, guion o guion bajo)';
    if (!(d.limiteMinuto >= 1 && d.limiteMinuto <= 60)) return 'Consultas por minuto: entre 1 y 60';
    if (!d.patentes.length) return 'Sin patentes el cliente recibirá una lista vacía';
    return '';
  });

  plain = plain;
  fmtDate = fmtDate;
  fmtNum = fmtNum;
  relativeTime = relativeTime;
  val(ev: Event): string { return (ev.target as HTMLInputElement).value; }

  ngOnInit() {
    this.loadList();
    this.loadVehicles();
    // Último uso y contadores
    this.timer = setInterval(() => this.loadList(), 30000);
  }
  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }

  async loadList() {
    try {
      const r = await firstValueFrom(this.api.accesos());
      this.accesos.set(r.accesos);
      if (r.endpoint) this.endpoint.set(r.endpoint);
    } catch (err) {
      this.toast.err(errMsg(err, 'No se pudieron cargar los accesos'));
    } finally { this.loading.set(false); }
  }
  async loadVehicles() {
    try { this.vehicles.set((await firstValueFrom(this.api.accesoVehiculos())).vehiculos); } catch {}
  }

  unknownCount(patentes: string[]) {
    if (!this.vehicles().length) return 0;
    const known = this.knownPlates();
    return patentes.filter((p) => !known.has(p)).length;
  }

  // ---------- edición ----------
  startNew() {
    this.usuarioTouched = false;
    this.draft.set({ nombre: '', usuario: '', limiteMinuto: 2, patentes: [] });
    this.resetPicker();
    this.editing.set('new');
  }
  toggleRow(a: ApiAccess) {
    if (this.editing() === a.id) return this.cancel();
    this.draft.set({ nombre: a.nombre, usuario: a.usuario, limiteMinuto: a.limiteMinuto, patentes: [...a.patentes] });
    this.resetPicker();
    this.editing.set(a.id);
  }
  cancel() { this.editing.set(null); this.preview.set(null); }
  private resetPicker() { this.pasteText.set(''); this.pickSearch.set(''); this.pickGroup.set(''); this.preview.set(null); }

  setNombre(v: string) {
    this.draft.update((d) => ({ ...d, nombre: v, usuario: this.editing() === 'new' && !this.usuarioTouched ? slug(v) : d.usuario }));
  }
  setUsuario(v: string) {
    this.usuarioTouched = true;
    this.draft.update((d) => ({ ...d, usuario: v.trim().toLowerCase() }));
  }
  setLimite(v: string) { this.draft.update((d) => ({ ...d, limiteMinuto: Number(v) })); }

  private setPlates(list: string[]) {
    this.draft.update((d) => ({ ...d, patentes: [...new Set(list.map(plain).filter(Boolean))].sort() }));
  }
  togglePlate(p: string) {
    const cur = this.draft().patentes;
    this.setPlates(cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]);
  }
  removePlate(p: string) { this.setPlates(this.draft().patentes.filter((x) => x !== p)); }
  addVisible() { this.setPlates([...this.draft().patentes, ...this.pickList().map((v) => v.patente)]); }
  addPasted() {
    const added = this.pasteText().split(/[\s,;]+/).map(plain).filter(Boolean);
    if (!added.length) return;
    this.setPlates([...this.draft().patentes, ...added]);
    this.pasteText.set('');
    const unknown = [...new Set(added)].filter((p) => !this.knownPlates().has(p));
    if (unknown.length && this.vehicles().length) {
      this.toast.warn(`${unknown.length} patente(s) no corresponden a ningún vehículo: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? '…' : ''}`);
    }
  }

  async save() {
    if (!this.canSave()) return;
    const d = this.draft();
    this.saving.set(true);
    try {
      if (this.editing() === 'new') {
        const r = await firstValueFrom(this.api.createAcceso({ nombre: d.nombre.trim(), usuario: d.usuario, patentes: d.patentes, limiteMinuto: d.limiteMinuto }));
        this.reveal(r.acceso, r.token, true);
        this.editing.set(null);
        this.toast.ok('Acceso creado');
      } else {
        const id = this.editing()!;
        const r = await firstValueFrom(this.api.updateAcceso(id, { nombre: d.nombre.trim(), patentes: d.patentes, limiteMinuto: d.limiteMinuto }));
        this.draft.set({ nombre: r.acceso.nombre, usuario: r.acceso.usuario, limiteMinuto: r.acceso.limiteMinuto, patentes: [...r.acceso.patentes] });
        if (this.preview()) this.loadPreview(r.acceso);
        this.toast.ok('Cambios guardados · aplican desde la próxima consulta');
      }
      await this.loadList();
    } catch (err) {
      this.toast.err(errMsg(err, 'No se pudo guardar'));
    } finally { this.saving.set(false); }
  }

  async setEnabled(a: ApiAccess, enabled: boolean) {
    try {
      await firstValueFrom(this.api.updateAcceso(a.id, { enabled }));
      this.toast.ok(enabled ? `${a.nombre}: acceso activado` : `${a.nombre}: acceso desactivado (responde 403)`);
    } catch (err) {
      this.toast.err(errMsg(err, 'No se pudo cambiar el estado'));
    }
    await this.loadList();
  }

  async regenerate(a: ApiAccess) {
    if (!confirm(`¿Generar un token nuevo para «${a.nombre}»?\n\nEl token actual deja de funcionar de inmediato: habrá que entregarle el nuevo al cliente.`)) return;
    try {
      const r = await firstValueFrom(this.api.regenerateAccesoToken(a.id));
      this.reveal(r.acceso, r.token, false);
      await this.loadList();
    } catch (err) {
      this.toast.err(errMsg(err, 'No se pudo regenerar el token'));
    }
  }

  async remove(a: ApiAccess) {
    if (!confirm(`¿Eliminar el acceso «${a.nombre}» (${a.usuario})?\n\nSu token deja de funcionar de inmediato.`)) return;
    try {
      await firstValueFrom(this.api.deleteAcceso(a.id));
      this.editing.set(null);
      this.toast.ok('Acceso eliminado');
      await this.loadList();
    } catch (err) {
      this.toast.err(errMsg(err, 'No se pudo eliminar'));
    }
  }

  async loadPreview(a: ApiAccess) {
    try { this.preview.set(await firstValueFrom(this.api.accesoPreview(a.id))); }
    catch (err) { this.toast.err(errMsg(err, 'No se pudo obtener la vista previa')); }
  }

  private reveal(a: ApiAccess, token: string, nuevo: boolean) {
    this.revealed.set({ nombre: a.nombre, usuario: a.usuario, token, limiteMinuto: a.limiteMinuto, nuevo });
    setTimeout(() => this.host.nativeElement.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  async copy(text: string, okMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.ok(okMsg);
    } catch {
      this.toast.err('No se pudo copiar al portapapeles');
    }
  }

  /** Texto para entregarle al cliente (incluye el token: solo existe mientras se muestra) */
  instructions(c: Revealed): string {
    const url = this.endpointUrl();
    return [
      `Acceso API PROASEG · ${c.nombre}`,
      '',
      `URL (GET): ${url}`,
      `Usuario:   ${c.usuario}`,
      `Token:     ${c.token}`,
      '',
      'Autenticación (cualquiera de estas):',
      `  - Header  Authorization: Bearer ${c.token}`,
      `  - Usuario y contraseña (HTTP Basic): usuario "${c.usuario}", contraseña = el token`,
      '',
      'Ejemplo:',
      `  curl -H "Authorization: Bearer ${c.token}" ${url}`,
      '',
      'Opcional: ?patente=AB1234,CD5678 para pedir solo algunas de las patentes autorizadas.',
      '',
      'Respuesta (JSON):',
      '{',
      '  "fecha_consulta": "2026-11-11T12:45:00-03:00",',
      '  "total": 1,',
      '  "vehiculos": [',
      '    { "patente": "AB1234", "latitud": -33.4489, "longitud": -70.6693,',
      '      "fecha_hora": "2026-11-11T12:42:10-03:00", "velocidad": 54, "ignicion": true }',
      '  ]',
      '}',
      '',
      'Campos de cada vehículo:',
      '  patente      letras y números, sin guion',
      '  latitud      grados decimales (WGS84)',
      '  longitud     grados decimales (WGS84)',
      '  fecha_hora   hora del GPS, ISO 8601 en hora de Chile con su offset (-03:00 / -04:00)',
      '  velocidad    km/h',
      '  ignicion     true = encendido, false = apagado, null = no informado',
      'Si una patente no tiene posición en los últimos 7 días, sus datos vienen en null.',
      '',
      'Frecuencia: los datos se actualizan cada ~10 s. Con el motor encendido los equipos reportan',
      `cada ~30 s y apagados cada ~5 min. Recomendado: consultar cada 30 a 60 s. Límite: ${c.limiteMinuto} consulta(s)`,
      'por minuto; si se excede responde 429 (el header Retry-After indica cuántos segundos esperar).',
      '',
      'Errores: 401 credenciales inválidas · 403 acceso desactivado · 429 demasiadas consultas.',
    ].join('\n');
  }
}
