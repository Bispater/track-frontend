import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

/**
 * Manda cookies (sesión del login) en cada request.
 * Si el server responde 401 (sesión vencida), redirige a /login — sin esto las
 * páginas quedaban mudas con datos vacíos cuando expiraba la sesión.
 */
export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const cloned = req.clone({ withCredentials: true });
  return next(cloned).pipe(
    catchError((err) => {
      // /api/me y /api/login manejan su propio 401 (flujo de login)
      const isAuthFlow = req.url.includes('/api/me') || req.url.includes('/api/login');
      if (err instanceof HttpErrorResponse && err.status === 401 && !isAuthFlow) {
        router.navigate(['/login']);
      }
      return throwError(() => err);
    })
  );
};
