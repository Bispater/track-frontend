import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.checkSession();
  // Si la auth está activada en el backend pero no hay sesión válida, manda a login
  if (auth.authEnabled() && !auth.authenticated()) {
    router.navigate(['/login']);
    return false;
  }
  return true;
};
