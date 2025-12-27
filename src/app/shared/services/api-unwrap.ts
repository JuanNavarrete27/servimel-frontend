export type ApiWrapped<T> = { ok: true; data: T } | { ok: false; error?: any };

export function unwrap<T>(res: any): T {
  if (res && typeof res === 'object' && 'ok' in res) {
    if (res.ok === true && 'data' in res) return res.data as T;
    throw res?.error ?? new Error('API_ERROR');
  }
  return res as T;
}
