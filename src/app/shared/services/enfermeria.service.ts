import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CONFIG } from '../../core/config/api.config';
import { unwrap } from './api-unwrap';

@Injectable({ providedIn: 'root' })
export class EnfermeriaService {
  constructor(private http: HttpClient) {}

  // HOY (panel rápido)
  hoy(): Promise<any> {
    return firstValueFrom(
      this.http.get<any>(`${API_CONFIG.baseUrl}/enfermeria/hoy`)
    ).then(unwrap);
  }

  // SIGNOS/VITALES
  addSignos(
    residenteId: number,
    payload: { temp?: string; presion?: string; pulso?: string; notes?: string }
  ): Promise<any> {
    return firstValueFrom(
      this.http.post<any>(
        `${API_CONFIG.baseUrl}/enfermeria/residentes/${residenteId}/vitals`,
        payload
      )
    ).then(unwrap);
  }

  // MEDICACIÓN
  addMedicacion(
    residenteId: number,
    payload: { medicamento: string; dosis: string; horario: string; notes?: string }
  ): Promise<any> {
    return firstValueFrom(
      this.http.post<any>(
        `${API_CONFIG.baseUrl}/enfermeria/residentes/${residenteId}/medications`,
        payload
      )
    ).then(unwrap);
  }

  // OBSERVACIONES
  addObservacion(
    residenteId: number,
    payload: { tipo: string; texto: string; severity?: 'info' | 'warning' | 'critical' }
  ): Promise<any> {
    return firstValueFrom(
      this.http.post<any>(
        `${API_CONFIG.baseUrl}/enfermeria/residentes/${residenteId}/observations`,
        payload
      )
    ).then(unwrap);
  }

  // RESOLVER ALERTA (observación)
  resolveObservacion(obsId: number, payload?: { resolution_note?: string }): Promise<any> {
    return firstValueFrom(
      this.http.put<any>(
        `${API_CONFIG.baseUrl}/enfermeria/observations/${obsId}/resolve`,
        payload ?? {}
      )
    ).then(unwrap);
  }
}
