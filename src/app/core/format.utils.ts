export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s) : d.toLocaleString('es-CL', { hour12: false });
}
export function fmtNum(n: any, decimals = 0): string {
  if (n == null || isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('es-CL', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}
export function relativeTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 0) return 'recién';
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}
export function ageMinutes(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / 60000;
}
export function statusFromAge(min: number | null): { label: string; cls: 'ok' | 'warn' | 'err' | 'muted' } {
  if (min == null) return { label: 'sin datos', cls: 'muted' };
  if (min < 15) return { label: 'activo', cls: 'ok' };
  if (min < 60 * 24) return { label: 'inactivo', cls: 'warn' };
  return { label: 'sin reportes', cls: 'err' };
}
