import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AppConfig {
  fmTrackBaseUrl: string;
  fmTrackKeyConfigured: boolean;
  targetApiUrl?: string;
  targetKeyConfigured?: boolean;
}

export interface SnapshotResponse {
  objects: { ok: boolean; status: number; data: any[] };
  positions: { ok: boolean; status: number; data: any[] };
  groups: { ok: boolean; status: number; data: any[] };
}

export interface HistoryEntry {
  ts: string;
  vehicleId: string;
  ok?: boolean;
  accepted?: boolean;
  status?: number;
  payload?: any;
  response?: any;
  raw?: any;
  error?: string;
  groupId?: string;
  url?: string;
  skipped?: boolean;        // entrada omitida (misma posición que la anterior)
  message?: string;         // ej. "5: Registro duplicado" (Wise)
  estados?: number[];       // códigos de estado Wise
}

/**
 * Cliente HTTP centralizado para hablar con el backend Node/Express.
 * Cada cliente (Falabella, Wise, Drivin, Bermann) tiene su prefijo.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  // ---- App config / auth ----
  config() { return this.http.get<AppConfig>('/api/config'); }
  me() { return this.http.get<{ authEnabled: boolean; authenticated: boolean; username: string | null }>('/api/me'); }
  login(body: { username: string; password: string }) { return this.http.post<{ ok: boolean; username: string }>('/api/login', body); }
  logout() { return this.http.post<{ ok: boolean }>('/api/logout', {}); }

  // ---- fm-track ----
  snapshot() { return this.http.get<SnapshotResponse>('/api/snapshot'); }
  fmTrackGroups() { return this.http.get<{ groups: { id: string; name: string; vehicles: string[] }[] }>('/api/fm-track/groups'); }
  proxyFmTrack(path: string) { return this.http.get<any>(`/api/fm-track?path=${encodeURIComponent(path)}`); }

  // ---- generic helper for each cliente ----
  clientConfig(client: ClientId): Observable<any> { return this.http.get(`/api/${client}/config`); }
  clientGroups(client: ClientId): Observable<{ groups: Record<string, GroupConfig> }> {
    return this.http.get<{ groups: Record<string, GroupConfig> }>(`/api/${client}/groups`);
  }
  updateClientGroup(client: ClientId, id: string, body: Partial<GroupConfig> & { confirmPassword?: string }) {
    return this.http.put<GroupConfig>(`/api/${client}/groups/${encodeURIComponent(id)}`, body);
  }
  previewClient(client: ClientId, vehicleId: string) {
    return this.http.post<{ ok: boolean; payload?: any; raw?: any; error?: string }>(`/api/${client}/preview`, { vehicleId });
  }
  sendOne(client: ClientId, body: { vehicleId: string; groupId?: string }) {
    return this.http.post<HistoryEntry & { url?: string; estados?: number[]; message?: string }>(`/api/${client}/send-one`, body);
  }
  sendGroup(client: ClientId, groupId: string) {
    return this.http.post<{ results: HistoryEntry[] }>(`/api/${client}/groups/${encodeURIComponent(groupId)}/send`, {});
  }
  sendStats(hours: number) { return this.http.get<any>(`/api/stats/sends?hours=${hours}`); }
  // Historial de recorrido de un vehículo (lee fm-track vía backend; from/to en ISO UTC)
  vehicleTrack(id: string, from: string, to: string) {
    return this.http.get<TrackResponse>(`/api/vehicles/${encodeURIComponent(id)}/track?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }
  clientHistory(client: ClientId, limit = 300) {
    return this.http.get<{ entries: HistoryEntry[] }>(`/api/${client}/history?limit=${limit}`);
  }
}

export type ClientId = 'falabella' | 'wise' | 'drivin' | 'bermann' | 'ds' | 'qanalytics';

// ---- Historial de recorrido (GET /api/vehicles/:id/track) ----
export interface TrackTrip {
  idx: number; startTs: string; endTs: string;
  durationSec: number; movingSec: number;
  distanceKm: number; odometerKm: number | null;
  maxSpeed: number; avgSpeed: number;
  start: { lat: number; lng: number }; end: { lat: number; lng: number };
  points: number;
}
export interface TrackStop {
  idx: number; startTs: string; endTs: string; durationSec: number;
  lat: number; lng: number; ignitionOff: boolean; ongoing: boolean; points: number;
}
export interface TrackSummary {
  distanceKm: number; odometerKm: number | null;
  movingSec: number; stoppedSec: number;
  maxSpeed: number; avgSpeed: number;
  trips: number; stops: number;
  firstTs: string | null; lastTs: string | null;
  points: number; glitches?: number;
}
export interface TrackResponse {
  vehicleId: string; from: string; to: string;
  pointsTotal: number; truncated: boolean;
  /** local = base propia · fm-track = traído de fm-track (rango anterior a lo guardado) · mixto */
  source: 'local' | 'fm-track' | 'mixto'; localCount: number; fetchedFm: number;
  summary: TrackSummary; trips: TrackTrip[]; stops: TrackStop[];
  /** Polilínea simplificada: [lat, lng, epochSec, speedKmh] */
  path: [number, number, number, number][];
}

export interface GroupConfig {
  id: string;
  name: string;
  vehicles: string[];
  intervalSec: number;
  enabled: boolean;
  env?: 'test' | 'prod';
  x_country?: string;
  provider?: { dni?: string; name?: string };
  lastRunAt?: string | null;
  lastStatus?: 'ok' | 'partial' | 'err' | null;
  lastSummary?: { total: number; accepted: number; ok: number; failed: number } | null;
}
