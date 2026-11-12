import { Component, ElementRef, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ApiService, ApiAccess, ApiAccessLog, ApiAccessVehicle } from '../../core/api.service';
import { VehicleStoreService } from '../../core/vehicle-store.service';
import { ToastService } from '../../core/toast.service';
import { fmtDate, fmtNum, relativeTime } from '../../core/format.utils';
import { IconComponent } from '../../shared/icon.component';
import { ToggleSwitchComponent } from '../../shared/toggle-switch.component';
import { JsonPanelComponent } from '../../shared/json-panel.component';

interface Draft { nombre: string; usuario: string; limiteMinuto: number; patentes: string[]; }
interface Revealed { nombre: string; usuario: string; token: string; limiteMinuto: number; nuevo: boolean; }
type Tab = 'actividad' | 'config' | 'respuesta';

// Misma regla que el backend: solo letras y dígitos, en mayúsculas ("ab-1234" → "AB1234")
const plain = (s: string) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
// "Transportes Pérez Ltda." → "transportes-perez-ltda"
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const USUARIO_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;
const errMsg = (err: any, fb: string) => err?.error?.error || err?.message || fb;

// Resultado de una consulta (api_access_log.resultado) → texto y color
const RESULTADOS: Record<string, { label: string; cls: string }> = {
  ok: { label: 'OK', cls: 'badge-ok' },
  limite: { label: 'Sobre el límite · 429', cls: 'badge-warn' },
  desactivado: { label: 'Acceso desactivado · 403', cls: 'badge-warn' },
  token_invalido: { label: 'Token incorrecto · 401', cls: 'badge-err' },
  usuario_desconocido: { label: 'Usuario no existe · 401', cls: 'badge-err' },
  sin_credenciales: { label: 'Sin credenciales · 401', cls: 'badge-err' },
  error: { label: 'Error interno · 500', cls: 'badge-err' },
};
const METODOS: Record<string, string> = { basic: 'Usuario y contraseña', bearer: 'Bearer', 'api-key': 'X-API-Key' };

