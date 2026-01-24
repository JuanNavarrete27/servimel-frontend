// src/app/pages/cocina/cocina.page.ts
// ============================================================
// SERVIMEL — Cocina (BACKEND REAL)
// ✅ API_CONFIG.baseUrl (NO hardcode "/api" global)
// ✅ styleUrls (no styleUrl)
// ✅ unwrapApi unificado (core/utils/api-unwrap)
// ✅ NO ResidentesService (carga residentes por HttpClient /residentes)
// ✅ Robustez:
//    - Soporta respuestas {menus}, {assignments}, {data}, {rows}, {items}, array directo
//    - Soporta menuJson como objeto o JSON string
//    - Convierte menuJson ⇄ grid (7 días x 4 comidas)
// ✅ Envío/recepción REAL (COCINA VA CON /api):
//    - GET    /api/cocina/menus?weekStart=YYYY-MM-DD
//    - GET    /api/cocina/menus/:id
//    - POST   /api/cocina/menus
//    - PUT    /api/cocina/menus/:id
//    - POST   /api/cocina/menus/:id/publish
//    - GET    /api/cocina/assignments?weekStart=YYYY-MM-DD
//    - PUT    /api/cocina/assignments   ✅ (FIX: body { assignments: [] })
//    - GET    /api/cocina/view?residentId=ID&weekStart=YYYY-MM-DD
//    - GET    /residentes   (SIN /api)
// ✅ FIX EXTRA:
//    - Authorization Bearer en TODAS las llamadas (incluye /residentes por si está protegido)
// ============================================================

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { API_CONFIG } from '../../core/config/api.config';
import { unwrapApi, ApiResponse } from '../../core/utils/api-unwrap';
import { AuthService } from '../../shared/services/auth.service';

type Role = 'admin' | 'medico' | 'enfermeria' | 'cocinero' | 'user' | string;
type MealKey = 'breakfast' | 'lunch' | 'snack' | 'dinner';

interface Resident {
  id: number;
  nombre?: string;
  habitacion?: string;
  first_name?: string;
  last_name?: string;
  apellido?: string;
  room?: string;
}

interface MenuCell {
  main: string;
  side: string;
  drink: string;
  dessert: string;
  notes: string;
  tags: string[];
}

type MenuGrid = Record<string, MenuCell>; // `${dayIndex}:${mealKey}`

interface KitchenMenu {
  id: number;
  title: string;
  status: 'draft' | 'published';
  weekStart: string; // yyyy-mm-dd
  weekEnd: string; // yyyy-mm-dd
  grid: MenuGrid;
  updatedAt?: string;
}

interface Assignment {
  residentId: number;
  weekStart: string;
  menuId: number | null;
  dietType: string;
  residentNotes: string;
}

interface ViewerResult {
  assignment: Assignment | null;
  menu: KitchenMenu | null;
}

interface SummaryStat {
  label: string;
  value: number;
}

interface CreateDraft {
  title: string;
  weekStart: string;
  weekEnd: string;
  duplicateFromMenuId: number; // 0 = no
}

interface ActiveCell {
  dayIndex: number; // 0..6
  meal: MealKey;
}

@Component({
  selector: 'app-cocina',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cocina.page.html',
  styleUrls: ['./cocina.page.scss'],
})
export class CocinaPage implements OnInit {
  // ============================================================
  // Estado general
  // ============================================================
  loading = false;
  saving = false;
  errorMsg = '';

  role: Role = 'user';

  tab: 'view' | 'menu' | 'assign' | 'summary' = 'view';

  canEditMenus = false; // cocinero/admin
  canAssignMenus = false; // admin/cocinero
  canPickResident = false; // admin/medico/enfermeria

  // ============================================================
  // Semana (Monday-based)
  // ============================================================
  weekStartIso = '';
  weekEndIso = '';
  weekDays: Array<{ label: string; iso: string }> = [];

  mealTypes: Array<{ key: MealKey; label: string; icon: string }> = [
    { key: 'breakfast', label: 'Desayuno', icon: '☕' },
    { key: 'lunch', label: 'Almuerzo', icon: '🍲' },
    { key: 'snack', label: 'Merienda', icon: '🥐' },
    { key: 'dinner', label: 'Cena', icon: '🌙' },
  ];

  // ============================================================
  // Datos
  // ============================================================
  residents: Resident[] = [];

  menus: KitchenMenu[] = [];
  selectedMenuId: number | null = null;
  selectedMenu: KitchenMenu | null = null;

  // Draft editable
  private selectedMenuDraft: KitchenMenu | null = null;

  viewerResidentId: number | null = null;
  viewerResult: ViewerResult | null = null;

  residentQuery = '';
  assignments: Assignment[] = [];
  assignDraft: Record<number, { menuId: number | null; dietType: string; residentNotes: string }> = {};

  bulkMenuId: number | null = null;
  bulkDiet = '';
  bulkNotes = '';

  summaryStats: SummaryStat[] = [];

  createOpen = false;
  createDraft: CreateDraft = {
    title: '',
    weekStart: '',
    weekEnd: '',
    duplicateFromMenuId: 0,
  };

  activeCell: ActiveCell | null = null;
  activeCellDraft: MenuCell = this.defaultCell();

