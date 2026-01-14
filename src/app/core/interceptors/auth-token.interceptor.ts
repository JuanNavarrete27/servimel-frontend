// F4 — src/app/core/interceptors/auth-token.interceptor.ts
import { HttpInterceptorFn } from '@angular/common/http';

const TOKEN_KEY = 'servimel_token_v1';

// Si venías de otras keys, migramos UNA vez para no romper sesiones viejas.
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
      // migración silenciosa
      try {
        localStorage.setItem(TOKEN_KEY, v.trim());
      } catch {}
      return v.trim();
    }
  }

  return null;
}

function shouldSkip(reqUrl: string): boolean {
  // No meter Bearer en auth/login|register (y similares si los usás)
  return /\/auth\/(login|register)\b/i.test(reqUrl);
}

export const authTokenInterceptor: HttpInterceptorFn = (req, next) => {
  try {
    if (shouldSkip(req.url)) return next(req);

    const token = readToken();
    if (!token) return next(req);

    const authReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    });

    return next(authReq);
  } catch {
    return next(req);
  }
};
