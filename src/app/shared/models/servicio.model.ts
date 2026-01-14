// src/app/shared/models/servicio.model.ts
// ============================================================
// SERVIMEL — Modelos Servicios (DB real)
// ============================================================

export interface ServiceCategory {
  id: number;
  slug: 'medicina-general' | 'yoga' | 'ed-fisica' | 'cocina' | 'fisioterapia' | string;
  name: string;
  description?: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ServiceItem {
  id: number;
  category_id: number;
  title: string;
  description?: string | null;
  content?: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

// Respuesta “lista” genérica (items paginados)
export interface ServiceListResponse<T = any> {
  page: number;
  limit: number;
  total: number;
  items: T[];
}

// Respuesta de /servicios/:slug (shape estable)
export interface ServiceCategoryWithItemsResponse {
  category: ServiceCategory;
  items: ServiceItem[];
  page?: number;
  limit?: number;
  total?: number;
}

// ============================================================
// GLOBAL SEARCH: resultados con metadata de categoría
// (para mostrar “de qué servicio viene” cada match)
// ============================================================

export interface ServiceItemSearchHit extends ServiceItem {
  category_slug: string;
  category_name: string;
}

export interface ServiceSearchResponse {
  q: string;
  total: number;
  items: ServiceItemSearchHit[];
}
