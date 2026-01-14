// src/app/pages/yoga/yoga.page.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';

import { AuthService } from '../../shared/services/auth.service';

// ✅ BASE URL REAL (NO env.ts)
import { API_CONFIG } from '../../core/config/api.config';
// ✅ Unwrap estándar del proyecto (mismo patrón que ResidentesService)
import { unwrapApi, ApiResponse } from '../../core/utils/api-unwrap';

type Role =
  | 'admin'
  | 'medico'
  | 'enfermeria'
  | 'yoga'
  | 'profesor'
  | 'coordinacion'
  | 'sin-rol'
  | string;

type ResidentLite = {
  id: number;
  fullName: string;
  roomLabel?: string;
  isActive?: boolean;
  avatarUrl?: string;
  tags?: string[];
};

type ServiceItem = {
  id: number;
  title: string;
  description?: string;
  level?: 'suave' | 'medio' | 'intenso' | string;
  minutes?: number;
};

type YogaSequence = {
  id: string;
  name: string;
  tone: 'suave' | 'medio' | 'intenso';
  minutes: number;
  items: Array<{ itemId: number; title: string; minutes?: number }>;
  note?: string;
};

type YogaDaySession = {
  dateISO: string; // YYYY-MM-DD
  time?: string;   // HH:mm
  focus?: string;
  intensity?: 'suave' | 'medio' | 'intenso';
  minutes?: number;
  sequenceId?: string | null;
  notes?: string;
  completed?: boolean;
  completedAtISO?: string | null;
};

type YogaWeekPlan = {
  residentId: number;
  weekStartISO: string; // Monday YYYY-MM-DD
  updatedAtISO: string;
  days: YogaDaySession[]; // 7
};

type ResidentsApiResponse =
  | ResidentLite[]
  | { items?: any[]; data?: any[]; residents?: any[] };

type ServiciosYogaResponse =
  | { items?: any[]; data?: any[]; category?: any }
  | any[];

const LS_PLANS_KEY = 'svm_yoga_plans_v1';
const LS_SEQS_KEY  = 'svm_yoga_sequences_v1';

@Component({
  selector: 'app-yoga',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './yoga.page.html',
  styleUrls: ['./yoga.page.scss'],
})
export class YogaPage implements OnInit {
  private http = inject(HttpClient);
  private fb = inject(FormBuilder);
  private auth = inject(AuthService) as any;

  role: Role = 'sin-rol';
  canEdit = false;

  weekStart = this.startOfWeek(new Date()); // Monday
  get weekKey(): string {
    return this.isoDate(this.weekStart);
  }

  loadingResidents = false;
  loadingCatalog = false;
  errorMsg = '';

  residents: ResidentLite[] = [];
  search = '';
  residentFilter: 'todos' | 'con-plan' | 'sin-plan' = 'todos';
  activeResidentId: number | null = null;

  catalogItems: ServiceItem[] = [];
  catalogQuery = '';

  sequences: YogaSequence[] = [];
  private plans: Record<string, YogaWeekPlan> = {};

  editingDayIndex: number | null = null;

  dayForm = this.fb.group({
    time: ['08:30'],
    focus: ['Movilidad & Respiración', [Validators.required, Validators.maxLength(60)]],
    intensity: ['suave' as 'suave' | 'medio' | 'intenso'],
    minutes: [35, [Validators.min(10), Validators.max(120)]],
    sequenceId: [null as string | null],
    notes: ['', [Validators.maxLength(260)]],
  });

  ngOnInit(): void {
    this.detectRole();
    this.loadLocal();
    this.bootstrapDefaultSequencesIfEmpty();

    this.fetchResidents();
    this.fetchYogaCatalog();
  }

