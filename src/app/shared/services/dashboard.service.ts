import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CONFIG } from '../../core/config/api.config';
import { unwrap } from './api-unwrap';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  constructor(private http: HttpClient) {}

  kpis(): Promise<any> {
    return firstValueFrom(
      this.http.get<any>(`${API_CONFIG.baseUrl}/dashboard/kpis`)
    ).then(unwrap);
  }

  quick(): Promise<any> {
    return firstValueFrom(
      this.http.get<any>(`${API_CONFIG.baseUrl}/dashboard/quick`)
    ).then(unwrap);
  }
}
