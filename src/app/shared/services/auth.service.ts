// src/app/shared/services/auth.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { API_CONFIG } from '../../core/config/api.config';

export type AuthRole = 'admin' | 'enfermeria' | 'medico';

export type AuthUser = {
  id: number;
  role: AuthRole;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  avatar_url: string | null;
};

const TOKEN_KEY = 'servimel_token_v1';
const USER_KEY = 'servimel_user_v1';

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string; details?: any } };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _token$ = new BehaviorSubject<string | null>(this.getStoredToken());
  token$ = this._token$.asObservable();

  private _user$ = new BehaviorSubject<AuthUser | null>(this.getStoredUser());
  user$ = this._user$.asObservable();

  constructor(private http: HttpClient) {}

  // ✅ compat con tu guard
  get isLoggedIn(): boolean {
    return !!this._token$.value;
  }

  // ✅ compat con tu interceptor
  getToken(): string | null {
    return this._token$.value;
  }

  get user(): AuthUser | null {
    return this._user$.value;
  }

  async login(email: string, password: string) {
    const url = `${API_CONFIG.baseUrl}/auth/login`;

    const res = await firstValueFrom(
      this.http.post<ApiOk<{ token: string; user: AuthUser }> | ApiFail>(url, { email, password })
    );

    if (!res || (res as any).ok !== true) {
      throw new Error((res as ApiFail)?.error?.message || 'Login failed');
    }

    const { token, user } = (res as ApiOk<{ token: string; user: AuthUser }>).data;
    this.setSession(token, user);
    return user;
  }

  async loadMe() {
    const url = `${API_CONFIG.baseUrl}/auth/me`;

    const res = await firstValueFrom(
      this.http.get<ApiOk<AuthUser> | ApiFail>(url)
    );

    if (!res || (res as any).ok !== true) {
      throw new Error((res as ApiFail)?.error?.message || 'Me failed');
    }

    const user = (res as ApiOk<AuthUser>).data;
    // deja token igual, solo actualiza user
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this._user$.next(user);
    return user;
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this._token$.next(null);
    this._user$.next(null);
  }

  private setSession(token: string, user: AuthUser) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this._token$.next(token);
    this._user$.next(user);
  }

  private getStoredToken(): string | null {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  }

  private getStoredUser(): AuthUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch { return null; }
  }
}
