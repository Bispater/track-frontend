# track-frontend

Frontend Angular 17 (standalone + Tailwind) que reemplaza el `public/app.js` del backend Node `track-service`. Consume las APIs `/api/*` existentes — el backend no requiere cambios.

## Quick start (desarrollo)

```bash
# 1. Backend (en otro terminal, ya configurado en track-service/)
cd ../track-service
npm start                          # http://localhost:3000

# 2. Frontend
cd track-frontend
npm install                        # primera vez (~2-3 min)
npm start                          # http://localhost:4200
```

El `proxy.conf.json` redirige `/api/*` y `/login` del puerto 4200 al 3000 — las cookies de sesión funcionan automáticamente.

## Estructura

```
src/app/
├── core/                          # servicios (inyectados con Angular DI)
│   ├── api.service.ts            # cliente HTTP centralizado
│   ├── auth.service.ts           # signals reactivos del usuario logueado
│   ├── auth.guard.ts             # protege rutas
│   ├── credentials.interceptor.ts # agrega withCredentials a cada request
│   ├── toast.service.ts          # notificaciones globales
│   ├── vehicle-store.service.ts  # polling 10s + cache localStorage
│   └── format.utils.ts           # fmtDate, relativeTime, statusFromAge
│
├── shared/                        # componentes reutilizables
│   ├── badge.component.ts
│   ├── icon.component.ts         # SVGs inline (23 iconos)
│   ├── json-panel.component.ts   # panel con expandir + copiar
│   ├── loading-card.component.ts
│   ├── toast-host.component.ts
│   └── toggle-switch.component.ts
│
└── features/                      # una carpeta por vista (todas standalone)
    ├── login/
    ├── layout/                   # sidebar + topbar + outlet
    ├── resumen/                  # KPIs + grupos fm-track + envíos recientes
    ├── vehiculos/                # tabla con dropdown expansible
    ├── mapa/                     # Leaflet reactivo al polling
    ├── envios/                   # historial paginado con pausa al expandir
    └── clients/
        └── client-page.component.ts  # genérico para TMS/Wise/Drivin/Bermann
```

## Routing

Hash routing (`#/resumen`, `#/vehiculos`, etc) — mismo formato que la app legacy. Ver `src/app/app.routes.ts`. Cada feature se carga con `loadComponent` (lazy).

## Auth

- El backend usa cookie de sesión firmada (HttpOnly).
- `credentialsInterceptor` agrega `withCredentials: true` a cada request HTTP.
- `authGuard` corre antes de cualquier ruta protegida; verifica con `GET /api/me` y redirige a `/login` si no hay sesión.

## Build (producción)

```bash
npm run build                      # genera dist/
```

El `dist/` queda listo para ser servido como estático. Tres opciones:

### Opción A — Mismo Node sirve el frontend (simple)

Copiar el contenido de `dist/` a `track-service/public/`:

```bash
rm -rf ../track-service/public/*
cp -r dist/* ../track-service/public/
```

Con hash routing **no se necesita fallback `*` en el server.js** — funciona out-of-the-box.

### Opción B — Caddy sirve estático + proxy a Node

En `Caddyfile` del backend:

```
proaseg.cl {
  handle /api/*   { reverse_proxy app:3000 }
  handle /login*  { reverse_proxy app:3000 }
  handle * {
    root * /srv/track-frontend-dist
    try_files {path} /index.html
    file_server
  }
}
```

Y montar `track-frontend/dist` como volumen del container de Caddy.

### Opción C — GitHub Actions hace el build

Recomendado para no commit-ear el `dist/`. En el workflow de deploy:

```yaml
- run: cd track-frontend && npm ci && npm run build
- run: rsync -r track-frontend/dist/ user@vps:/opt/track-service/public/
```

## Agregando un nuevo cliente

1. **Backend**: agregar adapter en `server.js` (ver patrón de Drivin/Bermann).
2. **Frontend**: una línea en `app.routes.ts`:
   ```ts
   { path: 'nuevocliente',
     loadComponent: () => import('./features/clients/client-page.component').then((m) => m.ClientPageComponent),
     data: { client: 'nuevocliente' } }
   ```
3. Agregar el clientId al tipo `ClientId` en `api.service.ts`.
4. Agregar entrada al sidebar en `layout.component.ts`.

El `ClientPageComponent` es **genérico** — sirve para los 4 clientes actuales (TMS/Wise/Drivin/Bermann) y futuros. Una sola implementación.

## Tecnologías

- **Angular 17** — standalone components, signals, control flow nativo (`@if`/`@for`)
- **Tailwind CSS 3** — utility classes; variables CSS para el tema dark/light
- **Leaflet** — mapa interactivo con tiles de OpenStreetMap
- **RxJS** — solo donde HttpClient lo requiere; el resto es signals

## Equivalencia con el frontend legacy

| Legacy (`public/app.js`) | Angular (`track-frontend/`) |
|---|---|
| `state.config`, `state.snapshot` | `ApiService` + signals en components |
| `vehicleStore` (objeto global) | `VehicleStoreService` (signals + localStorage) |
| `views.resumen` (función) | `ResumenComponent` (standalone) |
| `views.vehiculos` (función) | `VehiculosComponent` |
| `views.envios` (función) | `EnviosComponent` |
| `views.falabella/wise/drivin/bermann` (4 funciones distintas) | **`ClientPageComponent`** (1 componente genérico) |
| `el()` helper | Templates Angular |
| `toast()` | `ToastService` + `ToastHostComponent` |
| `route()` (hash routing manual) | Angular Router con `withHashLocation()` |
