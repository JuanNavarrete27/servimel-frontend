// F1 — src/app/core/utils/api-unwrap.ts
// ============================================================
// SERVIMEL — API Unwrap (ÚNICO estándar)
// - Normaliza respuestas típicas: { ok, data }, { items }, { rows }, arrays directos
// - Normaliza errores para mostrar message útil
// ============================================================

export type ApiResponse<T> =
  | T
  | {
      ok?: boolean;
      data?: T;
      items?: T;
      rows?: T;
      result?: T;
      message?: string;
      error?: any;
      errors?: any;
    };

export function unwrapApi<T>(res: ApiResponse<T>): T {
  // Array directo o data directa
  if (res == null) return res as unknown as T;

  // Si el backend devuelve el payload crudo
  if (Array.isArray(res)) return res as unknown as T;

  // Si es un objeto "plain", intentamos extraer data/items/rows/result
  const anyRes = res as any;

  if (anyRes && typeof anyRes === 'object') {
    if ('data' in anyRes && anyRes.data !== undefined) return anyRes.data as T;
    if ('items' in anyRes && anyRes.items !== undefined) return anyRes.items as T;
    if ('rows' in anyRes && anyRes.rows !== undefined) return anyRes.rows as T;
    if ('result' in anyRes && anyRes.result !== undefined) return anyRes.result as T;
  }

  return res as unknown as T;
}

export function unwrapApiOr<T>(res: ApiResponse<T>, fallback: T): T {
  try {
    const v = unwrapApi<T>(res);
    return (v as any) == null ? fallback : v;
  } catch {
    return fallback;
  }
}

// Mensaje de error “humano” para UI
export function apiErrorMessage(err: any, fallback = 'Error de servidor'): string {
  const msg =
    err?.error?.message ??
    err?.error?.error ??
    err?.message ??
    err?.statusText ??
    '';

  return msg ? `${fallback} (${String(msg)})` : fallback;
}
