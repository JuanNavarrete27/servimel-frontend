// src/app/shared/services/servicios.service.ts
// ============================================================
// SERVIMEL — Servicios (DB real)
// Consume endpoints reales del backend (NO MOCKS)
//
// Endpoints esperados (ya existen en tu backend):
// - GET    /servicios                     -> categorías activas
// - GET    /servicios/:slug               -> { category, items[] } (o items paginados)
// - GET    /servicios/:slug/items         -> listado paginado (opcional)
// - POST   /servicios/:slug/items         -> crear item (si lo usás)
// - PUT    /servicios/:slug/items/:id     -> editar item (si lo usás)
// - DELETE /servicios/:slug/items/:id     -> soft delete (si lo usás)
//
// Nota: Tu API puede venir envuelta {ok:true,data:...} o directo.
// Acá usamos unwrap() del shared/api-unwrap (ya lo tenés en varios services).
// ============================================================

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_CONFIG } from '../../core/config/api.config';
import { unwrap } from './api-unwrap';

import type {
  ServiceCategory,
  ServiceItem,
  ServiceListResponse,
  ServiceCategoryWithItems,
  ServiceSlug
} from '../models/servicio.model';

@Injectable({ providedIn: 'root' })
export class ServiciosService {
  constructor(private http: HttpClient) {}

  // -------------------------
  // Categorías
  // -------------------------
  listCategories(): Promise<ServiceCategory[]> {
    return firstValueFrom(
      this.http.get<any>(`${API_CONFIG.baseUrl}/servicios`)
    ).then((res) => {
      const data = unwrap<ServiceCategory[]>(res);
      return (data ?? []).map(this.normalizeCategory);
    });
  }

  getCategoryWithItems(slug: ServiceSlug): Promise<ServiceCategoryWithItems> {
    return firstValueFrom(
      this.http.get<any>(`${API_CONFIG.baseUrl}/servicios/${encodeURIComponent(String(slug))}`)
    ).then((res) => {
      const data = unwrap<any>(res);

      // Backend actual puede devolver:
      // A) { category, items: [...] }
      // B) { category, items: { page,limit,total,items:[...] } }
      // C) directo category + items sueltos
      const category: ServiceCategory = this.normalizeCategory(data?.category ?? data?.categoria ?? data);
      const rawItems = data?.items ?? data?.items?.items ?? [];

      const itemsPaged: ServiceListResponse<ServiceItem> =
        this.isPaged(rawItems)
          ? {
              page: Number(rawItems.page ?? 1),
              limit: Number(rawItems.limit ?? 20),
              total: Number(rawItems.total ?? 0),
              items: (rawItems.items ?? []).map(this.normalizeItem)
            }
          : {
              page: 1,
              limit: Array.isArray(rawItems) ? rawItems.length : 0,
              total: Array.isArray(rawItems) ? rawItems.length : 0,
              items: (Array.isArray(rawItems) ? rawItems : []).map(this.normalizeItem)
            };

      return { category, items: itemsPaged };
    });
  }

  // -------------------------
  // Ítems (paginado)
  // -------------------------
  listItems(
    slug: ServiceSlug,
    params?: { page?: number; limit?: number; q?: string; includeInactive?: boolean }
  ): Promise<ServiceListResponse<ServiceItem>> {
    return firstValueFrom(
      this.http.get<any>(`${API_CONFIG.baseUrl}/servicios/${encodeURIComponent(String(slug))}/items`, {
        params: params as any
      })
    ).then((res) => {
      const data = unwrap<any>(res);

      // esperamos {page,limit,total,items}
      const out: ServiceListResponse<ServiceItem> = {
        page: Number(data?.page ?? 1),
        limit: Number(data?.limit ?? 20),
        total: Number(data?.total ?? 0),
        items: Array.isArray(data?.items) ? data.items.map(this.normalizeItem) : []
      };
      return out;
    });
  }

  // -------------------------
  // CRUD opcional (si luego lo usás con admin)
  // -------------------------
  createItem(slug: ServiceSlug, payload: Partial<ServiceItem> & { title: string }): Promise<ServiceItem> {
    return firstValueFrom(
      this.http.post<any>(`${API_CONFIG.baseUrl}/servicios/${encodeURIComponent(String(slug))}/items`, payload)
    ).then((res) => this.normalizeItem(unwrap<ServiceItem>(res)));
  }

  updateItem(slug: ServiceSlug, id: number, payload: Partial<ServiceItem>): Promise<ServiceItem> {
    return firstValueFrom(
      this.http.put<any>(`${API_CONFIG.baseUrl}/servicios/${encodeURIComponent(String(slug))}/items/${id}`, payload)
    ).then((res) => this.normalizeItem(unwrap<ServiceItem>(res)));
  }

  deleteItem(slug: ServiceSlug, id: number): Promise<{ id: number; deleted: true }> {
    return firstValueFrom(
      this.http.delete<any>(`${API_CONFIG.baseUrl}/servicios/${encodeURIComponent(String(slug))}/items/${id}`)
    ).then((res) => unwrap<{ id: number; deleted: true }>(res));
  }

  // -------------------------
  // Normalizers
  // -------------------------
  private normalizeCategory = (c: any): ServiceCategory => {
    const cat: ServiceCategory = {
      id: Number(c?.id ?? 0),
      slug: String(c?.slug ?? '') as ServiceSlug,
      name: String(c?.name ?? c?.nombre ?? ''),
      description: c?.description ?? c?.descripcion ?? null,
      is_active: c?.is_active === undefined ? true : this.toBool(c?.is_active),
      created_at: c?.created_at ?? undefined,
      updated_at: c?.updated_at ?? undefined
    };
    return cat;
  };

  private normalizeItem = (i: any): ServiceItem => {
    const it: ServiceItem = {
      id: Number(i?.id ?? 0),
      category_id: i?.category_id !== undefined ? Number(i.category_id) : undefined,
      title: String(i?.title ?? i?.titulo ?? ''),
      description: i?.description ?? i?.descripcion ?? null,
      content: i?.content ?? i?.contenido ?? null,
      is_active: i?.is_active === undefined ? true : this.toBool(i?.is_active),
      created_at: i?.created_at ?? undefined,
      updated_at: i?.updated_at ?? undefined
    };
    return it;
  };

  private toBool(v: any): boolean {
    return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
  }

  private isPaged(x: any): x is { page: any; limit: any; total: any; items: any[] } {
    return x && typeof x === 'object' && 'items' in x && Array.isArray((x as any).items);
  }
}
