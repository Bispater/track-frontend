import { ApplicationConfig } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { credentialsInterceptor } from './core/credentials.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    // hash routing como el app actual (#/resumen) — facilita servirlo desde cualquier subpath
    provideRouter(routes, withHashLocation()),
    provideHttpClient(withInterceptors([credentialsInterceptor])),
  ],
};
