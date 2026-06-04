# track-frontend · arquitectura

Frontend en **Angular 17 standalone components** que reemplaza el `public/app.js` (2000+ líneas) del proyecto `track-service`. Consume las APIs `/api/*` del backend Node/Express.

**Despliegue (producción):** ya no se sirve desde el backend. Este SPA se compila y se empaqueta en su **propio contenedor Nginx** (`Dockerfile` + `nginx.conf`), separado del backend. El backend corre en su contenedor (Node + **Postgres**) y un **Caddy** enruta `proaseg.cl/api/*` → backend y el resto → este frontend. Ver `track-service/DEPLOY.md`. Ventaja: actualizar el front no reinicia el backend (los envíos GPS no se cortan).

```
~/Desktop/
├── track-service/         ← backend (Node + Express, no cambia)
│   ├── server.js
│   ├── public/            ← (vacío en producción, o sirve el dist de aquí)
│   └── docker-compose.yml
└── track-frontend/        ← este proyecto: Angular SPA
    ├── src/
    │   ├── app/
    │   │   ├── core/      ← servicios (Api, Auth, Store, interceptor, guard)
    │   │   ├── shared/    ← componentes reutilizables (Badge, Toggle, JsonPanel, Loading)
    │   │   └── features/  ← una carpeta por vista
    │   │       ├── login/
    │   │       ├── layout/        ← sidebar + topbar
    │   │       ├── resumen/
    │   │       ├── vehiculos/
    │   │       ├── mapa/
    │   │       ├── envios/
    │   │       └── clients/       ← genérico para TMS/Wise/Drivin/Bermann
    │   ├── app.config.ts          ← providers (router, http)
    │   ├── app.routes.ts          ← rutas + lazy loading + authGuard
    │   ├── app.component.ts       ← <router-outlet>
    │   ├── main.ts
    │   ├── index.html
    │   └── styles.css             ← Tailwind + variables CSS del tema
    ├── angular.json
    ├── package.json
    ├── tailwind.config.js
    └── proxy.conf.json            ← redirige /api/* al server local en dev
```

## Conceptos clave

### 1. **Standalone components**
Cada componente importa explícitamente sus dependencias (no hay `@NgModule`). Más simple, mejor tree-shaking, lazy-load nativo por ruta.

### 2. **Estado reactivo con Signals**
- `AuthService` (signals: `authenticated`, `username`, `authEnabled`)
- `VehicleStoreService` (signal: lista de vehículos, grupos fm-track, `lastPollAt`)
- Cada componente usa `signal()` / `computed()` para su estado local.

No usamos NgRx ni RxJS pesado — para el tamaño de esta app, los signals nativos son suficientes y más legibles.

### 3. **Cliente HTTP (`ApiService`)**
Wrapper sobre `HttpClient`. Una función por endpoint del backend:
- `me()`, `login()`, `logout()`, `config()`
- `snapshot()`, `fmTrackGroups()`
- `clientConfig(client)`, `clientGroups(client)`, `sendOne()`, `sendGroup()`, `clientHistory()`, `previewClient()`
- `client` es un tipo `'falabella' | 'wise' | 'drivin' | 'bermann'`

### 4. **Componente genérico por cliente**
Las vistas TMS / Wise / Drivin / Bermann **comparten el mismo componente** (`ClientPageComponent`) parametrizado por route data:
```ts
{ path: 'tms', loadComponent: () => import('./features/clients/client-page.component')..., data: { client: 'falabella' } }
```
Antes eran ~500 líneas duplicadas en `app.js`; ahora es un solo archivo y agregar un cliente nuevo es solo una entrada en `app.routes.ts` + adapter en el backend.

### 5. **Auth via cookie + interceptor**
- `credentialsInterceptor` agrega `withCredentials: true` a todas las requests → el cookie de sesión se manda solo.
- `authGuard` corre antes de cualquier ruta protegida; pregunta a `/api/me`; si no hay sesión, redirige a `/login`.

### 6. **Polling automático**
`VehicleStoreService.startPolling()` arranca al montar el layout, hace `GET /api/snapshot` cada 10s, mergea en localStorage (mismo patrón que el JS viejo). Componentes se suscriben con `computed()` sobre los signals del store — actualización automática sin código manual.

