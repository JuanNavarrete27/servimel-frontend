// src/app/shared/services/servicios.service.ts
// ============================================================
// SERVIMEL — Servicios (DB real)
// Consume endpoints reales del backend (NO MOCKS)
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
  ServiceCategoryWithItemsResponse
} from '../models/servicio.model';

type ServiceSlug = string;

@Injectable({ providedIn: 'root' })
export class ServiciosService {
  constructor(private http: HttpClient) {}

  // ============================================================
  // Categorías
  // ============================================================
  listCategories(): Promise<ServiceCategory[]> {
    return firstValueFrom(this.http.get<any>(`${API_CONFIG.baseUrl}/servicios`)).then((res) => {
      const data = unwrap<ServiceCategory[] | null>(res);
      return (data ?? []).map(this.normalizeCategory);
    });
  }

  // ============================================================
  // Categoría + ítems (SIN paginado – modelo real)
  // ============================================================
  getCategoryWithItems(slug: ServiceSlug): Promise<ServiceCategoryWithItemsResponse> {
    const safeSlug = encodeURIComponent(String(slug));

    return firstValueFrom(
      this.http.get<any>(`${API_CONFIG.baseUrl}/servicios/${safeSlug}`)
    ).then((res) => {
      const data = unwrap<any>(res);

      const category: ServiceCategory = this.normalizeCategory(
        data?.category ?? data?.categoria ?? data
      );

      // Backend puede devolver:
      // - items: ServiceItem[]
      // - items: { items: ServiceItem[] }
      const rawItems =
        Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data?.items?.items)
          ? data.items.items
          : [];

      const items: ServiceItem[] = rawItems.map(this.normalizeItem);

      return {
        category,
        items
      };
    });
  }

  // ============================================================
  // Ítems paginados (cuando lo necesites)
  // ============================================================
  listItems(
    slug: ServiceSlug,
    params?: { page?: number; limit?: number; q?: string; includeInactive?: boolean }
  ): Promise<ServiceListResponse<ServiceItem>> {
    const safeSlug = encodeURIComponent(String(slug));

    return firstValueFrom(
      this.http.get<any>(`${API_CONFIG.baseUrl}/servicios/${safeSlug}/items`, {
        params: (params ?? {}) as any
      })
    ).then((res) => {
      const data = unwrap<any>(res);

      return {
        page: Number(data?.page ?? 1),
        limit: Number(data?.limit ?? 20),
        total: Number(data?.total ?? 0),
        items: Array.isArray(data?.items) ? data.items.map(this.normalizeItem) : []
      };
    });
  }

  // ============================================================
  // Búsqueda global (para Medicina General)
  // ============================================================
  async searchAllItems(params?: {
    q?: string;
    limit?: number;
    includeInactive?: boolean;
    slugs?: ServiceSlug[];
  }): Promise<{
    total: number;
    items: ServiceItem[];
    meta: Record<number, { name: string; slug: string; category_id: number }>;
  }> {
    const q = String(params?.q ?? '').toLowerCase();
    const limit = Number(params?.limit ?? 50);
    const includeInactive = !!params?.includeInactive;

    const categories = await this.listCategories();
    const selected = params?.slugs?.length
      ? categories.filter((c) => params!.slugs!.includes(String(c.slug)))
      : categories;

    const meta: Record<number, { name: string; slug: string; category_id: number }> = {};
    const hits: ServiceItem[] = [];

    for (const c of selected) {
      const res = await this.getCategoryWithItems(String(c.slug));

      for (const item of res.items) {
        if (!includeInactive && item.is_active === false) continue;

        if (q) {
          const hay = `${item.title} ${item.description ?? ''} ${item.content ?? ''}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }

        meta[item.id] = {
          name: res.category.name,
          slug: String(res.category.slug),
          category_id: res.category.id
        };

        hits.push(item);
        if (hits.length >= limit) break;
      }

      if (hits.length >= limit) break;
    }

    return {
      total: hits.length,
      items: hits,
      meta
    };
  }

  // ============================================================
  // CRUD opcional
  // ============================================================
  createItem(slug: ServiceSlug, payload: Partial<ServiceItem> & { title: string }): Promise<ServiceItem> {
    const safeSlug = encodeURIComponent(String(slug));

    return firstValueFrom(
      this.http.post<any>(`${API_CONFIG.baseUrl}/servicios/${safeSlug}/items`, payload)
    ).then((res) => this.normalizeItem(unwrap<ServiceItem>(res)));
  }

  updateItem(slug: ServiceSlug, id: number, payload: Partial<ServiceItem>): Promise<ServiceItem> {
    const safeSlug = encodeURIComponent(String(slug));

    return firstValueFrom(
      this.http.put<any>(`${API_CONFIG.baseUrl}/servicios/${safeSlug}/items/${id}`, payload)
    ).then((res) => this.normalizeItem(unwrap<ServiceItem>(res)));
  }

  deleteItem(slug: ServiceSlug, id: number): Promise<{ id: number; deleted: true }> {
    const safeSlug = encodeURIComponent(String(slug));

    return firstValueFrom(
      this.http.delete<any>(`${API_CONFIG.baseUrl}/servicios/${safeSlug}/items/${id}`)
    ).then((res) => unwrap<{ id: number; deleted: true }>(res));
  }

  // ============================================================
  // Normalizers
  // ============================================================
  private normalizeCategory = (c: any): ServiceCategory => ({
    id: Number(c?.id ?? 0),
    slug: String(c?.slug ?? ''),
    name: String(c?.name ?? c?.nombre ?? ''),
    description: c?.description ?? c?.descripcion ?? null,
    is_active: c?.is_active === undefined ? true : this.toBool(c?.is_active),
    created_at: c?.created_at ?? undefined,
    updated_at: c?.updated_at ?? undefined
  });

  private normalizeItem = (i: any): ServiceItem => ({
    id: Number(i?.id ?? 0),
    category_id: Number(i?.category_id ?? 0),
    title: String(i?.title ?? i?.titulo ?? ''),
    description: i?.description ?? i?.descripcion ?? null,
    content: i?.content ?? i?.contenido ?? null,
    is_active: i?.is_active === undefined ? true : this.toBool(i?.is_active),
    created_at: i?.created_at ?? undefined,
    updated_at: i?.updated_at ?? undefined
  });

  private toBool(v: any): boolean {
    return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
  }
}
