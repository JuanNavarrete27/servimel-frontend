import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CONFIG } from '../../core/config/api.config';
import { unwrap } from './api-unwrap';

@Injectable({ providedIn: 'root' })
export class HistorialService {
  constructor(private http: HttpClient) {}

  listByResidente(
    residenteId: number,
    params?: {
      page?: number;
      limit?: number;
      preset?: 'hoy' | '7d' | 'all';
      fechaDesde?: string; // YYYY-MM-DD
      fechaHasta?: string; // YYYY-MM-DD
      type?: string;       // vital|medication|observation etc
    }
  ): Promise<any> {
    return firstValueFrom(
      this.http.get<any>(`${API_CONFIG.baseUrl}/historial/residentes/${residenteId}`, {
        params: params as any,
      })
    ).then(unwrap);
  }

  getEvento(eventId: number): Promise<any> {
    return firstValueFrom(
      this.http.get<any>(`${API_CONFIG.baseUrl}/historial/eventos/${eventId}`)
    ).then(unwrap);
  }
}
