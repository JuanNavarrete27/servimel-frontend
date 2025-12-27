// enfermeria.page.ts
// ============================================================
// SERVIMEL — Enfermería (Ingreso rápido)
// Standalone Page (Angular) + GSAP + micro-interacciones JS
//
// ✅ Backend real:
// - GET   /residentes?limit=200
// - POST  /enfermeria/residentes/:id/vitals
// - POST  /enfermeria/residentes/:id/medications
// - POST  /enfermeria/residentes/:id/observations
//
// ✅ Listados (FIX CONSOLE 404):
// - En tu backend actual NO existen (404) estos GET:
//   /enfermeria/residentes/:id/vitals?limit=6
//   /enfermeria/residentes/:id/medications?limit=6
//   /enfermeria/residentes/:id/observations?limit=6
// - Entonces para “quick data” usamos SOLO:
//   GET /historial/residentes/:id?preset=all&limit=60
//
// ✅ FIX PRO de prefijo (/api vs sin /api):
// - Si tu API_CONFIG.baseUrl queda "" o no coincide, el front puede pegarle a:
//   /enfermeria/... (404) o /api/enfermeria/... (404)
// - Esta page ahora prueba AUTOMÁTICAMENTE ambos prefijos:
//   baseUrl + path  y  (toggle) baseUrl + "/api" + path
//   o si baseUrl ya trae /api, también prueba sin /api.
//
// ✅ Envelope:
// - soporta respuesta directa {..} o envuelta { ok:true, data:{..} }
//
// ⚠️ GSAP: npm i gsap
// ✅ FIX GSAP warning:
// - No pasar NodeList directo a gsap (evita "target [object NodeList] not found")
// ============================================================

import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Inject,
  NgZone,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  ViewChild
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
  HttpErrorResponse,
  HttpHeaders
} from '@angular/common/http';

import { gsap } from 'gsap';
import { API_CONFIG } from '../../core/config/api.config';

import { Observable, Subscription, of, throwError } from 'rxjs';
import { catchError, finalize, map, switchMap, take } from 'rxjs/operators';

// =========================
// DB-ALIGNED TYPES
// =========================
type EstadoResidente = 'estable' | 'observacion' | 'critico';

type Residente = {
  id: number;
  first_name: string;
  last_name: string;
  room: string | null;
  status: EstadoResidente;
};

type VitalRecord = {
  id: number;
  resident_id: number;
  user_id?: number | null;
  taken_at: Date;

  temp_c: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  hr: number | null;
  rr?: number | null;
  spo2: number | null;
  pain: number | null;
  notes?: string | null;
};

type MedStatus = 'pending' | 'administered' | 'late' | 'suspended';

type MedRecord = {
  id: number;
  resident_id: number;
  user_id?: number | null;
  drug_name: string;
  dose: string | null;
  route?: string | null;
  status: MedStatus;
  scheduled_at: Date;
  administered_at?: Date | null;
  notes?: string | null;
};

type ObsType = 'normal' | 'alerta';

type Observation = {
  id: number;
  resident_id: number;
  user_id?: number | null;
  type: ObsType;
  observed_at: Date;
  text: string;
  resolved_at?: Date | null;
};

// =========================
// API (envelope + list)
// =========================
type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string; details?: any } };
type ApiEnvelope<T> = ApiOk<T> | ApiFail;

// residents list
type ResidentApi = {
  id: number;
  first_name: string;
  last_name: string;
  document_number: string | null;
  room: string | null;
  status: EstadoResidente;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  notes?: string | null;
  is_active?: number | boolean;
  created_at?: string;
  updated_at?: string;
};
type ResidentListApi = { page: number; limit: number; total: number; items: ResidentApi[] };

// vitals api (POST returns)
type VitalApi = {
  id: number;
  resident_id: number;
  user_id: number | null;
  taken_at: string;
  temp_c: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  hr: number | null;
  rr?: number | null;
  spo2: number | null;
  pain: number | null;
  notes: string | null;
  created_at?: string;
};