  // ============================================================
  // ✅ API BASE REAL (usa API_CONFIG.baseUrl)
  // - Mantiene override opcional por localStorage (para debug),
  //   pero por defecto pega al backend real.
  // ============================================================
  private apiBase(): string {
    // Preferimos SIEMPRE el config del proyecto
    const base = (API_CONFIG?.baseUrl || '').toString().trim();

    // Override opcional para debug (si alguien lo setea)
    let override = '';
    try {
      override =
        localStorage.getItem('SERVIMEL_API_URL') ||
        localStorage.getItem('apiUrl') ||
        '';
    } catch {
      override = '';
    }

    const fromAuth =
      this.auth?.apiUrl ||
      this.auth?.apiBaseUrl ||
      this.auth?.baseUrl ||
      '';

    return String(override || fromAuth || base || '').trim();
  }

  private joinUrl(base: string, path: string): string {
    const b = (base || '').replace(/\/+$/, '');
    const p = (path || '').replace(/^\/+/, '');
    if (!b) return `/${p}`;
    return `${b}/${p}`;
  }

  // =========================
  // ROLE
  // =========================
  private detectRole() {
    const fromAuth: Role =
      (this.auth?.userRole as Role) ??
      (this.auth?.role as Role) ??
      (this.auth?.getRole?.() as Role) ??
      (this.auth?.getUserRole?.() as Role) ??
      (this.auth?.currentUser?.value?.role as Role) ??
      (this.auth?.currentUserValue?.role as Role) ??
      'sin-rol';

    this.role = fromAuth || 'sin-rol';

    const EDIT_ROLES = new Set<string>(['admin', 'yoga', 'profesor', 'coordinacion', 'medico']);
    this.canEdit = EDIT_ROLES.has(String(this.role).toLowerCase());
  }

  // ============================================================
  // Helpers: parseo tolerante (API real puede devolver data envuelta)
  // ============================================================
  private pickArray(payload: any): any[] {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;

    // variantes comunes
    const a =
      payload?.items ??
      payload?.data ??
      payload?.residents ??
      payload?.rows ??
      payload?.results ??
      payload?.category?.items ??
      payload?.category?.data ??
      [];

    return Array.isArray(a) ? a : [];
  }

  // =========================
  // FETCH RESIDENTS (REALES)
  // =========================
  fetchResidents(): void {
    this.loadingResidents = true;
    this.errorMsg = '';

    const url = this.joinUrl(this.apiBase(), '/residentes?limit=200&offset=0');

    // ✅ intenta unwrap si viene como ApiResponse, y si no, usa respuesta cruda
    this.http
      .get<ApiResponse<any> | any>(url)
      .pipe(
        map((res: any) => {
          try {
            // si es ApiResponse, unwrapApi devuelve el data
            return unwrapApi<any>(res as ApiResponse<any>);
          } catch {
            // si NO es ApiResponse (o unwrap falla), devolvemos el raw
            return res;
          }
        })
      )
      .subscribe({
        next: (payload: ResidentsApiResponse | any) => {
          const rawArr = this.pickArray(payload);

          const mapped = (rawArr || [])
            .map((r: any) => this.mapResident(r))
            .filter((r: ResidentLite | null) => !!r) as ResidentLite[];

          mapped.sort((a, b) => Number(!!b.isActive) - Number(!!a.isActive));
          this.residents = mapped;

          if (this.activeResidentId == null && this.residents.length > 0) {
            this.activeResidentId = this.residents[0].id;
          }

          this.loadingResidents = false;
        },
        error: (err) => {
          this.loadingResidents = false;
          this.errorMsg = this.humanError(err, 'No se pudieron cargar residentes.');
        },
      });
  }

