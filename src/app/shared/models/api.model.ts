// src/app/shared/models/api.model.ts
export type ApiError = {
  code: string;
  message: string;
  details?: any;
};

export type ApiOk<T> = { ok: true; data: T };
export type ApiFail = { ok: false; error: ApiError };
export type ApiResponse<T> = ApiOk<T> | ApiFail;