// meds api (POST returns)
type MedicationApi = {
  id: number;
  resident_id: number;
  user_id: number | null;
  drug_name: string;
  dose: string | null;
  route: string | null;
  status: MedStatus;
  scheduled_at: string;
  administered_at: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

// obs api (POST returns)
type ObservationApi = {
  id: number;
  resident_id: number;
  user_id: number | null;
  type: ObsType;
  observed_at: string;
  text: string;
  resolved_at: string | null;
  created_at?: string;
  updated_at?: string;
};

// timeline fallback (GET list)
type TimelineItemApi = {
  id: number;
  resident_id: number;
  user_id: number | null;
  event_type: 'vital' | 'medication' | 'observation' | 'profile' | 'other';
  ref_table: string;
  ref_id: number;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  summary: string | null;
  occurred_at: string;
  created_at: string;
  user_email?: string | null;
  user_first_name?: string | null;
  user_last_name?: string | null;
};
type TimelineListApi = { page: number; limit: number; total: number; items: TimelineItemApi[] };

@Component({
  selector: 'app-enfermeria-page',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule, HttpClientModule],
  templateUrl: './enfermeria.page.html',
  styleUrls: ['./enfermeria.page.scss']
})
export class EnfermeriaPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('pageRoot', { static: true }) pageRoot!: ElementRef<HTMLElement>;

  // ✅ BaseUrl flexible (puede venir con /api o sin /api, o vacío)
  private readonly BASE = String(API_CONFIG.baseUrl || '').replace(/\/$/, '');

  // ------------------------------------------------------------
  // Estado UI
  // ------------------------------------------------------------
  residentSearch = '';
  isNavigating = false;

  loadingResidents = false;
  loadingQuick = false;
  saving = false;
  lastError: string | null = null;

  // ------------------------------------------------------------
  // Data (backend)
  // ------------------------------------------------------------
  residentes: Residente[] = [];

  vitalRecords: VitalRecord[] = [];
  meds: MedRecord[] = [];
  observations: Observation[] = [];

  private loadedResidentId: number | null = null;

  // ------------------------------------------------------------
  // Forms (Reactive)
  // ------------------------------------------------------------
  vitalsForm!: FormGroup<{
    residenteId: FormControl<number | null>;
    tension: FormControl<string>;
    fc: FormControl<number | null>;
    temp: FormControl<number | null>;
    spo2: FormControl<number | null>;
    glucemia: FormControl<number | null>; // legacy (no DB): se ignora
    dolor: FormControl<number | null>;
    notas: FormControl<string>;
  }>;

  medForm!: FormGroup<{
    residenteId: FormControl<number | null>;
    medicamento: FormControl<string>;
    dosis: FormControl<string>;
    horario: FormControl<string>;
    estado: FormControl<MedStatus>;
  }>;

  obsForm!: FormGroup<{
    residenteId: FormControl<number | null>;
    tipo: FormControl<ObsType>;
    texto: FormControl<string>;
  }>;

  // ✅ GSAP context tipado sin importar "Context" (evita TS2614)
  private gsapCtx?: ReturnType<typeof gsap.context>;
  private isBrowser = false;

  // micro loops / cleanup
  private rafId: number | null = null;
  private t0 = 0;
  private io?: IntersectionObserver;
  private cleanupFns: Array<() => void> = [];
  private subs = new Subscription();

  constructor(
    private http: HttpClient,
    private fb: FormBuilder,
    private router: Router,
    private zone: NgZone,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    this.buildForms();
  }

  // ============================================================
  // Lifecycle
  // ============================================================
  ngOnInit(): void {
    this.loadResidents();

    // cuando cambia cualquier selector, cargamos “quick data” del residente
    const watch = (ctrl: FormControl<number | null>) => {
      this.subs.add(
        ctrl.valueChanges.subscribe((id) => {
          if (!id) return;
          this.syncResidentIdAcrossForms(id, ctrl);
          this.loadQuickForResident(id);
        })
      );
    };

    watch(this.vitalsForm.controls.residenteId);
    watch(this.medForm.controls.residenteId);
    watch(this.obsForm.controls.residenteId);
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    const root = this.pageRoot.nativeElement;
    root.style.setProperty('--mx', '50%');
    root.style.setProperty('--my', '35%');
    root.style.setProperty('--t', '0');

    this.startAmbientLoop();

    if (this.prefersReducedMotion()) return;

    this.gsapCtx = gsap.context(() => {
      // ✅ FIX GSAP: convertir NodeList a arrays reales
      const headerEls = Array.from(root.querySelectorAll<HTMLElement>('.js-anim-header'));
      const cards = Array.from(root.querySelectorAll<HTMLElement>('.js-anim-card'));
      const rows = Array.from(root.querySelectorAll<HTMLElement>('.js-anim-row'));
      const kpiValues = Array.from(root.querySelectorAll<HTMLElement>('.kpi__value'));

      if (headerEls.length) gsap.set(headerEls, { opacity: 0, y: 16 });
      if (cards.length) gsap.set(cards, { opacity: 0, y: 16, filter: 'blur(6px)' });
      if (rows.length) gsap.set(rows, { opacity: 0, y: 10 });

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      if (headerEls.length) tl.to(headerEls, { opacity: 1, y: 0, duration: 0.6, stagger: 0.07 }, 0);

      if (cards.length) {
        tl.to(
          cards,
          { opacity: 1, y: 0, duration: 0.65, stagger: 0.10, filter: 'blur(0px)' },
          headerEls.length ? '-=0.22' : 0
        );
      }

      if (rows.length) {
        tl.to(rows, { opacity: 1, y: 0, duration: 0.42, stagger: 0.04 }, cards.length || headerEls.length ? '-=0.28' : 0);
      }

      if (kpiValues.length) {
        tl.fromTo(
          kpiValues,
          { scale: 0.98, filter: 'drop-shadow(0 0 0 rgba(182,203,51,0))' },
          { scale: 1, duration: 0.5, stagger: 0.06, filter: 'drop-shadow(0 10px 26px rgba(182,203,51,.10))' },
          (rows.length || cards.length || headerEls.length) ? '-=0.25' : 0
        );
      }

      this.enableMagneticButtons();
      this.enableFocusPops();
      this.enableRevealOnScroll();
    }, root);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();

    this.gsapCtx?.revert();
    this.cleanupFns.forEach((fn) => {
      try { fn(); } catch { /* ignore */ }
    });
    this.cleanupFns = [];

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.io?.disconnect();
    this.io = undefined;
  }

  // ============================================================
  // Navegación con animación (salida)
  // ============================================================
  async go(url: string, ev?: Event): Promise<void> {
    ev?.preventDefault();
    ev?.stopPropagation();

    if (!this.isBrowser) {
      await this.router.navigateByUrl(url);
      return;
    }

    if (this.isNavigating) return;
    this.isNavigating = true;

    const root = this.pageRoot.nativeElement;

    if (this.prefersReducedMotion()) {
      await this.router.navigateByUrl(url);
      return;
    }

    const wipe = root.querySelector<HTMLElement>('.navWipe');
    const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });

    if (wipe) {
      gsap.set(wipe, { opacity: 1, clipPath: 'polygon(0 0, 0 0, 0 100%, 0 100%)' });
      tl.to(wipe, { duration: 0.35, clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)' }, 0);
    }

    tl.to(root, { duration: 0.28, opacity: 0, y: 10, filter: 'blur(6px)' }, 0.08);

    await new Promise<void>((resolve) => tl.eventCallback('onComplete', () => resolve()));
    await this.router.navigateByUrl(url);
  }

  // ============================================================
  // AUTH (mismo patrón que /residentes)
  // ============================================================
  private getToken(): string | null {
    if (!this.isBrowser) return null;

    const keys = [
      'servimel_token',
      'servimel_token_v1',
      'auth_token',
      'token',
      'jwt',
      'access_token'
    ];

    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v && v.trim()) return v.trim();
    }
    return null;
  }

  private authHeaders(): HttpHeaders {
    const t = this.getToken();
    if (!t) return new HttpHeaders();
    return new HttpHeaders({ Authorization: `Bearer ${t}` });
  }

  // ============================================================
  // BACKEND HELPERS
  // ============================================================
  private unwrap<T>(raw: T | ApiEnvelope<T>): T {
    const r: any = raw as any;
    if (r && typeof r === 'object' && 'ok' in r) {
      if (r.ok === true) return r.data as T;
      throw new Error(r?.error?.message || 'API error');
    }
    return raw as T;
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
      const d = new Date(s.replace(' ', 'T') + 'Z');
      return isNaN(d.getTime()) ? new Date() : d;
    }

    const d = new Date(s);
    return isNaN(d.getTime()) ? new Date() : d;
  }

  private humanHttpError(e: unknown): string {
    const err = e as HttpErrorResponse;

    const msg = (err as any)?.error?.error?.message || (err as any)?.error?.message;
    if (msg) return String(msg);

    if (err?.status) return `HTTP ${err.status} — ${err.statusText || 'Error'}`;
    return 'Error de red/servidor.';
  }

  private syncResidentIdAcrossForms(id: number, source: FormControl<number | null>): void {
    const patch = (ctrl: FormControl<number | null>) => {
      if (ctrl === source) return;
      if (ctrl.value === id) return;
      ctrl.patchValue(id, { emitEvent: false });
    };

    patch(this.vitalsForm.controls.residenteId);
    patch(this.medForm.controls.residenteId);
    patch(this.obsForm.controls.residenteId);
  }

  // ============================================================
  // ✅ URL + FALLBACK (/api <-> sin /api)
  // ============================================================
  private buildUrl(path: string, base: string): string {
    const p = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
    if (!base) return p; // relativo
    return `${base}${p}`;
  }

  private apiCandidates(path: string): string[] {
    const cleanBase = this.BASE; // puede ser '' | 'http://...' | '/api' | 'http://.../api'
    const p = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;

    const urls: string[] = [];
    urls.push(this.buildUrl(p, cleanBase));

    // toggle api prefix
    if (cleanBase.endsWith('/api')) {
      const noApi = cleanBase.replace(/\/api$/, '');
      urls.push(this.buildUrl(p, noApi));
    } else {
      const withApi = `${cleanBase}/api`.replace(/\/+api$/, '/api').replace(/\/$/, '');
      urls.push(this.buildUrl(p, withApi));
    }

    // dedupe
    return Array.from(new Set(urls.filter(Boolean)));
  }

  private getWithFallback<T>(path: string, opts: { headers?: HttpHeaders } = {}): Observable<T> {
    const [u1, u2] = this.apiCandidates(path);
    return this.http.get<T>(u1, opts).pipe(
      catchError((e1: any) => {
        const s = (e1 as HttpErrorResponse)?.status;
        // solo reintenta en 404 / 0 (CORS/red) / 502-504
        if (u2 && (s === 404 || s === 0 || s === 502 || s === 503 || s === 504)) {
          return this.http.get<T>(u2, opts);
        }
        return throwError(() => e1);
      })
    );
  }

  private postWithFallback<T>(path: string, body: any, opts: { headers?: HttpHeaders } = {}): Observable<T> {
    const [u1, u2] = this.apiCandidates(path);
    return this.http.post<T>(u1, body, opts).pipe(
      catchError((e1: any) => {
        const s = (e1 as HttpErrorResponse)?.status;
        if (u2 && (s === 404 || s === 0 || s === 502 || s === 503 || s === 504)) {
          return this.http.post<T>(u2, body, opts);
        }
        return throwError(() => e1);
      })
    );
  }

  // ============================================================
  // Loaders (backend)
  // ============================================================
  private loadResidents(): void {
    this.loadingResidents = true;
    this.lastError = null;

    this.getWithFallback<ApiEnvelope<ResidentListApi> | ResidentListApi>(
      `/residentes?limit=200`,
      { headers: this.authHeaders() }
    )
      .pipe(
        take(1),
        map((raw) => this.unwrap<ResidentListApi>(raw)),
        map((list) =>
          (list?.items || []).map(
            (r) =>
              ({
                id: Number(r.id),
                first_name: r.first_name ?? '',
                last_name: r.last_name ?? '',
                room: r.room ?? null,
                status: (r.status ?? 'estable') as EstadoResidente
              }) as Residente
          )
        ),
        finalize(() => (this.loadingResidents = false))
      )
      .subscribe({
        next: (rows) => {
          this.residentes = rows;

          const firstId = this.residentes[0]?.id ?? null;
          if (firstId !== null) {
            this.vitalsForm.controls.residenteId.patchValue(firstId, { emitEvent: false });
            this.medForm.controls.residenteId.patchValue(firstId, { emitEvent: false });
            this.obsForm.controls.residenteId.patchValue(firstId, { emitEvent: false });
            this.loadQuickForResident(firstId);
          }
        },
        error: (e) => (this.lastError = this.humanHttpError(e))
      });
  }

  private loadQuickForResident(id: number): void {
    if (!id) return;

    if (this.loadingQuick && this.loadedResidentId === id) return;

    if (this.loadedResidentId !== id) {
      this.vitalRecords = [];
      this.meds = [];
      this.observations = [];
    }

    this.loadingQuick = true;
    this.lastError = null;
    this.loadedResidentId = id;

    // ✅ FIX 404: SOLO timeline/historial
    this.getWithFallback<ApiEnvelope<TimelineListApi> | TimelineListApi>(
      `/historial/residentes/${id}?preset=all&limit=60`,
      { headers: this.authHeaders() }
    )
      .pipe(
        take(1),
        map((raw) => this.unwrap<TimelineListApi>(raw)),
        map((tl) => {
          const items = tl?.items || [];

          const vitals: VitalRecord[] = items
            .filter((ev) => ev.event_type === 'vital')
            .slice(0, 6)
            .map((ev) => this.mapVitalFromTimeline(ev, id));

          const meds: MedRecord[] = items
            .filter((ev) => ev.event_type === 'medication')
            .slice(0, 6)
            .map((ev) => ({
              id: ev.ref_id ?? ev.id,
              resident_id: id,
              user_id: ev.user_id ?? null,
              drug_name: ((ev.summary || '').split('·')[0] || ev.title || 'Medicación').trim(),
              dose: null,
              route: null,
              status: this.guessMedStatus(ev.title, ev.summary),
              scheduled_at: this.parseDate(ev.occurred_at),
              administered_at: null,
              notes: ev.summary ?? null
            }));

          const obs: Observation[] = items
            .filter((ev) => ev.event_type === 'observation')
            .slice(0, 6)
            .map((ev) => ({
              id: ev.ref_id ?? ev.id,
              resident_id: id,
              user_id: ev.user_id ?? null,
              type: (ev.title || '').toLowerCase().includes('alerta') ? 'alerta' : 'normal',
              observed_at: this.parseDate(ev.occurred_at),
              text: ev.summary ?? ev.title ?? '',
              resolved_at: null
            }));

          return { vitals, meds, obs };
        }),
        catchError((e) => {
          this.lastError = this.humanHttpError(e);
          return of({ vitals: [], meds: [], obs: [] });
        }),
        finalize(() => (this.loadingQuick = false))
      )
      .subscribe({
        next: ({ vitals, meds, obs }) => {
          this.vitalRecords = Array.isArray(vitals) ? vitals : [];
          this.meds = Array.isArray(meds) ? meds : [];
          this.observations = Array.isArray(obs) ? obs : [];
        }
      });
  }

  private guessMedStatus(title: string, summary: string | null): MedStatus {
    const t = (title || '').toLowerCase();
    const s = (summary || '').toLowerCase();

    if (t.includes('administr') || s.includes('administer')) return 'administered';
    if (t.includes('atras') || s.includes('late')) return 'late';
    if (t.includes('suspend') || s.includes('suspend')) return 'suspended';
    return 'pending';
  }

  private mapVitalFromTimeline(ev: TimelineItemApi, residentId: number): VitalRecord {
    const txt = `${ev.title || ''} ${ev.summary || ''}`.toLowerCase();

    const pickNum = (re: RegExp) => {
      const m = txt.match(re);
      if (!m) return null;
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : null;
    };

    const bpMatch = txt.match(/(\d{2,3})\s*[/\-]\s*(\d{2,3})/);
    const bpSys = bpMatch ? Number(bpMatch[1]) : null;
    const bpDia = bpMatch ? Number(bpMatch[2]) : null;

    const temp = pickNum(/temp(?:eratura)?\s*[:=]?\s*(\d{2}(?:\.\d)?)/);
    const hr = pickNum(/\bfc\b\s*[:=]?\s*(\d{2,3})/);
    const spo2 = pickNum(/sat(?:o2)?\s*[:=]?\s*(\d{2,3})/);
    const pain = pickNum(/dolor\s*[:=]?\s*(\d{1,2})/);

    return {
      id: ev.ref_id ?? ev.id,
      resident_id: residentId,
      user_id: ev.user_id ?? null,
      taken_at: this.parseDate(ev.occurred_at),

      temp_c: temp,
      bp_systolic: Number.isFinite(bpSys as any) ? (bpSys as number) : null,
      bp_diastolic: Number.isFinite(bpDia as any) ? (bpDia as number) : null,
      hr: hr,
      rr: null,
      spo2: spo2,
      pain: pain,
      notes: ev.summary ?? ev.title ?? null
    };
  }

  // ============================================================
  // Mappers API -> UI (POST responses)
  // ============================================================
  private mapVital(v: VitalApi): VitalRecord {
    return {
      id: Number(v.id),
      resident_id: Number(v.resident_id),
      user_id: v.user_id ?? null,
      taken_at: this.parseDate(v.taken_at),
      temp_c: v.temp_c ?? null,
      bp_systolic: v.bp_systolic ?? null,
      bp_diastolic: v.bp_diastolic ?? null,
      hr: v.hr ?? null,
      rr: (v as any).rr ?? null,
      spo2: v.spo2 ?? null,
      pain: v.pain ?? null,
      notes: v.notes ?? null
    };
  }

  private mapMed(m: MedicationApi): MedRecord {
    return {
      id: Number(m.id),
      resident_id: Number(m.resident_id),
      user_id: m.user_id ?? null,
      drug_name: m.drug_name ?? 'Medicación',
      dose: m.dose ?? null,
      route: m.route ?? null,
      status: (m.status ?? 'pending') as MedStatus,
      scheduled_at: this.parseDate(m.scheduled_at),
      administered_at: m.administered_at ? this.parseDate(m.administered_at) : null,
      notes: m.notes ?? null
    };
  }

  private mapObs(o: ObservationApi): Observation {
    return {
      id: Number(o.id),
      resident_id: Number(o.resident_id),
      user_id: o.user_id ?? null,
      type: (o.type ?? 'normal') as ObsType,
      observed_at: this.parseDate(o.observed_at),
      text: o.text ?? '',
      resolved_at: o.resolved_at ? this.parseDate(o.resolved_at) : null
    };
  }

  // ============================================================
  // Builders
  // ============================================================
  private buildForms(): void {
    const bpRegex = /^(\d{2,3})\s*[/\-]\s*(\d{2,3})$/;

    this.vitalsForm = this.fb.group({
      residenteId: this.fb.control<number | null>(null, { validators: [Validators.required] }),
      tension: this.fb.control<string>('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(bpRegex)]
      }),
      fc: this.fb.control<number | null>(null, {
        validators: [Validators.required, Validators.min(20), Validators.max(250)]
      }),
      temp: this.fb.control<number | null>(null, {
        validators: [Validators.required, Validators.min(30), Validators.max(45)]
      }),
      spo2: this.fb.control<number | null>(null, {
        validators: [Validators.required, Validators.min(0), Validators.max(100)]
      }),
      glucemia: this.fb.control<number | null>(null, {
        validators: [Validators.min(0), Validators.max(600)]
      }),
      dolor: this.fb.control<number | null>(null, {
        validators: [Validators.required, Validators.min(0), Validators.max(10)]
      }),
      notas: this.fb.control<string>('', {
        nonNullable: true,
        validators: [Validators.maxLength(140)]
      })
    });

    this.medForm = this.fb.group({
      residenteId: this.fb.control<number | null>(null, { validators: [Validators.required] }),
      medicamento: this.fb.control<string>('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(60)]
      }),
      dosis: this.fb.control<string>('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(30)]
      }),
      horario: this.fb.control<string>('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(/^([01]\d|2[0-3]):[0-5]\d$/)]
      }),
      estado: this.fb.control<MedStatus>('pending', {
        nonNullable: true,
        validators: [Validators.required]
      })
    });

    this.obsForm = this.fb.group({
      residenteId: this.fb.control<number | null>(null, { validators: [Validators.required] }),
      tipo: this.fb.control<ObsType>('normal', {
        nonNullable: true,
        validators: [Validators.required]
      }),
      texto: this.fb.control<string>('', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(4), Validators.maxLength(380)]
      })
    });
  }

  // ============================================================
  // Getters UX
  // ============================================================
  get residentesFiltrados(): Residente[] {
    const q = this.residentSearch.trim().toLowerCase();
    if (!q) return this.residentes;
    return this.residentes.filter((r) =>
      `${r.first_name} ${r.last_name} ${r.room ?? ''}`.toLowerCase().includes(q)
    );
  }

  get lastVitals(): VitalRecord[] {
    return (this.vitalRecords || []).slice(0, 6);
  }

  get lastMeds(): MedRecord[] {
    return (this.meds || []).slice(0, 6);
  }

  get lastObs(): Observation[] {
    return (this.observations || []).slice(0, 6);
  }

  get kpiRegistrosHoy(): number {
    const start = this.startOfToday();
    const vitalsToday = (this.vitalRecords || []).filter((v) => v.taken_at >= start).length;
    const medsToday = (this.meds || []).filter((m) => m.scheduled_at >= start).length;
    const obsToday = (this.observations || []).filter((o) => o.observed_at >= start).length;
    return vitalsToday + medsToday + obsToday;
  }

  get kpiAlertas(): number {
    const start = this.startOfToday();
    return (this.observations || []).filter(
      (o) => o.observed_at >= start && o.type === 'alerta' && !o.resolved_at
    ).length;
  }

  get kpiMedsPendientes(): number {
    return (this.meds || []).filter((m) => m.status === 'pending' || m.status === 'late').length;
  }

  // ============================================================
  // Actions (REAL BACKEND)
  // ============================================================
  guardarSignos(): void {
    this.touchAll(this.vitalsForm);
    if (this.vitalsForm.invalid) return;

    const v = this.vitalsForm.getRawValue();
    if (v.residenteId === null) return;

    const bp = this.parseBP(v.tension);
    if (!bp) {
      this.vitalsForm.controls.tension.setErrors({ pattern: true });
      return;
    }

    this.saving = true;
    this.lastError = null;

    const body = {
      taken_at: new Date().toISOString(),
      temp_c: v.temp !== null ? Number(v.temp) : null,
      bp_systolic: bp.sys,
      bp_diastolic: bp.dia,
      hr: v.fc !== null ? Number(v.fc) : null,
      spo2: v.spo2 !== null ? Number(v.spo2) : null,
      pain: v.dolor !== null ? Number(v.dolor) : null,
      notes: (v.notas || '').trim() || null
    };

    this.postWithFallback<ApiEnvelope<VitalApi> | VitalApi>(
      `/enfermeria/residentes/${v.residenteId}/vitals`,
      body,
      { headers: this.authHeaders() }
    )
      .pipe(
        take(1),
        map((raw) => this.unwrap<VitalApi>(raw)),
        finalize(() => (this.saving = false))
      )
      .subscribe({
        next: (created) => {
          this.vitalRecords = [this.mapVital(created), ...(this.vitalRecords || [])];

          const keepRes = v.residenteId;
          this.vitalsForm.reset({
            residenteId: keepRes,
            tension: '',
            fc: null,
            temp: null,
            spo2: null,
            glucemia: null,
            dolor: null,
            notas: ''
          });

          this.bumpEntranceRows();
          this.pulseKpi('.kpi-panel .kpi:nth-child(1) .kpi__value');
        },
        error: (e) => (this.lastError = this.humanHttpError(e))
      });
  }

  registrarMedicacion(): void {
    this.touchAll(this.medForm);
    if (this.medForm.invalid) return;

    const m = this.medForm.getRawValue();
    if (m.residenteId === null) return;

    this.saving = true;
    this.lastError = null;

    const scheduledAtIso = this.combineTodayTimeToIso(m.horario);

    const body = {
      drug_name: m.medicamento.trim(),
      dose: m.dosis.trim() || null,
      route: null,
      status: m.estado,
      scheduled_at: scheduledAtIso,
      administered_at: m.estado === 'administered' ? new Date().toISOString() : null,
      notes: null
    };

    this.postWithFallback<ApiEnvelope<MedicationApi> | MedicationApi>(
      `/enfermeria/residentes/${m.residenteId}/medications`,
      body,
      { headers: this.authHeaders() }
    )
      .pipe(
        take(1),
        map((raw) => this.unwrap<MedicationApi>(raw)),
        finalize(() => (this.saving = false))
      )
      .subscribe({
        next: (created) => {
          this.meds = [this.mapMed(created), ...(this.meds || [])];

          const keepRes = m.residenteId;
          this.medForm.reset({
            residenteId: keepRes,
            medicamento: '',
            dosis: '',
            horario: '',
            estado: 'pending'
          });

          this.bumpEntranceRows();
          this.pulseKpi('.kpi-panel .kpi:nth-child(3) .kpi__value');
        },
        error: (e) => (this.lastError = this.humanHttpError(e))
      });
  }

  guardarObservacion(): void {
    this.touchAll(this.obsForm);
    if (this.obsForm.invalid) return;

    const o = this.obsForm.getRawValue();
    if (o.residenteId === null) return;

    this.saving = true;
    this.lastError = null;

    const body = {
      type: o.tipo,
      text: o.texto.trim(),
      observed_at: new Date().toISOString()
    };

    this.postWithFallback<ApiEnvelope<ObservationApi> | ObservationApi>(
      `/enfermeria/residentes/${o.residenteId}/observations`,
      body,
      { headers: this.authHeaders() }
    )
      .pipe(
        take(1),
        map((raw) => this.unwrap<ObservationApi>(raw)),
        finalize(() => (this.saving = false))
      )
      .subscribe({
        next: (created) => {
          this.observations = [this.mapObs(created), ...(this.observations || [])];

          const keepRes = o.residenteId;
          this.obsForm.reset({
            residenteId: keepRes,
            tipo: 'normal',
            texto: ''
          });

          this.bumpEntranceRows();
          if (created.type === 'alerta') this.pulseKpi('.kpi-panel .kpi:nth-child(2) .kpi__value');
        },
        error: (e) => (this.lastError = this.humanHttpError(e))
      });
  }

  // ============================================================
  // UI helpers
  // ============================================================
  residenteLabel(id: number): string {
    const r = this.residentes.find((x) => x.id === id);
    if (!r) return '—';
    return `${r.first_name} ${r.last_name} · Hab. ${r.room ?? '—'}`;
  }

  vitalBpLabel(v: VitalRecord): string {
    const s = v.bp_systolic ?? '—';
    const d = v.bp_diastolic ?? '—';
    return `${s}/${d}`;
  }

  medStatusLabel(s: MedStatus): string {
    switch (s) {
      case 'pending': return 'Pendiente';
      case 'administered': return 'Administrada';
      case 'late': return 'Atrasada';
      case 'suspended': return 'Suspendida';
    }
  }

  medStatusClass(s: MedStatus): string {
    switch (s) {
      case 'administered': return 'chip chip--ok';
      case 'pending': return 'chip chip--info';
      case 'late': return 'chip chip--danger';
      case 'suspended': return 'chip chip--muted';
    }
  }

  obsTypeClass(t: ObsType): string {
    return t === 'alerta' ? 'chip chip--danger' : 'chip chip--muted';
  }

  obsTypeLabel(t: ObsType): string {
    return t === 'alerta' ? 'Alerta' : 'Normal';
  }

  isInvalid(form: FormGroup, controlName: string): boolean {
    const c = form.get(controlName);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  // ============================================================
  // Anim helpers
  // ============================================================
  private bumpEntranceRows(): void {
    if (!this.isBrowser) return;
    if (this.prefersReducedMotion()) return;

    const root = this.pageRoot.nativeElement;
    const newRows = root.querySelectorAll<HTMLElement>('.js-row-new');
    if (!newRows.length) return;

    gsap.fromTo(
      newRows,
      { opacity: 0, y: 12, filter: 'blur(4px)' },
      { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.45, stagger: 0.04, ease: 'power3.out' }
    );

    newRows.forEach((el) => el.classList.remove('js-row-new'));
  }

  private pulseKpi(selector: string): void {
    if (!this.isBrowser) return;
    if (this.prefersReducedMotion()) return;

    const root = this.pageRoot.nativeElement;
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) return;

    gsap.fromTo(
      el,
      { scale: 1, filter: 'drop-shadow(0 0 0 rgba(182,203,51,0))' },
      {
        scale: 1.06,
        duration: 0.18,
        yoyo: true,
        repeat: 1,
        ease: 'power2.out',
        filter: 'drop-shadow(0 14px 36px rgba(182,203,51,.18))'
      }
    );
  }

  private touchAll(form: FormGroup): void {
    Object.values(form.controls).forEach((ctrl: AbstractControl) => ctrl.markAsTouched());
  }

  private prefersReducedMotion(): boolean {
    if (!this.isBrowser) return true;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  }

  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private combineTodayTimeToIso(hhmm: string): string {
    const [h, m] = (hhmm || '00:00').split(':').map((x) => Number(x));
    const d = new Date();
    d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    return d.toISOString();
  }

  private parseBP(input: string): { sys: number | null; dia: number | null } | null {
    const m = String(input || '').trim().match(/^(\d{2,3})\s*[/\-]\s*(\d{2,3})$/);
    if (!m) return null;
    const sys = Number(m[1]);
    const dia = Number(m[2]);
    if (!Number.isFinite(sys) || !Number.isFinite(dia)) return null;
    return { sys, dia };
  }

  // ============================================================
  // Ambient loop (CSS vars) - fuera de Angular
  // ============================================================
  private startAmbientLoop(): void {
    if (!this.isBrowser) return;

    this.zone.runOutsideAngular(() => {
      this.t0 = performance.now();

      const tick = (t: number) => {
        const dt = (t - this.t0) / 1000;
        this.pageRoot.nativeElement.style.setProperty('--t', dt.toFixed(3));
        this.rafId = requestAnimationFrame(tick);
      };

      this.rafId = requestAnimationFrame(tick);
    });
  }

  // ============================================================
  // Mouse parallax (súper sutil)
  // ============================================================
  @HostListener('mousemove', ['$event'])
  onMouseMove(ev: MouseEvent): void {
    if (!this.isBrowser) return;

    const root = this.pageRoot.nativeElement;
    const rect = root.getBoundingClientRect();

    const x = ((ev.clientX - rect.left) / Math.max(rect.width, 1)) * 100;
    const y = ((ev.clientY - rect.top) / Math.max(rect.height, 1)) * 100;

    root.style.setProperty('--mx', `${x.toFixed(2)}%`);
    root.style.setProperty('--my', `${y.toFixed(2)}%`);
  }

  // ============================================================
  // Magnetic buttons (GSAP)
  // ============================================================
  private enableMagneticButtons(): void {
    const root = this.pageRoot.nativeElement;
    const btns = Array.from(root.querySelectorAll<HTMLElement>('.btn'));
    const cleanups: Array<() => void> = [];

    btns.forEach((btn) => {
      const onMove = (e: PointerEvent) => {
        const r = btn.getBoundingClientRect();
        const mx = e.clientX - (r.left + r.width / 2);
        const my = e.clientY - (r.top + r.height / 2);
        gsap.to(btn, { x: mx * 0.12, y: my * 0.12, duration: 0.25, ease: 'power3.out' });
      };

      const onLeave = () => {
        gsap.to(btn, { x: 0, y: 0, duration: 0.35, ease: 'elastic.out(1, 0.55)' });
      };

      btn.addEventListener('pointermove', onMove, { passive: true });
      btn.addEventListener('pointerleave', onLeave);

      cleanups.push(() => {
        btn.removeEventListener('pointermove', onMove);
        btn.removeEventListener('pointerleave', onLeave);
      });
    });

    this.cleanupFns.push(...cleanups);
  }

  // ============================================================
  // Focus pops (inputs) - JS + GSAP
  // ============================================================
  private enableFocusPops(): void {
    const root = this.pageRoot.nativeElement;
    const inputs = Array.from(root.querySelectorAll<HTMLElement>('.input'));
    const cleanups: Array<() => void> = [];

    inputs.forEach((el) => {
      const onFocus = () => {
        gsap.fromTo(el, { scale: 0.995 }, { scale: 1, duration: 0.26, ease: 'power3.out' });
      };

      const onInvalidShake = () => {
        if (!el.classList.contains('input--invalid')) return;
        gsap.fromTo(el, { x: -2 }, { x: 2, duration: 0.06, repeat: 5, yoyo: true, ease: 'power1.inOut' });
        gsap.to(el, { x: 0, duration: 0.12, ease: 'power2.out' });
      };

      el.addEventListener('focus', onFocus, true);
      el.addEventListener('blur', onInvalidShake, true);

      cleanups.push(() => {
        el.removeEventListener('focus', onFocus, true);
        el.removeEventListener('blur', onInvalidShake, true);
      });
    });

    this.cleanupFns.push(...cleanups);
  }

  // ============================================================
  // Reveal on scroll (IntersectionObserver)
  // ============================================================
  private enableRevealOnScroll(): void {
    if (!this.isBrowser) return;

    const root = this.pageRoot.nativeElement;
    const items = Array.from(root.querySelectorAll<HTMLElement>('.list-item'));
    if (!items.length) return;

    this.io?.disconnect();

    this.io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;

          if (el.dataset['reveal'] === '1') return;
          el.dataset['reveal'] = '1';

          gsap.fromTo(
            el,
            { opacity: 0, y: 12, filter: 'blur(4px)' },
            { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.45, ease: 'power3.out' }
          );

          this.io?.unobserve(el);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -10% 0px' }
    );

    items.forEach((el) => this.io?.observe(el));
  }
}
