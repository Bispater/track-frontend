import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Manda cookies (sesión del login) en cada request.
 * Si el server responde 401, se redirige a /login.
 */
export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  const cloned = req.clone({ withCredentials: true });
  return next(cloned);
};
