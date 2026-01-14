// F9 — src/app/pages/ed-fisica/ed-fisica.page.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { API_CONFIG } from '../../core/config/api.config';
import { unwrapApi, ApiResponse } from '../../core/utils/api-unwrap';
import { AuthService } from '../../shared/services/auth.service';

// ============================================================
// SERVIMEL — Educación Física (REAL: /api/ed-fisica)
// Backend REAL NO tiene "sesiones": tiene
// ✅ GET  /api/ed-fisica/plans?residentId=&weekStart=YYYY-MM-DD
// ✅ POST /api/ed-fisica/plans
// ✅ PUT  /api/ed-fisica/plans/:id
// ✅ POST /api/ed-fisica/plans/:id/publish
// ✅ GET  /api/ed-fisica/logs?residentId=&weekStart=YYYY-MM-DD
// ✅ POST /api/ed-fisica/logs
//
// Este front adapta "sesiones" (UI) ↔ plan semanal + logs.
// ============================================================

type UserRole =
  | 'admin'
  | 'medico'
  | 'enfermeria'
  | 'entrenador_fisico'
  | 'edfisica'
  | 'profesor'
  | 'cocina'
  | 'user'
  | string;

type Intensity = 'suave' | 'moderada' | 'intensa';
type SessionStatus = 'pendiente' | 'cumplida' | 'omitida';

interface ResidentLite {
  id: number;
  nombre: string;
  habitacion?: string;
}

interface ExerciseLine {
  id?: number;
  nombre: string;
  series: number;
  repeticiones: number;
  descansoSeg: number;
  tempo?: string;
  indicaciones?: string;
}

interface EdFisicaSession {
  // 🔸 id sintético para trackBy (planId*10 + dayIndex)
  id: number;

  residentId: number;
  residentNombre: string;

  dateISO: string; // YYYY-MM-DD
  startTime?: string;
  durationMin?: number;

  objetivo: string;
  foco: 'fuerza' | 'movilidad' | 'cardio' | 'equilibrio' | 'rehab' | 'mixto';
  intensidad: Intensity;

  ejercicios: ExerciseLine[];
  notas?: string;

  creadoPorId?: number;
  creadoPorNombre?: string;

  status: SessionStatus;
  updatedAtISO?: string;

  // 🔸 extras para poder guardar contra backend real
  planId?: number | null;
  dayIndex?: number; // 0-6
}

interface EdFisicaKpi {
  total: number;
  pendientes: number;
  cumplidas: number;
  omitidas: number;
}

type EdfPlan = {
  id: number;
  residentId: number;
  weekStart: string;
  weekEnd: string;
  status: 'draft' | 'published';
  title?: string | null;
  days?: any[];
  updatedAt?: string;
};

type EdfLogRow = {
  id: number;
  residentId: number;
  dateIso: string;
  sessionType?: string;
  durationMin?: number;
  rpe?: number;
  mood?: string;
  pain?: string;
  notes?: string;
};

const EDF_API_PREFIX = '/api/ed-fisica';

@Component({
  selector: 'app-ed-fisica',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './ed-fisica.page.html',
  styleUrls: ['./ed-fisica.page.scss'],
})
export class EdFisicaPage implements OnInit {
  private fb = inject(FormBuilder);
  private http = inject(HttpClient);
  private auth = inject(AuthService) as any;

  // =============================
  // 🔐 Role / User
  // =============================
  role = signal<UserRole>('user');

  isEntrenadorFisico = computed(() => {
    const r = this.normalizeRole(this.role());
    return (
      r === 'entrenador_fisico' ||
      r === 'entrenador' ||
      r === 'entrenadorfisico' ||
      r === 'edfisica' ||
      r === 'profesor' ||
      r === 'admin'
    );
  });

  // =============================
  // UI State
  // =============================
  loading = signal<boolean>(false);
  saving = signal<boolean>(false);
  errorMsg = signal<string>('');

  // Filtros
  q = signal<string>('');
  filtroFoco = signal<'todos' | EdFisicaSession['foco']>('todos');
  filtroEstado = signal<'todos' | SessionStatus>('todos');
  filtroResidentId = signal<number | 'todos'>('todos');
  filtroDesdeISO = signal<string>(''); // YYYY-MM-DD
  filtroHastaISO = signal<string>(''); // YYYY-MM-DD

