import { ApplicationConfig, Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy, provideRouter, withHashLocation } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { credentialsInterceptor } from './core/credentials.interceptor';

// Título de pestaña: "PROASEG · <página>" (o solo "PROASEG" si la ruta no define título)
@Injectable()
class ProasegTitleStrategy extends TitleStrategy {
  private title = inject(Title);
  override updateTitle(snapshot: RouterStateSnapshot) {
    const page = this.buildTitle(snapshot);
    this.title.setTitle(page ? `PROASEG · ${page}` : 'PROASEG');
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    // hash routing como el app actual (#/resumen) — facilita servirlo desde cualquier subpath
    provideRouter(routes, withHashLocation()),
    provideHttpClient(withInterceptors([credentialsInterceptor])),
    { provide: TitleStrategy, useClass: ProasegTitleStrategy },
  ],
};
