// src/app/shared/services/residentes.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';

import { API_CONFIG } from '../../core/config/api.config';
import { unwrapApi, ApiResponse } from '../../core/utils/api-unwrap';
import { ResidenteDetail } from '../models/residente.model';

export type ResidenteListItem = {
  id: number;
  nombre: string;
  habitacion: string;
  estado: 'estable' | 'observacion' | 'critico';
};

@Injectable({ providedIn: 'root' })
export class ResidentesService {
  constructor(private http: HttpClient) {}

  list(): Promise<ResidenteListItem[]> {
    return firstValueFrom(
      this.http
        .get<ApiResponse<ResidenteListItem[]>>(`${API_CONFIG.baseUrl}/residentes`)
        .pipe(map((res) => unwrapApi<ResidenteListItem[]>(res)))
    );
  }

  getById(id: number): Promise<ResidenteDetail> {
    return firstValueFrom(
      this.http
        .get<ApiResponse<ResidenteDetail>>(`${API_CONFIG.baseUrl}/residentes/${id}`)
        .pipe(map((res) => unwrapApi<ResidenteDetail>(res)))
    );
  }
}
