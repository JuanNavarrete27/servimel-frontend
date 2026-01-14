// F3 — src/app/shared/services/enfermeria.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';
import { API_CONFIG } from '../../core/config/api.config';
import { unwrapApi, ApiResponse } from '../../core/utils/api-unwrap';

@Injectable({ providedIn: 'root' })
export class EnfermeriaService {
  constructor(private http: HttpClient) {}

  // HOY (panel rápido)
  hoy(): Promise<any> {
    return firstValueFrom(
      this.http
        .get<ApiResponse<any>>(`${API_CONFIG.baseUrl}/enfermeria/hoy`)
        .pipe(map((res) => unwrapApi<any>(res)))
    );
  }

  // SIGNOS/VITALES
  addSignos(
    residenteId: number,
    payload: { temp?: string; presion?: string; pulso?: string; notes?: string }
  ): Promise<any> {
    return firstValueFrom(
      this.http
        .post<ApiResponse<any>>(
          `${API_CONFIG.baseUrl}/enfermeria/residentes/${residenteId}/vitals`,
          payload
        )
        .pipe(map((res) => unwrapApi<any>(res)))
    );
  }

  // MEDICACIÓN
  addMedicacion(
    residenteId: number,
    payload: { medicamento: string; dosis: string; horario: string; notes?: string }
  ): Promise<any> {
    return firstValueFrom(
      this.http
        .post<ApiResponse<any>>(
          `${API_CONFIG.baseUrl}/enfermeria/residentes/${residenteId}/medications`,
          payload
        )
        .pipe(map((res) => unwrapApi<any>(res)))
    );
  }

  // OBSERVACIONES
  addObservacion(
    residenteId: number,
    payload: { tipo: string; texto: string; severity?: 'info' | 'warning' | 'critical' }
  ): Promise<any> {
    return firstValueFrom(
      this.http
        .post<ApiResponse<any>>(
          `${API_CONFIG.baseUrl}/enfermeria/residentes/${residenteId}/observations`,
          payload
        )
        .pipe(map((res) => unwrapApi<any>(res)))
    );
  }

  // RESOLVER ALERTA (observación)
  resolveObservacion(obsId: number, payload?: { resolution_note?: string }): Promise<any> {
    return firstValueFrom(
      this.http
        .put<ApiResponse<any>>(
          `${API_CONFIG.baseUrl}/enfermeria/observations/${obsId}/resolve`,
          payload ?? {}
        )
        .pipe(map((res) => unwrapApi<any>(res)))
    );
  }
}