  // Datos
  residents = signal<ResidentLite[]>([]);
  sessions = signal<EdFisicaSession[]>([]);

  // Modal editor
  editorOpen = signal<boolean>(false);
  editorMode = signal<'create' | 'edit'>('create');
  editorId = signal<number | null>(null);

  // 🔸 contexto real para guardar (residentId + dateISO)
  editorCtx = signal<{ residentId: number; dateISO: string } | null>(null);

  // =============================
  // Form
  // =============================
  form!: FormGroup;

  ngOnInit(): void {
    this.initRoleUnified();
    this.buildForm();
    void this.bootstrapReal();
  }

  private async bootstrapReal(): Promise<void> {
    this.loading.set(true);
    this.errorMsg.set('');
    try {
      await this.loadResidentsUnified();
      await this.fetchSessionsUnified();
    } finally {
      this.loading.set(false);
    }
  }

  // =============================
  // API BASE (unificado)
  // =============================
  private apiBase(): string {
    const baseFromConfig = (API_CONFIG?.baseUrl || '').toString().trim();

    let override = '';
    try {
      override = localStorage.getItem('SERVIMEL_API_URL') || localStorage.getItem('apiUrl') || '';
    } catch {
      override = '';
    }

    const fromAuth = this.auth?.apiUrl || this.auth?.apiBaseUrl || this.auth?.baseUrl || '';
    return String(override || fromAuth || baseFromConfig || '').trim();
  }

  private joinUrl(base: string, path: string): string {
    const b = (base || '').replace(/\/+$/, '');
    const p = (path || '').replace(/^\/+/, '');
    if (!b) return `/${p}`;
    return `${b}/${p}`;
  }

  private unwrapLoose<T>(res: any): T {
    try {
      return unwrapApi<T>(res as ApiResponse<T>);
    } catch {
      return res as T;
    }
  }

  private is404(err: any): boolean {
    return Number(err?.status) === 404;
  }

  private is401or403(err: any): boolean {
    const s = Number(err?.status);
    return s === 401 || s === 403;
  }

  // =============================
  // Role Detection (unificado)
  // =============================
  private initRoleUnified(): void {
    const fromAuth: UserRole =
      (this.auth?.userRole as UserRole) ??
      (this.auth?.role as UserRole) ??
      (this.auth?.getRole?.() as UserRole) ??
      (this.auth?.getUserRole?.() as UserRole) ??
      (this.auth?.currentUser?.value?.role as UserRole) ??
      (this.auth?.currentUserValue?.role as UserRole) ??
      '';

    const fromLs = this.tryReadRoleFromLocalStorage();
    const chosen = (fromAuth || fromLs || 'user') as UserRole;
    this.role.set(chosen);
  }

