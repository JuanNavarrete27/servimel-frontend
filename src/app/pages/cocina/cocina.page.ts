// src/app/pages/cocina/cocina.page.ts
// ============================================================
// SERVIMEL — Cocina (BACKEND REAL)
// ✅ API_CONFIG.baseUrl (NO hardcode "/api")
// ✅ styleUrls (no styleUrl)
// ✅ unwrapApi unificado (core/utils/api-unwrap)
// ✅ NO ResidentesService (carga residentes por HttpClient /residentes)
// ✅ Robustez:
//    - Soporta respuestas {data}, {rows}, {items}, array directo
//    - Soporta menu.grid como objeto o JSON string
//    - Rellena celdas faltantes (7 días x 4 comidas)
// ✅ Envío/recepción REAL:
//    - GET    /cocina/menus?weekStart=YYYY-MM-DD
//    - GET    /cocina/menus/:id
//    - POST   /cocina/menus
//    - PUT    /cocina/menus/:id
//    - POST   /cocina/menus/:id/publish
//    - GET    /cocina/assignments?weekStart=YYYY-MM-DD
//    - PUT    /cocina/assignments
//    - GET    /cocina/viewer?residentId=ID&weekStart=YYYY-MM-DD
//    - GET    /residentes
// ============================================================

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
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
  weekEnd: string;   // yyyy-mm-dd
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

  canEditMenus = false;     // cocinero/admin
  canAssignMenus = false;   // admin/cocinero
  canPickResident = false;  // admin/medico/enfermeria

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

  // Draft editable (lo que el user modifica antes de guardar)
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

  // Loading counter para evitar “parpadeos”
  private loadingCount = 0;

  constructor(
    private http: HttpClient,
    private auth: AuthService
  ) {}

  // ============================================================
  // Computed simple para template
  // ============================================================
  get currentMenu(): KitchenMenu | null {
    return this.selectedMenuDraft || this.selectedMenu;
  }

  get roleLabel(): string {
    const r = String(this.role || 'user').trim();
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
  private initRole(): void {
    const fromAuth = this.tryReadRoleFromAuth();
    const fromLs = this.tryReadRoleFromLocalStorage();
    this.role = (fromAuth || fromLs || 'user') as Role;

    const rr = String(this.role || '').trim().toLowerCase().replace(/\s+/g, '_');
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
        (u?.rol || u?.role || anyAuth?.userRole || anyAuth?.role || anyAuth?.getRole?.() || anyAuth?.getUserRole?.() || '') as Role;

      return r || 'user';
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

    // si cambia la semana, cerramos modales de celda
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
    // Real: recarga todo lo dependiente de semana
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

      // si estamos en view y ya hay resident seleccionado
      if (this.viewerResidentId) await this.loadViewer();

      this.recomputeSummary();
    } catch {
      // errorMsg ya se setea dentro de los loaders
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
  // Residents (REAL) — GET /residentes
  // ============================================================
  private async loadResidents(): Promise<void> {
    this.errorMsg = '';
    this.setLoading(true);

    try {
      const url = `${API_CONFIG.baseUrl}/residentes`;
      const res = await firstValueFrom(this.http.get<ApiResponse<any>>(url));
      const data = unwrapApi<any>(res);

      const arr: any[] =
        Array.isArray(data) ? data :
        Array.isArray(data?.items) ? data.items :
        Array.isArray(data?.rows) ? data.rows :
        Array.isArray(data?.data) ? data.data :
        [];

      this.residents = (arr || []).map((r: any) => ({
        id: Number(r?.id),
        nombre: String(r?.nombre ?? r?.name ?? r?.first_name ?? '').trim(),
        habitacion: (String(r?.habitacion ?? r?.room ?? '').trim() || undefined) as any,
        first_name: r?.first_name,
        last_name: r?.last_name,
        apellido: r?.apellido,
        room: r?.room,
      })) as Resident[];

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
  // Menús (REAL)
  // ============================================================
  private async loadMenus(): Promise<void> {
    this.errorMsg = '';
    this.setLoading(true);

    try {
      const url = `${API_CONFIG.baseUrl}/cocina/menus?weekStart=${encodeURIComponent(this.weekStartIso)}`;
      const res = await firstValueFrom(this.http.get<ApiResponse<any>>(url));
      const un = unwrapApi<any>(res);

      const rows: any[] =
        Array.isArray(un) ? un :
        Array.isArray(un?.rows) ? un.rows :
        Array.isArray(un?.data) ? un.data :
        Array.isArray(un?.items) ? un.items :
        [];

      const mapped = (rows || []).map((m: any) => this.normalizeMenu(m));
      this.menus = mapped;

      // Mantener selección coherente
      if (!this.selectedMenuId) {
        if (this.menus.length) this.selectMenu(this.menus[0].id, false);
        else this.selectMenu(null, false);
      } else {
        // si la selección no existe en la semana, elegimos primero
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
      const url = `${API_CONFIG.baseUrl}/cocina/menus/${menuId}`;
      const res = await firstValueFrom(this.http.get<ApiResponse<any>>(url));
      const un = unwrapApi<any>(res);

      // soporta {menu} o objeto directo
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
  // Assignments (REAL)
  // ============================================================
  async loadAssignments(): Promise<void> {
    this.errorMsg = '';
    this.setLoading(true);

    try {
      const url = `${API_CONFIG.baseUrl}/cocina/assignments?weekStart=${encodeURIComponent(this.weekStartIso)}`;
      const res = await firstValueFrom(this.http.get<ApiResponse<any>>(url));
      const un = unwrapApi<any>(res);

      const rows: any[] =
        Array.isArray(un) ? un :
        Array.isArray(un?.rows) ? un.rows :
        Array.isArray(un?.data) ? un.data :
        Array.isArray(un?.items) ? un.items :
        [];

      this.assignments = (rows || []).map((a: any) => this.normalizeAssignment(a));
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
  // Viewer (REAL) — GET /cocina/viewer
  // ============================================================
  async loadViewer(): Promise<void> {
    if (!this.viewerResidentId) {
      this.viewerResult = null;
      return;
    }

    this.errorMsg = '';
    this.setLoading(true);

    try {
      const url =
        `${API_CONFIG.baseUrl}/cocina/viewer?residentId=${encodeURIComponent(this.viewerResidentId)}&weekStart=${encodeURIComponent(this.weekStartIso)}`;

      const res = await firstValueFrom(this.http.get<ApiResponse<any>>(url));
      const data = unwrapApi<any>(res) || res;

      const assignmentRaw = data?.assignment ?? data?.asignacion ?? null;
      const menuRaw = data?.menu ?? null;

      const assignment = assignmentRaw ? this.normalizeAssignment(assignmentRaw) : null;
      const menu = menuRaw ? this.normalizeMenu(menuRaw) : null;

      this.viewerResult = { assignment, menu };
    } catch {
      // fallback “inteligente” con datos ya cargados (sin mock inventado)
      const a =
        this.assignments.find((x) => x.residentId === this.viewerResidentId && x.weekStart === this.weekStartIso) || null;
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
        // sincronizar array
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

  async createMenu(): Promise<void> {
    if (!this.canEditMenus) return;

    this.saving = true;
    this.errorMsg = '';

    const payload = {
      title: (this.createDraft.title || '').trim() || `Semana ${this.createDraft.weekStart}`,
      weekStart: this.createDraft.weekStart,
      weekEnd: this.createDraft.weekEnd,
      duplicateFromMenuId: this.createDraft.duplicateFromMenuId || 0,
    };

    try {
      const url = `${API_CONFIG.baseUrl}/cocina/menus`;
      const res = await firstValueFrom(this.http.post<ApiResponse<any>>(url, payload));
      const un = unwrapApi<any>(res);

      const raw = un?.menu ?? un?.data ?? un ?? null;
      if (!raw) throw new Error('No menu returned');

      const created = this.normalizeMenu(raw);

      this.menus = [created, ...this.menus.filter((x) => x.id !== created.id)];
      this.selectMenu(created.id, false);
      this.createOpen = false;

      // recargar para quedar igual al server
      await this.loadMenus();
      await this.loadAssignments();
      if (this.viewerResidentId) await this.loadViewer();
      this.recomputeSummary();
    } catch {
      this.errorMsg = 'No se pudo crear el menú en el backend.';
    } finally {
      this.saving = false;
    }
  }

  async saveSelectedMenu(): Promise<void> {
    if (!this.canEditMenus) return;
    if (!this.selectedMenuId || !this.selectedMenuDraft) return;

    this.saving = true;
    this.errorMsg = '';

    // Asegurar que grid esté completo antes de enviar
    const payload = this.normalizeMenu(this.selectedMenuDraft);

    try {
      const url = `${API_CONFIG.baseUrl}/cocina/menus/${this.selectedMenuId}`;
      const res = await firstValueFrom(this.http.put<ApiResponse<any>>(url, payload));
      const un = unwrapApi<any>(res);

      const raw = un?.menu ?? un?.data ?? un ?? null;
      const saved = raw ? this.normalizeMenu(raw) : payload;

      this.selectedMenu = saved;
      this.selectedMenuDraft = this.cloneMenu(saved);
      this.menus = this.menus.map((m) => (m.id === saved.id ? saved : m));

      // server truth
      await this.loadMenus();
      this.recomputeSummary();
    } catch {
      this.errorMsg = 'No se pudo guardar el menú en el backend.';
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
      const url = `${API_CONFIG.baseUrl}/cocina/menus/${this.selectedMenuId}/publish`;
      const res = await firstValueFrom(this.http.post<ApiResponse<any>>(url, {}));
      const un = unwrapApi<any>(res);

      const raw = un?.menu ?? un?.data ?? un ?? null;
      const published = raw ? this.normalizeMenu(raw) : null;

      if (published) {
        this.selectedMenu = published;
        this.selectedMenuDraft = this.cloneMenu(published);
        this.menus = this.menus.map((m) => (m.id === published.id ? published : m));
      }

      // server truth
      await this.loadMenus();
      await this.loadAssignments();
      if (this.viewerResidentId) await this.loadViewer();
      this.recomputeSummary();
    } catch {
      this.errorMsg = 'No se pudo publicar el menú en el backend.';
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
    const menu = this.viewerResult?.menu ? this.viewerResult.menu : (this.selectedMenuDraft || this.selectedMenu);
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
      const url = `${API_CONFIG.baseUrl}/cocina/assignments`;
      await firstValueFrom(this.http.put<ApiResponse<any>>(url, { weekStart, rows }));
      // server truth
      await this.loadAssignments();
      if (this.viewerResidentId) await this.loadViewer();
      this.recomputeSummary();
    } catch {
      this.errorMsg = 'No se pudieron guardar asignaciones en el backend.';
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
  // Normalizadores (clave para “acorde al backend”)
  // ============================================================
  private normalizeAssignment(a: any): Assignment {
    // tolera snake_case/camelCase
    const residentId = Number(a?.residentId ?? a?.resident_id ?? a?.residenteId ?? a?.residente_id);
    const weekStart = String(a?.weekStart ?? a?.week_start ?? this.weekStartIso);
    const menuIdRaw = a?.menuId ?? a?.menu_id ?? a?.menu ?? null;

    const menuId = menuIdRaw === null || menuIdRaw === undefined || menuIdRaw === ''
      ? null
      : Number(menuIdRaw);

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
    const weekStart = String(m?.weekStart ?? m?.week_start ?? this.weekStartIso);
    const weekEnd = String(m?.weekEnd ?? m?.week_end ?? this.weekEndIso);
    const updatedAt = (m?.updatedAt ?? m?.updated_at ?? m?.updatedAtISO ?? m?.updated_at_iso) ? String(m?.updatedAt ?? m?.updated_at ?? m?.updatedAtISO ?? m?.updated_at_iso) : undefined;

    let grid: any = m?.grid ?? m?.menuGrid ?? m?.menu_grid ?? {};
    if (typeof grid === 'string') {
      try { grid = JSON.parse(grid); } catch { grid = {}; }
    }
    if (!grid || typeof grid !== 'object') grid = {};

    // rellena 7x4 y normaliza cada celda
    const filled: MenuGrid = {};
    for (let di = 0; di < 7; di++) {
      for (const mt of this.mealTypes) {
        const key = this.cellKey(di, mt.key);
        const cellRaw = grid[key] ?? grid?.[String(key)] ?? null;
        filled[key] = this.normalizeCell(cellRaw);
      }
    }

    return { id, title, status, weekStart, weekEnd, grid: filled, updatedAt };
  }

  private normalizeCell(c: any): MenuCell {
    const base = this.defaultCell();
    if (!c || typeof c !== 'object') return base;

    const tags = Array.isArray(c.tags) ? c.tags.map((t: any) => String(t).trim()).filter(Boolean) : [];

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
