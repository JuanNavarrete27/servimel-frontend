// src/app/shared/models/servicio.model.ts
// ============================================================
// SERVIMEL — Modelos de Servicios (DB real)
// ✅ Tipos alineados con el backend:
// - service_categories (id, slug, name, description, is_active, created_at, updated_at)
// - service_items      (id, category_id, title, description, content, is_active, created_at, updated_at)
// ============================================================

export type ServiceSlug =
  | 'medicina-general'
  | 'yoga'
  | 'fisioterapia'
  | 'cocina'
  | 'ed-fisica';

export type ServiceCategory = {
  id: number;
  slug: ServiceSlug;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ServiceItem = {
  id: number;
  category_id?: number; // puede venir en algunos endpoints (listItemsByCategory)
  title: string;
  description: string | null;
  content: string | null; // puede ser HTML / Markdown / texto
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ServiceListResponse<T> = {
  page: number;
  limit: number;
  total: number;
  items: T[];
};

export type ServiceCategoryWithItems = {
  category: ServiceCategory;
  items: ServiceListResponse<ServiceItem>;
};

// Helpers opcionales (por si querés usarlos en páginas)
export const SERVICE_SLUGS: ServiceSlug[] = [
  'medicina-general',
  'yoga',
  'fisioterapia',
  'cocina',
  'ed-fisica',
];

export function isServiceSlug(v: any): v is ServiceSlug {
  return SERVICE_SLUGS.includes(String(v) as ServiceSlug);
}
