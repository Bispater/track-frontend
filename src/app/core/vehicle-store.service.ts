import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService, SnapshotResponse } from './api.service';
import { firstValueFrom } from 'rxjs';

export interface StoredVehicle {
  id: string;
  name: string;
  imei: string | number;
  model?: string;
  plate?: string;
  raw: any;
  position?: ParsedPosition | null;
  positionUpdatedAt: string | null;
  lastCheckedAt: string | null;
  fmGroups?: { id: string; name: string }[];
}
export interface ParsedPosition {
  ts?: string;
  lat?: number | null;
  lng?: number | null;
  speed?: number | null;
  direction?: number | null;
  altitude?: number | null;
  ignition?: string | null;
  sats?: number | null;
  hdop?: string | null;
  raw: any;
}

const VS_KEY = 'track-service.vehicles.v1';
const VS_GROUPS_KEY = 'track-service.fmGroups.v1';
const POLL_INTERVAL_MS = 10000;

function pick(obj: any, paths: string[], fallback?: any): any {
  if (!obj) return fallback;
  for (const p of paths) {
    const v = p.split('.').reduce((acc: any, k) => (acc == null ? acc : acc[k]), obj);
    if (v != null && v !== '') return v;
  }
  return fallback;
}
function toArray(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && Array.isArray(x.items)) return x.items;
  if (x && Array.isArray(x.data)) return x.data;
  return x ? [x] : [];
}

@Injectable({ providedIn: 'root' })
export class VehicleStoreService {
  private api = inject(ApiService);

  // Estado reactivo: signal por vehículo + grupos fm-track
  private data = signal<Record<string, StoredVehicle>>(this.loadStored());
  private fmGroupsRaw = signal<{ id: string; name: string; vehicles: string[] }[]>(this.loadGroups());
  lastPollAt = signal<string | null>(null);

  list = computed(() => Object.values(this.data()).sort((a, b) => String(a.name).localeCompare(String(b.name))));
  fmGroups = computed(() => this.fmGroupsRaw());
  // Index vehicleId → array de grupos
  groupsByVehicle = computed(() => {
    const map = new Map<string, { id: string; name: string }[]>();
    for (const g of this.fmGroupsRaw()) {
      for (const vid of g.vehicles || []) {
        const k = String(vid);
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push({ id: g.id, name: g.name });
      }
    }
    return map;
  });

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  startPolling() {
    if (this.pollTimer) return;
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }
  stopPolling() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  async poll() {
    try {
      const snap = await firstValueFrom(this.api.snapshot());
      this.update(snap);
      this.lastPollAt.set(new Date().toISOString());
    } catch { /* ignorar errores de poll silenciosamente */ }
  }

  private update(snap: SnapshotResponse) {
    const now = new Date().toISOString();
    const objs = toArray(snap.objects?.data);
    const positions = toArray(snap.positions?.data);
    const posByObj = new Map<string, any>();
    for (const p of positions) {
      const id = pick(p, ['object_id', 'id']);
      if (id != null) posByObj.set(String(id), p);
    }

    const next = { ...this.data() };
    for (const o of objs) {
      const id = String(pick(o, ['id', 'object_id', 'uuid', 'imei']) || '');
      if (!id) continue;
      const prev = next[id];
      let position = prev?.position || null;
      let positionUpdatedAt = prev?.positionUpdatedAt || null;
      const incoming = posByObj.get(id);
      if (incoming) {
        const newTs = pick(incoming, ['datetime']);
        const prevTs = position ? position.ts : null;
        if (newTs && newTs !== prevTs) {
          position = this.parsePosition(incoming);
          positionUpdatedAt = now;
        }
      }
      next[id] = {
        id,
        name: pick(o, ['name', 'label', 'description'], '—'),
        imei: pick(o, ['imei', 'identifier'], ''),
        model: pick(o, ['vehicle_params.model', 'model']),
        plate: pick(o, ['vehicle_params.plate_number', 'plate']),
        raw: o,
        position,
        positionUpdatedAt,
        lastCheckedAt: now,
      };
    }

    // Grupos
    const incomingGroups = toArray(snap.groups?.data);
    if (incomingGroups.length) {
      this.fmGroupsRaw.set(incomingGroups);
      try { localStorage.setItem(VS_GROUPS_KEY, JSON.stringify(incomingGroups)); } catch {}
    }
    this.data.set(next);
    try { localStorage.setItem(VS_KEY, JSON.stringify(next)); } catch {}
  }

  private parsePosition(p: any): ParsedPosition {
    const lat = pick(p, ['position.latitude']);
    const lng = pick(p, ['position.longitude']);
    return {
      ts: pick(p, ['datetime']),
      lat: lat != null ? Number(lat) : null,
      lng: lng != null ? Number(lng) : null,
      speed: pick(p, ['position.speed']),
      direction: pick(p, ['position.direction']),
      altitude: pick(p, ['position.altitude']),
      ignition: pick(p, ['ignition_status']),
      sats: pick(p, ['position.satellites_count']),
      hdop: pick(p, ['device_inputs.hdop']),
      raw: p,
    };
  }

  private loadStored(): Record<string, StoredVehicle> {
    try { return JSON.parse(localStorage.getItem(VS_KEY) || '{}'); } catch { return {}; }
  }
  private loadGroups() {
    try { return JSON.parse(localStorage.getItem(VS_GROUPS_KEY) || '[]'); } catch { return []; }
  }

  clear() {
    this.data.set({});
    this.fmGroupsRaw.set([]);
    try { localStorage.removeItem(VS_KEY); localStorage.removeItem(VS_GROUPS_KEY); } catch {}
  }
}
