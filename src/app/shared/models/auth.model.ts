// src/app/shared/models/auth.model.ts

export type UserRole = 'admin' | 'enfermeria' | 'medico' | 'staff';

// =========================
// UI MODEL (lo que usa tu frontend)
// =========================
export type AuthUser = {
  id: number;
  nombre: string;          // UI-friendly
  rol: UserRole;           // UI-friendly
  email?: string;          // útil para perfil
  avatar_url?: string;
};

// =========================
// API MODEL (lo que viene del backend)
// =========================
export type ApiAuthUser = {
  id: number;
  email: string;
  role: UserRole;

  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
};

// Login: backend puede devolver directo {token,user}
// o envuelto {ok:true,data:{token,user}}
export type LoginResponse = {
  token: string;
  user: AuthUser;
};

export type ApiLoginResponse = {
  token: string;
  user: ApiAuthUser;
};

// =========================
// Mapper API -> UI
// =========================
export function mapApiUserToAuthUser(u: ApiAuthUser): AuthUser {
  const nombre =
    [u.first_name, u.last_name].filter(Boolean).join(' ').trim() ||
    u.email ||
    'Usuario';

  return {
    id: u.id,
    nombre,
    rol: u.role,
    email: u.email,
    avatar_url: u.avatar_url ?? undefined,
  };
}