  // ============================================================
  // Auth helpers
  // ============================================================
  private getToken(): string | null {
    const keys = ['servimel_token_v1', 'servimel_token', 'auth_token', 'token', 'jwt', 'access_token'];
    for (const k of keys) {
      try {
        const v = localStorage.getItem(k);
        if (v?.trim()) return v.trim();
      } catch {
        // noop
      }
    }
    return null;
  }

  private authHeaders(): HttpHeaders {
    const t = this.getToken();
    return t ? new HttpHeaders({ Authorization: `Bearer ${t}` }) : new HttpHeaders();
  }

  // Loading counter
  private loadingCount = 0;

  constructor(
    private http: HttpClient,
    private auth: AuthService,
  ) {}

  // ============================================================
  // ✅ URL Helpers (FIX REAL)
  // - Residentes: SIN /api
  // - Cocina: CON /api/cocina
  // ============================================================
  private baseUrl(): string {
    return String(API_CONFIG?.baseUrl || '').replace(/\/+$/, '');
  }

  private join(base: string, path: string): string {
    const b = (base || '').replace(/\/+$/, '');
    const p = (path || '').replace(/^\/+/, '');
    return `${b}/${p}`;
  }

  private residentesUrl(path: string): string {
    // ✅ SIN /api
    const normalized = (path || '').startsWith('/') ? path : `/${path}`;
    return this.join(this.baseUrl(), normalized);
  }

  private cocinaUrl(path: string): string {
    // ✅ CON /api SOLO para Cocina (como en Render)
    const clean = (path || '').trim();
    const p = clean.startsWith('/') ? clean : `/${clean}`;
    return this.join(this.baseUrl(), `/api/cocina${p}`);
  }

  private safeUnwrap<T>(res: any): T {
    try {
      return unwrapApi<T>(res as ApiResponse<T>);
    } catch {
      return res as T;
    }
  }

  // ============================================================
  // Computed simple para template
  // ============================================================
  get currentMenu(): KitchenMenu | null {
    return this.selectedMenuDraft || this.selectedMenu;
  }

  get roleLabel(): string {
    const r = String(this.role || '').trim();
    return r || 'user';
  }

  ngOnInit(): void {
    this.initRole();
    this.initWeek(new Date());
    void this.bootstrap();
  }

  // ============================================================
  // Role / Permisos (unificado y tolerante)
  // ============================================================
  private normalizeRole(raw: any): Role {
    const v = String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');

    if (!v) return 'user';

    // aliases comunes
    if (v === 'administrador' || v === 'administrator') return 'admin';
    if (v === 'admin') return 'admin';

    if (v === 'doctor') return 'medico';
    if (v === 'medico') return 'medico';

    if (v === 'enfermeria' || v === 'nurse' || v === 'nursing') return 'enfermeria';
    if (v === 'cocinero' || v === 'kitchen' || v === 'chef') return 'cocinero';

    return v as Role;
  }

  private initRole(): void {
    const fromAuth = this.tryReadRoleFromAuth();
    const fromLs = this.tryReadRoleFromLocalStorage();
    this.role = this.normalizeRole(fromAuth || fromLs || 'user');

    const rr = String(this.role || '').trim().toLowerCase().replace(/\s+/g, '_');

    // ✅ Política REAL: admin + cocinero editan/assignan
    this.canEditMenus = rr === 'cocinero' || rr === 'admin';
    this.canAssignMenus = rr === 'cocinero' || rr === 'admin';
    this.canPickResident = rr === 'admin' || rr === 'medico' || rr === 'enfermeria';

    // default tab
    this.tab = this.canEditMenus ? 'menu' : 'view';
  }

  private tryReadRoleFromAuth(): Role {
    try {
      const anyAuth: any = this.auth as any;
      const u: any =
        anyAuth?.getUser?.() ||
        anyAuth?.currentUserValue ||
        anyAuth?.user?.value ||
        anyAuth?.currentUser?.value ||
        null;

      const r =
        (u?.rol ||
          u?.role ||
          anyAuth?.userRole ||
          anyAuth?.role ||
          anyAuth?.getRole?.() ||
          anyAuth?.getUserRole?.() ||
          '') as Role;

      return (r || 'user') as Role;
    } catch {
      return 'user';
    }
  }

