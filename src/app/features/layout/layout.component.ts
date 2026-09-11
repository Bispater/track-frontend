import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ApiService } from '../../core/api.service';
import { VehicleStoreService } from '../../core/vehicle-store.service';
import { ThemeService } from '../../core/theme.service';
import { relativeTime } from '../../core/format.utils';
import { IconComponent, IconName } from '../../shared/icon.component';
import { ToastHostComponent } from '../../shared/toast-host.component';

interface NavItem { path: string; label: string; sub: string; icon: IconName; }
interface NavSection { title: string; items: NavItem[]; }

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, IconComponent, ToastHostComponent],
  template: `
    <div class="grid min-h-screen" style="grid-template-columns: 264px 1fr;">
      <!-- Sidebar -->
      <aside class="flex flex-col border-r" style="background: var(--bg-elev); border-color: var(--border);">
        <div class="px-4 pt-5 pb-4 flex items-center gap-3">
          <div class="brand-square w-10 h-10 rounded-xl">
            <app-icon name="route" [size]="20" />
          </div>
          <div class="leading-tight">
            <div class="font-bold text-[15px]">PROASEG</div>
            <div class="text-[11px] uppercase tracking-wider text-text-dim font-semibold">Concentrador GPS</div>
          </div>
        </div>

        <nav class="flex-1 px-3 py-2 flex flex-col gap-4 overflow-auto">
          @for (sec of sections; track sec.title) {
            <div>
              <div class="text-[10px] uppercase tracking-wider text-text-dim px-2 mb-1.5 font-semibold">{{ sec.title }}</div>
              @for (item of sec.items; track item.path) {
                <a [routerLink]="item.path" routerLinkActive="active" class="nav-item-pro">
                  <app-icon [name]="item.icon" [size]="18" />
                  <span class="leading-tight">
                    <span class="block font-semibold text-[13px]">{{ item.label }}</span>
                    <span class="block text-[11px] sub">{{ item.sub }}</span>
                  </span>
                </a>
              }
            </div>
          }
        </nav>

        <!-- Tarjeta de cuenta (estilo referencia) -->
        @if (auth.username()) {
          <div class="border-t p-3" style="border-color: var(--border);">
            <div class="flex items-center gap-2.5 p-2 rounded-xl" style="background: var(--bg-soft);">
              <div class="brand-square w-9 h-9 rounded-lg text-[13px] font-bold">{{ initials() }}</div>
              <div class="flex-1 min-w-0 leading-tight">
                <div class="font-semibold text-[13px] truncate">{{ displayName() }}</div>
                <div class="text-[11px] text-text-dim truncate">{{ auth.username() }}</div>
              </div>
              <button class="icon-btn" style="width:34px;height:34px;" (click)="auth.logout()" title="Cerrar sesión / desconectar">
                <app-icon name="logout" [size]="16" />
              </button>
            </div>
          </div>
        }
      </aside>

      <!-- Main -->
      <main class="flex flex-col min-w-0">
        <header class="flex items-center gap-3 px-6 py-3 border-b" style="background: var(--bg-elev); border-color: var(--border);">
          <h1 class="m-0 text-lg font-bold">{{ pageTitle() }}</h1>
          <div class="flex-1"></div>
          <span class="pill" [class.pill-ok]="cfgKey()" [class.pill-err]="!cfgKey()">
            {{ cfgKey() ? 'API key cargada' : 'API key faltante' }}
          </span>
          <span class="pill" [class.pill-ok]="!!store.lastPollAt()" [class.pill-warn]="!store.lastPollAt()" title="Polling automático cada 10s">
            auto · {{ pollAgo() }}
          </span>
          <button class="icon-btn" title="Notificaciones"><app-icon name="bell" [size]="18" /></button>
          <button class="icon-btn" (click)="theme.cycle()" [title]="'Tema: ' + theme.mode() + ' (clic para cambiar)'">
            <app-icon [name]="themeIcon()" [size]="18" />
          </button>
        </header>
        <section class="p-6 flex-1 overflow-auto">
          <router-outlet></router-outlet>
        </section>
      </main>
    </div>
    <app-toast-host />
  `,
  styles: [`
    .nav-item-pro {
      display: flex; align-items: center; gap: 11px;
      padding: 9px 11px; border-radius: 10px;
      color: var(--text-dim); text-decoration: none;
      transition: background 0.15s, color 0.15s;
    }
    .nav-item-pro .sub { color: var(--text-dim); font-weight: 400; }
    .nav-item-pro:hover { background: var(--bg-soft); color: var(--text); }
    .nav-item-pro.active { background: var(--accent); color: white; }
    .nav-item-pro.active app-icon, .nav-item-pro.active .sub { color: white; opacity: 0.85; }
  `],
})
export class LayoutComponent implements OnInit, OnDestroy {
  auth = inject(AuthService);
  api = inject(ApiService);
  store = inject(VehicleStoreService);
  theme = inject(ThemeService);
  private router = inject(Router);
  private navSub?: Subscription;

