// src/app/app.routes.ts
import { inject } from '@angular/core';
import { Routes, Router, CanActivateChildFn, UrlTree } from '@angular/router';

/* ============================================================
   ✅ AUTH GUARD (GLOBAL)
   - Bloquea TODO lo que está dentro del Shell
   - Si NO hay token → /login?redirect=...
   - Compatible con keys legacy + migra a servimel_token_v1
============================================================ */

const TOKEN_KEY = 'servimel_token_v1';

const LEGACY_TOKEN_KEYS = [
  'servimel_token',
  'auth_token',
  'token',
  'jwt',
  'access_token',
  'servimelToken',
  'servimel_token_v0',
];

function normalizeToken(raw: any): string | null {
  if (raw == null) return null;

  let v = String(raw).trim();
  if (!v) return null;

  // si guardaron "Bearer eyJ..."
  v = v.replace(/^Bearer\s+/i, '').trim();

  // comillas
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }

  // JSON guardado por error
  if (v.startsWith('{') && v.endsWith('}')) {
    try {
      const obj = JSON.parse(v);
      const cand =
        obj?.token ||
        obj?.accessToken ||
        obj?.access_token ||
        obj?.jwt ||
        obj?.data?.token ||
        obj?.data?.accessToken ||
        null;
      if (cand) return normalizeToken(cand);
    } catch {
      // noop
    }
  }

  return v.length >= 10 ? v : null;
}

function readTokenFrom(storage: Storage, key: string): string | null {
  try {
    return normalizeToken(storage.getItem(key));
  } catch {
    return null;
  }
}

function readToken(): string | null {
  // 1) oficial (local + session)
  const direct =
    readTokenFrom(localStorage, TOKEN_KEY) ||
    readTokenFrom(sessionStorage, TOKEN_KEY);

  if (direct) return direct;

  // 2) legacy (migra a oficial)
  for (const k of LEGACY_TOKEN_KEYS) {
    const v =
      readTokenFrom(localStorage, k) ||
      readTokenFrom(sessionStorage, k);

    if (v) {
      try {
        localStorage.setItem(TOKEN_KEY, v);
      } catch {}
      return v;
    }
  }

  return null;
}

function redirectToLogin(router: Router, targetUrl?: string): UrlTree {
  const url = targetUrl ? `/login?redirect=${encodeURIComponent(targetUrl)}` : '/login';
  return router.parseUrl(url);
}

const authGuardChild: CanActivateChildFn = (_childRoute, state) => {
  const router = inject(Router);

  const token = readToken();
  if (!token) return redirectToLogin(router, state?.url);

  return true;
};

export const routes: Routes = [
  // =========================
  // ROOT → LOGIN
  // =========================
  { path: '', pathMatch: 'full', redirectTo: 'login' },

  // =========================
  // AUTH (SIN SHELL)
  // =========================
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login.page').then(m => m.LoginPage),
  },

  // =========================
  // APP (CON SHELL)
  // =========================
  {
    path: '',
    loadComponent: () =>
      import('./shared/components/app-shell/app-shell.component').then(
        m => m.AppShellComponent
      ),
    canActivateChild: [authGuardChild],
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/dashboard/dashboard.page').then(m => m.DashboardPage),
      },

      {
        path: 'residentes',
        loadComponent: () =>
          import('./pages/residentes/residentes.page').then(m => m.ResidentesPage),
      },

      // {
      //   path: 'residentes/nuevo',
      //   loadComponent: () =>
      //     import('./pages/residentes-nuevo/residentes-nuevo.page').then(
      //       m => m.ResidentesNuevoPage
      //     ),
      // },

      {
        path: 'residentes/:id',
        loadComponent: () =>
          import('./pages/residente-detalle/residente-detalle.page').then(
            m => m.ResidenteDetallePage
          ),
      },

      {
        path: 'enfermeria',
        loadComponent: () =>
          import('./pages/enfermeria/enfermeria.page').then(m => m.EnfermeriaPage),
      },

      // {
      //   path: 'medicina-general',
      //   loadComponent: () =>
      //     import('./pages/medicina-general/medicina-general.page').then(m => m.MedicinaGeneralPage),
      // },

      {
        path: 'fisioterapia',
        loadComponent: () =>
          import('./pages/fisioterapia/fisioterapia.page').then(m => m.FisioterapiaPage),
      },

      {
        path: 'ed-fisica',
        loadComponent: () =>
          import('./pages/ed-fisica/ed-fisica.page').then(m => m.EdFisicaPage),
      },

      {
        path: 'yoga',
        loadComponent: () =>
          import('./pages/yoga/yoga.page').then(m => m.YogaPage),
      },

      {
        path: 'cocina',
        loadComponent: () =>
          import('./pages/cocina/cocina.page').then(m => m.CocinaPage),
      },

      {
        path: 'historial',
        loadComponent: () =>
          import('./pages/historial/historial.page').then(m => m.HistorialPage),
      },

      {
        path: 'ajustes',
        loadComponent: () =>
          import('./pages/ajustes/ajustes.page').then(m => m.AjustesPage),
      },

      {
        path: 'perfil',
        loadComponent: () =>
          import('./pages/perfil/perfil.page').then(m => m.PerfilPage),
      },

      {
        path: 'nuevo',
        loadComponent: () =>
          import('./pages/residentes-nuevo/residentes-nuevo.page').then(m => m.ResidentesNuevoPage),
      },
       {
        path: 'crearfuncionario',
        loadComponent: () =>
          import('./pages/admin-funcionarios/admin-funcionarios.page').then(m => m.AdminFuncionariosPage),
      }
    ],
  },

  // =========================
  // 404 → LOGIN
  // =========================
  { path: '**', redirectTo: 'login' },
];
