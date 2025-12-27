// src/app/core/interceptors/auth-token.interceptor.ts
import { inject } from '@angular/core';
import {
  HttpInterceptorFn,
  HttpRequest,
  HttpHandlerFn,
  HttpErrorResponse
} from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

import { AuthService } from '../../shared/services/auth.service';

export const authTokenInterceptor: HttpInterceptorFn = (req: HttpRequest<any>, next: HttpHandlerFn) => {
  const auth = inject(AuthService);

  const url = req.url || '';
  const isAuthEndpoint =
    url.includes('/auth/login') ||
    url.includes('/auth/register');

  // ✅ TOKEN ROBUSTO: si AuthService no está hidratado en pestaña nueva,
  // igual lo leemos directo desde localStorage.
  const token =
    auth.getToken?.() ||
    (() => {
      try {
        const keys = ['servimel_token', 'servimel_token_v1', 'auth_token', 'token', 'jwt', 'access_token'];
        for (const k of keys) {
          const v = localStorage.getItem(k);
          if (v && v.trim()) return v.trim();
        }
      } catch {}
      return null;
    })();

  // ✅ No pisar Authorization si ya viene seteado (por request manual)
  const hasAuthHeader = req.headers.has('Authorization');

  const authReq =
    !isAuthEndpoint && token && !hasAuthHeader
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;

  return next(authReq).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        // ✅ opcional (NO rompo tu flujo): si querés, descomentá para limpiar token y mandar al login
        // auth.logout?.();
      }
      return throwError(() => err);
    })
  );
};
