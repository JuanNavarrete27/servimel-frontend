// src/app/shared/services/ajustes.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';

import { API_CONFIG } from '../../core/config/api.config';
import { unwrapApi, ApiResponse } from '../../core/utils/api-unwrap';
import { UserSettings } from '../models/settings.model';

@Injectable({ providedIn: 'root' })
export class AjustesService {
  constructor(private http: HttpClient) {}

  getMe(): Promise<UserSettings> {
    return firstValueFrom(
      this.http
        .get<ApiResponse<UserSettings>>(`${API_CONFIG.baseUrl}/settings/me`)
        .pipe(map((res) => unwrapApi<UserSettings>(res)))
    );
  }

  updateMe(payload: Partial<UserSettings>): Promise<UserSettings> {
    return firstValueFrom(
      this.http
        .put<ApiResponse<UserSettings>>(`${API_CONFIG.baseUrl}/settings/me`, payload)
        .pipe(map((res) => unwrapApi<UserSettings>(res)))
    );
  }
}
