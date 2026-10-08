/**
 * Diagnóstico en lenguaje simple de los errores de envío a clientes.
 * Recibe el servicio, el texto de la respuesta/error y el código HTTP, y devuelve
 * qué significa y qué hacer. null = sin diagnóstico conocido.
 */
export interface ErrorHint { what: string; action: string; kind: 'client-config' | 'credentials' | 'network' | 'gps' | 'rate' | 'format' | 'server' | 'info'; }

const RULES: { test: (t: string, s: number, c: string) => boolean; hint: ErrorHint }[] = [
  {
    test: (t) => /no registrado para id_cliente_externo/i.test(t),
    hint: { kind: 'client-config', what: 'Bermann no tiene este IMEI dado de alta para tu id de cliente externo.', action: 'Pedir a Bermann que registre el IMEI, o sacar el vehículo del grupo Bermann para que deje de intentarlo.' },
  },
  {
    test: (t) => /NO_TRACKING_CONFIGURED/i.test(t),
    hint: { kind: 'client-config', what: 'La patente no está habilitada en el TMS de Falabella para este ambiente (test/prod).', action: 'Avisar al equipo TMS de Falabella para que la activen. El envío es correcto.' },
  },
  {
    test: (t) => /sin posición en últimos 7 días/i.test(t),
    hint: { kind: 'gps', what: 'El equipo GPS del vehículo no reporta hace más de 7 días (apagado, sin señal o desconectado).', action: 'Revisar el equipo. No es un error del cliente ni del concentrador.' },
  },
  {
    test: (t) => /registro duplicado|estado.*\b5\b/i.test(t),
    hint: { kind: 'info', what: 'Wise ya tenía exactamente esa posición.', action: 'Nada que hacer: no es un fallo real, el vehículo no se ha movido desde el envío anterior.' },
  },
  {
    test: (t) => /credenciales .*no configurad/i.test(t),
    hint: { kind: 'credentials', what: 'Faltan las credenciales de este cliente en el .env del backend.', action: 'Completar usuario, clave o token en el .env y reiniciar el backend.' },
  },
  {
    test: (t, s) => s === 401 || /unauthorized|token (inválido|invalido|expirado|vencido)|invalid token/i.test(t),
    hint: { kind: 'credentials', what: 'El cliente rechazó las credenciales o el token (401).', action: 'Verificar usuario, clave, API key o token en el .env; si el cliente los renovó, actualizarlos.' },
  },
  {
    test: (t, s) => s === 403,
    hint: { kind: 'credentials', what: 'El cliente rechazó la petición por permisos (403): las credenciales valen pero no autorizan este dato o vehículo.', action: 'Revisar con el cliente qué falta habilitar para esta cuenta o patente.' },
  },
  {
    test: (t, s) => s === 429 || /too many requests/i.test(t),
    hint: { kind: 'rate', what: 'El cliente limita la cantidad de llamadas por minuto y rechazó esta por exceso (429).', action: 'Subir el intervalo de envío del grupo o enviar menos vehículos por tanda.' },
  },
  {
    test: (t, s) => s === 400 || s === 422,
    hint: { kind: 'format', what: 'El cliente rechazó el formato o contenido de los datos (400).', action: 'Revisar el payload enviado contra la documentación del cliente (campos obligatorios, rangos, fechas).' },
  },
  {
    test: (t, s) => s === 404,
    hint: { kind: 'client-config', what: 'La URL del cliente no existe (404).', action: 'Revisar la URL configurada en el .env para este cliente.' },
  },
  {
    test: (t, s) => s >= 500,
    hint: { kind: 'server', what: 'Error interno en el servidor del cliente (5xx).', action: 'Suele resolverse solo. Si persiste, reportar al cliente con fecha, patente y payload.' },
  },
  {
    test: (t) => /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|certificate|socket hang up|network/i.test(t),
    hint: { kind: 'network', what: 'No se pudo conectar con el servidor del cliente (red, DNS, certificado o servicio caído).', action: 'Reintentar más tarde. Si se repite por horas, avisar al cliente.' },
  },
  {
    test: (t, s) => s === 0,
    hint: { kind: 'network', what: 'No hubo respuesta HTTP: el envío no llegó al cliente.', action: 'Revisar conectividad del VPS y la URL configurada.' },
  },
];

export function explainError(client: string, text: string | null | undefined, status?: number | null): ErrorHint | null {
  const t = String(text ?? '');
  const s = Number(status ?? 0) || 0;
  for (const r of RULES) if (r.test(t, s, client)) return r.hint;
  return null;
}

export const HINT_KIND_LABEL: Record<ErrorHint['kind'], string> = {
  'client-config': 'Configuración del cliente', credentials: 'Credenciales', network: 'Red', gps: 'Equipo GPS',
  rate: 'Límite de llamadas', format: 'Formato', server: 'Servidor del cliente', info: 'Informativo',
};
