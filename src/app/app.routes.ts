import { inject } from '@angular/core';
import { Routes, Router, CanActivateChildFn } from '@angular/router';

/* ============================================================
   ✅ AUTH GUARD (GLOBAL)
   - Bloquea TODO lo que está dentro del Shell
   - Si NO hay token → /login
   - Compatible con las keys que ya usás en AjustesPage
============================================================ */
const authGuardChild: CanActivateChildFn = () => {
  const router = inject(Router);

  const keys = ['servimel_token', 'servimel_token_v1', 'auth_token', 'token', 'jwt', 'access_token'];
  let token: string | null = null;

  try {
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v && v.trim()) { token = v.trim(); break; }
    }
  } catch {
    token = null;
  }

  if (!token) return router.parseUrl('/login');
  return true;
};

export const routes: Routes = [
  // =========================
  // ROOT → LOGIN (PÁGINA PRINCIPAL)
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
    canActivateChild: [authGuardChild], // ✅ PROTEGE TODAS LAS RUTAS HIJAS
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

      /*
      {
        path: 'residentes/nuevo',
        loadComponent: () =>
          import('./pages/residentes-nuevo/residentes-nuevo.page').then(
            m => m.ResidentesNuevoPage
          ),
      },
      */

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
      {
        path: 'medicina-general',
        loadComponent: () =>
          import('./pages/medicina-general/medicina-general.page').then(m => m.MedicinaGeneralPage),
      },
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
      }
    ],
  },

  // =========================
  // 404 → LOGIN
  // =========================
  { path: '**', redirectTo: 'login' },
];
