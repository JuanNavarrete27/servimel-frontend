// perfil.page.ts
// ============================================================
// SERVIMEL — /perfil (Cuenta del usuario logueado)
// Standalone Page (Angular) + Reactive Forms + GSAP
//
// ✅ Actividad reciente REAL (SIN MOCKS) + SIN SPAM de 404:
// - NO intenta endpoints “/me”, “/timeline/me”, “/activity/me”, etc.
// - Construye la actividad REAL leyendo:
//    1) GET /residentes
//    2) GET /historial/residentes/:id (y filtra por tu user_id / email)
// - Si falla o viene vacío -> queda vacío (muestra "Sin actividad...")
// - NO hace toggle /api <-> sin /api (para no tirar 404 extra). BaseUrl debe estar bien.
//
// ✅ KPIs REALES (SIN MOCK):
// - kpiResidentesCargo: cantidad de residentes activos (GET /residentes)
// - kpiRegistrosHoy: cantidad de eventos del usuario HOY (desde historiales)
// - kpiAlertas: cantidad de eventos "críticos" del usuario en últimos 7 días (desde historiales)
//
// ✅ Guardar perfil REAL (SIN MOCK):
// - PATCH /auth/me  (incluye avatar_url)
//
// ✅ Cambiar contraseña REAL (SIN MOCK) + “funciona”:
// - POST /auth/change-password
// - Soporta respuestas: { ok:true }, { ok:true,data }, o 204/empty
// - Envía Authorization: Bearer token SIEMPRE
// - No depende de cookies (igual manda withCredentials por compat)
// ============================================================

import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Inject,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
  OnInit
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';

import {
  HttpClient,
  HttpClientModule,
  HttpHeaders
} from '@angular/common/http';
import { firstValueFrom, Subscription } from 'rxjs';

import { gsap } from 'gsap';

import { UiPrefsService, UiSettings } from '../../shared/services/ui-prefs.service';
import { AuthService } from '../../shared/services/auth.service';
import { API_CONFIG } from '../../core/config/api.config';

// =========================
// DB-ALIGNED TYPES
// =========================
type Role = 'enfermeria' | 'medico' | 'admin' | 'cocinero' | 'fisio' | 'entrenador_fisico';
type UserStatus = 'activo' | 'guardia' | 'fuera';

type ToastType = 'ok' | 'warn' | 'error';
type Toast = { id: number; type: ToastType; title: string; msg?: string };

type UserProfile = {
  id: number;
  first_name: string;
  last_name: string;
  role: Role;
  email: string;
  phone: string;
  avatar_url: string;
  status: UserStatus;
};

type MeApiResponse = {
  id: number;
  role: Role;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  avatar_url: string | null;
  is_active: number | boolean;
  status?: UserStatus | null;
};

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiEnvelope<T> = ApiOk<T> | ApiFail;

// =========================
// Activity REAL
// =========================
type ActivityType = 'signos' | 'medicacion' | 'observacion' | 'alerta';
type ActivityItem = {
  id: number;
  at: Date;
  type: ActivityType;
  title: string;
  detail: string;
  by: string;
};
type ActivityRange = 'hoy' | '7d' | 'todo';

// timeline backend
type TimelineItemApi = {
  id: number;
  resident_id: number | null;
  user_id: number | null;
  event_type: 'vital' | 'medication' | 'observation' | 'profile' | 'other';
  ref_table?: string;
  ref_id?: number;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  summary: string | null;
  occurred_at?: string | null;
  created_at?: string | null;

  user_email?: string | null;
  user_first_name?: string | null;
  user_last_name?: string | null;
};

type TimelineListApi = { page: number; limit: number; total: number; items: TimelineItemApi[] };

// residentes
type ResidentApi = {
  id: number;
  first_name?: string;
  last_name?: string;
  room?: string | null;
  is_active?: number | boolean | string | null;
};
type ResidentListApi = { page: number; limit: number; total: number; items: ResidentApi[] };

// change password response (tolerante)
type ChangePassOk = { ok?: boolean; data?: any; message?: string };

