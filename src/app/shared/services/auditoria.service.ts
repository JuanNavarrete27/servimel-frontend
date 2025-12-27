import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CONFIG } from '../../core/config/api.config';
import { unwrap } from './api-unwrap';

@Injectable({ providedIn: 'root' })
export class AuditoriaService {
  constructor(private http: HttpClient) {}

  list(params?: {
    page?: number;
    limit?: number;
    module?: string;
    action?: string;
    entity?: string;
    userId?: number;
  }): Promise<any> {
    return firstValueFrom(
      this.http.get<any>(`${API_CONFIG.baseUrl}/auditoria`, { params: params as any })
    ).then(unwrap);
  }
}
