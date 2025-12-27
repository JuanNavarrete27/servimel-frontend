// src/app/core/utils/api-unwrap.ts
export type ApiOk<T> = { ok: true; data: T };
export type ApiFail = { ok: false; error: { code: string; message: string; details?: any } };
export type ApiResponse<T> = T | ApiOk<T> | ApiFail;

export function unwrapApi<T>(res: ApiResponse<T>): T {
  if (res && typeof res === 'object' && 'ok' in res) {
    const r = res as ApiOk<T> | ApiFail;
    if (r.ok) return r.data;
    throw new Error(r.error?.message || 'Error de API');
  }
  return res as T;
}
