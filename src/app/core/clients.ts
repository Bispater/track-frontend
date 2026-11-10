import type { IconName } from '../shared/icon.component';
import type { HistoryEntry } from './api.service';

/**
 * Registro único de clientes (destinos GPS). Menú, rutas, Envíos, Resumen, Métricas e
 * Informe salen de aquí: un cliente nuevo se agrega solo en este archivo (más su color
 * en Métricas). El id debe coincidir con el prefijo /api/<id> del backend.
 */

/** Lo que las vistas de historial muestran de un envío. */
export interface SendSummary {
  patente: string;
  eventTs: string | null;
  speed: number | string | null;
}

interface ClientInfo {
  /** Nombre corto: filtros, gráficos, historial */
  label: string;
  /** Nombre en el informe imprimible */
  reportLabel: string;
  /** Ruta de su página (sin /) */
  path: string;
  menuLabel: string;
  menuSub: string;
  icon: IconName;
  pageTitle: string;
  /** El ambiente test/prod se elige por grupo */
  testProd?: boolean;
  /** Patente, hora del evento y velocidad (km/h) del payload de un envío */
  summarize: (e: HistoryEntry) => SendSummary;
}

const summary = (e: HistoryEntry, patente: unknown, eventTs: unknown, speed: unknown): SendSummary => ({
  patente: (patente as string) || e.vehicleId,
  eventTs: (eventTs as string) ?? null,
  speed: (speed as number | string) ?? null,
});

// "yyyy-MM-dd HH:mm:ss" en UTC (Wise, Bermann) → ISO con Z; sin la Z el navegador la leería como hora local
const utc = (s: unknown): string | null => (typeof s === 'string' && s ? s.replace(' ', 'T') + 'Z' : null);

const DEFS = {
  falabella: {
    label: 'Falabella', reportLabel: 'TMS Falabella',
    path: 'tms', menuLabel: 'TMS Falabella', menuSub: 'Test / Prod', icon: 'building',
    pageTitle: 'TMS · envío de posiciones', testProd: true,
    summarize: (e) => summary(e, e.payload?.vehicleId, e.payload?.timestamp, e.payload?.speed?.value),
  },
  wise: {
    label: 'Wise', reportLabel: 'Wise (Wisetrack)',
    path: 'wise', menuLabel: 'Wise', menuSub: 'Wisetrack', icon: 'package',
    pageTitle: 'Wise · envío de posiciones',
    summarize: (e) => { const p = e.payload?.posicion?.[0]; return summary(e, p?.patente, utc(p?.fecha_hora), p?.velocidad); },
  },
  drivin: {
    label: 'Drivin', reportLabel: 'Drivin',
    path: 'drivin', menuLabel: 'Drivin', menuSub: 'Posiciones', icon: 'box',
    pageTitle: 'Drivin · envío de posiciones',
    // timestamp en ms y speed en m/s
    summarize: (e) => {
      const p = e.payload?._json?.[0] || e.payload?.positions?.[0];
      return summary(e, p?.vehicle_code,
        p?.timestamp ? new Date(Number(p.timestamp)).toISOString() : null,
        p?.speed != null ? Math.round(Number(p.speed) * 3.6) : null);
    },
  },
  bermann: {
    label: 'Bermann', reportLabel: 'Bermann',
    path: 'bermann', menuLabel: 'Bermann', menuSub: 'Concentrador', icon: 'inbox',
    pageTitle: 'Bermann · envío de posiciones',
    summarize: (e) => summary(e, e.payload?.patente, utc(e.payload?.fecha), e.payload?.velocidad),
  },
  ds: {
    label: 'DS', reportLabel: 'DS',
    path: 'ds', menuLabel: 'DS', menuSub: 'postDataGPS', icon: 'package',
    pageTitle: 'DS · envío de posiciones',
    summarize: (e) => summary(e, e.payload?.patente, e.payload?.fechahora, e.payload?.velocidad),
  },
  qanalytics: {
    label: 'Qanalytics', reportLabel: 'Qanalytics',
    path: 'qanalytics', menuLabel: 'Qanalytics', menuSub: 'Q Integración', icon: 'box',
    pageTitle: 'Qanalytics · envío de posiciones', testProd: true,
    // FH_RPT_GPS viene en UTC sin sufijo Z
    summarize: (e) => summary(e, e.payload?.PLACA, e.payload?.FH_RPT_GPS ? e.payload.FH_RPT_GPS + 'Z' : null, e.payload?.VEL),
  },
  cvxr: {
    label: 'CVX-R', reportLabel: 'CVX-R (StartSee)',
    path: 'cvxr', menuLabel: 'CVX-R', menuSub: 'StartSee', icon: 'send',
    pageTitle: 'CVX-R · envío de posiciones',
    // payload = eventos del envío (del más antiguo al más nuevo): se muestra el último
    summarize: (e) => { const ev = Array.isArray(e.payload) ? e.payload[e.payload.length - 1] : null; return summary(e, ev?.patente, ev?.fecha_hora_evento, ev?.velocidad); },
  },
} satisfies Record<string, ClientInfo>;

export type ClientId = keyof typeof DEFS;
export type ClientDef = ClientInfo & { id: ClientId };

/** En el orden en que se muestran */
export const CLIENTS: ClientDef[] = (Object.keys(DEFS) as ClientId[]).map((id) => ({ id, ...DEFS[id] }));
export const CLIENT_IDS: ClientId[] = CLIENTS.map((c) => c.id);
export const clientDef = (id: string): ClientDef | undefined => CLIENTS.find((c) => c.id === id);
export const clientLabel = (id: string): string => clientDef(id)?.label || id;
