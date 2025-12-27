// src/app/core/auth/auth.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type AuthUser = {
  name: string;
  role: 'admin' | 'staff';
};

const TOKEN_KEY = 'servimel_token';     // ✅ MISMA que el interceptor
const USER_KEY  = 'servimel_user_v1';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _token$ = new BehaviorSubject<string | null>(this.getStoredToken());
  token$ = this._token$.asObservable();

  private _user$ = new BehaviorSubject<AuthUser | null>(this.getStoredUser());
  user$ = this._user$.asObservable();

  get token(): string | null {
    return this._token$.value;
  }

  get isLoggedIn(): boolean {
    return !!this._token$.value;
  }

  // ✅ para el interceptor
  getToken(): string | null {
    return this._token$.value;
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this._token$.next(null);
    this._user$.next(null);
  }

  private getStoredToken(): string | null {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  }

  private getStoredUser(): AuthUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  }
}