  private tryReadRoleFromLocalStorage(): Role {
    try {
      const keys = ['servimel_user_v1', 'servimel_user', 'user', 'currentUser', 'auth_user'];
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;

        // rol guardado como string simple
        if (raw.length < 80 && !raw.trim().startsWith('{')) return raw as Role;

        const obj = JSON.parse(raw);
        const cand =
          obj?.rol ??
          obj?.role ??
          obj?.user?.rol ??
          obj?.user?.role ??
          obj?.data?.rol ??
          obj?.data?.role ??
          null;

        if (typeof cand === 'string' && cand.trim()) return cand as Role;
      }
    } catch {
      // noop
    }
    return 'user';
  }

  // ============================================================
  // Semana helpers
  // ============================================================
  private initWeek(date: Date): void {
    const monday = this.toMonday(date);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    this.weekStartIso = this.toIso(monday);
    this.weekEndIso = this.toIso(sunday);

    this.weekDays = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return { label: this.dayLabel(i), iso: this.toIso(d) };
    });

    this.closeCell();
  }

  prevWeek(): void {
    const d = this.fromIso(this.weekStartIso);
    d.setDate(d.getDate() - 7);
    this.initWeek(d);
    void this.onWeekChanged();
  }

  nextWeek(): void {
    const d = this.fromIso(this.weekStartIso);
    d.setDate(d.getDate() + 7);
    this.initWeek(d);
    void this.onWeekChanged();
  }

  weekRangeLabel(): string {
    const start = this.fromIso(this.weekStartIso);
    const end = this.fromIso(this.weekEndIso);
    const fmt = (x: Date) => x.toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit' });
    return `${fmt(start)} → ${fmt(end)}`;
  }

  private async onWeekChanged(): Promise<void> {
    await this.loadMenus();
    await this.loadAssignments();
    if (this.viewerResidentId) await this.loadViewer();
    this.recomputeSummary();
  }

  // ============================================================
  // Boot / Cargas (REAL)
  // ============================================================
  private async bootstrap(): Promise<void> {
    this.setLoading(true);
    this.errorMsg = '';

    try {
      await this.loadResidents();
      await this.loadMenus();
      await this.loadAssignments();

      if (this.viewerResidentId) await this.loadViewer();
      this.recomputeSummary();
    } catch {
      // errorMsg se setea en loaders
    } finally {
      this.setLoading(false);
    }
  }

  private setLoading(on: boolean): void {
    this.loadingCount += on ? 1 : -1;
    if (this.loadingCount < 0) this.loadingCount = 0;
    this.loading = this.loadingCount > 0;
  }

  // ============================================================
  // Residents (REAL) — GET /residentes ✅ SIN /api
  // ============================================================
  private async loadResidents(): Promise<void> {
    this.errorMsg = '';
    this.setLoading(true);

    try {
      const url = this.residentesUrl('/residentes');
      const res = await firstValueFrom(
        this.http.get<ApiResponse<any> | any>(url, { headers: this.authHeaders() }),
      );
      const data = this.safeUnwrap<any>(res);

      const arr: any[] =
        Array.isArray(data)
          ? data
          : Array.isArray(data?.items)
            ? data.items
            : Array.isArray(data?.rows)
              ? data.rows
              : Array.isArray(data?.data)
                ? data.data
                : [];

      this.residents = (arr || [])
        .map((r: any) => ({
          id: Number(r?.id),
          nombre: String(r?.nombre ?? r?.name ?? r?.first_name ?? '').trim(),
          habitacion: (String(r?.habitacion ?? r?.room ?? '').trim() || undefined) as any,
          first_name: r?.first_name,
          last_name: r?.last_name,
          apellido: r?.apellido,
          room: r?.room,
        }))
        .filter((r: Resident) => Number.isFinite(r.id)) as Resident[];

      this.seedAssignDraft();
    } catch {
      this.residents = [];
      this.seedAssignDraft();
      this.errorMsg = 'No se pudieron cargar residentes desde el backend.';
    } finally {
      this.setLoading(false);
    }
  }

  // ============================================================
  // Menús (REAL) ✅ /api/cocina/menus
  // ============================================================
  private async loadMenus(): Promise<void> {
    this.errorMsg = '';
    this.setLoading(true);

    try {
      const url = this.cocinaUrl(`/menus?weekStart=${encodeURIComponent(this.weekStartIso)}`);
      const res = await firstValueFrom(
        this.http.get<ApiResponse<any> | any>(url, { headers: this.authHeaders() }),
      );
      const un = this.safeUnwrap<any>(res) || (res as any);

      const list: any[] =
        Array.isArray(un)
          ? un
          : Array.isArray(un?.menus)
            ? un.menus
            : Array.isArray(un?.rows)
              ? un.rows
              : Array.isArray(un?.data)
                ? un.data
                : Array.isArray(un?.items)
                  ? un.items
                  : [];

      const mapped = (list || []).map((m: any) => this.normalizeMenu(m));
      this.menus = mapped;

      if (!this.selectedMenuId) {
        if (this.menus.length) this.selectMenu(this.menus[0].id, false);
        else this.selectMenu(null, false);
      } else {
        const exists = this.menus.some((x) => x.id === this.selectedMenuId);
        if (!exists) {
          if (this.menus.length) this.selectMenu(this.menus[0].id, false);
          else this.selectMenu(null, false);
        } else {
          this.selectMenu(this.selectedMenuId, false);
        }
      }
    } catch {
      this.menus = [];
      this.selectMenu(null, false);
      this.errorMsg = 'No se pudieron cargar menús desde el backend.';
    } finally {
      this.setLoading(false);
    }
  }

  async loadMenuById(menuId: number): Promise<KitchenMenu | null> {
    if (!menuId) return null;

    this.errorMsg = '';
    this.setLoading(true);

    try {
      const url = this.cocinaUrl(`/menus/${menuId}`);
      const res = await firstValueFrom(
        this.http.get<ApiResponse<any> | any>(url, { headers: this.authHeaders() }),
      );
      const un = this.safeUnwrap<any>(res) || (res as any);

      const raw = un?.menu ?? un?.data ?? un ?? null;
      if (!raw) return null;

      return this.normalizeMenu(raw);
    } catch {
      this.errorMsg = 'No se pudo cargar el menú seleccionado desde el backend.';
      return null;
    } finally {
      this.setLoading(false);
    }
  }

  // ============================================================
  // Assignments (REAL) ✅ /api/cocina/assignments
  // ============================================================
  async loadAssignments(): Promise<void> {
    this.errorMsg = '';
    this.setLoading(true);

    try {
      const url = this.cocinaUrl(`/assignments?weekStart=${encodeURIComponent(this.weekStartIso)}`);
      const res = await firstValueFrom(
        this.http.get<ApiResponse<any> | any>(url, { headers: this.authHeaders() }),
      );
      const un = this.safeUnwrap<any>(res) || (res as any);

      const list: any[] =
        Array.isArray(un)
          ? un
          : Array.isArray(un?.assignments)
            ? un.assignments
            : Array.isArray(un?.rows)
              ? un.rows
              : Array.isArray(un?.data)
                ? un.data
                : Array.isArray(un?.items)
                  ? un.items
                  : [];

      this.assignments = (list || []).map((a: any) => this.normalizeAssignment(a));
      this.seedAssignDraftFromAssignments();
      this.recomputeSummary();
    } catch {
      this.assignments = [];
      this.seedAssignDraftFromAssignments();
      this.recomputeSummary();
      this.errorMsg = 'No se pudieron cargar asignaciones desde el backend.';
    } finally {
      this.setLoading(false);
    }
  }

  // ============================================================
  // Viewer (REAL) ✅ /api/cocina/view
  // ============================================================
  async loadViewer(): Promise<void> {
    if (!this.viewerResidentId) {
      this.viewerResult = null;
      return;
    }

    this.errorMsg = '';
    this.setLoading(true);

    try {
      const url = this.cocinaUrl(
        `/view?residentId=${encodeURIComponent(this.viewerResidentId)}&weekStart=${encodeURIComponent(
          this.weekStartIso,
        )}`,
      );

      const res = await firstValueFrom(
        this.http.get<ApiResponse<any> | any>(url, { headers: this.authHeaders() }),
      );
      const data = this.safeUnwrap<any>(res) || (res as any);

      const assignmentRaw = data?.assignment ?? data?.asignacion ?? null;
      const menuRaw = data?.menu ?? null;

      const assignment = assignmentRaw ? this.normalizeAssignment(assignmentRaw) : null;
      const menu = menuRaw ? this.normalizeMenu(menuRaw) : null;

      this.viewerResult = { assignment, menu };
    } catch {
      const a =
        this.assignments.find(
          (x) => x.residentId === this.viewerResidentId && x.weekStart === this.weekStartIso,
        ) || null;

      const menu = a?.menuId ? this.menus.find((m) => m.id === a.menuId) || null : null;
      this.viewerResult = { assignment: a, menu };
      this.errorMsg = 'No se pudo cargar viewer desde el backend (usando datos locales ya cargados).';
    } finally {
      this.setLoading(false);
    }
  }

  // ============================================================
  // Tabs
  // ============================================================
  setTab(t: 'view' | 'menu' | 'assign' | 'summary'): void {
    this.tab = t;

    if (t === 'view' && this.viewerResidentId) void this.loadViewer();
    if (t === 'assign' || t === 'summary') void this.loadAssignments();
  }

  // ============================================================
  // Menús — selección y CRUD REAL
  // ============================================================
  selectMenu(menuId: number | null, preferFetch: boolean): void {
    this.selectedMenuId = menuId;

    if (!menuId) {
      this.selectedMenu = null;
      this.selectedMenuDraft = null;
      return;
    }

    const local = this.menus.find((m) => m.id === menuId) || null;
    this.selectedMenu = local;
    this.selectedMenuDraft = local ? this.cloneMenu(local) : null;

    if (preferFetch) {
      void (async () => {
        const fresh = await this.loadMenuById(menuId);
        if (!fresh) return;
        this.selectedMenu = fresh;
        this.selectedMenuDraft = this.cloneMenu(fresh);
        this.menus = this.menus.map((x) => (x.id === fresh.id ? fresh : x));
      })();
    }
  }

  openCreateMenu(): void {
    this.createOpen = true;
    this.createDraft = {
      title: '',
      weekStart: this.weekStartIso,
      weekEnd: this.weekEndIso,
      duplicateFromMenuId: 0,
    };
  }

  closeCreateMenu(): void {
    this.createOpen = false;
  }

  // ✅ FIX: ahora mostramos el error real del backend (sin [object Object])
  private extractBackendErrorMessage(err: any): string {
    try {
      const raw = err?.error?.message ?? err?.error?.error ?? err?.message ?? '';
      if (!raw) return '';
      if (typeof raw === 'string') return raw.trim();
      return JSON.stringify(raw);
    } catch {
      return '';
    }
  }

  async createMenu(): Promise<void> {
    if (!this.canEditMenus) return;

    this.saving = true;
    this.errorMsg = '';

    // ✅ aseguramos formato YYYY-MM-DD
    const weekStart = this.isoDateOnly(this.createDraft.weekStart);
    const weekEnd = this.isoDateOnly(this.createDraft.weekEnd);

    const payload = {
      title: (this.createDraft.title || '').trim() || `Semana ${weekStart}`,
      weekStart,
      weekEnd,
      duplicateFromMenuId: this.createDraft.duplicateFromMenuId || 0,
    };

    try {
      const url = this.cocinaUrl('/menus');
      const res = await firstValueFrom(
        this.http.post<ApiResponse<any> | any>(url, payload, { headers: this.authHeaders() }),
      );
      const un = this.safeUnwrap<any>(res) || (res as any);

      const raw = un?.menu ?? un?.data ?? un ?? null;
      if (!raw) throw new Error('No menu returned');

      const created = this.normalizeMenu(raw);

      this.menus = [created, ...this.menus.filter((x) => x.id !== created.id)];
      this.selectMenu(created.id, true);
      this.createOpen = false;

      await this.loadMenus();
      await this.loadAssignments();
      if (this.viewerResidentId) await this.loadViewer();
      this.recomputeSummary();
    } catch (err: any) {
      const detail = this.extractBackendErrorMessage(err);
      this.errorMsg = detail
        ? `No se pudo crear el menú en el backend: ${detail}`
        : 'No se pudo crear el menú en el backend.';
    } finally {
      this.saving = false;
    }
  }

  async saveSelectedMenu(): Promise<void> {
    if (!this.canEditMenus) return;
    if (!this.selectedMenuId || !this.selectedMenuDraft) return;

    this.saving = true;
    this.errorMsg = '';

    // ✅ FIX CRÍTICO: weekStart/weekEnd SIEMPRE YYYY-MM-DD
    const weekStart = this.isoDateOnly(this.selectedMenuDraft.weekStart);
    const weekEnd = this.isoDateOnly(this.selectedMenuDraft.weekEnd);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      this.errorMsg = `weekStart inválido en frontend: "${this.selectedMenuDraft.weekStart}"`;
      this.saving = false;
      return;
    }

    const payload = {
      id: this.selectedMenuDraft.id,
      title: this.selectedMenuDraft.title,
      status: this.selectedMenuDraft.status,
      weekStart,
      weekEnd,
      menuJson: this.gridToMenuJson(this.selectedMenuDraft.grid, weekStart),
    };

    try {
      const url = this.cocinaUrl(`/menus/${this.selectedMenuId}`);
      const res = await firstValueFrom(
        this.http.put<ApiResponse<any> | any>(url, payload, { headers: this.authHeaders() }),
      );
      const un = this.safeUnwrap<any>(res) || (res as any);

      const raw = un?.menu ?? un?.data ?? un ?? null;
      const saved = raw ? this.normalizeMenu(raw) : this.normalizeMenu(payload);

      this.selectedMenu = saved;
      this.selectedMenuDraft = this.cloneMenu(saved);
      this.menus = this.menus.map((m) => (m.id === saved.id ? saved : m));

      await this.loadMenus();
      this.recomputeSummary();
    } catch (err: any) {
      const detail = this.extractBackendErrorMessage(err);
      this.errorMsg = detail
        ? `No se pudo guardar el menú en el backend: ${detail}`
        : 'No se pudo guardar el menú en el backend.';
    } finally {
      this.saving = false;
    }
  }

  async publishSelectedMenu(): Promise<void> {
    if (!this.canEditMenus) return;
    if (!this.selectedMenuId) return;

    this.saving = true;
    this.errorMsg = '';

    try {
      const url = this.cocinaUrl(`/menus/${this.selectedMenuId}/publish`);
      const res = await firstValueFrom(
        this.http.post<ApiResponse<any> | any>(url, {}, { headers: this.authHeaders() }),
      );
      const un = this.safeUnwrap<any>(res) || (res as any);

      const raw = un?.menu ?? un?.data ?? un ?? null;
      const published = raw ? this.normalizeMenu(raw) : null;

      if (published) {
        this.selectedMenu = published;
        this.selectedMenuDraft = this.cloneMenu(published);
        this.menus = this.menus.map((m) => (m.id === published.id ? published : m));
      }

      await this.loadMenus();
      await this.loadAssignments();
      if (this.viewerResidentId) await this.loadViewer();
      this.recomputeSummary();
    } catch (err: any) {
      const detail = this.extractBackendErrorMessage(err);
      this.errorMsg = detail
        ? `No se pudo publicar el menú en el backend: ${detail}`
        : 'No se pudo publicar el menú en el backend.';
    } finally {
      this.saving = false;
    }
  }

  menuStatusLabel(m: KitchenMenu | null): string {
    if (!m) return 'Sin menú';
    return m.status === 'published' ? 'Publicado' : 'Borrador';
  }

  // ============================================================
  // Celdas
  // ============================================================
  getCell(dayIndex: number, meal: MealKey): MenuCell {
    let menu: KitchenMenu | null = null;

    if (this.tab === 'view' && this.viewerResidentId && this.viewerResult?.menu) {
      menu = this.viewerResult.menu;
    } else {
      menu = this.selectedMenuDraft || this.selectedMenu;
    }

    if (!menu) return this.defaultCell();

    const key = this.cellKey(dayIndex, meal);
    return menu.grid[key] || this.defaultCell();
  }

  openCell(dayIndex: number, meal: MealKey): void {
    if (!this.canEditMenus) return;
    if (!this.selectedMenuDraft) return;

    this.activeCell = { dayIndex, meal };
    const key = this.cellKey(dayIndex, meal);
    const current = this.selectedMenuDraft.grid[key] || this.defaultCell();
    this.activeCellDraft = this.cloneCell(current);
  }

  closeCell(): void {
    this.activeCell = null;
    this.activeCellDraft = this.defaultCell();
  }

  get activeDayLabel(): string {
    if (!this.activeCell) return '';
    return this.weekDays[this.activeCell.dayIndex]?.label || 'Día';
  }

  get activeMealLabel(): string {
    if (!this.activeCell) return '';
    const mt = this.mealTypes.find((x) => x.key === this.activeCell!.meal);
    return mt?.label || 'Comida';
  }

  applyActiveCellToGrid(): void {
    if (!this.canEditMenus) return;
    if (!this.activeCell || !this.selectedMenuDraft) return;

    const { dayIndex, meal } = this.activeCell;
    const key = this.cellKey(dayIndex, meal);
    this.selectedMenuDraft.grid[key] = this.cloneCell(this.activeCellDraft);
  }

  addTagToActive(tag: string): void {
    if (!this.canEditMenus) return;
    const t = (tag || '').trim();
    if (!t) return;
    const tags = this.activeCellDraft.tags;
    if (!tags.includes(t)) tags.push(t);
  }

  removeTagFromActive(tag: string): void {
    if (!this.canEditMenus) return;
    this.activeCellDraft.tags = this.activeCellDraft.tags.filter((x) => x !== tag);
  }

  // ============================================================
  // Asignaciones
  // ============================================================
  seedAssignDraft(): void {
    const next: Record<number, { menuId: number | null; dietType: string; residentNotes: string }> = {};
    for (const r of this.residents) next[r.id] = { menuId: null, dietType: '', residentNotes: '' };
    this.assignDraft = next;
    this.seedAssignDraftFromAssignments();
  }

  private seedAssignDraftFromAssignments(): void {
    if (!this.residents.length) return;

    for (const r of this.residents) {
      if (!this.assignDraft[r.id]) this.assignDraft[r.id] = { menuId: null, dietType: '', residentNotes: '' };
    }

    const week = this.weekStartIso;
    for (const a of this.assignments.filter((x) => x.weekStart === week)) {
      if (!this.assignDraft[a.residentId]) continue;
      this.assignDraft[a.residentId] = {
        menuId: a.menuId ?? null,
        dietType: a.dietType || '',
        residentNotes: a.residentNotes || '',
      };
    }
  }

  filteredResidents(): Resident[] {
    const q = (this.residentQuery || '').trim().toLowerCase();
    if (!q) return this.residents;

    return this.residents.filter((r) => {
      const name = this.residentLabel(r).toLowerCase();
      const room = String(r.habitacion || r.room || '').toLowerCase();
      const id = String(r.id);
      return name.includes(q) || room.includes(q) || id.includes(q);
    });
  }

  applyBulk(): void {
    if (!this.canAssignMenus) return;

    const list = this.filteredResidents();
    for (const r of list) {
      this.assignDraft[r.id] = {
        menuId: this.bulkMenuId,
        dietType: (this.bulkDiet || '').trim(),
        residentNotes: (this.bulkNotes || '').trim(),
      };
    }
    this.recomputeSummary();
  }

  async saveAssignments(): Promise<void> {
    if (!this.canAssignMenus) return;

    this.saving = true;
    this.errorMsg = '';

    const weekStart = this.weekStartIso;

    const rows: Assignment[] = Object.keys(this.assignDraft).map((k) => {
      const residentId = Number(k);
      const d = this.assignDraft[residentId];
      return {
        residentId,
        weekStart,
        menuId: d?.menuId ?? null,
        dietType: d?.dietType || '',
        residentNotes: d?.residentNotes || '',
      };
    });

    try {
      // ✅ FIX REAL: Backend espera "assignments" como ARRAY
      const url = this.cocinaUrl('/assignments');
      await firstValueFrom(
        this.http.put<ApiResponse<any> | any>(
          url,
          { weekStart, assignments: rows },
          { headers: this.authHeaders() },
        ),
      );

      await this.loadAssignments();
      if (this.viewerResidentId) await this.loadViewer();
      this.recomputeSummary();
    } catch (err: any) {
      const detail = this.extractBackendErrorMessage(err);
      this.errorMsg = detail
        ? `No se pudieron guardar asignaciones en el backend: ${detail}`
        : 'No se pudieron guardar asignaciones en el backend.';
    } finally {
      this.saving = false;
    }
  }

  // ============================================================
  // Summary
  // ============================================================
  recomputeSummary(): void {
    const totalResidents = this.residents.length;

    let assigned = 0;
    let unassigned = 0;

    for (const r of this.residents) {
      const d = this.assignDraft[r.id];
      if (d && d.menuId) assigned++;
      else unassigned++;
    }

    const uniqueMenus = new Set<number>();
    for (const r of this.residents) {
      const d = this.assignDraft[r.id];
      if (d?.menuId) uniqueMenus.add(d.menuId);
    }

    this.summaryStats = [
      { label: 'Residentes', value: totalResidents },
      { label: 'Sin menú', value: unassigned },
      { label: 'Con menú', value: assigned },
      { label: 'Menús usados', value: uniqueMenus.size },
    ];
  }

  summaryValue(index: number): number {
    return this.summaryStats[index]?.value ?? 0;
  }

  menuAssignmentCounts(): Array<{ menuId: number; title: string; count: number }> {
    const map = new Map<number, number>();

    for (const r of this.residents) {
      const mid = this.assignDraft[r.id]?.menuId;
      if (!mid) continue;
      map.set(mid, (map.get(mid) || 0) + 1);
    }

    const out = Array.from(map.entries()).map(([menuId, count]) => {
      const title = this.menus.find((m) => m.id === menuId)?.title || 'Sin título';
      return { menuId, title, count };
    });

    out.sort((a, b) => b.count - a.count);
    return out;
  }

  // ============================================================
  // UI helpers
  // ============================================================
  residentLabel(r: Resident): string {
    const fn = (r.nombre || r.first_name || '').trim();
    const ln = (r.apellido || r.last_name || '').trim();
    const full = `${fn} ${ln}`.trim();
    const room = (r.habitacion || r.room || '').trim();
    return room ? `${full || `Residente #${r.id}`} · Hab ${room}` : full || `Residente #${r.id}`;
  }

  // ============================================================
  // Normalizadores (ACORDE BACKEND: usa menuJson)
  // ============================================================
  private normalizeAssignment(a: any): Assignment {
    const residentId = Number(a?.residentId ?? a?.resident_id ?? a?.residenteId ?? a?.residente_id);
    const weekStart = this.isoDateOnly(a?.weekStart ?? a?.week_start ?? this.weekStartIso);

    const menuIdRaw = a?.menuId ?? a?.menu_id ?? a?.menu ?? null;
    const menuId =
      menuIdRaw === null || menuIdRaw === undefined || menuIdRaw === '' ? null : Number(menuIdRaw);

    return {
      residentId,
      weekStart,
      menuId,
      dietType: String(a?.dietType ?? a?.diet_type ?? '').trim(),
      residentNotes: String(a?.residentNotes ?? a?.resident_notes ?? '').trim(),
    };
  }

  private normalizeMenu(m: any): KitchenMenu {
    const id = Number(m?.id);
    const title = String(m?.title ?? m?.titulo ?? `Semana ${this.weekStartIso}`).trim();
    const statusRaw = String(m?.status ?? m?.estado ?? 'draft').toLowerCase();
    const status: 'draft' | 'published' = statusRaw === 'published' ? 'published' : 'draft';

    // ✅ weekStart/weekEnd siempre YYYY-MM-DD
    const weekStart = this.isoDateOnly(m?.weekStart ?? m?.week_start ?? this.weekStartIso);
    const weekEnd = this.isoDateOnly(m?.weekEnd ?? m?.week_end ?? this.weekEndIso);

    const updatedAt =
      m?.updatedAt ?? m?.updated_at ?? m?.updatedAtISO ?? m?.updated_at_iso
        ? String(m?.updatedAt ?? m?.updated_at ?? m?.updatedAtISO ?? m?.updated_at_iso)
        : undefined;

    // ✅ Backend usa menuJson (puede venir string u objeto)
    let menuJson: any = m?.menuJson ?? m?.menu_json ?? null;
    if (typeof menuJson === 'string') {
      try {
        menuJson = JSON.parse(menuJson);
      } catch {
        menuJson = null;
      }
    }

    const grid = this.menuJsonToGrid(menuJson);

    return { id, title, status, weekStart, weekEnd, grid, updatedAt };
  }

  private normalizeCell(c: any): MenuCell {
    const base = this.defaultCell();
    if (!c || typeof c !== 'object') return base;

    const tags = Array.isArray(c.tags)
      ? c.tags.map((t: any) => String(t).trim()).filter(Boolean)
      : [];

    return {
      main: String(c.main ?? '').trim(),
      side: String(c.side ?? '').trim(),
      drink: String(c.drink ?? '').trim(),
      dessert: String(c.dessert ?? '').trim(),
      notes: String(c.notes ?? '').trim(),
      tags,
    };
  }

  // ============================================================
  // ✅ Conversión Backend menuJson ⇄ UI grid
  // ============================================================
  private mealKeyToBackend(meal: MealKey): 'desayuno' | 'almuerzo' | 'merienda' | 'cena' {
    if (meal === 'breakfast') return 'desayuno';
    if (meal === 'lunch') return 'almuerzo';
    if (meal === 'snack') return 'merienda';
    return 'cena';
  }

  private backendToMealKey(x: string): MealKey | null {
    const v = String(x || '').toLowerCase().trim();
    if (v === 'desayuno') return 'breakfast';
    if (v === 'almuerzo') return 'lunch';
    if (v === 'merienda') return 'snack';
    if (v === 'cena') return 'dinner';
    return null;
  }

  private menuJsonToGrid(menuJson: any): MenuGrid {
    const filled: MenuGrid = {};
    for (let di = 0; di < 7; di++) {
      for (const mt of this.mealTypes) {
        const k = this.cellKey(di, mt.key);
        filled[k] = this.defaultCell();
      }
    }

    if (!menuJson || typeof menuJson !== 'object') return filled;

    // Caso A) menuJson.grid ya viene como grid del frontend
    if (menuJson?.grid && typeof menuJson.grid === 'object') {
      const g = menuJson.grid;
      for (let di = 0; di < 7; di++) {
        for (const mt of this.mealTypes) {
          const k = this.cellKey(di, mt.key);
          const raw = g[k] ?? g[String(k)] ?? null;
          filled[k] = this.normalizeCell(raw);
        }
      }
      return filled;
    }

    // Caso B) schema kitchen-v1 (days[dayIndex].meals.desayuno/almuerzo/...)
    const days = Array.isArray(menuJson?.days) ? menuJson.days : [];
    for (const d of days) {
      const dayIndex = Number(d?.dayIndex);
      if (!Number.isFinite(dayIndex) || dayIndex < 0 || dayIndex > 6) continue;

      const meals = d?.meals && typeof d.meals === 'object' ? d.meals : {};
      for (const mealBackendKey of Object.keys(meals)) {
        const mk = this.backendToMealKey(mealBackendKey);
        if (!mk) continue;

        const k = this.cellKey(dayIndex, mk);
        filled[k] = this.normalizeCell(meals[mealBackendKey]);
      }
    }

    return filled;
  }

  private gridToMenuJson(grid: MenuGrid, weekStart: string): any {
    const ws = this.isoDateOnly(weekStart);

    const days = Array.from({ length: 7 }).map((_, dayIndex) => {
      const meals: any = {};
      for (const mt of this.mealTypes) {
        const bk = this.mealKeyToBackend(mt.key);
        const key = this.cellKey(dayIndex, mt.key);
        meals[bk] = this.normalizeCell(grid?.[key] || this.defaultCell());
      }

      const dateIso = this.addDaysIso(ws, dayIndex);
      return { dayIndex, dateIso, meals };
    });

    return {
      schema: 'kitchen-v1',
      weekStart: ws,
      mealKeys: ['desayuno', 'almuerzo', 'merienda', 'cena'],
      days,
    };
  }

  private addDaysIso(iso: string, days: number): string {
    const base = this.isoDateOnly(iso);
    const [y, m, d] = String(base || '').split('-').map((n) => Number(n));
    const dt = new Date(y, (m || 1) - 1, d || 1);
    dt.setDate(dt.getDate() + days);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }

  // ============================================================
  // Helpers internos
  // ============================================================
  private toMonday(date: Date): Date {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    d.setDate(d.getDate() + diff);
    return d;
  }

  // ✅ FIX DEFINITIVO: convierte cualquier formato a YYYY-MM-DD
  private isoDateOnly(v: any): string {
    try {
      if (v === null || v === undefined) return '';

      // Date object real
      if (v instanceof Date && !isNaN(v.getTime())) {
        return this.toIso(v);
      }

      const s = String(v ?? '').trim();
      if (!s) return '';

      // ✅ ISO directo o ISO que arranca con yyyy-mm-dd...
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

      // ✅ ISO con T
      if (/^\d{4}-\d{2}-\d{2}T/.test(s) && s.length >= 10) return s.slice(0, 10);

      // ✅ ISO con espacio
      if (/^\d{4}-\d{2}-\d{2}\s/.test(s) && s.length >= 10) return s.split(' ')[0];

      // ✅ Caso especial: "Mon Jan 12" o "Mon Jan 12 2026"
      const parts = s.split(/\s+/g).filter(Boolean);

      const weekdays = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
      const monthMap: Record<string, number> = {
        jan: 1,
        feb: 2,
        mar: 3,
        apr: 4,
        may: 5,
        jun: 6,
        jul: 7,
        aug: 8,
        sep: 9,
        oct: 10,
        nov: 11,
        dec: 12,
      };

      let idx = 0;
      if (parts[0] && weekdays.has(parts[0].toLowerCase())) idx = 1;

      const maybeMonth = parts[idx];
      const maybeDay = parts[idx + 1];
      const maybeYear = parts[idx + 2];

      const mm = monthMap[String(maybeMonth || '').toLowerCase()] || 0;
      const dd = Number(maybeDay);

      let yy = Number(maybeYear);
      if (!Number.isFinite(yy) || yy <= 1900) {
        yy = Number(String(this.weekStartIso || '').slice(0, 4)) || new Date().getFullYear();
      }

      if (mm >= 1 && mm <= 12 && Number.isFinite(dd) && dd >= 1 && dd <= 31) {
        return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      }

      // Último intento: Date.parse
      const t = Date.parse(s);
      if (!isNaN(t)) return this.toIso(new Date(t));

      return '';
    } catch {
      return '';
    }
  }

  private toIso(date: Date): string {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  }

  private fromIso(iso: string): Date {
    const [y, m, d] = iso.split('-').map((n) => Number(n));
    const dt = new Date(y, (m || 1) - 1, d || 1);
    dt.setHours(12, 0, 0, 0);
    return dt;
  }

  private dayLabel(i: number): string {
    const labels = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    return labels[i] || 'Día';
  }

  private cellKey(dayIndex: number, meal: MealKey): string {
    return `${dayIndex}:${meal}`;
  }

  private defaultCell(): MenuCell {
    return { main: '', side: '', drink: '', dessert: '', notes: '', tags: [] };
  }

  private cloneCell(c: MenuCell): MenuCell {
    return {
      main: c.main || '',
      side: c.side || '',
      drink: c.drink || '',
      dessert: c.dessert || '',
      notes: c.notes || '',
      tags: Array.isArray(c.tags) ? [...c.tags] : [],
    };
  }

  private cloneGrid(g: MenuGrid): MenuGrid {
    const out: MenuGrid = {};
    for (const k of Object.keys(g || {})) out[k] = this.cloneCell(g[k]);
    return out;
  }

  private cloneMenu(m: KitchenMenu): KitchenMenu {
    return {
      id: m.id,
      title: m.title,
      status: m.status,
      weekStart: m.weekStart,
      weekEnd: m.weekEnd,
      updatedAt: m.updatedAt,
      grid: this.cloneGrid(m.grid || {}),
    };
  }
}
