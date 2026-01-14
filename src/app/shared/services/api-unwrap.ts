// F8 — src/app/shared/services/api-unwrap.ts
// ============================================================
// SERVIMEL — Compat layer (NO DUPLICAR unwraps)
// ✅ Unifica TODO a core/utils/api-unwrap.ts
// ✅ Mantiene "unwrap" para servicios viejos (EnfermeriaService, etc.)
// ============================================================

import { unwrapApi as coreUnwrapApi, type ApiResponse } from '../../core/utils/api-unwrap';

// Re-export del tipo oficial
export type { ApiResponse };

// ✅ Compat: servicios viejos hacen `.then(unwrap)`
// Acepta tanto respuesta tipo ApiResponse como respuestas directas
export function unwrap<T = any>(res: any): T {
  try {
    return coreUnwrapApi<T>(res as ApiResponse<T>);
  } catch {
    // fallback: si ya vino directo del backend
    return res as T;
  }
}

// ✅ Si algún lugar importa unwrapApi desde shared
export function unwrapApi<T = any>(res: ApiResponse<T>): T {
  return coreUnwrapApi<T>(res);
}
