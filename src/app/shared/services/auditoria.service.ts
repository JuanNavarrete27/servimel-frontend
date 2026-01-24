import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CONFIG } from '../../core/config/api.config';
import { unwrapApi } from '../../core/utils/api-unwrap'; // usa el unwrap "bueno" si lo tenés
import { AuthService } from './auth.service'; // ajustá el path si tu AuthService vive en otro lado

@Injectable({ providedIn: 'root' })
export class AuditoriaService {
  constructor(private http: HttpClient, private auth: AuthService) {}

  private getToken(): string | null {
    const keys = ['servimel_token_v1', 'servimel_token', 'auth_token', 'token', 'jwt', 'access_token'];
    for (const k of keys) {
      try {
        const v = localStorage.getItem(k);
        if (v?.trim()) return v.trim();
      } catch {}
    }
    return null;
  }

  private authHeaders(): HttpHeaders {
    const t = this.getToken();
    return t ? new HttpHeaders({ Authorization: `Bearer ${t}` }) : new HttpHeaders();
  }

  list(params?: {
    page?: number;
    limit?: number;
    module?: string;
    action?: string;
    entity?: string;
    userId?: number;
  }): Promise<any> {
    const url = `${API_CONFIG.baseUrl}/auditoria`;

    return firstValueFrom(
      this.http.get<any>(url, {
        params: params as any,
        headers: this.authHeaders(),
      })
    ).then((res) => {
      try {
        return unwrapApi<any>(res as any);
      } catch {
        return res;
      }
    });
  }
}