  private mapResident(r: any): ResidentLite | null {
    if (!r) return null;

    const id = Number(r.id ?? r.residentId ?? r.residenteId);
    if (!Number.isFinite(id)) return null;

    // backend /residentes a veces devuelve { nombre, habitacion, estado }
    const nombre = (r.nombre ?? '').toString().trim();
    const apellido = (r.apellido ?? '').toString().trim();

    const first = (r.first_name ?? r.firstName ?? nombre ?? '').toString().trim();
    const last  = (r.last_name ?? r.lastName ?? apellido ?? '').toString().trim();

    const fullName =
      (r.fullName ?? r.full_name ?? `${first} ${last}`.trim()).toString().trim() ||
      `Residente #${id}`;

    const room =
      (r.room ??
        r.habitacion ??
        r.room_number ??
        r.roomNumber ??
        r.room_label ??
        r.roomLabel ??
        '').toString().trim();

    // si no viene activo, asumimos true para UI
    const isActive = Boolean(r.is_active ?? r.isActive ?? r.activo ?? true);

    const avatarUrl =
      (r.avatar_url ?? r.avatarUrl ?? r.photo_url ?? r.photoUrl ?? '').toString().trim() || undefined;

    const tags: string[] = [];
    const estado = (r.estado ?? r.status ?? '').toString().trim();
    if (estado) tags.push(estado);

    const mobility = (r.mobility_level ?? r.mobilityLevel ?? '').toString().trim();
    if (mobility) tags.push(mobility);

    const risk = (r.fall_risk ?? r.fallRisk ?? '').toString().trim();
    if (risk) tags.push(`Riesgo: ${risk}`);

    return {
      id,
      fullName,
      roomLabel: room ? `Hab. ${room}` : undefined,
      isActive,
      avatarUrl,
      tags: tags.length ? tags : undefined,
    };
  }

  // =========================
  // FETCH CATALOG /servicios/yoga (REAL)
  // =========================
  fetchYogaCatalog(): void {
    this.loadingCatalog = true;
    this.errorMsg = '';

    const url = this.joinUrl(this.apiBase(), '/servicios/yoga');

    this.http
      .get<ApiResponse<any> | any>(url)
      .pipe(
        map((res: any) => {
          try {
            return unwrapApi<any>(res as ApiResponse<any>);
          } catch {
            return res;
          }
        })
      )
      .subscribe({
        next: (payload: ServiciosYogaResponse | any) => {
          const rawArr = this.pickArray(payload);

          const mapped = (rawArr || [])
            .map((it: any) => this.mapServiceItem(it))
            .filter((x: ServiceItem | null) => !!x) as ServiceItem[];

          this.catalogItems = mapped;
          this.loadingCatalog = false;

          this.rehydrateSequencesFromCatalog();
        },
        error: (err) => {
          this.loadingCatalog = false;
          // No bloquea uso local
          this.errorMsg = this.humanError(err, 'No se pudo cargar el catálogo de Yoga (servicios/yoga).');
        },
      });
  }

  private mapServiceItem(it: any): ServiceItem | null {
    if (!it) return null;

    const id = Number(it.id ?? it.itemId ?? it.service_item_id ?? it.serviceItemId);
    if (!Number.isFinite(id)) return null;

    const title = (it.title ?? it.name ?? it.nombre ?? it.label ?? `Item #${id}`).toString().trim();
    const description = (it.description ?? it.descripcion ?? '').toString().trim() || undefined;

    const level = (it.level ?? it.intensity ?? it.nivel ?? it.tone ?? '').toString().trim() || undefined;

    const minutesRaw = it.minutes ?? it.duration_minutes ?? it.durationMinutes ?? it.duration ?? it.minutos;
    const minutes = Number(minutesRaw);
    const m = Number.isFinite(minutes) ? minutes : undefined;

    return { id, title, description, level, minutes: m };
  }

  // =========================
  // DERIVED UI
  // =========================
  get activeResident(): ResidentLite | null {
    if (this.activeResidentId == null) return null;
    return this.residents.find(r => r.id === this.activeResidentId) ?? null;
  }

  get filteredResidents(): ResidentLite[] {
    const q = this.search.trim().toLowerCase();
    let list = this.residents;

    if (q) {
      list = list.filter(r =>
        r.fullName.toLowerCase().includes(q) ||
        String(r.id).includes(q) ||
        (r.roomLabel || '').toLowerCase().includes(q)
      );
    }

    if (this.residentFilter !== 'todos') {
      list = list.filter(r => {
        const has = this.hasPlan(r.id);
        return this.residentFilter === 'con-plan' ? has : !has;
      });
    }

    return list;
  }

