import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, Router, UrlTree } from '@angular/router';

function getToken(): string | null {
  try {
    const keys = ['servimel_token', 'servimel_token_v1', 'auth_token', 'token', 'jwt', 'access_token'];
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v && v.trim()) return v.trim();
    }
    return null;
  } catch {
    return null;
  }
}

function deny(router: Router, returnUrl?: string): UrlTree {
  return router.createUrlTree(['/login'], returnUrl ? { queryParams: { returnUrl } } : undefined);
}

export const authGuard: CanActivateFn = (_route, state): boolean | UrlTree => {
  const router = inject(Router);
  const token = getToken();
  if (token) return true;
  return deny(router, state.url);
};

export const authChildGuard: CanActivateChildFn = (_childRoute, state): boolean | UrlTree => {
  const router = inject(Router);
  const token = getToken();
  if (token) return true;
  return deny(router, state.url);
};
