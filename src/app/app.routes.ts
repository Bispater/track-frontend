import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/layout/layout.component').then((m) => m.LayoutComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'resumen' },
      { path: 'resumen', loadComponent: () => import('./features/resumen/resumen.component').then((m) => m.ResumenComponent) },
      { path: 'vehiculos', loadComponent: () => import('./features/vehiculos/vehiculos.component').then((m) => m.VehiculosComponent) },
      { path: 'mapa', loadComponent: () => import('./features/mapa/mapa.component').then((m) => m.MapaComponent) },
      { path: 'envios', loadComponent: () => import('./features/envios/envios.component').then((m) => m.EnviosComponent) },
      { path: 'tms', loadComponent: () => import('./features/clients/client-page.component').then((m) => m.ClientPageComponent), data: { client: 'falabella', title: 'TMS · envío de posiciones' } },
      { path: 'wise', loadComponent: () => import('./features/clients/client-page.component').then((m) => m.ClientPageComponent), data: { client: 'wise', title: 'Wise · envío de posiciones' } },
      { path: 'drivin', loadComponent: () => import('./features/clients/client-page.component').then((m) => m.ClientPageComponent), data: { client: 'drivin', title: 'Drivin · envío de posiciones' } },
      { path: 'bermann', loadComponent: () => import('./features/clients/client-page.component').then((m) => m.ClientPageComponent), data: { client: 'bermann', title: 'Bermann · envío de posiciones' } },
    ],
  },
  { path: '**', redirectTo: '' },
];
