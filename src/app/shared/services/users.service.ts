import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CONFIG } from '../../core/config/api.config';
import { unwrap } from './api-unwrap';

@Injectable({ providedIn: 'root' })
export class UsersService {
  constructor(private http: HttpClient) {}

  me(): Promise<any> {
    return firstValueFrom(
      this.http.get<any>(`${API_CONFIG.baseUrl}/users/me`)
    ).then(unwrap);
  }

  updateMe(payload: any): Promise<any> {
    return firstValueFrom(
      this.http.put<any>(`${API_CONFIG.baseUrl}/users/me`, payload)
    ).then(unwrap);
  }

  changePassword(payload: { current_password: string; new_password: string }): Promise<any> {
    return firstValueFrom(
      this.http.put<any>(`${API_CONFIG.baseUrl}/users/me/password`, payload)
    ).then(unwrap);
  }

  // Admin (si lo usás luego)
  list(params?: any): Promise<any> {
    return firstValueFrom(
      this.http.get<any>(`${API_CONFIG.baseUrl}/users`, { params })
    ).then(unwrap);
  }

  adminCreate(payload: any): Promise<any> {
    return firstValueFrom(
      this.http.post<any>(`${API_CONFIG.baseUrl}/users`, payload)
    ).then(unwrap);
  }

  adminUpdate(id: number, payload: any): Promise<any> {
    return firstValueFrom(
      this.http.put<any>(`${API_CONFIG.baseUrl}/users/${id}`, payload)
    ).then(unwrap);
  }
}