/**
 * Accesos API: credenciales de solo lectura para que un cliente consulte la última posición
 * de las patentes que se le autorizan (GET /api/externo/v1/posiciones). El token completo
 * solo se ve al crearlo o regenerarlo. Cada consulta (también las rechazadas) queda en el
 * registro del acceso.
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
          <div class="grid gap-2 text-sm items-center" style="grid-template-columns: 80px minmax(0, 1fr);">
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
          <div class="font-semibold mb-3">Nuevo acceso</div>
          <ng-container *ngTemplateOutlet="editor" />
        </div>
      }

      <div class="card-body-tight overflow-x-auto">
        <table class="tbl">
          <thead>
            <tr>
              <th style="width: 28px;"></th>
              <th>Acceso</th><th>Patentes</th><th>Límite</th><th>Última consulta</th>
              <th>Consultas 24 h</th><th>Errores 24 h</th><th>Activo</th>
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
                <td>
                  <div class="font-medium">{{ a.nombre }}</div>
                  <div class="text-[11px] text-text-dim font-mono">{{ a.usuario }}</div>
                </td>
                <td>
                  {{ a.patentes.length }}
                  @if (unknownCount(a.patentes); as n) {
                    <span class="badge badge-warn ml-1" title="Patentes que no corresponden a ningún vehículo de fm-track">{{ n }} sin vehículo</span>
                  }
                </td>
                <td>{{ a.limiteMinuto }}/min</td>
                <td>
                  @if (a.lastUsedAt) {
                    <div>{{ relativeTime(a.lastUsedAt) }}</div>
                    <div class="text-[11px] text-text-dim font-mono">{{ a.lastIp }}</div>
                  } @else {
                    <span class="text-text-dim">nunca</span>
                  }
                </td>
                <td class="tabular-nums">{{ fmtNum(a.ok24h) }}</td>
                <td>
                  @if (a.errores24h) {
                    <span class="badge badge-err" [title]="'Último error ' + relativeTime(a.ultimoError)">{{ fmtNum(a.errores24h) }}</span>
                  } @else {
                    <span class="text-text-dim">0</span>
                  }
                </td>
                <td (click)="$event.stopPropagation()">
                  <app-toggle-switch [checked]="a.enabled" (checkedChange)="setEnabled(a, $event)" />
                </td>
              </tr>
              @if (editing() === a.id) {
                <tr class="no-hover detail-row">
                  <td colspan="8" style="padding: 0;">
                    <div class="detail">
                      <div class="detail-bar">
                        <div class="tabs">
                          <button [class.on]="tab() === 'actividad'" (click)="setTab('actividad', a)">
                            Actividad
                            @if (a.errores24h) { <span class="tab-count">{{ a.errores24h }}</span> }
                          </button>
                          <button [class.on]="tab() === 'config'" (click)="setTab('config', a)">Configuración</button>
                          <button [class.on]="tab() === 'respuesta'" (click)="setTab('respuesta', a)">Lo que recibe el cliente</button>
                        </div>
                        <div class="flex-1"></div>
                        <button class="btn btn-ghost btn-xs flex items-center gap-1.5" (click)="regenerate(a)">
                          <app-icon name="refresh" [size]="13" /> Regenerar token
                        </button>
                        <button class="btn btn-ghost btn-xs flex items-center gap-1.5 text-err" (click)="remove(a)">
                          <app-icon name="x" [size]="13" /> Eliminar
                        </button>
                      </div>

                      @if (tab() === 'actividad') {
                        <div class="kpis">
                          <div class="kpi">
                            <div class="kpi-label">Última consulta</div>
                            <div class="kpi-value">{{ a.lastUsedAt ? relativeTime(a.lastUsedAt) : 'nunca' }}</div>
                            <div class="kpi-sub">{{ a.lastUsedAt ? fmtDate(a.lastUsedAt) + ' · ' + a.lastIp : 'El cliente aún no consulta' }}</div>
                          </div>
                          <div class="kpi">
                            <div class="kpi-label">Respondidas · 24 h</div>
                            <div class="kpi-value">{{ fmtNum(a.ok24h) }}</div>
                            <div class="kpi-sub">{{ fmtNum(a.consultas) }} desde que se creó</div>
                          </div>
                          <div class="kpi" [class.kpi-err]="a.errores24h">
                            <div class="kpi-label">Rechazadas · 24 h</div>
                            <div class="kpi-value">{{ fmtNum(a.errores24h) }}</div>
                            <div class="kpi-sub">{{ a.ultimoError ? 'última ' + relativeTime(a.ultimoError) : 'Sin errores' }}</div>
                          </div>
                          <div class="kpi">
                            <div class="kpi-label">Token vigente</div>
                            <div class="kpi-value font-mono">…{{ a.tokenFin }}</div>
                            <div class="kpi-sub">creado {{ fmtDate(a.createdAt) }}{{ a.createdBy ? ' por ' + a.createdBy : '' }}</div>
                          </div>
                        </div>

                        <div class="flex items-center gap-2 mt-4 mb-2">
                          <div class="font-semibold text-sm">Registro de consultas</div>
                          <div class="flex-1"></div>
                          <div class="seg-mini">
                            <button [class.on]="!soloErrores()" (click)="setSoloErrores(false, a)">Todas</button>
                            <button [class.on]="soloErrores()" (click)="setSoloErrores(true, a)">Solo rechazadas</button>
                          </div>
                          <button class="icon-btn copy-btn" title="Actualizar" (click)="loadRegistro(a)"><app-icon name="refresh" [size]="14" /></button>
                        </div>
                        <ng-container *ngTemplateOutlet="logTable; context: { $implicit: registro(), acc: a }" />
                      }

                      @if (tab() === 'config') {
                        <ng-container *ngTemplateOutlet="editor" />
                      }

                      @if (tab() === 'respuesta') {
                        <div class="text-xs text-text-dim mb-2">
                          Esto es lo que recibiría el cliente si consultara ahora. Verlo aquí no cuenta como consulta.
                        </div>
                        @if (preview(); as p) {
                          <app-json-panel title="Respuesta de la API para este acceso" [content]="p" />
                        } @else {
                          <div class="text-xs text-text-dim">Cargando…</div>
                        }
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

    @if (sinIdentificar()) {
      <div class="card">
        <div class="card-header cursor-pointer" (click)="toggleSinIdent()">
          <span class="inline-block transition-transform text-text-dim" [style.transform]="sinIdentOpen() ? 'rotate(90deg)' : 'rotate(0deg)'">
            <app-icon name="chevron-right" [size]="14" />
          </span>
          <h2>Intentos rechazados sin acceso identificado</h2>
          <span class="badge badge-err">{{ fmtNum(sinIdentificar()) }}</span>
          <span class="text-xs text-text-dim">últimos 7 días</span>
        </div>
        @if (sinIdentOpen()) {
          <div class="card-body">
            <div class="text-xs text-text-dim mb-2">
              Consultas con un token que no es de ningún acceso (por ejemplo, uno que ya se regeneró) o sin credenciales.
              Si un cliente dice que no puede conectarse, búscalo aquí por su IP.
            </div>
            <ng-container *ngTemplateOutlet="logTable; context: { $implicit: sinIdentList(), acc: null }" />
          </div>
        }
      </div>
    }

    <!-- Tabla del registro: acc = acceso abierto (null en los intentos sin identificar) -->
    <ng-template #logTable let-rows let-acc="acc">
      <div class="log-wrap">
        <table class="log">
          <thead>
            <tr><th>Fecha y hora</th><th>Resultado</th><th>IP</th><th>Método</th><th>Vehículos</th><th>Detalle</th></tr>
          </thead>
          <tbody>
            @if (rows === null) {
              <tr><td colspan="6" class="text-text-dim">Cargando…</td></tr>
            }
            @for (r of rows || []; track r.id) {
              <tr>
                <td class="whitespace-nowrap tabular-nums" [title]="relativeTime(r.ts)">{{ fmtDate(r.ts) }}</td>
                <td class="whitespace-nowrap"><span [class]="'badge ' + resultado(r).cls">{{ resultado(r).label }}</span></td>
                <td class="font-mono whitespace-nowrap">{{ r.ip || '—' }}</td>
                <td class="whitespace-nowrap">{{ metodo(r) }}</td>
                <td class="tabular-nums whitespace-nowrap">
                  @if (r.vehiculos != null) {
                    {{ r.conPosicion }} / {{ r.vehiculos }}
                  } @else { <span class="text-text-dim">—</span> }
                </td>
                <td class="detail-cell">
                  <div>{{ detalle(r, acc) }}</div>
                  @if (r.userAgent) { <div class="text-[11px] text-text-dim truncate" [title]="r.userAgent">{{ r.userAgent }}</div> }
                </td>
              </tr>
            }
            @if (rows && !rows.length) {
              <tr><td colspan="6" class="text-text-dim py-4">
                {{ acc ? (soloErrores() ? 'Sin consultas rechazadas.' : 'Sin consultas todavía. Aquí aparecerá cada consulta del cliente, también las que fallen.') : 'Sin intentos.' }}
              </td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (rows?.length) {
        <div class="text-[11px] text-text-dim mt-1.5">
          Últimas {{ rows.length }} · «Vehículos» = con posición / entregados · el registro se guarda 90 días
        </div>
      }
    </ng-template>

    <ng-template #editor>
      <div class="editor">
        <div class="ed-fields">
          <label class="field">
            <span>Nombre</span>
            <input class="input" [value]="draft().nombre" (input)="setNombre(val($event))" placeholder="Empresa o contacto" />
          </label>
          @if (editing() === 'new') {
            <label class="field">
              <span>Usuario</span>
              <input class="input font-mono" [value]="draft().usuario" (input)="setUsuario(val($event))" placeholder="empresa-x" />
            </label>
          }
          <label class="field">
            <span>Consultas por minuto</span>
            <input class="input" type="number" min="1" max="60" [value]="draft().limiteMinuto" (input)="setLimite(val($event))" />
          </label>
        </div>

        <div class="ed-section">
          <div class="ed-title">
            Patentes autorizadas <span class="badge badge-muted">{{ draft().patentes.length }}</span>
            <div class="flex-1"></div>
            @if (draft().patentes.length) {
              <button class="link-btn" (click)="setPlates([])">Quitar todas</button>
            }
          </div>
          <div class="chips-box">
            @for (p of draft().patentes; track p) {
              <span class="chip" [class.chip-warn]="!knownPlates().has(p)"
                [title]="knownPlates().has(p) ? '' : 'No hay ningún vehículo con esta patente en fm-track'">
                {{ p }}<button (click)="removePlate(p)" title="Quitar">×</button>
              </span>
            } @empty {
              <span class="text-xs text-text-dim">Ninguna todavía: pégalas o márcalas abajo.</span>
            }
          </div>
        </div>

        <div class="ed-section">
          <div class="ed-title">Agregar patentes</div>
          <div class="add-grid">
            <div class="min-w-0">
              <div class="ed-sub">Pegar una lista</div>
              <textarea class="input w-full font-mono" rows="8" placeholder="DFBY49, AB-1234&#10;una por línea o separadas por coma"
                [value]="pasteText()" (input)="pasteText.set(val($event))"></textarea>
              <button class="btn btn-ghost mt-1.5 flex items-center gap-1.5" (click)="addPasted()" [disabled]="!pasteText().trim()">
                <app-icon name="plus" [size]="14" /> Agregar
              </button>
            </div>
            <div class="min-w-0">
              <div class="ed-sub">Elegir de la flota</div>
              <div class="pick-tools">
                <input class="input pick-search" type="search" placeholder="Buscar patente o nombre…" [value]="pickSearch()" (input)="pickSearch.set(val($event))" />
                <select class="input pick-group" [value]="pickGroup()" (change)="pickGroup.set(val($event))">
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
        </div>

        <div class="ed-foot">
          @if (formHint(); as h) { <span class="text-xs text-text-dim">{{ h }}</span> }
          <div class="flex-1"></div>
          <button class="btn btn-ghost" (click)="cancelEdit()">{{ editing() === 'new' ? 'Cancelar' : 'Descartar cambios' }}</button>
          <button class="btn" (click)="save()" [disabled]="saving() || !canSave()">
            {{ editing() === 'new' ? 'Crear acceso' : 'Guardar cambios' }}
          </button>
        </div>
      </div>
    </ng-template>
  `,
  styles: [`
    .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .field > span, .ed-title, .ed-sub { font-size: 11px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
    .field .input { width: 100%; }
    .chip {
      display: inline-flex; align-items: center; gap: 2px; padding: 2px 2px 2px 8px; border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; font-weight: 600;
      background: var(--bg-elev); border: 1px solid var(--border);
    }
    .chip button { border: none; background: transparent; color: var(--text-dim); cursor: pointer; padding: 0 5px; font-size: 15px; line-height: 1; }
    .chip button:hover { color: var(--err); }
    .chip-warn { border-color: var(--warn); color: var(--warn); }
    .copy-btn { width: 28px; height: 28px; }
    .tbl tbody tr.no-hover:hover { background: var(--bg-soft); cursor: default; }

    /* editor */
    .editor { display: flex; flex-direction: column; gap: 18px; }
    .ed-fields { display: flex; flex-wrap: wrap; gap: 12px; }
    .ed-fields .field { flex: 0 1 340px; }
    .ed-fields .field:last-child { flex: 0 0 170px; }
    .ed-section { display: flex; flex-direction: column; gap: 8px; }
    .ed-title { display: flex; align-items: center; gap: 8px; }
    .ed-sub { margin-bottom: 6px; text-transform: none; letter-spacing: 0; font-size: 12px; }
    .chips-box {
      display: flex; flex-wrap: wrap; gap: 6px; min-height: 42px; padding: 8px;
      border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elev);
    }
    .add-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.8fr); gap: 16px; }
    @media (max-width: 900px) { .add-grid { grid-template-columns: minmax(0, 1fr); } }
    .pick-tools { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
    .pick-search { flex: 1 1 180px; min-width: 0; }
    .pick-group { flex: 0 1 220px; min-width: 0; }
    .pick-list { max-height: 264px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elev); }
    .pick-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; font-size: 13px; cursor: pointer; border-bottom: 1px solid var(--border); min-width: 0; }
    .pick-row:last-child { border-bottom: none; }
    .pick-row:hover { background: var(--bg-soft); }
    .ed-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-top: 14px; border-top: 1px solid var(--border); }
    .link-btn { background: none; border: none; padding: 0; font-size: 12px; color: var(--text-dim); cursor: pointer; text-transform: none; letter-spacing: 0; font-weight: 500; }
    .link-btn:hover { color: var(--err); text-decoration: underline; }

    /* detalle del acceso */
    .detail-row { background: var(--bg-soft); }
    /* contain: el contenido (registro ancho) no ensancha la tabla principal; el registro hace scroll dentro de su caja */
    .detail { padding: 0 20px 20px; contain: inline-size; }
    .detail-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
    .tabs { display: flex; gap: 2px; }
    .tabs button {
      display: inline-flex; align-items: center; gap: 6px; padding: 11px 14px 9px; font-size: 13px; font-weight: 600;
      color: var(--text-dim); background: transparent; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; cursor: pointer;
    }
    .tabs button:hover { color: var(--text); }
    .tabs button.on { color: var(--text); border-bottom-color: var(--accent); }
    .tab-count { background: var(--err); color: #fff; border-radius: 999px; font-size: 10.5px; line-height: 16px; padding: 0 6px; }
    .btn-xs { padding: 4px 10px; font-size: 12px; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .kpi { background: var(--bg-elev); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; min-width: 0; }
    .kpi-label { font-size: 10.5px; color: var(--text-dim); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .kpi-value { font-size: 20px; font-weight: 700; line-height: 1.3; font-variant-numeric: tabular-nums; }
    .kpi-sub { font-size: 11px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kpi-err { border-color: rgba(248,114,114,0.45); }
    .kpi-err .kpi-value { color: var(--err); }
    .seg-mini { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--bg-elev); }
    .seg-mini button { padding: 4px 12px; font-size: 12px; font-weight: 600; background: transparent; border: none; color: var(--text-dim); cursor: pointer; }
    .seg-mini button + button { border-left: 1px solid var(--border); }
    .seg-mini button.on { background: var(--accent); color: #fff; }
    .log-wrap { border: 1px solid var(--border); border-radius: 8px; overflow: auto; max-height: 420px; background: var(--bg-elev); }
    .log { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .log th {
      position: sticky; top: 0; text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--text-dim); font-weight: 600; padding: 7px 10px; border-bottom: 1px solid var(--border); background: var(--bg-soft);
    }
    .log td { padding: 6px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
    .log tbody tr:last-child td { border-bottom: none; }
    .detail-cell { max-width: 420px; min-width: 200px; }
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
  tab = signal<Tab>('actividad');
  draft = signal<Draft>({ nombre: '', usuario: '', limiteMinuto: 2, patentes: [] });
  revealed = signal<Revealed | null>(null);
  preview = signal<any>(null);
  registro = signal<ApiAccessLog[] | null>(null);
  soloErrores = signal(false);
  sinIdentificar = signal(0);
  sinIdentOpen = signal(false);
  sinIdentList = signal<ApiAccessLog[] | null>(null);
  pasteText = signal('');
  pickSearch = signal('');
  pickGroup = signal('');
  private usuarioTouched = false;
  private timer?: ReturnType<typeof setInterval>;

  endpointUrl = computed(() => location.origin + this.endpoint());
  knownPlates = computed(() => new Set(this.vehicles().map((v) => v.patente).filter(Boolean)));
  draftSet = computed(() => new Set(this.draft().patentes));
  current = computed(() => this.accesos().find((a) => a.id === this.editing()) || null);
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
  /** Hay cambios sin guardar en el acceso abierto */
  dirty = computed(() => {
    const a = this.current();
    if (!a) return true;
    const d = this.draft();
    return d.nombre.trim() !== a.nombre || d.limiteMinuto !== a.limiteMinuto || d.patentes.join(',') !== [...a.patentes].sort().join(',');
  });
  canSave = computed(() => {
    const d = this.draft();
    return d.nombre.trim().length > 0 && Number.isInteger(d.limiteMinuto) && d.limiteMinuto >= 1 && d.limiteMinuto <= 60
      && (this.editing() !== 'new' ? this.dirty() : USUARIO_RE.test(d.usuario));
  });
  formHint = computed(() => {
    const d = this.draft();
    if (!d.nombre.trim()) return 'Falta el nombre';
    if (this.editing() === 'new' && !USUARIO_RE.test(d.usuario)) return 'Usuario: 3 a 40 caracteres (minúsculas, números, punto, guion o guion bajo)';
    if (!(d.limiteMinuto >= 1 && d.limiteMinuto <= 60)) return 'Consultas por minuto: entre 1 y 60';
    if (!d.patentes.length) return 'Sin patentes el cliente recibirá una lista vacía';
    if (this.editing() !== 'new' && !this.dirty()) return 'Sin cambios';
    return '';
  });

  plain = plain;
  fmtDate = fmtDate;
  fmtNum = fmtNum;
  relativeTime = relativeTime;
  val(ev: Event): string { return (ev.target as HTMLInputElement).value; }

  resultado(r: ApiAccessLog) { return RESULTADOS[r.resultado] || { label: `${r.resultado} · ${r.status}`, cls: r.status >= 400 ? 'badge-err' : 'badge-ok' }; }
  metodo(r: ApiAccessLog) { return r.metodo ? METODOS[r.metodo] || r.metodo : '—'; }
  /** Explicación corta de cada fila del registro */
  detalle(r: ApiAccessLog, acc: ApiAccess | null): string {
    const parts: string[] = [];
    if (r.resultado === 'token_invalido') {
      parts.push(r.tokenFin ? `Usó un token terminado en …${r.tokenFin}` : 'Token con formato inválido');
      if (acc && r.tokenFin) parts.push(`el vigente termina en …${acc.tokenFin}`);
    }
    if (r.resultado === 'usuario_desconocido' && r.usuario) parts.push(`Usuario enviado: «${r.usuario}»`);
    if (!acc && r.usuario && r.resultado !== 'usuario_desconocido') parts.push(`Usuario: ${r.usuario}`);
    if (r.resultado === 'sin_credenciales') parts.push('No envió usuario ni token');
    if (r.resultado === 'limite') parts.push('Consultó más seguido de lo permitido');
    if (r.resultado === 'desactivado') parts.push('El acceso estaba desactivado');
    if (r.filtro) parts.push(`Filtro: ${r.filtro}`);
    if (r.resultado === 'ok' && r.ms != null) parts.push(`${r.ms} ms`);
    return parts.join(' · ') || '—';
  }

  ngOnInit() {
    this.loadList();
    this.loadVehicles();
    // Última consulta, contadores y registro abierto
    this.timer = setInterval(() => {
      this.loadList();
      const a = this.current();
      if (a && this.tab() === 'actividad') this.loadRegistro(a, true);
      if (this.sinIdentOpen()) this.loadSinIdent(true);
    }, 30000);
  }
  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }

  async loadList() {
    try {
      const r = await firstValueFrom(this.api.accesos());
      this.accesos.set(r.accesos);
      this.sinIdentificar.set(r.sinIdentificar7d || 0);
      if (r.endpoint) this.endpoint.set(r.endpoint);
    } catch (err) {
      this.toast.err(errMsg(err, 'No se pudieron cargar los accesos'));
    } finally { this.loading.set(false); }
  }
  async loadVehicles() {
    try { this.vehicles.set((await firstValueFrom(this.api.accesoVehiculos())).vehiculos); } catch {}
  }
  async loadRegistro(a: ApiAccess, silent = false) {
    if (!silent) this.registro.set(null);
    try {
      const r = await firstValueFrom(this.api.accesoRegistro(a.id, this.soloErrores()));
      if (this.editing() === a.id) this.registro.set(r.registro);
    } catch (err) {
      if (!silent) { this.registro.set([]); this.toast.err(errMsg(err, 'No se pudo cargar el registro')); }
    }
  }
  setSoloErrores(v: boolean, a: ApiAccess) { this.soloErrores.set(v); this.loadRegistro(a); }
  toggleSinIdent() {
    this.sinIdentOpen.update((v) => !v);
    if (this.sinIdentOpen()) this.loadSinIdent();
  }
  async loadSinIdent(silent = false) {
    if (!silent) this.sinIdentList.set(null);
    try { this.sinIdentList.set((await firstValueFrom(this.api.accesosSinIdentificar())).registro); }
    catch (err) { if (!silent) { this.sinIdentList.set([]); this.toast.err(errMsg(err, 'No se pudieron cargar los intentos')); } }
  }

  unknownCount(patentes: string[]) {
    if (!this.vehicles().length) return 0;
    const known = this.knownPlates();
    return patentes.filter((p) => !known.has(p)).length;
  }

  // ---------- apertura y pestañas ----------
  startNew() {
    this.usuarioTouched = false;
    this.draft.set({ nombre: '', usuario: '', limiteMinuto: 2, patentes: [] });
    this.resetPicker();
    this.editing.set('new');
  }
  toggleRow(a: ApiAccess) {
    if (this.editing() === a.id) { this.editing.set(null); return; }
    this.loadDraft(a);
    this.resetPicker();
    this.soloErrores.set(false);
    this.editing.set(a.id);
    this.setTab('actividad', a);
  }
  setTab(t: Tab, a: ApiAccess) {
    this.tab.set(t);
    if (t === 'actividad') this.loadRegistro(a);
    if (t === 'respuesta') this.loadPreview(a);
  }
  private loadDraft(a: ApiAccess) {
    this.draft.set({ nombre: a.nombre, usuario: a.usuario, limiteMinuto: a.limiteMinuto, patentes: [...a.patentes].sort() });
  }
  cancelEdit() {
    if (this.editing() === 'new') { this.editing.set(null); return; }
    const a = this.current();
    if (a) { this.loadDraft(a); this.resetPicker(); }
  }
  private resetPicker() { this.pasteText.set(''); this.pickSearch.set(''); this.pickGroup.set(''); this.preview.set(null); }

  // ---------- edición ----------
  setNombre(v: string) {
    this.draft.update((d) => ({ ...d, nombre: v, usuario: this.editing() === 'new' && !this.usuarioTouched ? slug(v) : d.usuario }));
  }
  setUsuario(v: string) {
    this.usuarioTouched = true;
    this.draft.update((d) => ({ ...d, usuario: v.trim().toLowerCase() }));
  }
  setLimite(v: string) { this.draft.update((d) => ({ ...d, limiteMinuto: Number(v) })); }

  setPlates(list: string[]) {
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
        this.loadDraft(r.acceso);
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
    if (!confirm(`¿Eliminar el acceso «${a.nombre}» (${a.usuario})?\n\nSu token deja de funcionar de inmediato y se borra su registro de consultas.`)) return;
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
    this.preview.set(null);
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
