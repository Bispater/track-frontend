import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', title: 'Iniciar sesión', loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent) },
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
      { path: 'tms', title: 'TMS Falabella', loadComponent: () => import('./features/clients/client-page.component').then((m) => m.ClientPageComponent), data: { client: 'falabella', title: 'TMS · envío de posiciones' } },
      { path: 'wise', title: 'Wise', loadComponent: () => import('./features/clients/client-page.component').then((m) => m.ClientPageComponent), data: { client: 'wise', title: 'Wise · envío de posiciones' } },
      { path: 'drivin', title: 'Drivin', loadComponent: () => import('./features/clients/client-page.component').then((m) => m.ClientPageComponent), data: { client: 'drivin', title: 'Drivin · envío de posiciones' } },
      { path: 'bermann', title: 'Bermann', loadComponent: () => import('./features/clients/client-page.component').then((m) => m.ClientPageComponent), data: { client: 'bermann', title: 'Bermann · envío de posiciones' } },
      { path: 'ds', title: 'DS', loadComponent: () => import('./features/clients/client-page.component').then((m) => m.ClientPageComponent), data: { client: 'ds', title: 'DS · envío de posiciones' } },
      { path: 'qanalytics', title: 'Qanalytics', loadComponent: () => import('./features/clients/client-page.component').then((m) => m.ClientPageComponent), data: { client: 'qanalytics', title: 'Qanalytics · envío de posiciones' } },
    ],
  },
  { path: '**', redirectTo: '' },
];
