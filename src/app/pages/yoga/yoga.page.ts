// src/app/pages/yoga/yoga.page.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';

import { AuthService } from '../../shared/services/auth.service';
import { API_CONFIG } from '../../core/config/api.config';
import { unwrapApi, ApiResponse } from '../../core/utils/api-unwrap';

type Role =
  | 'admin'
  | 'medico'
  | 'enfermeria'
  | 'yoga'
  | 'profesor'
  | 'coordinacion'
  | 'instructor'
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
  dateISO: string;
  time?: string;
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
  weekStartISO: string;
  updatedAtISO: string;
  days: YogaDaySession[];
};

type ResidentsApiResponse = ResidentLite[] | { items?: any[]; data?: any[]; residents?: any[] };
type ServiciosYogaResponse = { items?: any[]; data?: any[]; category?: any } | any[];

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
  private cdr = inject(ChangeDetectorRef);

  role: Role = 'sin-rol';
  canEdit = false;

  weekStart = this.startOfWeek(new Date());
  get weekKey(): string {
    return this.isoDate(this.weekStart);
  }

  loadingResidents = false;
  loadingCatalog = false;
  loadingPlan = false;
  savingPlan = false;
  loadingSequences = false;

  errorMsg = '';
  infoMsg = '';

  residents: ResidentLite[] = [];
  search = '';
  residentFilter: 'todos' | 'con-plan' | 'sin-plan' = 'todos';
  activeResidentId: number | null = null;

  catalogItems: ServiceItem[] = [];
  catalogQuery = '';

  sequences: YogaSequence[] = [];

  activePlan: YogaWeekPlan | null = null;

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
    this.detectRoleSyncStable();

    this.fetchResidents();
    this.fetchYogaCatalog();
    this.fetchSequences();

    queueMicrotask(() => {
      this.detectRoleSyncStable();
      this.cdr.detectChanges();
    });
  }

  // ============================================================
  // ✅ API BASE REAL
  // ============================================================
  private apiBase(): string {
    const base = (API_CONFIG?.baseUrl || '').toString().trim();

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

  private endpoint(path: string): string {
    const clean = (path || '').trim();
    const normalized = clean.startsWith('/') ? clean : `/${clean}`;
    return this.joinUrl(this.apiBase(), normalized);
  }

  // ============================================================
  // ROLE
  // ============================================================
  private detectRoleSyncStable(): void {
    const normalize = (r: any) =>
      String(r || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');

    const fromAuth: Role =
      (this.auth?.userRole as Role) ??
      (this.auth?.role as Role) ??
      (this.auth?.getRole?.() as Role) ??
      (this.auth?.getUserRole?.() as Role) ??
      (this.auth?.currentUser?.value?.role as Role) ??
      (this.auth?.currentUserValue?.role as Role) ??
      (this.auth?.currentUser?.value?.rol as Role) ??
      (this.auth?.currentUserValue?.rol as Role) ??
      'sin-rol';

    let fromLS: Role = 'sin-rol';
    try {
      const raw =
        localStorage.getItem('servimel_user_v1') ||
        localStorage.getItem('servimel_user') ||
        localStorage.getItem('user') ||
        localStorage.getItem('currentUser') ||
        '';

      if (raw) {
        const parsed = JSON.parse(raw);
        fromLS = (parsed?.role || parsed?.rol || parsed?.userRole || 'sin-rol') as Role;
      }
    } catch {}

    const detected = normalize(fromAuth || fromLS || 'sin-rol') || 'sin-rol';
    this.role = detected;

    const EDIT_ROLES = new Set<string>([
      'admin',
      'instructor',
      'yoga',
      'profesor',
      'coordinacion',
      'medico',
    ]);

    this.canEdit = EDIT_ROLES.has(detected);
  }

  // ============================================================
  // Helpers: parseo tolerante
  // ============================================================
  private pickArray(payload: any): any[] {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;

    const a =
      payload?.items ??
      payload?.data ??
      payload?.residents ??
      payload?.rows ??
      payload?.results ??
      payload?.category?.items ??
      payload?.category?.data ??
      payload?.data?.items ??
      payload?.data?.data ??
      payload?.data?.residents ??
      [];

    return Array.isArray(a) ? a : [];
  }

  // ✅ FIX: soporta wrappers PROFUNDOS
  private pickPlan(payload: any): YogaWeekPlan | null {
    if (!payload) return null;

    // 1) plano
    if (payload?.residentId && payload?.weekStartISO && Array.isArray(payload?.days)) {
      return payload as YogaWeekPlan;
    }

    // 2) wrappers comunes
    const candidates = [
      payload?.plan,
      payload?.data,
      payload?.item,

      payload?.data?.plan,
      payload?.data?.data,
      payload?.data?.item,

      payload?.data?.plan?.plan,
      payload?.data?.data?.plan,
      payload?.data?.item?.plan,
    ].filter(Boolean);

    for (const c of candidates) {
      if (c?.residentId && c?.weekStartISO && Array.isArray(c?.days)) return c as YogaWeekPlan;
      if (c?.plan?.residentId && c?.plan?.weekStartISO && Array.isArray(c?.plan?.days)) return c.plan as YogaWeekPlan;
    }

    return null;
  }

  // ============================================================
  // FETCH RESIDENTS
  // ============================================================
  fetchResidents(): void {
    this.loadingResidents = true;
    this.errorMsg = '';

    const url = this.endpoint('/residentes?limit=200&offset=0');

    this.http
      .get<ApiResponse<any> | any>(url)
      .pipe(
        map((res: any) => {
          try {
            return unwrapApi<any>(res as ApiResponse<any>);
          } catch {
            return res;
          }
        }),
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
            this.fetchWeekPlanForActiveResident();
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

    const nombre = (r.nombre ?? '').toString().trim();
    const apellido = (r.apellido ?? '').toString().trim();

    const first = (r.first_name ?? r.firstName ?? nombre ?? '').toString().trim();
    const last = (r.last_name ?? r.lastName ?? apellido ?? '').toString().trim();

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
        '')
        .toString()
        .trim();

    const isActive = Boolean(r.is_active ?? r.isActive ?? r.activo ?? true);

    const avatarUrl =
      (r.avatar_url ?? r.avatarUrl ?? r.photo_url ?? r.photoUrl ?? '').toString().trim() ||
      undefined;

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

  // ============================================================
  // FETCH CATALOG
  // ============================================================
  fetchYogaCatalog(): void {
    this.loadingCatalog = true;
    this.errorMsg = '';

    const url = this.endpoint('/servicios/yoga');

    this.http
      .get<ApiResponse<any> | any>(url)
      .pipe(
        map((res: any) => {
          try {
            return unwrapApi<any>(res as ApiResponse<any>);
          } catch {
            return res;
          }
        }),
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

    const level =
      (it.level ?? it.intensity ?? it.nivel ?? it.tone ?? '').toString().trim() || undefined;

    const minutesRaw =
      it.minutes ?? it.duration_minutes ?? it.durationMinutes ?? it.duration ?? it.minutos;
    const minutes = Number(minutesRaw);
    const m = Number.isFinite(minutes) ? minutes : undefined;

    return { id, title, description, level, minutes: m };
  }

  // ============================================================
  // SEQUENCES
  // ============================================================
  async fetchSequences(): Promise<void> {
    this.loadingSequences = true;
    this.errorMsg = '';

    const url = this.endpoint('/yoga/sequences?limit=200');

    try {
      const raw = await firstValueFrom(
        this.http.get<ApiResponse<any> | any>(url).pipe(
          map((res: any) => {
            try {
              return unwrapApi<any>(res as ApiResponse<any>);
            } catch {
              return res;
            }
          }),
        ),
      );

      const arr = this.pickArray(raw);
      const mapped = (arr || [])
        .map((x: any) => this.mapSequence(x))
        .filter(Boolean) as YogaSequence[];

      this.sequences = mapped;
    } catch (err: any) {
      console.warn('[YOGA] fetchSequences error:', err);
    } finally {
      this.loadingSequences = false;
      this.cdr.detectChanges();
    }
  }

  private mapSequence(x: any): YogaSequence | null {
    if (!x) return null;

    const idNum = Number(x.id ?? x.sequenceId);
    const id = Number.isFinite(idNum) ? String(idNum) : String(x.id ?? '').trim();
    if (!id) return null;

    const name = String(x.name ?? x.title ?? 'Secuencia').trim() || `Secuencia ${id}`;

    const toneRaw = String(x.tone ?? x.level ?? 'suave').toLowerCase().trim();
    const tone =
      toneRaw.includes('int') ? 'intenso' : toneRaw.includes('med') ? 'medio' : 'suave';

    const minutes = Number(x.minutes ?? 30);
    const m = Number.isFinite(minutes) ? minutes : 30;

    const items = Array.isArray(x.items)
      ? x.items.map((it: any) => ({
          itemId: Number(it.itemId ?? it.id ?? 0),
          title: String(it.title ?? it.name ?? 'Item').trim(),
          minutes: it.minutes == null ? undefined : Number(it.minutes),
        }))
      : [];

    const note = x.note ? String(x.note) : undefined;

    return { id, name, tone, minutes: m, items, note };
  }

  // ============================================================
  // WEEK PLAN
  // ============================================================
  private async fetchWeekPlanForActiveResident(): Promise<void> {
    if (this.activeResidentId == null) return;

    this.loadingPlan = true;
    this.errorMsg = '';
    this.infoMsg = '';

    const residentId = this.activeResidentId;
    const weekStartISO = this.weekKey;

    const url = this.endpoint(
      `/yoga/plans/${encodeURIComponent(residentId)}?weekStart=${encodeURIComponent(weekStartISO)}`,
    );

    try {
      const raw = await firstValueFrom(
        this.http.get<ApiResponse<any> | any>(url).pipe(
          map((res: any) => {
            try {
              return unwrapApi<any>(res as ApiResponse<any>);
            } catch {
              return res;
            }
          }),
        ),
      );

      const plan = this.pickPlan(raw);

      if (plan) {
        this.activePlan = this.normalizePlan(plan, residentId, weekStartISO);
      } else {
        const fresh = this.buildEmptyPlan(residentId, weekStartISO);
        this.activePlan = fresh;
        await this.saveActivePlan(true);
      }
    } catch (err: any) {
      const status = err?.status;

      if (status === 404) {
        const fresh = this.buildEmptyPlan(residentId, weekStartISO);
        this.activePlan = fresh;

        try {
          await this.saveActivePlan(true);
        } catch {}
      } else {
        this.errorMsg = this.humanError(err, 'No se pudo cargar el plan semanal real.');
      }
    } finally {
      this.loadingPlan = false;
      this.cdr.detectChanges();
    }
  }

  private normalizePlan(plan: YogaWeekPlan, residentId: number, weekStartISO: string): YogaWeekPlan {
    const daysExpected = this.buildWeekDays(this.weekStart);

    const mapByDate = new Map<string, YogaDaySession>();
    (plan?.days || []).forEach((d: any) => {
      if (d?.dateISO) mapByDate.set(String(d.dateISO), d);
      // 🛟 si te llegara "date" en vez de dateISO por algo raro:
      if (!d?.dateISO && d?.date) mapByDate.set(String(d.date), { ...d, dateISO: String(d.date) });
    });

    const days = daysExpected.map((dateISO) => {
      const existing = mapByDate.get(dateISO);

      if (existing) {
        return {
          dateISO,
          time: existing.time || '08:30',
          focus: existing.focus || 'Movilidad & Respiración',
          intensity: (existing.intensity || 'suave') as any,
          minutes: Number(existing.minutes ?? 35),
          sequenceId: existing.sequenceId != null ? String(existing.sequenceId) : null,
          notes: existing.notes || '',
          completed: !!existing.completed,
          completedAtISO: existing.completedAtISO ?? null,
        };
      }

      return {
        dateISO,
        time: '08:30',
        focus: 'Movilidad & Respiración',
        intensity: 'suave',
        minutes: 35,
        sequenceId: null,
        notes: '',
        completed: false,
        completedAtISO: null,
      };
    });

    return {
      residentId: Number((plan as any).residentId ?? residentId),
      weekStartISO: String((plan as any).weekStartISO ?? weekStartISO),
      updatedAtISO: String((plan as any).updatedAtISO ?? new Date().toISOString()),
      days,
    };
  }

  private buildEmptyPlan(residentId: number, weekStartISO: string): YogaWeekPlan {
    const days = this.buildWeekDays(this.weekStart).map((dateISO) => ({
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

    return {
      residentId,
      weekStartISO,
      updatedAtISO: new Date().toISOString(),
      days,
    };
  }

  // ✅ FIX: manda { plan } + fuerza repaint con clones
  private async saveActivePlan(silent = false): Promise<void> {
    if (!this.activePlan) return;
    if (this.activeResidentId == null) return;

    const plan: YogaWeekPlan = {
      ...this.activePlan,
      residentId: this.activeResidentId,
      weekStartISO: this.weekKey,
      updatedAtISO: new Date().toISOString(),
      days: (this.activePlan.days || []).map((d) => ({
        ...d,
        sequenceId: d.sequenceId != null ? String(d.sequenceId) : null,
      })),
    };

    this.savingPlan = true;
    if (!silent) {
      this.errorMsg = '';
      this.infoMsg = '';
    }

    const url = this.endpoint(
      `/yoga/plans/${encodeURIComponent(this.activeResidentId)}?weekStart=${encodeURIComponent(this.weekKey)}`,
    );

    try {
      // ✅ contrato más compatible
      const res = await firstValueFrom(
        this.http.put<ApiResponse<any> | any>(url, { plan }).pipe(
          map((r: any) => {
            try {
              return unwrapApi<any>(r as ApiResponse<any>);
            } catch {
              return r;
            }
          }),
        ),
      );

      const saved = this.pickPlan(res);

      if (saved) {
        this.activePlan = this.normalizePlan(saved, this.activeResidentId, this.weekKey);
      } else {
        // igual lo dejamos en UI
        this.activePlan = { ...plan, days: [...plan.days] };
      }

      if (!silent) this.infoMsg = 'Plan guardado ✔️';
    } catch (err: any) {
      if (!silent) this.errorMsg = this.humanError(err, 'No se pudo guardar el plan real en el backend.');
    } finally {
      this.savingPlan = false;
      this.cdr.detectChanges();
    }
  }

  // ============================================================
  // DERIVED UI
  // ============================================================
  get activeResident(): ResidentLite | null {
    if (this.activeResidentId == null) return null;
    return this.residents.find((r) => r.id === this.activeResidentId) ?? null;
  }

  get filteredResidents(): ResidentLite[] {
    const q = this.search.trim().toLowerCase();
    let list = this.residents;

    if (q) {
      list = list.filter(
        (r) =>
          r.fullName.toLowerCase().includes(q) ||
          String(r.id).includes(q) ||
          (r.roomLabel || '').toLowerCase().includes(q),
      );
    }

    if (this.residentFilter !== 'todos') {
      list = list.filter((r) => {
        const has = this.hasPlan(r.id);
        return this.residentFilter === 'con-plan' ? has : !has;
      });
    }

    return list;
  }

  get filteredCatalog(): ServiceItem[] {
    const q = this.catalogQuery.trim().toLowerCase();
    if (!q) return this.catalogItems;
    return this.catalogItems.filter(
      (i) => i.title.toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q),
    );
  }

  // ============================================================
  // WEEK NAV
  // ============================================================
  prevWeek(): void {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() - 7);
    this.weekStart = this.startOfWeek(d);
    this.closeEditor();
    this.fetchWeekPlanForActiveResident();
  }

  nextWeek(): void {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() + 7);
    this.weekStart = this.startOfWeek(d);
    this.closeEditor();
    this.fetchWeekPlanForActiveResident();
  }

  goThisWeek(): void {
    this.weekStart = this.startOfWeek(new Date());
    this.closeEditor();
    this.fetchWeekPlanForActiveResident();
  }

  weekRangeLabel(): string {
    const start = new Date(this.weekStart);
    const end = new Date(this.weekStart);
    end.setDate(end.getDate() + 6);

    const fmt = (d: Date) => d.toLocaleDateString('es-UY', { day: '2-digit', month: 'short' });

    const y = start.getFullYear();
    return `${fmt(start)} – ${fmt(end)} ${y}`;
  }

  // ============================================================
  // PLAN HELPERS
  // ============================================================
  getActivePlan(): YogaWeekPlan | null {
    return this.activePlan;
  }

  hasPlan(_residentId: number): boolean {
    const plan = this.activePlan;
    if (!plan) return false;
    return !!(
      plan.days &&
      plan.days.some((d) => (d.sequenceId || d.notes || d.focus) && (d.minutes || 0) > 0)
    );
  }

  // ============================================================
  // EDITOR
  // ============================================================
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
      sequenceId: day.sequenceId != null ? String(day.sequenceId) : null,
      notes: day.notes || '',
    });

    // ✅ fuerza render de drawer
    this.cdr.detectChanges();
  }

  closeEditor(): void {
    this.editingDayIndex = null;
    this.cdr.detectChanges();
  }

  async saveDay(): Promise<void> {
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

    const nextDay: YogaDaySession = {
      ...current,
      time: String(v.time || '08:30'),
      focus: String(v.focus || 'Movilidad & Respiración'),
      intensity: (v.intensity || 'suave') as any,
      minutes: Number(v.minutes || 35),
      sequenceId: v.sequenceId != null ? String(v.sequenceId) : null,
      notes: String(v.notes || ''),
    };

    // ✅ CLONE para forzar repaint
    const nextDays = [...plan.days];
    nextDays[idx] = nextDay;

    this.activePlan = {
      ...plan,
      updatedAtISO: new Date().toISOString(),
      days: nextDays,
    };

    this.closeEditor();
    await this.saveActivePlan();
  }

  async toggleCompleted(dayIndex: number): Promise<void> {
    const plan = this.getActivePlan();
    if (!plan) return;

    const day = plan.days[dayIndex];
    if (!day) return;

    const next = !day.completed;

    const nextDay: YogaDaySession = {
      ...day,
      completed: next,
      completedAtISO: next ? new Date().toISOString() : null,
    };

    const nextDays = [...plan.days];
    nextDays[dayIndex] = nextDay;

    this.activePlan = {
      ...plan,
      updatedAtISO: new Date().toISOString(),
      days: nextDays,
    };

    await this.saveActivePlan(true);
  }

  async clearDay(dayIndex: number): Promise<void> {
    if (!this.canEdit) return;

    const plan = this.getActivePlan();
    if (!plan) return;

    const day = plan.days[dayIndex];
    if (!day) return;

    const nextDay: YogaDaySession = {
      ...day,
      time: '08:30',
      focus: 'Movilidad & Respiración',
      intensity: 'suave',
      minutes: 35,
      sequenceId: null,
      notes: '',
      completed: false,
      completedAtISO: null,
    };

    const nextDays = [...plan.days];
    nextDays[dayIndex] = nextDay;

    this.activePlan = {
      ...plan,
      updatedAtISO: new Date().toISOString(),
      days: nextDays,
    };

    await this.saveActivePlan();
  }

  // ============================================================
  // SEQUENCES (igual que tenías)
  // ============================================================
  sequenceById(id: string | null | undefined): YogaSequence | null {
    if (!id) return null;
    const key = String(id);
    return this.sequences.find((s) => String(s.id) === key) ?? null;
  }

  async addQuickSequenceFromCatalog(item: ServiceItem): Promise<void> {
    if (!this.canEdit) return;

    const url = this.endpoint('/yoga/sequences');

    const payload = {
      name: `Flow: ${item.title}`,
      tone: ((item.level as any) || 'suave') as 'suave' | 'medio' | 'intenso',
      minutes: item.minutes ?? 30,
      items: [{ itemId: item.id, title: item.title, minutes: item.minutes ?? 0 }],
      note: item.description ?? null,
    };

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<any> | any>(url, payload).pipe(
          map((r: any) => {
            try {
              return unwrapApi<any>(r as ApiResponse<any>);
            } catch {
              return r;
            }
          }),
        ),
      );

      const createdId = res?.id ?? res?.item?.id ?? res?.data?.id ?? null;
      await this.fetchSequences();

      if (createdId != null) {
        const cid = String(createdId);
        const found = this.sequences.find((s) => String(s.id) === cid);
        if (found) {
          this.sequences = [found, ...this.sequences.filter((s) => String(s.id) !== cid)];
        }
      }
    } catch (e) {
      const seq: YogaSequence = {
        id: `seq_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name: `Flow: ${item.title}`,
        tone: (item.level as any) || 'suave',
        minutes: item.minutes ?? 30,
        items: [{ itemId: item.id, title: item.title, minutes: item.minutes }],
        note: item.description,
      };
      this.sequences = [seq, ...this.sequences];
    }
  }

  async deleteSequence(id: string): Promise<void> {
    if (!this.canEdit) return;

    const isDbId = /^\d+$/.test(String(id));

    if (isDbId) {
      const url = this.endpoint(`/yoga/sequences/${encodeURIComponent(String(id))}`);
      try {
        await firstValueFrom(
          this.http.delete<ApiResponse<any> | any>(url).pipe(
            map((r: any) => {
              try {
                return unwrapApi<any>(r as ApiResponse<any>);
              } catch {
                return r;
              }
            }),
          ),
        );
      } catch {}
    }

    this.sequences = this.sequences.filter((s) => String(s.id) !== String(id));

    const plan = this.getActivePlan();
    if (plan) {
      const nextDays = plan.days.map((d) => ({
        ...d,
        sequenceId: String(d.sequenceId) === String(id) ? null : d.sequenceId,
      }));

      this.activePlan = {
        ...plan,
        updatedAtISO: new Date().toISOString(),
        days: nextDays,
      };

      await this.saveActivePlan(true);
    }
  }

  private rehydrateSequencesFromCatalog(): void {
    if (!this.catalogItems.length || !this.sequences.length) return;

    const byId = new Map<number, ServiceItem>();
    this.catalogItems.forEach((i) => byId.set(i.id, i));

    this.sequences = this.sequences.map((s) => ({
      ...s,
      items: s.items.map((it) => {
        if (it.title && it.title.trim()) return it;
        const found = byId.get(it.itemId);
        return {
          ...it,
          title: found?.title ?? `Item #${it.itemId}`,
          minutes: it.minutes ?? found?.minutes,
        };
      }),
    }));
  }

  // ============================================================
  // UI HELPERS
  // ============================================================
  trackById(_: number, x: { id: any }): any {
    return x.id;
  }
  trackByIndex(i: number): number {
    return i;
  }

  selectResident(id: number): void {
    this.activeResidentId = id;
    this.closeEditor();
    this.fetchWeekPlanForActiveResident();
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
    const planned = plan.days.filter((d) => (d.minutes || 0) > 0).length;
    const done = plan.days.filter((d) => !!d.completed).length;
    const minutes = plan.days.reduce((acc, d) => acc + Number(d.minutes || 0), 0);
    return { planned, done, minutes };
  }

  // ============================================================
  // DATE HELPERS
  // ============================================================
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
    const day = x.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
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
