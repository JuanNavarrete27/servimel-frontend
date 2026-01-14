// F5 — src/app/core/guards/auth.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, CanActivateChildFn, Router, UrlTree } from '@angular/router';

const TOKEN_KEY = 'servimel_token_v1';

const LEGACY_TOKEN_KEYS = [
  'token',
  'auth_token',
  'access_token',
  'jwt',
  'servimel_token',
  'servimelToken',
  'servimel_token_v0',
];

function readToken(): string | null {
  const direct = localStorage.getItem(TOKEN_KEY);
  if (direct && direct.trim()) return direct.trim();

  for (const k of LEGACY_TOKEN_KEYS) {
    const v = localStorage.getItem(k);
    if (v && v.trim()) {
      try {
        localStorage.setItem(TOKEN_KEY, v.trim());
      } catch {}
      return v.trim();
    }
  }
  return null;
}

function redirectUnauthorized(router: Router, stateUrl?: string): UrlTree {
  // Ajustá tu ruta real de login si es otra
  const target = stateUrl ? `/auth/login?redirect=${encodeURIComponent(stateUrl)}` : `/auth/login`;
  return router.parseUrl(target);
}

export const authGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);

  try {
    const token = readToken();
    if (token) return true;
    return redirectUnauthorized(router, state?.url);
  } catch {
    return redirectUnauthorized(router, state?.url);
  }
};

export const authGuardChild: CanActivateChildFn = (childRoute, state) => {
  // Mismo criterio que canActivate
  const router = inject(Router);

  try {
    const token = readToken();
    if (token) return true;
    return redirectUnauthorized(router, state?.url);
  } catch {
    return redirectUnauthorized(router, state?.url);
  }
};