  get filteredCatalog(): ServiceItem[] {
    const q = this.catalogQuery.trim().toLowerCase();
    if (!q) return this.catalogItems;
    return this.catalogItems.filter(i =>
      i.title.toLowerCase().includes(q) ||
      (i.description || '').toLowerCase().includes(q)
    );
  }

  // =========================
  // WEEK NAV
  // =========================
  prevWeek(): void {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() - 7);
    this.weekStart = this.startOfWeek(d);
    this.closeEditor();
  }

  nextWeek(): void {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() + 7);
    this.weekStart = this.startOfWeek(d);
    this.closeEditor();
  }

  goThisWeek(): void {
    this.weekStart = this.startOfWeek(new Date());
    this.closeEditor();
  }

  weekRangeLabel(): string {
    const start = new Date(this.weekStart);
    const end = new Date(this.weekStart);
    end.setDate(end.getDate() + 6);

    const fmt = (d: Date) =>
      d.toLocaleDateString('es-UY', { day: '2-digit', month: 'short' });

    const y = start.getFullYear();
    return `${fmt(start)} – ${fmt(end)} ${y}`;
  }

  // =========================
  // PLAN STORAGE
  // =========================
  private planKey(residentId: number): string {
    return `${residentId}__${this.weekKey}`;
  }

  private ensurePlan(residentId: number): YogaWeekPlan {
    const key = this.planKey(residentId);
    const existing = this.plans[key];
    if (existing && Array.isArray(existing.days) && existing.days.length === 7) return existing;

    const days = this.buildWeekDays(this.weekStart).map(dateISO => ({
      dateISO,
      time: '08:30',
      focus: 'Movilidad & Respiración',
      intensity: 'suave' as const,
      minutes: 35,
      sequenceId: null,
      notes: '',
      completed: false,
      completedAtISO: null,
    }));

    const plan: YogaWeekPlan = {
      residentId,
      weekStartISO: this.weekKey,
      updatedAtISO: new Date().toISOString(),
      days,
    };

    this.plans[key] = plan;
    this.persistPlans();
    return plan;
  }

  getActivePlan(): YogaWeekPlan | null {
    if (this.activeResidentId == null) return null;
    return this.ensurePlan(this.activeResidentId);
  }

  hasPlan(residentId: number): boolean {
    const key = this.planKey(residentId);
    const p = this.plans[key];
    return !!(p && p.days && p.days.some(d => (d.sequenceId || d.notes || d.focus) && (d.minutes || 0) > 0));
  }

  // =========================
  // EDITOR
  // =========================
  openDayEditor(dayIndex: number): void {
    if (!this.canEdit) return;
    const plan = this.getActivePlan();
    if (!plan) return;

    const day = plan.days[dayIndex];
    if (!day) return;

    this.editingDayIndex = dayIndex;

    this.dayForm.setValue({
      time: day.time || '08:30',
      focus: day.focus || 'Movilidad & Respiración',
      intensity: (day.intensity || 'suave') as any,
      minutes: Number(day.minutes || 35),
      sequenceId: (day.sequenceId ?? null) as any,
      notes: day.notes || '',
    });
  }

  closeEditor(): void {
    this.editingDayIndex = null;
  }

  saveDay(): void {
    const plan = this.getActivePlan();
    if (!plan) return;
    if (this.editingDayIndex == null) return;
    if (this.dayForm.invalid) {
      this.dayForm.markAllAsTouched();
      return;
    }

    const idx = this.editingDayIndex;
    const current = plan.days[idx];
    if (!current) return;

    const v = this.dayForm.value;

    current.time = String(v.time || '08:30');
    current.focus = String(v.focus || 'Movilidad & Respiración');
    current.intensity = (v.intensity || 'suave') as any;
    current.minutes = Number(v.minutes || 35);
    current.sequenceId = (v.sequenceId ?? null) as any;
    current.notes = String(v.notes || '');

    plan.updatedAtISO = new Date().toISOString();
    this.persistPlans();
    this.closeEditor();
  }

  toggleCompleted(dayIndex: number): void {
    const plan = this.getActivePlan();
    if (!plan) return;
    const day = plan.days[dayIndex];
    if (!day) return;

    const next = !day.completed;
    day.completed = next;
    day.completedAtISO = next ? new Date().toISOString() : null;

    plan.updatedAtISO = new Date().toISOString();
    this.persistPlans();
  }

  clearDay(dayIndex: number): void {
    const plan = this.getActivePlan();
    if (!plan) return;
    const day = plan.days[dayIndex];
    if (!day) return;

    day.time = '08:30';
    day.focus = 'Movilidad & Respiración';
    day.intensity = 'suave';
    day.minutes = 35;
    day.sequenceId = null;
    day.notes = '';
    day.completed = false;
    day.completedAtISO = null;

    plan.updatedAtISO = new Date().toISOString();
    this.persistPlans();
  }

  // =========================
  // SEQUENCES
  // =========================
  sequenceById(id: string | null | undefined): YogaSequence | null {
    if (!id) return null;
    return this.sequences.find(s => s.id === id) ?? null;
  }

  addQuickSequenceFromCatalog(item: ServiceItem): void {
    if (!this.canEdit) return;

    const seq: YogaSequence = {
      id: `seq_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      name: `Flow: ${item.title}`,
      tone: (item.level as any) || 'suave',
      minutes: item.minutes ?? 30,
      items: [{ itemId: item.id, title: item.title, minutes: item.minutes }],
      note: item.description,
    };

    this.sequences = [seq, ...this.sequences];
    this.persistSequences();
  }

  deleteSequence(id: string): void {
    if (!this.canEdit) return;

    this.sequences = this.sequences.filter(s => s.id !== id);
    this.persistSequences();

    const plan = this.getActivePlan();
    if (!plan) return;

    plan.days.forEach(d => {
      if (d.sequenceId === id) d.sequenceId = null;
    });
    plan.updatedAtISO = new Date().toISOString();
    this.persistPlans();
  }

  private rehydrateSequencesFromCatalog(): void {
    if (!this.catalogItems.length || !this.sequences.length) return;

    const byId = new Map<number, ServiceItem>();
    this.catalogItems.forEach(i => byId.set(i.id, i));

    this.sequences = this.sequences.map(s => ({
      ...s,
      items: s.items.map(it => {
        if (it.title && it.title.trim()) return it;
        const found = byId.get(it.itemId);
        return {
          ...it,
          title: found?.title ?? `Item #${it.itemId}`,
          minutes: it.minutes ?? found?.minutes,
        };
      }),
    }));

    this.persistSequences();
  }

  private bootstrapDefaultSequencesIfEmpty(): void {
    if (this.sequences.length) return;

    this.sequences = [
      {
        id: 'seq_default_zen',
        name: 'Zen Reset (Suave)',
        tone: 'suave',
        minutes: 25,
        items: [
          { itemId: 1, title: 'Respiración 4-6', minutes: 5 },
          { itemId: 2, title: 'Movilidad cervical y hombros', minutes: 6 },
          { itemId: 3, title: 'Estiramiento posterior (suave)', minutes: 6 },
          { itemId: 4, title: 'Relajación guiada', minutes: 8 },
        ],
        note: 'Ideal para iniciar semana o residentes con cansancio / dolor leve.',
      },
      {
        id: 'seq_default_mobility',
        name: 'Flow Movilidad (Medio)',
        tone: 'medio',
        minutes: 35,
        items: [
          { itemId: 5, title: 'Calentamiento articular', minutes: 6 },
          { itemId: 6, title: 'Saludo al Sol adaptado', minutes: 12 },
          { itemId: 7, title: 'Equilibrio y core', minutes: 8 },
          { itemId: 8, title: 'Estiramientos finales', minutes: 9 },
        ],
        note: 'Mejora rango articular + estabilidad.',
      },
      {
        id: 'seq_default_strength',
        name: 'Estabilidad & Fuerza (Intenso)',
        tone: 'intenso',
        minutes: 45,
        items: [
          { itemId: 9, title: 'Activación (core + glúteo)', minutes: 8 },
          { itemId: 10, title: 'Guerreros (progresión)', minutes: 14 },
          { itemId: 11, title: 'Plancha y variaciones', minutes: 10 },
          { itemId: 12, title: 'Enfriamiento + respiración', minutes: 13 },
        ],
        note: 'Para residentes aptos / con supervisión.',
      },
    ];

    this.persistSequences();
  }

  // =========================
  // LOCAL LOAD/SAVE
  // =========================
  private loadLocal(): void {
    try {
      const rawPlans = localStorage.getItem(LS_PLANS_KEY);
      this.plans = rawPlans ? JSON.parse(rawPlans) : {};
    } catch { this.plans = {}; }

    try {
      const rawSeqs = localStorage.getItem(LS_SEQS_KEY);
      this.sequences = rawSeqs ? JSON.parse(rawSeqs) : [];
    } catch { this.sequences = []; }
  }

  private persistPlans(): void {
    try { localStorage.setItem(LS_PLANS_KEY, JSON.stringify(this.plans)); } catch {}
  }

  private persistSequences(): void {
    try { localStorage.setItem(LS_SEQS_KEY, JSON.stringify(this.sequences)); } catch {}
  }

  // =========================
  // UI HELPERS
  // =========================
  trackById(_: number, x: { id: any }): any { return x.id; }
  trackByIndex(i: number): number { return i; }

  selectResident(id: number): void {
    this.activeResidentId = id;
    this.closeEditor();
    this.ensurePlan(id);
  }

  dayLabel(dayISO: string): string {
    const d = new Date(`${dayISO}T00:00:00`);
    return d.toLocaleDateString('es-UY', { weekday: 'short' });
  }

  dayNumber(dayISO: string): string {
    const d = new Date(`${dayISO}T00:00:00`);
    return d.toLocaleDateString('es-UY', { day: '2-digit' });
  }

  toneClass(t: any): string {
    const v = String(t || '').toLowerCase();
    if (v.includes('int')) return 'tone--intenso';
    if (v.includes('med')) return 'tone--medio';
    return 'tone--suave';
  }

  planStats(plan: YogaWeekPlan | null): { planned: number; done: number; minutes: number } {
    if (!plan) return { planned: 0, done: 0, minutes: 0 };
    const planned = plan.days.filter(d => (d.minutes || 0) > 0).length;
    const done = plan.days.filter(d => !!d.completed).length;
    const minutes = plan.days.reduce((acc, d) => acc + Number(d.minutes || 0), 0);
    return { planned, done, minutes };
  }

  // =========================
  // DATE HELPERS
  // =========================
  private buildWeekDays(weekStart: Date): string[] {
    const base = new Date(weekStart);
    const out: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      out.push(this.isoDate(d));
    }
    return out;
  }

  private startOfWeek(d: Date): Date {
    const x = new Date(d);
    const day = x.getDay(); // 0 sunday
    const diff = (day === 0 ? -6 : 1) - day; // monday
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() + diff);
    return x;
  }

  private isoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  }

  private humanError(err: any, fallback: string): string {
    const status = err?.status ? `HTTP ${err.status}` : '';
    const msg = err?.error?.message ?? err?.message ?? err?.statusText ?? '';
    const extra = [status, msg].filter(Boolean).join(' • ');
    return extra ? `${fallback} (${extra})` : fallback;
  }
}