@Component({
  selector: 'app-perfil-page',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule, HttpClientModule],
  templateUrl: './perfil.page.html',
  styleUrls: ['./perfil.page.scss']
})
export class PerfilPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('pageRoot', { static: true }) pageRoot!: ElementRef<HTMLElement>;
  @ViewChild('passModal') passModal?: ElementRef<HTMLElement>;
  @ViewChild('passOverlay') passOverlay?: ElementRef<HTMLElement>;
  @ViewChild('passFirstInput') passFirstInput?: ElementRef<HTMLInputElement>;

  // ✅ Logout modal (animado tipo login success)
  @ViewChild('logoutBackdrop', { static: false }) logoutBackdrop?: ElementRef<HTMLElement>;
  @ViewChild('logoutModal', { static: false }) logoutModal?: ElementRef<HTMLElement>;
  logoutOpen = false;
  private logoutTl?: gsap.core.Timeline;
  private loggingOut = false;

  private isBrowser = false;

  // ✅ BaseUrl (SIN toggle /api)
  private readonly BASE = String(API_CONFIG.baseUrl || '').replace(/\/$/, '');

  // LocalStorage key (perfil cache)
  private LS_PROFILE = 'servimel_profile_v1';

  readonly DEFAULT_AVATAR =
    'https://static.vecteezy.com/system/resources/previews/009/292/244/non_2x/default-avatar-icon-of-social-media-user-vector.jpg';

  profile: UserProfile = {
    id: 0,
    first_name: '',
    last_name: '',
    role: 'enfermeria',
    email: '',
    phone: '',
    avatar_url: this.DEFAULT_AVATAR,
    status: 'activo'
  };

  // ✅ KPIs (REALES)
  kpiRegistrosHoy = 0;
  kpiAlertas = 0;
  kpiResidentesCargo = 0;

  // ✅ UI Settings global
  settings: UiSettings = {
    animations: true,
    hi_contrast: false,
    compact: false,
    dna_opacity: 0.22,
    font: 'md'
  };

  private prefsSub?: Subscription;

  // Forms
  editForm!: FormGroup<{
    first_name: FormControl<string>;
    last_name: FormControl<string>;
    phone: FormControl<string>;
    email: FormControl<string>;
    avatar_url: FormControl<string>;
  }>;

  passForm!: FormGroup<{
    actual: FormControl<string>;
    nueva: FormControl<string>;
    repetir: FormControl<string>;
  }>;

  // Modal state
  passOpen = false;
  modalAnimating = false;

  // ✅ Activity (REAL ONLY)
  activityRange: ActivityRange = '7d';
  activityLoading = false;
  activity: ActivityItem[] = []; // ✅ NO MOCK

  // Toasts
  toasts: Toast[] = [];
  private toastSeq = 100;

  // GSAP refs
  private gsapCtx?: ReturnType<typeof gsap.context>;
  private entranceTl?: gsap.core.Timeline;
  private modalTl?: gsap.core.Timeline;

  // ✅ evita /auth/logout 401 cuando no hay sesión real
  private serverSessionOk = false;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private http: HttpClient,
    private uiPrefs: UiPrefsService,
    private auth: AuthService,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);

    this.settings = this.uiPrefs.snapshot;

    // fallback local (cache perfil)
    this.hydrateProfile();

    // forms
    this.buildForms();
  }

  // ============================================================
  // INIT: load /me (REAL) + load activity/kpis real
  // ============================================================
  async ngOnInit(): Promise<void> {
    if (!this.isBrowser) return;

    this.prefsSub = this.uiPrefs.changes.subscribe(s => {
      const prevAnim = this.settings.animations;
      this.settings = s;

      if (prevAnim && !s.animations) {
        this.entranceTl?.kill();
        this.modalTl?.kill();
        this.logoutTl?.kill();
        this.gsapCtx?.revert();
        this.gsapCtx = undefined;
      }
    });

    const token = this.getAuthToken();

    // ✅ SIN token -> no pegamos al backend
    if (!token) {
      this.serverSessionOk = false;
      this.activity = [];
      this.activityLoading = false;
      this.setKpisEmpty();
      return;
    }

    // ✅ Con token: /auth/me (debería existir)
    const ok = await this.loadProfileFromApi(token);
    this.serverSessionOk = ok;

    if (!ok) {
      this.toast('warn', 'Sesión inválida', 'No pude validar tu sesión. Volvé a iniciar sesión.');
      this.activity = [];
      this.activityLoading = false;
      this.setKpisEmpty();
      return;
    }

    await this.loadActivityRecentReal(); // ✅ acá también setea KPIs reales
  }

  // ============================================================
  // Lifecycle
  // ============================================================
  ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    if (this.prefersReducedMotion()) return;
    if (!this.settings.animations) return;

    this.runEntranceAnimations();
  }

  ngOnDestroy(): void {
    this.prefsSub?.unsubscribe();

    try {
      this.entranceTl?.kill();
      this.modalTl?.kill();
      this.logoutTl?.kill();
      this.gsapCtx?.revert();

      if (this.isBrowser) {
        const root = this.pageRoot?.nativeElement;
        if (root) gsap.killTweensOf(root.querySelectorAll('*'));
      }
    } catch {
      // ignore
    } finally {
      this.unlockBodyScroll();
    }
  }

  // ============================================================
  // ✅ Envelope unwrap (tolerante)
  // ============================================================
  private unwrap<T>(raw: T | ApiEnvelope<T> | any): T {
    const r: any = raw as any;
    if (r && typeof r === 'object' && 'ok' in r) {
      if (r.ok === true) return r.data as T;
      throw new Error(r?.error?.message || 'API error');
    }
    return raw as T;
  }

  // ============================================================
  // ✅ URL builder (SIN toggle /api)
  // ============================================================
  private apiUrl(path: string): string {
    const p = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
    if (!this.BASE) return p;
    return `${this.BASE}${p}`;
  }

  private async getJson<T>(
    path: string,
    options: { headers?: HttpHeaders; params?: any; withCredentials?: boolean } = {}
  ): Promise<T> {
    return await firstValueFrom(this.http.get<T>(this.apiUrl(path), {
      headers: options.headers,
      params: options.params,
      withCredentials: options.withCredentials
    }));
  }

  private async postJson<T>(
    path: string,
    body: any,
    options: { headers?: HttpHeaders; params?: any; withCredentials?: boolean } = {}
  ): Promise<T> {
    return await firstValueFrom(this.http.post<T>(this.apiUrl(path), body, {
      headers: options.headers,
      params: options.params,
      withCredentials: options.withCredentials
    }));
  }

  private async patchJson<T>(
    path: string,
    body: any,
    options: { headers?: HttpHeaders; params?: any; withCredentials?: boolean } = {}
  ): Promise<T> {
    return await firstValueFrom(this.http.patch<T>(this.apiUrl(path), body, {
      headers: options.headers,
      params: options.params,
      withCredentials: options.withCredentials
    }));
  }

  // ============================================================
  // Token getter + Auth headers
  // ============================================================
  private getAuthToken(): string | null {
    if (!this.isBrowser) return null;

    const keys = [
      'servimel_token_v1',
      'token',
      'auth_token',
      'servimel_token',
      'jwt',
      'access_token',
      'accessToken'
    ];

    for (const k of keys) {
      const v = window.localStorage.getItem(k);
      if (v && v.trim()) return v.trim();
    }

    try {
      const raw = window.localStorage.getItem('auth');
      if (raw) {
        const parsed = JSON.parse(raw);
        const t = parsed?.token || parsed?.accessToken || parsed?.access_token;
        if (t && String(t).trim()) return String(t).trim();
      }
    } catch {
      // ignore
    }

    return null;
  }

  private authHeaders(): HttpHeaders {
    const t = this.getAuthToken();
    if (!t) return new HttpHeaders();
    return new HttpHeaders({ Authorization: `Bearer ${t}` });
  }

  // ✅ fallback de userId por si /me falla pero hay user guardado
  private getUserIdFallback(): number {
    if (!this.isBrowser) return 0;

    const tryParse = (raw: string | null): any => {
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    };

    const candidates: any[] = [
      tryParse(localStorage.getItem('user')),
      tryParse(localStorage.getItem('servimel_user_v1')),
      tryParse(localStorage.getItem('servimel_user')),
      tryParse(localStorage.getItem('auth')),
      tryParse(sessionStorage.getItem('user')),
      tryParse(sessionStorage.getItem('auth'))
    ].filter(Boolean);

    for (const c of candidates) {
      const id = c?.id ?? c?.user?.id ?? c?.data?.id ?? c?.me?.id;
      const n = Number(id);
      if (Number.isFinite(n) && n > 0) return n;
    }

    return 0;
  }

  // ============================================================
  // ✅ API: Load profile from DB
  // ============================================================
  private async loadProfileFromApi(token: string | null): Promise<boolean> {
    try {
      const headers = token
        ? new HttpHeaders({ Authorization: `Bearer ${token}` })
        : this.authHeaders();

      const raw = await this.getJson<MeApiResponse | ApiEnvelope<MeApiResponse> | any>(
        '/auth/me',
        { headers, withCredentials: true }
      );

      const me: MeApiResponse = this.unwrap<MeApiResponse>(raw as any);
      if (!me || typeof me !== 'object' || me.id == null) return false;

      const isActive =
        typeof me.is_active === 'boolean' ? me.is_active : Number(me.is_active) === 1;

      const safeRole: Role =
        (me.role === 'admin'
          || me.role === 'medico'
          || me.role === 'enfermeria'
          || me.role === 'cocinero'
          || me.role === 'fisio'
          || me.role === 'entrenador_fisico')
          ? me.role
          : this.profile.role;

      const mapped: UserProfile = {
        id: Number(me.id),
        first_name: String(me.first_name ?? '').trim(),
        last_name: String(me.last_name ?? '').trim(),
        role: safeRole,
        email: String(me.email ?? '').trim(),
        phone: String(me.phone ?? '').trim(),
        avatar_url: me.avatar_url && String(me.avatar_url).trim()
          ? String(me.avatar_url).trim()
          : this.DEFAULT_AVATAR,
        status: (me.status as UserStatus | null) ?? (isActive ? 'activo' : 'fuera')
      };

      this.profile = mapped;

      this.editForm.patchValue({
        first_name: mapped.first_name,
        last_name: mapped.last_name,
        phone: mapped.phone,
        email: mapped.email,
        avatar_url: mapped.avatar_url
      }, { emitEvent: false });

      // cache local (no es mock; es cache)
      this.persistProfile();
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================
  // ✅ Backend helpers (sin endpoints inventados)
  // ============================================================
  private async getResidentsReal(): Promise<ResidentApi[]> {
    const headers = this.authHeaders();

    const raw = await this.getJson<
      ResidentListApi | ApiEnvelope<ResidentListApi> | ResidentApi[] | ApiEnvelope<ResidentApi[]>
    >('/residentes?limit=200', { headers, withCredentials: true });

    const data: any = this.unwrap<any>(raw as any);
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    return (items as any[]).map(x => ({ ...x, id: Number(x.id) })) as ResidentApi[];
  }

  private async getTimelineForResidentReal(residentId: number): Promise<TimelineItemApi[]> {
    const headers = this.authHeaders();
    const raw = await this.getJson<TimelineListApi | ApiEnvelope<TimelineListApi> | any>(
      `/historial/residentes/${residentId}?preset=all&limit=120`,
      { headers, withCredentials: true }
    );
    const list = this.unwrap<TimelineListApi>(raw as any);
    return Array.isArray(list?.items) ? list.items : [];
  }

  private async poolMap<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<R>
  ): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let i = 0;

    const runners = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) break;
        out[idx] = await worker(items[idx]);
      }
    });

    await Promise.all(runners);
    return out;
  }

  // ============================================================
  // ✅ KPIs reales (derivados)
  // ============================================================
  private setKpisEmpty(): void {
    this.kpiRegistrosHoy = 0;
    this.kpiAlertas = 0;
    this.kpiResidentesCargo = 0;
  }

  private isTruthyActive(v: any): boolean {
    if (v === true) return true;
    if (v === false) return false;
    if (v == null) return true; // si no viene, asumimos activo (mejor UX)
    if (typeof v === 'number') return v === 1;
    const s = String(v).trim().toLowerCase();
    if (!s) return true;
    if (s === '1' || s === 'true' || s === 'activo' || s === 'active') return true;
    if (s === '0' || s === 'false' || s === 'inactivo' || s === 'inactive') return false;
    return true;
  }

  // ============================================================
  // ✅ Actividad reciente REAL + KPIs reales (desde residentes + historial) — SIN MOCKS
  // ============================================================
  private async loadActivityRecentReal(): Promise<void> {
    if (!this.isBrowser) return;

    if (!this.serverSessionOk) {
      this.activity = [];
      this.activityLoading = false;
      this.setKpisEmpty();
      return;
    }

    const userId = Number(this.profile?.id || 0) || this.getUserIdFallback();
    if (!userId) {
      this.activity = [];
      this.activityLoading = false;
      this.setKpisEmpty();
      return;
    }

    this.activityLoading = true;

    try {
      const residents = await this.getResidentsReal();

      // ✅ KPI: residentes activos (real)
      this.kpiResidentesCargo = residents.filter(r => this.isTruthyActive(r.is_active)).length;

      const ids = residents
        .map(r => Number(r.id))
        .filter(n => Number.isFinite(n) && n > 0)
        .slice(0, 80);

      if (!ids.length) {
        this.activity = [];
        this.kpiRegistrosHoy = 0;
        this.kpiAlertas = 0;
        return;
      }

      const timelines = await this.poolMap(ids, 6, async (rid) => {
        try {
          return await this.getTimelineForResidentReal(rid);
        } catch {
          return [] as TimelineItemApi[];
        }
      });

      const emailMe = (this.profile.email || '').trim().toLowerCase();
      const nameMe = `${this.profile.first_name || ''} ${this.profile.last_name || ''}`.trim().toLowerCase();

      const matchesUser = (ev: TimelineItemApi) => {
        if (ev?.user_id != null) return Number(ev.user_id) === userId;

        const em = (ev.user_email || '').trim().toLowerCase();
        if (emailMe && em && em === emailMe) return true;

        const nm = [ev.user_first_name, ev.user_last_name].filter(Boolean).join(' ').trim().toLowerCase();
        if (nameMe && nm && nm === nameMe) return true;

        return false;
      };

      const flat = timelines.flat();

      // ✅ KPIs reales basados en historiales (del usuario)
      const now = new Date();
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);

      const d7 = new Date(now);
      d7.setDate(d7.getDate() - 7);

      const perUser = flat.filter(matchesUser);

      this.kpiRegistrosHoy = perUser.filter(ev => {
        const when = this.parseDate(ev.occurred_at || ev.created_at);
        return when >= startOfToday;
      }).length;

      this.kpiAlertas = perUser.filter(ev => {
        const when = this.parseDate(ev.occurred_at || ev.created_at);
        if (when < d7) return false;

        const t = String(ev.title || '').toLowerCase();
        const isCritical = ev.severity === 'critical';
        const looksAlert = t.includes('alerta') || t.includes('alarm') || t.includes('crit');
        return isCritical || looksAlert;
      }).length;

      // ✅ Actividad (real)
      const filtered = perUser
        .sort((a, b) => {
          const da = this.parseDate(a.occurred_at || a.created_at).getTime();
          const db = this.parseDate(b.occurred_at || b.created_at).getTime();
          return db - da;
        })
        .slice(0, 120)
        .map(ev => this.mapActivityFromTimeline(ev));

      this.activity = filtered; // ✅ puede quedar vacío
    } finally {
      this.activityLoading = false;
    }
  }

  private mapActivityFromTimeline(ev: TimelineItemApi): ActivityItem {
    const type: ActivityType =
      ev.event_type === 'vital'
        ? 'signos'
        : ev.event_type === 'medication'
          ? 'medicacion'
          : ev.event_type === 'observation'
            ? (ev.severity === 'critical' || (ev.title || '').toLowerCase().includes('alerta') ? 'alerta' : 'observacion')
            : (ev.severity === 'critical' ? 'alerta' : 'observacion');

    const by =
      [ev.user_first_name, ev.user_last_name].filter(Boolean).join(' ').trim()
      || (ev.user_email ? String(ev.user_email) : 'Sistema');

    const when = this.parseDate(ev.occurred_at || ev.created_at);

    return {
      id: Number(ev.ref_id ?? ev.id),
      at: when,
      type,
      title: String(ev.title ?? '').trim() || this.activityTypeLabel(type),
      detail: String(ev.summary ?? '').trim(),
      by
    };
  }

  private parseDate(input: string | Date | null | undefined): Date {
    if (!input) return new Date();
    if (input instanceof Date) return input;

    const s = String(input);

    if (s.includes('T')) {
      const d = new Date(s);
      return isNaN(d.getTime()) ? new Date() : d;
    }

    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?$/.test(s)) {
      const d = new Date(s.replace(' ', 'T'));
      return isNaN(d.getTime()) ? new Date() : d;
    }

    const d = new Date(s);
    return isNaN(d.getTime()) ? new Date() : d;
  }

  // ============================================================
  // Build Forms
  // ============================================================
  private buildForms(): void {
    this.editForm = this.fb.group({
      first_name: this.fb.control<string>(this.profile.first_name, {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(40)]
      }),
      last_name: this.fb.control<string>(this.profile.last_name, {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(40)]
      }),
      phone: this.fb.control<string>(this.profile.phone, {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(6), Validators.maxLength(25)]
      }),
      email: this.fb.control<string>(this.profile.email, {
        nonNullable: true,
        validators: [Validators.required, Validators.email, Validators.maxLength(80)]
      }),
      avatar_url: this.fb.control<string>(this.profile.avatar_url, {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(280)]
      })
    });

    this.passForm = this.fb.group(
      {
        actual: this.fb.control<string>('', {
          nonNullable: true,
          validators: [Validators.required, Validators.minLength(8)]
        }),
        nueva: this.fb.control<string>('', {
          nonNullable: true,
          validators: [Validators.required, Validators.minLength(8)]
        }),
        repetir: this.fb.control<string>('', {
          nonNullable: true,
          validators: [Validators.required, Validators.minLength(8)]
        })
      },
      { validators: [this.passwordsMatchValidator] }
    );
  }

  // ============================================================
  // TEMPLATE HELPERS
  // ============================================================
  isInvalid(form: FormGroup, controlName: string): boolean {
    const c = form.get(controlName);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  activityIcon(t: ActivityType): string {
    switch (t) {
      case 'signos': return '🫀';
      case 'medicacion': return '💊';
      case 'observacion': return '📝';
      case 'alerta': return '⚠️';
      default: return '•';
    }
  }

  activityChipClass(t: ActivityType): string {
    switch (t) {
      case 'signos': return 'chip chip--teal';
      case 'medicacion': return 'chip chip--ok';
      case 'observacion': return 'chip chip--info';
      case 'alerta': return 'chip chip--danger';
      default: return 'chip chip--muted';
    }
  }

  activityTypeLabel(t: ActivityType): string {
    switch (t) {
      case 'signos': return 'Signos';
      case 'medicacion': return 'Medicación';
      case 'observacion': return 'Observación';
      case 'alerta': return 'Alerta';
      default: return 'Otro';
    }
  }

  // ============================================================
  // Getters (HTML)
  // ============================================================
  get roleLabel(): string {
    switch (this.profile.role) {
      case 'admin': return 'Admin';
      case 'medico': return 'Médico';
      case 'enfermeria': return 'Enfermería';
      case 'cocinero': return 'Cocinero';
      case 'fisio': return 'Fisioterapia';
      case 'entrenador_fisico': return 'Entrenador físico';
      default: return 'Usuario';
    }
  }

  get statusLabel(): string {
    switch (this.profile.status) {
      case 'activo': return 'Activo';
      case 'guardia': return 'En guardia';
      case 'fuera': return 'Fuera';
      default: return '—';
    }
  }

  get statusClass(): string {
    switch (this.profile.status) {
      case 'activo': return 'chip chip--ok';
      case 'guardia': return 'chip chip--info';
      case 'fuera': return 'chip chip--muted';
      default: return 'chip chip--muted';
    }
  }

  get activityFiltered(): ActivityItem[] {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    if (this.activityRange === 'todo') return this.activity;

    if (this.activityRange === 'hoy') {
      return this.activity.filter(a => a.at >= startOfToday);
    }

    const d7 = new Date(now);
    d7.setDate(d7.getDate() - 7);
    return this.activity.filter(a => a.at >= d7);
  }

  get activityLastUpdate(): Date | null {
    return this.activityFiltered[0]?.at ?? null;
  }

  // ============================================================
  // Header actions
  // ============================================================
  irAjustes(): void { this.router.navigateByUrl('/ajustes'); }
  irDashboard(): void { this.router.navigateByUrl('/dashboard'); }

  // ============================================================
  // ✅ Save profile (REAL) — PATCH /auth/me (incluye avatar_url)
  // ============================================================
  async guardarPerfil(): Promise<void> {
    this.touchAll(this.editForm);
    if (this.editForm.invalid) {
      this.toast('error', 'Revisá los campos', 'Hay validaciones pendientes en tu perfil.');
      this.bumpInvalid();
      return;
    }

    if (!this.serverSessionOk) {
      this.toast('warn', 'Sesión inválida', 'Volvé a iniciar sesión para guardar cambios.');
      return;
    }

    const v = this.editForm.getRawValue();
    const payload = {
      first_name: v.first_name.trim(),
      last_name: v.last_name.trim(),
      phone: v.phone.trim(),
      email: v.email.trim(),
      avatar_url: v.avatar_url.trim()
    };

    try {
      const raw = await this.patchJson<MeApiResponse | ApiEnvelope<MeApiResponse> | any>(
        '/auth/me',
        payload,
        { headers: this.authHeaders(), withCredentials: true }
      );

      const me = this.unwrap<MeApiResponse>(raw as any);

      const isActive =
        typeof me.is_active === 'boolean' ? me.is_active : Number(me.is_active) === 1;

      const safeRole: Role =
        (me.role === 'admin'
          || me.role === 'medico'
          || me.role === 'enfermeria'
          || me.role === 'cocinero'
          || me.role === 'fisio'
          || me.role === 'entrenador_fisico')
          ? me.role
          : this.profile.role;

      this.profile = {
        ...this.profile,
        id: Number(me.id),
        role: safeRole,
        first_name: String(me.first_name ?? payload.first_name).trim(),
        last_name: String(me.last_name ?? payload.last_name).trim(),
        email: String(me.email ?? payload.email).trim(),
        phone: String(me.phone ?? payload.phone).trim(),
        avatar_url: me.avatar_url && String(me.avatar_url).trim()
          ? String(me.avatar_url).trim()
          : (payload.avatar_url || this.DEFAULT_AVATAR),
        status: (me.status as UserStatus | null) ?? (isActive ? 'activo' : 'fuera')
      };

      // reflejar por si backend normaliza algo
      this.editForm.patchValue({
        first_name: this.profile.first_name,
        last_name: this.profile.last_name,
        phone: this.profile.phone,
        email: this.profile.email,
        avatar_url: this.profile.avatar_url
      }, { emitEvent: false });

      this.persistProfile(); // cache local
      this.toast('ok', 'Perfil actualizado', 'Avatar y datos guardados en el sistema.');
      this.sparkPulse('.js-pulse-edit');
    } catch (e: any) {
      this.toast('error', 'No se pudo guardar', String(e?.message || 'Error al actualizar perfil.'));
      this.bumpInvalid();
    }
  }

  // ============================================================
  // Security
  // ============================================================
  abrirModalPassword(): void {
    if (this.modalAnimating) return;

    this.passOpen = true;
    this.modalAnimating = true;
    this.lockBodyScroll();

    if (this.isBrowser) {
      window.setTimeout(() => this.passFirstInput?.nativeElement?.focus?.(), 0);
    }

    this.modalEnter();
  }

  cerrarModalPassword(): void {
    if (this.modalAnimating) return;
    this.modalAnimating = true;

    this.modalLeave(() => {
      this.passOpen = false;
      this.modalAnimating = false;
      this.unlockBodyScroll();
      this.passForm.reset({ actual: '', nueva: '', repetir: '' });
    });
  }

  // ✅ Password REAL — POST /auth/change-password (robusto)
  async guardarPassword(): Promise<void> {
    this.touchAll(this.passForm);
    if (this.passForm.invalid) {
      const msg = this.passForm.hasError('passwordsMismatch')
        ? 'La confirmación no coincide.'
        : 'Mínimo 8 caracteres por campo.';
      this.toast('error', 'No se pudo cambiar', msg);
      this.bumpInvalid();
      return;
    }

    if (!this.serverSessionOk) {
      this.toast('warn', 'Sesión inválida', 'Volvé a iniciar sesión para cambiar la contraseña.');
      return;
    }

    const token = this.getAuthToken();
    if (!token) {
      this.toast('warn', 'Sin token', 'No encontré tu token. Volvé a iniciar sesión.');
      return;
    }

    const v = this.passForm.getRawValue();
    const body = {
      current_password: String(v.actual),
      new_password: String(v.nueva)
    };

    try {
      // ✅ SIEMPRE Bearer (no dependemos de cookies)
      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

      // soporta: 204/empty, o JSON cualquiera
      const raw = await this.postJson<ChangePassOk | ApiEnvelope<any> | any>(
        '/auth/change-password',
        body,
        { headers, withCredentials: true }
      );

      // si viene envelope ok:false -> tira error en unwrap
      try { this.unwrap<any>(raw as any); } catch (err: any) { throw err; }

      this.toast('ok', 'Contraseña actualizada', 'Cambio aplicado.');
      this.sparkPulse('.js-pulse-security');

      // reset prolijo + cerrar modal
      this.passForm.reset({ actual: '', nueva: '', repetir: '' });
      this.cerrarModalPassword();
    } catch (e: any) {
      const msg = String(e?.message || 'Error al cambiar contraseña.');
      this.toast('error', 'No se pudo cambiar', msg);
      this.bumpInvalid();
    }
  }

  // ============================================================
  // ✅ LOGOUT REAL + MODAL ANIMADO (tipo login)
  // ============================================================
  async cerrarSesion(): Promise<void> {
    if (!this.isBrowser) return;
    if (this.loggingOut) return;

    this.loggingOut = true;

    const doLogout = async () => {
      await this.performLogout();
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      this.loggingOut = false;
    };

    if (this.prefersReducedMotion() || !this.settings.animations) {
      await doLogout();
      return;
    }

    this.openLogoutModal(doLogout);
  }

  private openLogoutModal(onDone: () => void) {
    this.logoutOpen = true;
    this.lockBodyScroll();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const bd = this.logoutBackdrop?.nativeElement;
        const md = this.logoutModal?.nativeElement;

        if (!bd || !md) {
          this.logoutOpen = false;
          this.unlockBodyScroll();
          onDone();
          return;
        }

        this.logoutTl?.kill();

        gsap.set(bd, { opacity: 0 });
        gsap.set(md, { opacity: 0, y: 14, scale: 0.98, filter: 'blur(10px)' });

        this.logoutTl = gsap.timeline({ defaults: { ease: 'power3.out' } });

        this.logoutTl
          .to(bd, { opacity: 1, duration: 0.18 }, 0)
          .to(md, { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.28 }, 0.02)
          .to(md, { y: -2, duration: 0.18, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 0.32)
          .to(md, { opacity: 0, y: 10, filter: 'blur(10px)', duration: 0.22, ease: 'power2.inOut' }, 0.92)
          .to(bd, { opacity: 0, duration: 0.18 }, 0.98)
          .add(() => {
            this.logoutOpen = false;
            this.unlockBodyScroll();
            onDone();
          });
      });
    });
  }

  private async performLogout(): Promise<void> {
    try {
      const maybe = (this.auth as any)?.logout?.();
      if (maybe && typeof maybe.then === 'function') await maybe;
    } catch {
      // ignore
    }

    if (this.serverSessionOk) {
      try {
        await this.postJson('/auth/logout', {}, { withCredentials: true, headers: this.authHeaders() });
      } catch {
        // ignore
      }
    }

    this.clearAuthStorage();

    this.passOpen = false;
    this.toasts = [];
    this.activity = [];
    this.serverSessionOk = false;
    this.setKpisEmpty();
  }

  private clearAuthStorage(): void {
    if (!this.isBrowser) return;

    const keys = [
      'servimel_token_v1',
      'servimel_token',
      'auth_token',
      'token',
      'jwt',
      'access_token',
      'accessToken',
      'refresh_token',
      'refreshToken',
      'auth',
      'user',
      'servimel_user_v1'
    ];

    try {
      keys.forEach(k => localStorage.removeItem(k));
      keys.forEach(k => sessionStorage.removeItem(k));
    } catch {
      // ignore
    }
  }

  // ============================================================
  // Preferences (via UiPrefsService)
  // ============================================================
  toggleAnimations(v: boolean): void {
    const prev = this.settings.animations;

    this.settings = this.uiPrefs.setAnimations(!!v);
    this.uiPrefs.apply(true);

    if (this.isBrowser && !this.settings.animations) {
      this.entranceTl?.kill();
      this.modalTl?.kill();
      this.logoutTl?.kill();
      this.gsapCtx?.revert();
      this.gsapCtx = undefined;
    }

    if (this.isBrowser && this.settings.animations && !prev) {
      if (!this.prefersReducedMotion()) this.runEntranceAnimations();
    }

    this.toast('ok', 'Preferencias guardadas', this.settings.animations ? 'Animaciones activadas.' : 'Animaciones desactivadas.');
  }

  toggleHiContrast(v: boolean): void {
    this.settings = this.uiPrefs.setHiContrast(!!v);
    this.uiPrefs.apply(true);
    this.toast('ok', 'Contraste actualizado', this.settings.hi_contrast ? 'Alto contraste ON.' : 'Alto contraste OFF.');
  }

  toggleCompact(v: boolean): void {
    this.settings = this.uiPrefs.setCompact(!!v);
    this.uiPrefs.apply(true);
    this.toast('ok', 'Interfaz actualizada', this.settings.compact ? 'Modo compacto ON.' : 'Modo compacto OFF.');
  }

  setDnaOpacity(v: number | string): void {
    this.settings = this.uiPrefs.setDnaOpacity(v, true);
  }

  guardarPreferencias(): void {
    this.uiPrefs.save();
    this.uiPrefs.apply(true);
    this.toast('ok', 'Preferencias guardadas', 'Configuración aplicada.');
    this.sparkPulse('.js-pulse-prefs');
  }

  // ============================================================
  // Activity filter
  // ============================================================
  setActivityRange(r: ActivityRange): void {
    this.activityRange = r;

    if (this.isBrowser && this.settings.animations && !this.prefersReducedMotion()) {
      const root = this.pageRoot.nativeElement;
      const items = Array.from(root.querySelectorAll<HTMLElement>('.js-activity-item'));
      gsap.killTweensOf(items);
      gsap.fromTo(items, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.32, stagger: 0.03, ease: 'power2.out' });
    }
  }

  // ============================================================
  // Keyboard / overlay
  // ============================================================
  @HostListener('document:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent): void {
    if (!this.passOpen) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.cerrarModalPassword();
    }
  }

  onOverlayClick(ev: MouseEvent): void {
    if (!this.passOpen) return;
    if (ev.target === this.passOverlay?.nativeElement) {
      this.cerrarModalPassword();
    }
  }

  // ============================================================
  // GSAP animations
  // ============================================================
  private runEntranceAnimations(): void {
    this.gsapCtx?.revert();
    this.gsapCtx = undefined;

    this.gsapCtx = gsap.context(() => {
      const root = this.pageRoot.nativeElement;

      const headerEls = Array.from(root.querySelectorAll<HTMLElement>('.js-anim-header'));
      const cards = Array.from(root.querySelectorAll<HTMLElement>('.js-anim-card'));
      const avatar = root.querySelector<HTMLElement>('.js-anim-avatar');
      const activityItems = Array.from(root.querySelectorAll<HTMLElement>('.js-activity-item'));

      if (headerEls.length) gsap.set(headerEls, { opacity: 0, y: 14, filter: 'blur(3px)' });
      if (cards.length) gsap.set(cards, { opacity: 0, y: 14, filter: 'blur(3px)' });
      if (avatar) gsap.set(avatar, { opacity: 0, scale: 0.96 });
      if (activityItems.length) gsap.set(activityItems, { opacity: 0, y: 10 });

      this.entranceTl?.kill();
      this.entranceTl = gsap.timeline({ defaults: { ease: 'power2.out' } });

      if (headerEls.length) {
        this.entranceTl.to(headerEls, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.55, stagger: 0.06 });
      }
      if (cards.length) {
        this.entranceTl.to(cards, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.55, stagger: 0.08 }, headerEls.length ? '-=0.18' : 0);
      }

      if (avatar) {
        this.entranceTl.to(avatar, { opacity: 1, scale: 1, duration: 0.42, ease: 'back.out(1.6)' }, '-=0.35');
        this.entranceTl.fromTo(
          avatar,
          { boxShadow: '0 0 0 0 rgba(182,203,51,.0)' },
          { boxShadow: '0 0 0 12px rgba(182,203,51,.08)', duration: 0.45, ease: 'power2.out' },
          '-=0.25'
        );
      }

      if (activityItems.length) {
        this.entranceTl.to(activityItems, { opacity: 1, y: 0, duration: 0.34, stagger: 0.03 }, '-=0.20');
      }
    }, this.pageRoot.nativeElement);
  }

  private sparkPulse(selector: string): void {
    if (!this.isBrowser) return;
    if (this.prefersReducedMotion()) return;
    if (!this.settings.animations) return;

    const root = this.pageRoot.nativeElement;
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) return;

    gsap.killTweensOf(el);
    gsap.fromTo(
      el,
      { filter: 'brightness(1)', boxShadow: '0 18px 64px rgba(0,0,0,.38)' },
      {
        duration: 0.55,
        keyframes: [
          { filter: 'brightness(1.16)', boxShadow: '0 0 0 10px rgba(182,203,51,.08), 0 26px 86px rgba(0,0,0,.46)' },
          { filter: 'brightness(1)', boxShadow: '0 18px 64px rgba(0,0,0,.38)' }
        ],
        ease: 'power2.out'
      }
    );
  }

  private bumpInvalid(): void {
    if (!this.isBrowser) return;
    if (this.prefersReducedMotion()) return;
    if (!this.settings.animations) return;

    const root = this.pageRoot.nativeElement;
    const invalids = root.querySelectorAll<HTMLElement>('.input--invalid');
    if (!invalids.length) return;

    gsap.killTweensOf(invalids);
    gsap.fromTo(invalids, { x: 0 }, { x: 6, duration: 0.06, yoyo: true, repeat: 5, ease: 'power1.inOut' });
  }

  private modalEnter(): void {
    if (!this.isBrowser) { this.modalAnimating = false; return; }
    if (this.prefersReducedMotion() || !this.settings.animations) { this.modalAnimating = false; return; }

    const overlay = this.passOverlay?.nativeElement;
    const modal = this.passModal?.nativeElement;
    if (!overlay || !modal) { this.modalAnimating = false; return; }

    gsap.set(overlay, { opacity: 0 });
    gsap.set(modal, { opacity: 0, y: 10, scale: 0.985 });

    this.modalTl?.kill();
    this.modalTl = gsap.timeline({
      defaults: { ease: 'power2.out' },
      onComplete: () => { this.modalAnimating = false; }
    });

    this.modalTl
      .to(overlay, { opacity: 1, duration: 0.18 })
      .to(modal, { opacity: 1, y: 0, scale: 1, duration: 0.22 }, '-=0.10');
  }

  private modalLeave(done: () => void): void {
    if (!this.isBrowser) { done(); return; }
    if (this.prefersReducedMotion() || !this.settings.animations) { done(); return; }

    const overlay = this.passOverlay?.nativeElement;
    const modal = this.passModal?.nativeElement;
    if (!overlay || !modal) { done(); return; }

    this.modalTl?.kill();
    this.modalTl = gsap.timeline({
      defaults: { ease: 'power2.inOut' },
      onComplete: done
    });

    this.modalTl
      .to(modal, { opacity: 0, y: 10, scale: 0.985, duration: 0.18 })
      .to(overlay, { opacity: 0, duration: 0.16 }, '-=0.08');
  }

  // ============================================================
  // Toasts
  // ============================================================
  toast(type: ToastType, title: string, msg?: string): void {
    const t: Toast = { id: ++this.toastSeq, type, title, msg };
    this.toasts = [t, ...this.toasts].slice(0, 4);

    if (this.isBrowser) {
      window.setTimeout(() => this.cerrarToast(t.id), 3500);
    }

    if (this.isBrowser && !this.prefersReducedMotion() && this.settings.animations) {
      const root = this.pageRoot.nativeElement;
      const stack = root.querySelector<HTMLElement>('.toast-stack');
      if (stack) {
        gsap.killTweensOf(stack);
        gsap.fromTo(stack, { y: -6, opacity: 0.92 }, { y: 0, opacity: 1, duration: 0.25, ease: 'power2.out' });
      }
    }
  }

  cerrarToast(id: number): void {
    this.toasts = this.toasts.filter(x => x.id !== id);
  }

  // ============================================================
  // Validators
  // ============================================================
  private passwordsMatchValidator = (group: AbstractControl) => {
    const g = group as FormGroup;
    const n = g.get('nueva')?.value;
    const r = g.get('repetir')?.value;
    if (!n || !r) return null;
    return n === r ? null : { passwordsMismatch: true };
  };

  private touchAll(form: FormGroup): void {
    Object.values(form.controls).forEach((c: AbstractControl) => c.markAsTouched());
  }

  // ============================================================
  // Persistence (cache perfil)
  // ============================================================
  private hydrateProfile(): void {
    if (!this.isBrowser) return;

    try {
      const raw = window.localStorage.getItem(this.LS_PROFILE);
      if (!raw) return;

      const parsed = JSON.parse(raw) as any;

      const migrated: Partial<UserProfile> = {
        id: Number(parsed.id ?? this.profile.id),
        first_name: String(parsed.first_name ?? parsed.nombre ?? this.profile.first_name),
        last_name: String(parsed.last_name ?? parsed.apellido ?? this.profile.last_name),
        role: (parsed.role ?? parsed.rol ?? this.profile.role) as Role,
        email: String(parsed.email ?? this.profile.email),
        phone: String(parsed.phone ?? parsed.telefono ?? this.profile.phone),
        avatar_url: String(parsed.avatar_url ?? parsed.avatarUrl ?? this.profile.avatar_url),
        status: (parsed.status ?? parsed.estado ?? this.profile.status) as UserStatus
      };

      this.profile = { ...this.profile, ...migrated } as UserProfile;
    } catch {
      // ignore
    }
  }

  private persistProfile(): void {
    if (!this.isBrowser) return;
    try {
      window.localStorage.setItem(this.LS_PROFILE, JSON.stringify(this.profile));
    } catch {
      // ignore
    }
  }

  private prefersReducedMotion(): boolean {
    if (!this.isBrowser) return true;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  }

  private lockBodyScroll(): void {
    if (!this.isBrowser) return;
    document.body.style.overflow = 'hidden';
  }

  private unlockBodyScroll(): void {
    if (!this.isBrowser) return;
    document.body.style.overflow = '';
  }
}