  private tryReadRoleFromLocalStorage(): UserRole {
    try {
      const keys = ['servimel_user_v1', 'servimel_user', 'user', 'currentUser', 'auth_user'];
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;

        if (raw && raw.length < 80 && !raw.trim().startsWith('{')) return raw as UserRole;

        const obj = JSON.parse(raw);
        const cand =
          obj?.rol ??
          obj?.role ??
          obj?.user?.rol ??
          obj?.user?.role ??
          obj?.data?.rol ??
          obj?.data?.role ??
          null;

        if (typeof cand === 'string' && cand.trim()) return cand as UserRole;
      }
    } catch {
      // noop
    }
    return 'user';
  }

  private normalizeRole(r: any): string {
    return String(r || '').trim().toLowerCase().replace(/\s+/g, '_');
  }

  // =============================
  // Form Builder
  // =============================
  private buildForm(): void {
    this.form = this.fb.group({
      residentId: [null, [Validators.required]],
      dateISO: ['', [Validators.required]],
      startTime: [''],
      durationMin: [45, [Validators.min(10), Validators.max(180)]],

      objetivo: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(70)]],
      foco: ['mixto', [Validators.required]],
      intensidad: ['moderada', [Validators.required]],

      notas: [''],

      ejercicios: this.fb.array([]),
    });

    this.ensureMinExercises(3);
  }

  get ejerciciosFA(): FormArray {
    return this.form.get('ejercicios') as FormArray;
  }

  private newExerciseLine(seed?: Partial<ExerciseLine>): FormGroup {
    return this.fb.group({
      nombre: [seed?.nombre ?? '', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
      series: [seed?.series ?? 3, [Validators.required, Validators.min(1), Validators.max(12)]],
      repeticiones: [seed?.repeticiones ?? 10, [Validators.required, Validators.min(1), Validators.max(100)]],
      descansoSeg: [seed?.descansoSeg ?? 60, [Validators.required, Validators.min(0), Validators.max(600)]],
      tempo: [seed?.tempo ?? ''],
      indicaciones: [seed?.indicaciones ?? ''],
    });
  }

  addExercise(seed?: Partial<ExerciseLine>): void {
    this.ejerciciosFA.push(this.newExerciseLine(seed));
  }

  removeExercise(i: number): void {
    if (!this.isEntrenadorFisico()) return;
    if (this.ejerciciosFA.length <= 1) return;
    this.ejerciciosFA.removeAt(i);
  }

  private ensureMinExercises(min: number): void {
    while (this.ejerciciosFA.length < min) this.addExercise();
  }

  // =============================
  // ✅ RESIDENTES (API directa)
  // =============================
  private async loadResidentsUnified(): Promise<void> {
    this.errorMsg.set('');

    const base = this.apiBase();
    const url = this.joinUrl(base, '/residentes?limit=300&offset=0');

    const payload = await firstValueFrom(
      this.http.get<ApiResponse<any> | any>(url).pipe(map((x) => this.unwrapLoose<any>(x)))
    );

    const arr: any[] =
      Array.isArray(payload) ? payload :
      Array.isArray(payload?.items) ? payload.items :
      Array.isArray(payload?.data) ? payload.data :
      Array.isArray(payload?.residents) ? payload.residents :
      [];

    // ✅ FIX: armar nombre real (nombre + apellido / fullName / etc.)
    const mapped: ResidentLite[] = (arr || [])
      .map((r: any) => {
        const id = Number(r?.id ?? r?.residentId ?? r?.residenteId);
        if (!Number.isFinite(id)) return null;

        const first = String(
          r?.nombre ??
          r?.nombres ??
          r?.firstName ??
          r?.firstname ??
          r?.name ??
          ''
        ).trim();

        const last = String(
          r?.apellido ??
          r?.apellidos ??
          r?.lastName ??
          r?.lastname ??
          ''
        ).trim();

        const full = String(
          r?.fullName ??
          r?.full_name ??
          r?.nombreCompleto ??
          r?.nombre_completo ??
          ''
        ).trim();

        // si el backend trae "nombre" ya completo (ej "Residente 1"), igual priorizamos full/first+last si existen
        const nombre = (full || [first, last].filter(Boolean).join(' ')).trim() || `Residente #${id}`;

        const habitacion = String(r?.habitacion ?? r?.room ?? r?.room_number ?? '').trim() || '';

        return {
          id,
          nombre,
          habitacion: habitacion ? habitacion : undefined,
        } as ResidentLite;
      })
      .filter(Boolean) as ResidentLite[];

    this.residents.set(mapped);

    const current = this.filtroResidentId();
    if (current !== 'todos' && !mapped.some((x) => x.id === current)) {
      this.filtroResidentId.set('todos');
    }
  }

  // =============================
  // ✅ "SESIONES" UI ←→ PLAN + LOGS reales
  // =============================
  private pickWeekStart(): string {
    const ref = this.filtroDesdeISO().trim() || this.filtroHastaISO().trim() || this.toISODate(new Date());
    return this.toWeekStart(ref);
  }

  private async fetchSessionsUnified(): Promise<void> {
    this.errorMsg.set('');

    const base = this.apiBase();
    if (!base) {
      this.sessions.set([]);
      this.errorMsg.set('API baseUrl vacío. Revisá API_CONFIG.baseUrl.');
      return;
    }

    const weekStart = this.pickWeekStart();
    const rid = this.filtroResidentId();

    // ⚠️ Backend requiere residentId, así que:
    // - Si seleccionás un residente: 1 fetch (plan + logs)
    // - Si es "todos": agregamos por cada residente (cap para no matar el server)
    const targets: ResidentLite[] =
      rid === 'todos'
        ? (this.residents().slice(0, 40)) // cap defensivo
        : (this.residents().filter((r) => r.id === rid));

    if (!targets.length) {
      this.sessions.set([]);
      this.errorMsg.set('No hay residentes para consultar.');
      return;
    }

    try {
      const results = await Promise.allSettled(
        targets.map(async (r) => {
          const [plan, logs] = await Promise.all([
            this.fetchPlanReal(base, r.id, weekStart),
            this.fetchLogsReal(base, r.id, weekStart),
          ]);
          return this.mapPlanAndLogsToSessions(r, weekStart, plan, logs);
        })
      );

      const merged: EdFisicaSession[] = [];
      for (const res of results) {
        if (res.status === 'fulfilled') merged.push(...(res.value || []));
      }

      this.sessions.set(merged);

      // mensajes útiles si hay auth/roles
    } catch (err: any) {
      const msg = err?.error?.message ?? err?.message ?? '';
      this.errorMsg.set(msg ? `No se pudieron cargar datos. (${msg})` : 'No se pudieron cargar datos.');
    }
  }

  private async fetchPlanReal(base: string, residentId: number, weekStart: string): Promise<EdfPlan | null> {
    const url = this.joinUrl(
      base,
      `${EDF_API_PREFIX}/plans?residentId=${encodeURIComponent(String(residentId))}&weekStart=${encodeURIComponent(weekStart)}`
    );
    try {
      const payload = await firstValueFrom(
        this.http.get<ApiResponse<any> | any>(url).pipe(map((x) => this.unwrapLoose<any>(x)))
      );

      // controller responde: { ok:true, plan }
      const plan = payload?.plan ?? payload?.data?.plan ?? payload?.data ?? payload;
      if (!plan) return null;

      return plan as EdfPlan;
    } catch (err: any) {
      if (this.is401or403(err)) {
        this.errorMsg.set('Sin permisos para Educación Física (401/403). Revisá token y roles en ed-fisica.routes.js.');
      }
      if (this.is404(err)) return null; // si no existe plan o ruta (según backend)
      throw err;
    }
  }

  private async fetchLogsReal(base: string, residentId: number, weekStart: string): Promise<EdfLogRow[]> {
    const url = this.joinUrl(
      base,
      `${EDF_API_PREFIX}/logs?residentId=${encodeURIComponent(String(residentId))}&weekStart=${encodeURIComponent(weekStart)}`
    );
    try {
      const payload = await firstValueFrom(
        this.http.get<ApiResponse<any> | any>(url).pipe(map((x) => this.unwrapLoose<any>(x)))
      );

      // controller responde: { ok:true, rows }
      const rows = payload?.rows ?? payload?.data?.rows ?? payload?.data ?? payload;
      return Array.isArray(rows) ? (rows as EdfLogRow[]) : [];
    } catch (err: any) {
      if (this.is401or403(err)) {
        this.errorMsg.set('Sin permisos para logs de Ed-Física (401/403). Revisá token y roles.');
      }
      if (this.is404(err)) return [];
      throw err;
    }
  }

  private mapPlanAndLogsToSessions(
    r: ResidentLite,
    weekStart: string,
    plan: EdfPlan | null,
    logs: EdfLogRow[]
  ): EdFisicaSession[] {
    const logsByDate = new Map<string, EdfLogRow>();
    (logs || []).forEach((x) => {
      const d = String(x?.dateIso || '').slice(0, 10);
      if (d) logsByDate.set(d, x);
    });

    const planId = plan?.id ?? null;
    const days = Array.isArray(plan?.days) ? plan!.days : [];

    const safeFoco = (sessionType: any): EdFisicaSession['foco'] => {
      const x = String(sessionType || '').toLowerCase();
      if (x.includes('fuer')) return 'fuerza';
      if (x.includes('mov')) return 'movilidad';
      if (x.includes('car')) return 'cardio';
      if (x.includes('equ')) return 'equilibrio';
      if (x.includes('reh')) return 'rehab';
      return 'mixto';
    };

    const intensityFromRpe = (rpe: any): Intensity => {
      const n = Number(rpe);
      if (!Number.isFinite(n)) return 'moderada';
      if (n >= 8) return 'intensa';
      if (n <= 3) return 'suave';
      return 'moderada';
    };

    const sessions: EdFisicaSession[] = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const dateISO = this.addDays(weekStart, dayIndex);
      const day = days.find((d: any) => Number(d?.dayIndex) === dayIndex) || null;
      const log = logsByDate.get(dateISO) || null;

      const dayExercisesRaw = Array.isArray(day?.exercises) ? day.exercises : [];
      const ejercicios: ExerciseLine[] = dayExercisesRaw
        .map((ex: any) => {
          const nombre = String(ex?.name || '').trim();
          if (!nombre) return null;

          const series = Number(ex?.sets ?? 0);
          const repeticiones = Number(ex?.reps ?? 0);
          // No hay descanso en backend -> default razonable
          const descansoSeg = 60;

          return {
            nombre,
            series: Number.isFinite(series) ? series : 0,
            repeticiones: Number.isFinite(repeticiones) ? repeticiones : 0,
            descansoSeg,
            indicaciones: ex?.notes ? String(ex.notes) : '',
          } as ExerciseLine;
        })
        .filter(Boolean) as ExerciseLine[];

      const objetivo =
        (day?.title ? String(day.title) : '') ||
        (plan?.title ? String(plan.title) : '') ||
        'Sesión de Educación Física';

      const foco = safeFoco(day?.sessionType || log?.sessionType);
      const durationMin =
        Number.isFinite(Number(day?.durationTargetMin)) && Number(day.durationTargetMin) > 0
          ? Number(day.durationTargetMin)
          : (Number.isFinite(Number(log?.durationMin)) ? Number(log?.durationMin) : undefined);

      const notasPartes = [
        day?.goals ? `Objetivos: ${String(day.goals)}` : '',
        day?.contraindications ? `Contraindicaciones: ${String(day.contraindications)}` : '',
        log?.notes ? `Log: ${String(log.notes)}` : '',
      ].filter(Boolean);

      const status: SessionStatus =
        log ? 'cumplida' : 'pendiente';

      const intensidad: Intensity =
        log ? intensityFromRpe(log?.rpe) : 'moderada';

      const syntheticId =
        planId != null ? (Number(planId) * 10 + dayIndex) : (Number(r.id) * 10000 + dayIndex);

      sessions.push({
        id: syntheticId,
        residentId: r.id,
        residentNombre: r.nombre,
        dateISO,
        durationMin,
        objetivo,
        foco,
        intensidad,
        ejercicios,
        notas: notasPartes.join('\n'),
        creadoPorNombre: 'Ed-Física',
        status,
        updatedAtISO: (plan?.updatedAt || plan?.updatedAt || '').slice(0, 10) || undefined,
        planId,
        dayIndex,
      });
    }

    return sessions;
  }

  // =============================
  // Computed
  // =============================
  filteredSessions = computed(() => {
    const q = this.q().trim().toLowerCase();
    const foco = this.filtroFoco();
    const estado = this.filtroEstado();
    const rid = this.filtroResidentId();
    const desde = this.filtroDesdeISO().trim();
    const hasta = this.filtroHastaISO().trim();

    return this.sessions()
      .filter((s) => (foco === 'todos' ? true : s.foco === foco))
      .filter((s) => (estado === 'todos' ? true : s.status === estado))
      .filter((s) => (rid === 'todos' ? true : s.residentId === rid))
      .filter((s) => (desde ? s.dateISO >= desde : true))
      .filter((s) => (hasta ? s.dateISO <= hasta : true))
      .filter((s) => {
        if (!q) return true;
        const hay =
          s.residentNombre.toLowerCase().includes(q) ||
          s.objetivo.toLowerCase().includes(q) ||
          s.foco.toLowerCase().includes(q) ||
          (s.notas || '').toLowerCase().includes(q) ||
          (s.ejercicios || []).some((e) => e.nombre.toLowerCase().includes(q));
        return hay;
      })
      .sort((a, b) => {
        if (a.dateISO === b.dateISO) return (b.startTime || '').localeCompare(a.startTime || '');
        return b.dateISO.localeCompare(a.dateISO);
      });
  });

  kpis = computed<EdFisicaKpi>(() => {
    const list = this.filteredSessions();
    const total = list.length;
    const pendientes = list.filter((x) => x.status === 'pendiente').length;
    const cumplidas = list.filter((x) => x.status === 'cumplida').length;
    const omitidas = list.filter((x) => x.status === 'omitida').length;
    return { total, pendientes, cumplidas, omitidas };
  });

  nextSession = computed<EdFisicaSession | null>(() => {
    const today = this.toISODate(new Date());
    const upcoming = this.filteredSessions()
      .filter((s) => s.status === 'pendiente')
      .filter((s) => s.dateISO >= today)
      .sort((a, b) => {
        if (a.dateISO === b.dateISO) return (a.startTime || '').localeCompare(b.startTime || '');
        return a.dateISO.localeCompare(b.dateISO);
      });
    return upcoming.length ? upcoming[0] : null;
  });

  // =============================
  // UI Handlers
  // =============================
  setQ(v: string): void { this.q.set(v); }
  setFoco(v: any): void { this.filtroFoco.set(v); }
  setEstado(v: any): void { this.filtroEstado.set(v); }
  setResident(v: any): void { this.filtroResidentId.set(v === 'todos' ? 'todos' : Number(v)); }
  setDesde(v: string): void { this.filtroDesdeISO.set(v); }
  setHasta(v: string): void { this.filtroHastaISO.set(v); }

  clearFilters(): void {
    this.q.set('');
    this.filtroFoco.set('todos');
    this.filtroEstado.set('todos');
    this.filtroResidentId.set('todos');
    this.filtroDesdeISO.set('');
    this.filtroHastaISO.set('');
    void this.fetchSessionsUnified();
  }

  // =============================
  // CRUD (REAL)
  // Guardamos 1 día dentro del plan semanal (upsert plan)
  // =============================
  openCreate(): void {
    if (!this.isEntrenadorFisico()) return;

    this.editorMode.set('create');
    this.editorId.set(null);
    this.editorOpen.set(true);
    this.editorCtx.set(null);

    this.form.reset({
      residentId: null,
      dateISO: this.toISODate(new Date()),
      startTime: '',
      durationMin: 45,
      objetivo: '',
      foco: 'mixto',
      intensidad: 'moderada',
      notas: '',
    });

    while (this.ejerciciosFA.length) this.ejerciciosFA.removeAt(0);
    this.ensureMinExercises(3);
  }

  openEdit(s: EdFisicaSession): void {
    if (!this.isEntrenadorFisico()) return;

    this.editorMode.set('edit');
    this.editorId.set(s.id);
    this.editorOpen.set(true);
    this.editorCtx.set({ residentId: s.residentId, dateISO: s.dateISO });

    this.form.patchValue({
      residentId: s.residentId,
      dateISO: s.dateISO,
      startTime: s.startTime || '',
      durationMin: s.durationMin || 45,
      objetivo: s.objetivo,
      foco: s.foco,
      intensidad: s.intensidad,
      notas: s.notas || '',
    });

    while (this.ejerciciosFA.length) this.ejerciciosFA.removeAt(0);
    (s.ejercicios || []).forEach((ex) => this.addExercise(ex));
    this.ensureMinExercises(1);
  }

  closeEditor(): void {
    this.editorOpen.set(false);
  }

  async save(): Promise<void> {
    if (!this.isEntrenadorFisico()) return;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.errorMsg.set('');

    const base = this.apiBase();
    const residentId = Number(this.form.value.residentId);
    const dateISO = String(this.form.value.dateISO || '').slice(0, 10);

    if (!residentId || !dateISO) {
      this.errorMsg.set('Residente y fecha son requeridos.');
      this.saving.set(false);
      return;
    }

    const weekStart = this.toWeekStart(dateISO);
    const weekEnd = this.addDays(weekStart, 6);

    // dayIndex 0-6
    const dayIndex = this.diffDays(weekStart, dateISO);
    if (dayIndex < 0 || dayIndex > 6) {
      this.errorMsg.set('Fecha fuera de la semana calculada (bug).');
      this.saving.set(false);
      return;
    }

    const dayPayload = this.buildDayPayloadFromForm(dayIndex);

    try {
      const existing = await this.fetchPlanReal(base, residentId, weekStart);

      if (!existing) {
        // CREATE plan semanal
        const createPayload = {
          residentId,
          weekStart,
          weekEnd,
          status: 'draft',
          title: null,
          days: this.ensureSevenDays([], dayPayload),
        };

        await this.createPlanReal(base, createPayload);
      } else {
        // UPDATE plan semanal (backend bloquea si published)
        const updatePayload = {
          residentId,
          weekStart,
          weekEnd,
          status: 'draft',
          title: existing.title ?? null,
          days: this.ensureSevenDays(existing.days || [], dayPayload),
        };

        await this.updatePlanReal(base, existing.id, updatePayload);
      }

      this.editorOpen.set(false);
      await this.fetchSessionsUnified();
    } catch (err: any) {
      const msg = err?.error?.message ?? err?.message ?? '';
      this.errorMsg.set(msg ? `No se pudo guardar. (${msg})` : 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  async markStatus(s: EdFisicaSession, status: SessionStatus): Promise<void> {
    if (!this.isEntrenadorFisico()) return;

    // Backend real: status se refleja vía LOG (no hay PATCH)
    if (status === 'pendiente') {
      this.errorMsg.set('No hay endpoint para “volver a pendiente” (revertir log).');
      return;
    }

    this.saving.set(true);
    this.errorMsg.set('');

    try {
      const base = this.apiBase();
      const notes = status === 'omitida'
        ? `Omitida: ${s.objetivo || ''}`.trim()
        : `Cumplida: ${s.objetivo || ''}`.trim();

      await this.createLogReal(base, {
        residentId: s.residentId,
        dateIso: s.dateISO,
        sessionType: this.focoToSessionType(s.foco),
        durationMin: s.durationMin || 30,
        rpe: status === 'omitida' ? 1 : 6,
        mood: 'Normal',
        pain: 'No',
        notes,
      });

      await this.fetchSessionsUnified();
    } catch (err: any) {
      const msg = err?.error?.message ?? err?.message ?? '';
      this.errorMsg.set(msg ? `No se pudo actualizar estado. (${msg})` : 'No se pudo actualizar estado.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(s: EdFisicaSession): Promise<void> {
    if (!this.isEntrenadorFisico()) return;

    this.saving.set(true);
    this.errorMsg.set('');

    try {
      const base = this.apiBase();
      const weekStart = this.toWeekStart(s.dateISO);
      const weekEnd = this.addDays(weekStart, 6);
      const dayIndex = this.diffDays(weekStart, s.dateISO);

      const existing = await this.fetchPlanReal(base, s.residentId, weekStart);
      if (!existing) {
        this.errorMsg.set('No existe plan para esa semana (nada para borrar).');
        return;
      }

      const clearedDay = {
        dayIndex,
        title: '',
        sessionType: 'Mixto',
        durationTargetMin: 0,
        goals: '',
        contraindications: '',
        exercises: [],
      };

      const updatePayload = {
        residentId: s.residentId,
        weekStart,
        weekEnd,
        status: 'draft',
        title: existing.title ?? null,
        days: this.ensureSevenDays(existing.days || [], clearedDay),
      };

      await this.updatePlanReal(base, existing.id, updatePayload);
      await this.fetchSessionsUnified();
    } catch (err: any) {
      const msg = err?.error?.message ?? err?.message ?? '';
      this.errorMsg.set(msg ? `No se pudo eliminar. (${msg})` : 'No se pudo eliminar.');
    } finally {
      this.saving.set(false);
    }
  }

  // =============================
  // Backend calls (REAL)
  // =============================
  private async createPlanReal(base: string, body: any): Promise<void> {
    const url = this.joinUrl(base, `${EDF_API_PREFIX}/plans`);
    await firstValueFrom(this.http.post<ApiResponse<any> | any>(url, body).pipe(map((x) => this.unwrapLoose<any>(x))));
  }

  private async updatePlanReal(base: string, id: number, body: any): Promise<void> {
    const url = this.joinUrl(base, `${EDF_API_PREFIX}/plans/${id}`);
    await firstValueFrom(this.http.put<ApiResponse<any> | any>(url, body).pipe(map((x) => this.unwrapLoose<any>(x))));
  }

  private async createLogReal(base: string, body: any): Promise<void> {
    const url = this.joinUrl(base, `${EDF_API_PREFIX}/logs`);
    await firstValueFrom(this.http.post<ApiResponse<any> | any>(url, body).pipe(map((x) => this.unwrapLoose<any>(x))));
  }

  // =============================
  // Helpers: payload plan/day
  // =============================
  private focoToSessionType(foco: EdFisicaSession['foco']): string {
    switch (foco) {
      case 'fuerza': return 'Fuerza';
      case 'movilidad': return 'Movilidad';
      case 'cardio': return 'Cardio';
      case 'equilibrio': return 'Equilibrio';
      case 'rehab': return 'Rehab';
      default: return 'Mixto';
    }
  }

  private buildDayPayloadFromForm(dayIndex: number): any {
    const objetivo = String(this.form.value.objetivo || '').trim();
    const foco = this.form.value.foco as EdFisicaSession['foco'];
    const durationMin = Number(this.form.value.durationMin || 0) || 0;

    const notes = String(this.form.value.notas || '').trim();

    const exercises = Array.isArray(this.form.value.ejercicios)
      ? this.form.value.ejercicios.map((x: any) => ({
          name: String(x?.nombre || '').trim(),
          sets: Number(x?.series || 0),
          reps: Number(x?.repeticiones || 0),
          durationMin: 0,
          intensity: 'Moderada',
          notes: String(x?.indicaciones || '').trim(),
          tags: [],
        })).filter((x: any) => x.name)
      : [];

    return {
      dayIndex,
      title: objetivo || '',
      sessionType: this.focoToSessionType(foco),
      durationTargetMin: durationMin,
      goals: notes || '',
      contraindications: '',
      exercises,
    };
  }

  private ensureSevenDays(existingDays: any[], overrideDay: any): any[] {
    const base: any[] = [];
    const mapByIdx = new Map<number, any>();

    (Array.isArray(existingDays) ? existingDays : []).forEach((d: any) => {
      const idx = Number(d?.dayIndex);
      if (Number.isFinite(idx) && idx >= 0 && idx <= 6) mapByIdx.set(idx, d);
    });

    // override
    const oIdx = Number(overrideDay?.dayIndex);
    if (Number.isFinite(oIdx)) mapByIdx.set(oIdx, overrideDay);

    for (let i = 0; i < 7; i++) {
      const d = mapByIdx.get(i) || {
        dayIndex: i,
        title: '',
        sessionType: 'Mixto',
        durationTargetMin: 0,
        goals: '',
        contraindications: '',
        exercises: [],
      };

      base.push({
        dayIndex: i,
        title: String(d?.title || ''),
        sessionType: String(d?.sessionType || 'Mixto'),
        durationTargetMin: Number(d?.durationTargetMin || 0) || 0,
        goals: String(d?.goals || ''),
        contraindications: String(d?.contraindications || ''),
        exercises: Array.isArray(d?.exercises) ? d.exercises : [],
      });
    }

    return base;
  }

  // =============================
  // Utils
  // =============================
  trackById = (_: number, item: { id: number }) => item.id;
  trackByIdx = (i: number) => i;

  private toISODate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // Monday-based weekStart
  private toWeekStart(dateISO: string): string {
    const iso = String(dateISO || '').slice(0, 10);
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    const day = dt.getDay(); // 0 sun .. 6 sat
    const diffToMon = (day === 0 ? -6 : 1 - day);
    dt.setDate(dt.getDate() + diffToMon);
    return this.toISODate(dt);
  }

  private addDays(iso: string, days: number): string {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    dt.setDate(dt.getDate() + Number(days || 0));
    return this.toISODate(dt);
  }

  private diffDays(fromISO: string, toISO: string): number {
    const [y1, m1, d1] = String(fromISO).slice(0, 10).split('-').map(Number);
    const [y2, m2, d2] = String(toISO).slice(0, 10).split('-').map(Number);
    const a = new Date(y1, (m1 || 1) - 1, d1 || 1).getTime();
    const b = new Date(y2, (m2 || 1) - 1, d2 || 1).getTime();
    return Math.round((b - a) / 86400000);
  }
}
