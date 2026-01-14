// F6 — src/app/shared/services/auth.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom, map } from 'rxjs';
import { API_CONFIG } from '../../core/config/api.config';
import { unwrapApi, ApiResponse } from '../../core/utils/api-unwrap';

const TOKEN_KEY = 'servimel_token_v1';
const USER_KEY = 'servimel_user_v1';

// compat keys viejas (migración silenciosa)
const LEGACY_USER_KEYS = ['user', 'servimel_user', 'currentUser', 'auth_user'];
const LEGACY_TOKEN_KEYS = ['token', 'auth_token', 'access_token', 'jwt', 'servimel_token', 'servimelToken'];

type AnyUser = any;

@Injectable({ providedIn: 'root' })
export class AuthService {
  // Compat: algunos componentes leen .apiUrl/.apiBaseUrl/.baseUrl
  apiUrl = API_CONFIG.baseUrl;
  apiBaseUrl = API_CONFIG.baseUrl;
  baseUrl = API_CONFIG.baseUrl;

  // ✅ Fuente única reactiva de usuario
  private _user$ = new BehaviorSubject<AnyUser | null>(null);

  // Compat con código que usa currentUser / user
  user = this._user$;
  currentUser = this._user$;

  constructor(private http: HttpClient) {
    this.hydrateFromStorage();
  }

  // ============================================================
  // Session storage (token + user)
  // ============================================================
  private hydrateFromStorage(): void {
    // Token (solo fuerza migración si viene de legacy)
    this.getToken();

    // User
    const u = this.readUser();
    if (u) this._user$.next(u);
  }

  private readUser(): AnyUser | null {
    // primero la key nueva
    const direct = localStorage.getItem(USER_KEY);
    if (direct) {
      try {
        return JSON.parse(direct);
      } catch {
        // si está roto, lo limpiamos
        try {
          localStorage.removeItem(USER_KEY);
        } catch {}
      }
    }

    // migración desde keys viejas
    for (const k of LEGACY_USER_KEYS) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw);
        // migramos a key nueva
        try {
          localStorage.setItem(USER_KEY, JSON.stringify(parsed));
        } catch {}
        return parsed;
      } catch {
        // a veces guardan role string directo, lo ignoramos
      }
    }

    return null;
  }

  private saveUser(u: AnyUser | null): void {
    if (!u) {
      try {
        localStorage.removeItem(USER_KEY);
      } catch {}
      this._user$.next(null);
      return;
    }

    try {
      localStorage.setItem(USER_KEY, JSON.stringify(u));
    } catch {}
    this._user$.next(u);
  }

  setToken(token: string | null): void {
    if (!token) {
      try {
        localStorage.removeItem(TOKEN_KEY);
      } catch {}
      return;
    }
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {}
  }

  getToken(): string | null {
    const direct = localStorage.getItem(TOKEN_KEY);
    if (direct && direct.trim()) return direct.trim();

    // migración silenciosa desde keys viejas
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

  clearSession(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {}
    try {
      localStorage.removeItem(USER_KEY);
    } catch {}
    this._user$.next(null);
  }

  // ============================================================
  // Compat getters usados en páginas
  // ============================================================
  get currentUserValue(): AnyUser | null {
    return this._user$.value;
  }

  getUser(): AnyUser | null {
    return this._user$.value;
  }

  getRole(): string {
    const u = this._user$.value;
    return String(u?.rol ?? u?.role ?? u?.user?.rol ?? u?.user?.role ?? '').trim();
  }

  getUserRole(): string {
    return this.getRole();
  }

  // algunos componentes leen auth.userRole / auth.role
  get userRole(): string {
    return this.getRole();
  }

  get role(): string {
    return this.getRole();
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  // ============================================================
  // Auth API
  // ✅ FIX: soporta login(email, password) (legacy) y login({email,password})
  // ============================================================
  async login(email: string, password: string): Promise<any>;
  async login(payload: { email: string; password: string }): Promise<any>;
  async login(a: any, b?: any): Promise<any> {
    const payload =
      typeof a === 'string'
        ? { email: String(a), password: String(b ?? '') }
        : { email: String(a?.email ?? ''), password: String(a?.password ?? '') };

    const url = `${API_CONFIG.baseUrl}/auth/login`;

    const res = await firstValueFrom(
      this.http.post<ApiResponse<any>>(url, payload).pipe(map((x) => unwrapApi<any>(x)))
    );

    // Intento flexible (token en diferentes keys)
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

    if (token) this.setToken(String(token));
    if (user) this.saveUser(user);

    return res;
  }

  async register(payload: any): Promise<any> {
    const url = `${API_CONFIG.baseUrl}/auth/register`;

    const res = await firstValueFrom(
      this.http.post<ApiResponse<any>>(url, payload).pipe(map((x) => unwrapApi<any>(x)))
    );

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

    if (token) this.setToken(String(token));
    if (user) this.saveUser(user);

    return res;
  }

  // Para actualizar user (ej: settings, perfil)
  updateUser(partial: any): void {
    const current = this._user$.value || {};
    const next = { ...current, ...partial };
    this.saveUser(next);
  }
}