  pageTitle = signal<string>('');
  cfgLoaded = signal(false);
  cfgKey = signal(false);

  initials = computed(() => {
    const u = this.auth.username() || '';
    return (u[0] || '?').toUpperCase();
  });

  // "jc.novoa.b@gmail.com" → "Jc.novoa.b" (parte antes del @, capitalizada)
  displayName = computed(() => {
    const u = this.auth.username() || '';
    const name = u.split('@')[0] || u;
    return name.charAt(0).toUpperCase() + name.slice(1);
  });

  themeIcon = computed<IconName>(() => {
    const m = this.theme.mode();
    return m === 'light' ? 'sun' : m === 'dark' ? 'moon' : 'monitor';
  });

  sections: NavSection[] = [
    {
      title: 'Datos',
      items: [
        { path: '/resumen', label: 'Resumen', sub: 'Estado general', icon: 'dashboard' },
        { path: '/vehiculos', label: 'Vehículos', sub: 'Flota y posiciones', icon: 'truck' },
        { path: '/mapa', label: 'Mapa', sub: 'Ubicación en vivo', icon: 'map' },
      ],
    },
    {
      title: 'Clientes',
      items: [
        { path: '/tms', label: 'TMS Falabella', sub: 'Test / Prod', icon: 'building' },
        { path: '/wise', label: 'Wise', sub: 'Wisetrack', icon: 'package' },
        { path: '/drivin', label: 'Drivin', sub: 'Posiciones', icon: 'box' },
        { path: '/bermann', label: 'Bermann', sub: 'Concentrador', icon: 'inbox' },
        { path: '/ds', label: 'DS', sub: 'postDataGPS', icon: 'package' },
        { path: '/qanalytics', label: 'Qanalytics', sub: 'Q Integración', icon: 'box' },
      ],
    },
    {
      title: 'Auditoría',
      items: [
        { path: '/envios', label: 'Envíos', sub: 'Historial', icon: 'send' },
      ],
    },
  ];

  pollAgo = computed(() => relativeTime(this.store.lastPollAt()));
  private tickTimer?: ReturnType<typeof setInterval>;

  // Título del header según la ruta activa (el route.title definido en app.routes.ts)
  private updatePageTitle() {
    let r = this.router.routerState.snapshot.root;
    let title = '';
    for (;;) {
      const t = r.routeConfig?.title ?? r.data?.['title'];
      if (typeof t === 'string') title = t;
      if (!r.firstChild) break;
      r = r.firstChild;
    }
    this.pageTitle.set(title);
  }

  async ngOnInit() {
    this.updatePageTitle();
    this.navSub = this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.updatePageTitle());
    try {
      const cfg = await new Promise<any>((resolve, reject) =>
        this.api.config().subscribe({ next: resolve, error: reject })
      );
      this.cfgLoaded.set(true);
      this.cfgKey.set(Boolean(cfg.fmTrackKeyConfigured));
      if (cfg.fmTrackKeyConfigured) this.store.startPolling();
    } catch {}
    this.tickTimer = setInterval(() => this.store.lastPollAt.update((v) => v), 1000);
  }
  ngOnDestroy() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.navSub?.unsubscribe();
    this.store.stopPolling();
  }
}
