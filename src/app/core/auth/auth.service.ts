// src/app/core/auth/auth.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom, map } from 'rxjs';
import { API_CONFIG } from '../config/api.config';
import { unwrapApi, ApiResponse } from '../utils/api-unwrap';

export type UserRole =
  | 'admin'
  | 'enfermeria'
  | 'medico'
  | 'cocinero'
  | 'fisioterapeuta'
  | 'ed-fisico';

export type AuthUser = {
  id?: number;
  email?: string;
  first_name?: string;
  last_name?: string;

  // compat vieja
  name?: string;

  // ✅ canónico
  role: UserRole;

  // compat
  rol?: string;

  // ✅ DB real
  avatar_url?: string | null;
};

const TOKEN_KEY = 'servimel_token_v1';
const USER_KEY = 'servimel_user_v1';

// compat keys viejas (migración silenciosa)
const LEGACY_USER_KEYS = ['user', 'servimel_user', 'currentUser', 'auth_user'];
const LEGACY_TOKEN_KEYS = ['token', 'auth_token', 'access_token', 'jwt', 'servimel_token', 'servimelToken'];

function normalizeRole(v: any): UserRole {
  const r = String(v ?? '').trim().toLowerCase();

  // aliases comunes
  if (r === 'enfermero' || r === 'enfermera' || r === 'nurse') return 'enfermeria';
  if (r === 'cocina') return 'cocinero';

  // ed-física aliases
  if (r === 'edfisica' || r === 'ed_fisico' || r === 'educacion_fisica' || r === 'educación_fisica')
    return 'ed-fisico';
  if (r === 'ed-fisico' || r === 'ed fisico') return 'ed-fisico';

  // fisio aliases
  if (r === 'fisioterapia') return 'fisioterapeuta';
  if (r === 'fisioterapeuta') return 'fisioterapeuta';

  // canonical
  if (
    r === 'admin' ||
    r === 'enfermeria' ||
    r === 'medico' ||
    r === 'cocinero' ||
    r === 'fisioterapeuta' ||
    r === 'ed-fisico'
  ) {
    return r as UserRole;
  }

  return 'enfermeria';
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  // compat: algunos lugares leen .apiUrl/.apiBaseUrl/.baseUrl
  apiUrl = API_CONFIG.baseUrl;
  apiBaseUrl = API_CONFIG.baseUrl;
  baseUrl = API_CONFIG.baseUrl;

  private _token$ = new BehaviorSubject<string | null>(this.getStoredToken());
  token$ = this._token$.asObservable();

  private _user$ = new BehaviorSubject<AuthUser | null>(this.getStoredUser());
  user$ = this._user$.asObservable();

  // ✅ compat (hay código que usa auth.user / auth.currentUser como observable)
  user = this._user$;
  currentUser = this._user$;

  constructor(private http: HttpClient) {
    // migración silenciosa al boot
    this.migrateLegacyKeys();
  }

  get token(): string | null {
    return this._token$.value;
  }

  get currentUserValue(): AuthUser | null {
    return this._user$.value;
  }

  get isLoggedIn(): boolean {
    return !!this._token$.value;
  }

  // ✅ para interceptor
  getToken(): string | null {
    return this._token$.value;
  }

  get role(): UserRole | null {
    return this._user$.value?.role ?? null;
  }

  get userRole(): string {
    return this._user$.value?.role ?? '';
  }

  get rol(): string {
    return this._user$.value?.role ?? '';
  }

  hasRole(...roles: UserRole[]): boolean {
    const r = this.role;
    if (!r) return false;
    return roles.includes(r);
  }

  // ✅ regla global: enfermeria solo lectura (si la usás)
  get isReadOnlyRole(): boolean {
    return this.role === 'enfermeria';
  }

  // ============================================================
  // ✅ LOGIN REAL (API)
  // ============================================================
  async login(email: string, password: string): Promise<any>;
  async login(payload: { email: string; password: string }): Promise<any>;
  async login(a: any, b?: any): Promise<any> {
    const payload =
      typeof a === 'string'
        ? { email: String(a).trim(), password: String(b ?? '') }
        : { email: String(a?.email ?? '').trim(), password: String(a?.password ?? '') };

    const url = `${API_CONFIG.baseUrl}/auth/login`;

    const res = await firstValueFrom(
      this.http.post<ApiResponse<any>>(url, payload).pipe(map((x) => unwrapApi<any>(x)))
    );

    // token flexible
    const token =
      res?.token ??
      res?.accessToken ??
      res?.access_token ??
      res?.jwt ??
      res?.data?.token ??
      null;

    const user =
      res?.user ??
      res?.data?.user ??
      res?.profile ??
      res?.data?.profile ??
      null;

    if (token && user) {
      this.setSession(String(token), user);
    } else if (token) {
      // si por alguna razón el backend no manda user
      this.setToken(String(token));
    }

    return res;
  }

  // ============================================================
  // Session
  // ============================================================
  setSession(token: string, user: any) {
    const normalizedUser: AuthUser = {
      ...user,
      role: normalizeRole(user?.role ?? user?.rol),
      rol: normalizeRole(user?.role ?? user?.rol), // compat
      avatar_url: user?.avatar_url ?? null,        // ✅ DB real
    };

    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(normalizedUser));
    } catch {}

    this._token$.next(token);
    this._user$.next(normalizedUser);
  }

  setToken(token: string | null): void {
    if (!token) {
      try { localStorage.removeItem(TOKEN_KEY); } catch {}
      this._token$.next(null);
      return;
    }
    try { localStorage.setItem(TOKEN_KEY, token); } catch {}
    this._token$.next(token);
  }

  logout() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {}
    this._token$.next(null);
    this._user$.next(null);
  }

  clearSession(): void {
    this.logout();
  }

  // ============================================================
  // Storage helpers + migración silenciosa
  // ============================================================
  private migrateLegacyKeys(): void {
    // token
    const direct = this.getStoredToken();
    if (!direct) {
      for (const k of LEGACY_TOKEN_KEYS) {
        try {
          const v = localStorage.getItem(k);
          if (v && v.trim()) {
            localStorage.setItem(TOKEN_KEY, v.trim());
            this._token$.next(v.trim());
            break;
          }
        } catch {}
      }
    }

    // user
    const u = this.getStoredUser();
    if (!u) {
      for (const k of LEGACY_USER_KEYS) {
        try {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          const normalized: AuthUser = {
            ...parsed,
            role: normalizeRole(parsed?.role ?? parsed?.rol),
            rol: normalizeRole(parsed?.role ?? parsed?.rol),
            avatar_url: parsed?.avatar_url ?? null,
          };
          localStorage.setItem(USER_KEY, JSON.stringify(normalized));
          this._user$.next(normalized);
          break;
        } catch {}
      }
    }
  }

  private getStoredToken(): string | null {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      return t && t.trim() ? t.trim() : null;
    } catch {
      return null;
    }
  }

  private getStoredUser(): AuthUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as any;

      const normalized: AuthUser = {
        ...parsed,
        role: normalizeRole(parsed?.role ?? parsed?.rol),
        rol: normalizeRole(parsed?.role ?? parsed?.rol),
        avatar_url: parsed?.avatar_url ?? null,
      };

      return normalized;
    } catch {
      return null;
    }
  }
}