---

## Cómo correr en desarrollo

```bash
# 1. Backend (en c:\Users\User\Desktop\track-service\)
cd ../track-service
npm start                       # http://localhost:3000

# 2. Frontend (en este proyecto)
cd ../track-frontend
npm install                     # primera vez
npm start                       # http://localhost:4200
```

`proxy.conf.json` redirige `/api/*` y `/login` desde `4200` → `3000`, así Angular se siente como si fuera el mismo origen y los cookies funcionan sin CORS.

Abrir `http://localhost:4200` → pantalla de login (si está activada) → SPA.

---

## Cómo correr en producción (deploy)

**Dos opciones**. Elige según prefieras:

### Opción A — Servir el build desde el mismo Node (recomendado, más simple)

1. **Build** en local o CI:
   ```bash
   cd track-frontend
   npm run build         # genera dist/
   ```
2. **Mover el dist al backend**:
   ```bash
   rm -rf ../track-service/public/*
   cp -r dist/* ../track-service/public/
   ```
   El backend ya hace `app.use(express.static('public'))` — sirve la SPA automáticamente.
3. Para que el router de Angular funcione en deep-linking sin hash, agregar en `server.js` un fallback:
   ```js
   // al final, después de todas las rutas /api
   app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
   ```
   (Si mantienes hash routing como en este proyecto, **no hace falta** — ya viene configurado con `withHashLocation()`).

4. Subir como siempre: `git push` (los archivos del dist se commitean) o lo construyes en GitHub Actions antes del SSH-deploy.

**Tradeoff**: commits del dist son ruidosos. Mejor: GitHub Actions que builde Angular y copie al volumen del container.

### Opción B — Servirlo desde Caddy directamente

En `Caddyfile`:
```
proaseg.cl {
  handle /api/* { reverse_proxy app:3000 }
  handle /login* { reverse_proxy app:3000 }
  handle { root * /srv/track-frontend/dist; try_files {path} /index.html; file_server }
}
```
Y en `docker-compose.yml` montar el dist como volumen del container de Caddy.

Más complejo pero permite servir frontend sin que pase por Node.

---

## Estado actual de la migración

| Vista | Estado | Notas |
|---|---|---|
| Login | ✅ completo | Formulario + auth service |
| Layout (sidebar + topbar) | ✅ completo | Polling auto, badges de estado |
| Resumen | ✅ funcional | KPIs + últimos 15 envíos |
| Vehículos | ⚠️ stub básico | Falta dropdown expansible + filtro por grupo + pausa al expandir |
| Mapa | ⚠️ Leaflet básico | Falta popup completo, fit-bounds dinámico, refresh con polling |
| Envíos | ✅ funcional | Paginación 100 + filtros + detalle inline con JSON panels |
| TMS / Wise / Drivin / Bermann | ✅ genérico | Mismo componente para los 4 con `data.client` en la ruta |
| Auth flow | ✅ completo | Guard + interceptor cookie |
| Shared (Badge, Toggle, JsonPanel, Loading) | ✅ | Reutilizables |

**Próximas iteraciones**:
- Vehículos: agregar dropdown expansible + filtro por grupo + pausa de refresh al expandir
- Mapa: integrar con el polling reactivamente
- Toast de notificaciones (componente compartido)
- Drag & drop o multi-select para gestión de grupos (si lo necesitas)

---

## Conexión con el backend existente

Este frontend **es 100% compatible** con el `server.js` actual sin tocar nada. Todas las llamadas son a los endpoints existentes:

- `GET /api/me` · `POST /api/login` · `POST /api/logout`
- `GET /api/config` · `GET /api/snapshot` · `GET /api/fm-track/groups`
- `GET /api/falabella/groups` · `PUT /api/falabella/groups/:id` · `POST /api/falabella/send-one` · `POST /api/falabella/groups/:id/send` · `GET /api/falabella/history`
- Idem para `/api/wise/*`, `/api/drivin/*`, `/api/bermann/*`

Cuando estés conforme con el frontend Angular, simplemente reemplazas `public/*` del backend con el build de aquí y eso es todo el cambio en el backend.
