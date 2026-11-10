import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { CLIENTS } from './core/clients';

export const routes: Routes = [
  { path: 'login', title: 'Iniciar sesión', loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent) },
  // Informe imprimible por cliente (documento A4, sin layout de la app)
  { path: 'reporte', title: 'Informe de servicio', canActivate: [authGuard], loadComponent: () => import('./features/reporte/reporte.component').then((m) => m.ReporteComponent) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/layout/layout.component').then((m) => m.LayoutComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'resumen' },
      { path: 'resumen', title: 'Resumen', loadComponent: () => import('./features/resumen/resumen.component').then((m) => m.ResumenComponent) },
      { path: 'metricas', title: 'Métricas', loadComponent: () => import('./features/metricas/metricas.component').then((m) => m.MetricasComponent) },
      { path: 'vehiculos', title: 'Vehículos', loadComponent: () => import('./features/vehiculos/vehiculos.component').then((m) => m.VehiculosComponent) },
      { path: 'mapa', title: 'Mapa', loadComponent: () => import('./features/mapa/mapa.component').then((m) => m.MapaComponent) },
      { path: 'envios', title: 'Envíos', loadComponent: () => import('./features/envios/envios.component').then((m) => m.EnviosComponent) },
      // Una página por cliente (core/clients.ts)
      ...CLIENTS.map((c) => ({
        path: c.path, title: c.menuLabel, data: { client: c.id, title: c.pageTitle },
        loadComponent: () => import('./features/clients/client-page.component').then((m) => m.ClientPageComponent),
      })),
    ],
  },
  { path: '**', redirectTo: '' },
];
