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

function normalizeToken(raw: any): string | null {
  if (raw == null) return null;

  let v = String(raw).trim();
  if (!v) return null;

  // Si guardaron algo tipo "Bearer eyJ..."
  v = v.replace(/^Bearer\s+/i, '').trim();

  // Si quedó guardado con comillas: "eyJ..."
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }

  // Si guardaron un JSON en vez del token
  if (v.startsWith('{') && v.endsWith('}')) {
    try {
      const obj = JSON.parse(v);
      const cand =
        obj?.token ||
        obj?.accessToken ||
        obj?.access_token ||
        obj?.jwt ||
        obj?.data?.token ||
        obj?.data?.accessToken ||
        null;

      if (cand) return normalizeToken(cand);
    } catch {
      // noop
    }
  }

  // Validación mínima
  if (v.length < 10) return null;
  return v;
}

function readTokenFrom(storage: Storage, key: string): string | null {
  try {
    const raw = storage.getItem(key);
    return normalizeToken(raw);
  } catch {
    return null;
  }
}

function readToken(): string | null {
  // 1) KEY oficial primero
  const direct =
    readTokenFrom(localStorage, TOKEN_KEY) ||
    readTokenFrom(sessionStorage, TOKEN_KEY);

  if (direct) return direct;

  // 2) Keys viejas (local + session)
  for (const k of LEGACY_TOKEN_KEYS) {
    const v =
      readTokenFrom(localStorage, k) ||
      readTokenFrom(sessionStorage, k);

    if (v) {
      // migración silenciosa
      try {
        localStorage.setItem(TOKEN_KEY, v);
      } catch {}
      return v;
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
