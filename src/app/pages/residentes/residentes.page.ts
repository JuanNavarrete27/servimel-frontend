// src/app/pages/residentes/residentes.page.ts
import {
  Component,
  AfterViewInit,
  OnDestroy,
  ElementRef,
  Inject,
  PLATFORM_ID,
  HostListener,
  OnInit,
} from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import {
  HttpClient,
  HttpClientModule,
  HttpErrorResponse,
  HttpHeaders
} from '@angular/common/http';
import { finalize, map, switchMap, take } from 'rxjs/operators';
import { API_CONFIG } from '../../core/config/api.config';

/* =========================
   UI TYPES (Frontend)
========================= */
type EstadoResidente = 'estable' | 'observacion' | 'critico';

type MedEstado = 'pendiente' | 'administrada' | 'atrasada' | 'suspendida';
type ObsTipo = 'normal' | 'alerta';

type MedicacionRow = {
  id: number; // ⚠️ en esta pantalla lo vamos a mapear desde timeline_event.id
  medicamento: string;
  dosis: string;
  horario: string; // "HH:MM"
  estado: MedEstado;
  updatedAt?: string;
  updatedBy?: string;
};

type ObservacionRow = {
  id: number; // ⚠️ timeline_event.id
  fecha: string; // ISO
  tipo: ObsTipo;
  texto: string;
  updatedAt?: string;
  updatedBy?: string;
};

type HistorialRow = {
  id: number; // timeline_event.id
  fecha: string; // ISO
  titulo: string;
  detalle?: string;
  by: string;
};

type AuditoriaRow = {
  id: number;
  fecha: string;
  accion: 'create' | 'update' | 'delete';
  modulo: 'residentes' | 'medicacion' | 'observaciones' | 'historial';
  campo?: string;
  before?: string;
  after?: string;
  by: string;
};

type Residente = {
  id: number;
  nombre: string;
  documento: string;
  habitacion: string;
  estado: EstadoResidente;

  notas?: string;
  contactoNombre?: string;
  contactoTel?: string;

  medicacion: MedicacionRow[];
  observaciones: ObservacionRow[];
  historial: HistorialRow[];
  auditoria: AuditoriaRow[];
};

type Resumen = {
  medsPend: number;
  medsAtras: number;
  obsAlert: number;
};

/* =========================
   BACKEND TYPES (DB-aligned)
========================= */
type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string; details?: any } };
type ApiEnvelope<T> = ApiOk<T> | ApiFail;

type ResidentApi = {
  id: number;
  first_name: string;
  last_name: string;
  document_number: string | null;
  room: string | null;
  status: EstadoResidente; // backend usa 'estable'|'observacion'|'critico'
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  is_active: number | boolean;
  created_at?: string;
  updated_at?: string;
};

type ResidentListApi = {
  page: number;
  limit: number;
  total: number;
  items: ResidentApi[];
};

// timeline backend
type TimelineItemApi = {
  id: number;
  resident_id: number;
  user_id: number | null;
  event_type: 'vital' | 'medication' | 'observation' | 'profile' | 'other';
  ref_table: 'vitals' | 'medications' | 'observations' | string;
  ref_id: number;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  summary: string | null;
  occurred_at: string; // "YYYY-MM-DD HH:mm:ss"
  created_at: string;
  user_email?: string | null;
  user_first_name?: string | null;
  user_last_name?: string | null;
};

type TimelineListApi = {
  page: number;
  limit: number;
  total: number;
  items: TimelineItemApi[];
};

@Component({
  selector: 'app-residentes-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, HttpClientModule],
  templateUrl: './residentes.page.html',
  styleUrls: ['./residentes.page.scss'],
})
export class ResidentesPage implements OnInit, AfterViewInit, OnDestroy {
  // ✅ Backend real (sin /api)
  private readonly API = API_CONFIG.baseUrl; // http://localhost:3000

  currentUser = 'Sesión activa'; // si querés, lo sacás del /auth/me
  mvpVersion = 'v0.1 (MVP)';

  q = '';
  filtro: 'todos' | EstadoResidente = 'todos';

  selectedId: number | null = null;
  tab: 'resumen' | 'medicacion' | 'observaciones' | 'historial' | 'auditoria' = 'resumen';

  editingMedId: number | null = null;
  medDraft: Partial<MedicacionRow> = {};

  editingObsId: number | null = null;
  obsDraft: Partial<ObservacionRow> = {};

  newObsText = '';
  newObsTipo: ObsTipo = 'normal';

  newMedNombre = '';
  newMedDosis = '';
  newMedHora = '08:00';

  loadingList = false;
  loadingDetail = false;
  saving = false;
  lastError: string | null = null;

  residentes: Residente[] = [];

  private gsapCleanup: (() => void) | null = null;

  // ✅ navegación con animación (lock anti doble click)
  private navLock = false;

  constructor(
    private http: HttpClient,
    private router: Router,
    private host: ElementRef<HTMLElement>,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  ngOnInit(): void {
    this.loadResidentes();
  }

  /* =========================
     GSAP ENTER (pro)
  ========================= */
  async ngAfterViewInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    this.setMouseVars(50, 35);

    try {
      const mod = await import('gsap');
      const gsap = mod.gsap;

      const root = this.host.nativeElement;

      const ctx = gsap.context(() => {
        const head = root.querySelector('.head');
        const toolbar = root.querySelector('.toolbar');
        const rows = Array.from(root.querySelectorAll('.row'));
        const list = root.querySelector('.list');

        gsap.set([head, toolbar, list], { opacity: 1 });

        const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
        tl.from(head, { y: 10, opacity: 0, duration: 0.55 })
          .from(toolbar, { y: 10, opacity: 0, duration: 0.45 }, '-=0.32')
          .from(list, { y: 8, opacity: 0, duration: 0.4 }, '-=0.28');

        if (rows.length) {
          tl.from(rows, { y: 10, opacity: 0, duration: 0.34, stagger: 0.05 }, '-=0.18')
            .from(
              rows.map(r => r.querySelector('.statebar')).filter(Boolean),
              { scaleY: 0, transformOrigin: 'center', duration: 0.22, stagger: 0.03 },
              '-=0.30'
            );
        }
      }, root);

      this.gsapCleanup = () => ctx.revert();
    } catch {
      // sin gsap, sin drama
    }
  }

  ngOnDestroy(): void {
    this.gsapCleanup?.();
    this.gsapCleanup = null;
  }

  /* =========================
     Mouse vars (glow global)
  ========================= */
  @HostListener('mousemove', ['$event'])
  onMove(ev: MouseEvent): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const x = (ev.clientX / (window.innerWidth || 1)) * 100;
    const y = (ev.clientY / (window.innerHeight || 1)) * 100;
    this.setMouseVars(x, y);
  }

  @HostListener('mouseleave')
  onLeave(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.setMouseVars(50, 35);
  }

  private setMouseVars(xPct: number, yPct: number): void {
    const x = Math.max(0, Math.min(100, xPct));
    const y = Math.max(0, Math.min(100, yPct));
    document.documentElement.style.setProperty('--mx', `${x.toFixed(2)}%`);
    document.documentElement.style.setProperty('--my', `${y.toFixed(2)}%`);
  }

  /* =========================
     AUTH (✅ FIX)
  ========================= */
  private getToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;

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

  /* =========================
     BACKEND HELPERS
  ========================= */
  private unwrap<T>(raw: T | ApiEnvelope<T>): T {
    const r: any = raw as any;
    if (r && typeof r === 'object' && 'ok' in r) {
      if (r.ok === true) return r.data as T;
      throw new Error(r?.error?.message || 'API error');
    }
    return raw as T;
  }

  private mapResident(api: ResidentApi): Residente {
    const nombre = `${api.first_name ?? ''} ${api.last_name ?? ''}`.trim();

    return {
      id: Number(api.id),
      nombre: nombre || `Residente #${api.id}`,
      documento: api.document_number ?? '',
      habitacion: api.room ?? '',
      estado: (api.status ?? 'estable') as EstadoResidente,

      notas: api.notes ?? '',
      contactoNombre: api.emergency_contact_name ?? '',
      contactoTel: api.emergency_contact_phone ?? '',

      medicacion: [],
      observaciones: [],
      historial: [],
      auditoria: []
    };
  }

  private timelineUserLabel(t: TimelineItemApi): string {
    const fn = (t.user_first_name ?? '').trim();
    const ln = (t.user_last_name ?? '').trim();
    const full = `${fn} ${ln}`.trim();
    return full || (t.user_email ?? 'Sistema');
  }

  private hhmmFromOccurredAt(occurredAt: string): string {
    const m = String(occurredAt || '').match(/\s(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : '00:00';
  }

  private mapMedStatusFromBackend(summary: string | null): MedEstado {
    const s = (summary || '').toLowerCase();
    if (s.includes('administered')) return 'administrada';
    if (s.includes('late')) return 'atrasada';
    if (s.includes('suspended')) return 'suspendida';
    return 'pendiente';
  }

  private mapObsTypeFromTitle(title: string): ObsTipo {
    const t = (title || '').toLowerCase();
    return t.includes('alerta') ? 'alerta' : 'normal';
  }

  /* =========================
     BACKEND LOADERS
  ========================= */
  private loadResidentes(): void {
    this.loadingList = true;
    this.lastError = null;

    this.http
      .get<ApiEnvelope<ResidentListApi> | ResidentListApi>(
        `${this.API}/residentes?limit=200`,
        { headers: this.authHeaders() }
      )
      .pipe(
        take(1),
        map(raw => this.unwrap<ResidentListApi>(raw)),
        map(list => (list?.items || []).map(r => this.mapResident(r))),
        finalize(() => (this.loadingList = false))
      )
      .subscribe({
        next: (rows) => {
          this.residentes = rows;
          // ✅ IMPORTANTE: no auto-cargamos detalle acá, porque ahora esta pantalla navega a /residentes/:id
        },
        error: (e) => {
          this.lastError = this.humanHttpError(e);
        }
      });
  }

  private loadResidenteDetalle(id: number): void {
    // (queda por compat si todavía lo usás en otra parte, pero ya no es el flujo principal)
    this.loadingDetail = true;
    this.lastError = null;

    this.http
      .get<ApiEnvelope<ResidentApi> | ResidentApi>(
        `${this.API}/residentes/${id}`,
        { headers: this.authHeaders() }
      )
      .pipe(
        take(1),
        map(raw => this.unwrap<ResidentApi>(raw)),
        switchMap((residentApi) => {
          const base = this.mapResident(residentApi);

          return this.http
            .get<ApiEnvelope<TimelineListApi> | TimelineListApi>(
              `${this.API}/historial/residentes/${id}?preset=all&limit=200`,
              { headers: this.authHeaders() }
            )
            .pipe(
              take(1),
              map(raw => this.unwrap<TimelineListApi>(raw)),
              map(tl => {
                const items = tl?.items || [];

                const historial: HistorialRow[] = items.map(ev => ({
                  id: ev.id,
                  fecha: ev.occurred_at,
                  titulo: ev.title,
                  detalle: ev.summary ?? '',
                  by: this.timelineUserLabel(ev)
                }));

                const medicacion: MedicacionRow[] = items
                  .filter(ev => ev.event_type === 'medication')
                  .map(ev => ({
                    id: ev.id,
                    medicamento: (ev.summary || '').split('·')[0]?.trim() || 'Medicación',
                    dosis: '',
                    horario: this.hhmmFromOccurredAt(ev.occurred_at),
                    estado: this.mapMedStatusFromBackend(ev.summary),
                    updatedAt: ev.occurred_at,
                    updatedBy: this.timelineUserLabel(ev)
                  }));

                const observaciones: ObservacionRow[] = items
                  .filter(ev => ev.event_type === 'observation')
                  .map(ev => ({
                    id: ev.id,
                    fecha: ev.occurred_at,
                    tipo: this.mapObsTypeFromTitle(ev.title),
                    texto: ev.summary ?? '',
                    updatedAt: ev.occurred_at,
                    updatedBy: this.timelineUserLabel(ev)
                  }));

                return {
                  ...base,
                  historial,
                  medicacion,
                  observaciones
                } as Residente;
              })
            );
        }),
        finalize(() => (this.loadingDetail = false))
      )
      .subscribe({
        next: (detail) => {
          const idx = this.residentes.findIndex(r => r.id === id);
          if (idx >= 0) this.residentes[idx] = detail;
          else this.residentes = [detail, ...this.residentes];

          this.selectedId = id;
        },
        error: (e) => {
          this.lastError = this.humanHttpError(e);
        }
      });
  }

  /* =========================
     FILTERED LIST
  ========================= */
  get filtered(): Residente[] {
    const term = this.q.trim().toLowerCase();

    const searched = !term
      ? this.residentes
      : this.residentes.filter(r =>
          (r.nombre || '').toLowerCase().includes(term) ||
          (r.documento || '').toLowerCase().includes(term) ||
          (r.habitacion || '').toLowerCase().includes(term)
        );

    if (this.filtro === 'todos') return searched;
    return searched.filter(r => r.estado === this.filtro);
  }

  get totalCount(): number {
    return this.filtered.length;
  }
  get establesCount(): number {
    return this.filtered.filter(r => r.estado === 'estable').length;
  }
  get observacionCount(): number {
    return this.filtered.filter(r => r.estado === 'observacion').length;
  }
  get criticosCount(): number {
    return this.filtered.filter(r => r.estado === 'critico').length;
  }

  /* =========================
     NAVIGATE TO DETAILS (✅ LO QUE PEDISTE)
     - click card -> /residentes/:id
     - animación GSAP si existe, fallback CSS si no
  ========================= */
  async openDetalle(id: number, ev?: Event): Promise<void> {
    if (this.navLock) return;
    this.navLock = true;

    // SSR/No browser
    if (!isPlatformBrowser(this.platformId)) {
      await this.router.navigate(['/residentes', id]);
      this.navLock = false;
      return;
    }

    const root = this.host.nativeElement;
    const rowEl = (ev?.currentTarget as HTMLElement) || null;

    // Fallback CSS (por si no hay GSAP)
    root.classList.add('is-leaving');

    try {
      const mod = await import('gsap');
      const gsap = mod.gsap;

      await new Promise<void>((resolve) => {
        const tl = gsap.timeline({
          defaults: { ease: 'power2.inOut' },
          onComplete: () => resolve()
        });

        if (rowEl) {
          tl.to(rowEl, { scale: 0.985, duration: 0.08 }, 0)
            .to(rowEl, { scale: 1, duration: 0.14 }, 0.08);
        }

        tl.to(root, { opacity: 0, y: -8, duration: 0.22 }, 0.06);
      });
    } catch {
      // sin gsap -> dejamos el fallback CSS hacer su laburo
      await new Promise(r => setTimeout(r, 220));
    }

    try {
      await this.router.navigate(['/residentes', id]);
    } finally {
      // anti doble click
      setTimeout(() => (this.navLock = false), 450);
    }
  }

  /* =========================
     SELECTED (queda por compat)
  ========================= */
  select(id: number): void {
    this.selectedId = id;
    this.tab = 'resumen';
    this.cancelMedEdit();
    this.cancelObsEdit();

    this.loadResidenteDetalle(id);
  }

  get selected(): Residente | null {
    return this.residentes.find(r => r.id === this.selectedId) ?? null;
  }

  get resumen(): Resumen {
    const r = this.selected;
    if (!r) return { medsPend: 0, medsAtras: 0, obsAlert: 0 };

    return {
      medsPend: (r.medicacion ?? []).filter(m => m.estado === 'pendiente').length,
      medsAtras: (r.medicacion ?? []).filter(m => m.estado === 'atrasada').length,
      obsAlert: (r.observaciones ?? []).filter(o => o.tipo === 'alerta').length,
    };
  }

  estadoLabel(e: EstadoResidente): string {
    if (e === 'estable') return 'Estable';
    if (e === 'observacion') return 'Observación';
    return 'Crítico';
  }

  /* =========================
     MEDICACIÓN (REAL BACKEND)
     POST /enfermeria/residentes/:id/medications
  ========================= */
  startMedEdit(row: MedicacionRow): void {
    this.editingMedId = row.id;
    this.medDraft = { ...row };
  }

  cancelMedEdit(): void {
    this.editingMedId = null;
    this.medDraft = {};
  }

  saveMedEdit(): void {
    this.lastError = 'Editar medicación aún no está conectado al backend (faltan endpoints de listing/edición por medication.id).';
    this.cancelMedEdit();
  }

  addMedMock(): void {
    const r = this.selected;
    if (!r) return;

    const nombre = this.clean(this.newMedNombre);
    const dosis = this.clean(this.newMedDosis);
    const hora = this.clean(this.newMedHora);
    if (!nombre || !dosis || !hora) return;

    this.saving = true;
    this.lastError = null;

    const scheduledAtIso = this.combineTodayTimeToIso(hora);

    this.http
      .post<ApiEnvelope<any> | any>(
        `${this.API}/enfermeria/residentes/${r.id}/medications`,
        {
          drug_name: nombre,
          dose: dosis,
          route: null,
          status: 'pending',
          scheduled_at: scheduledAtIso,
          administered_at: null,
          notes: null
        },
        { headers: this.authHeaders() }
      )
      .pipe(
        take(1),
        finalize(() => (this.saving = false))
      )
      .subscribe({
        next: () => {
          this.newMedNombre = '';
          this.newMedDosis = '';
          this.newMedHora = '08:00';
          this.loadResidenteDetalle(r.id);
        },
        error: (e) => (this.lastError = this.humanHttpError(e))
      });
  }

  setMedEstado(row: MedicacionRow, estado: MedEstado): void {
    this.lastError = 'Cambiar estado de medicación aún no está conectado (faltan endpoints PATCH meds/:id).';
  }

  /* =========================
     OBSERVACIONES (REAL BACKEND)
     POST /enfermeria/residentes/:id/observations
  ========================= */
  startObsEdit(row: ObservacionRow): void {
    this.editingObsId = row.id;
    this.obsDraft = { ...row };
  }

  cancelObsEdit(): void {
    this.editingObsId = null;
    this.obsDraft = {};
  }

  saveObsEdit(): void {
    this.lastError = 'Editar observación aún no está conectado al backend (faltan endpoints de listing/edición por observation.id).';
    this.cancelObsEdit();
  }

  addObsMock(): void {
    const r = this.selected;
    if (!r) return;

    const txt = this.clean(this.newObsText);
    if (!txt) return;

    this.saving = true;
    this.lastError = null;

    this.http
      .post<ApiEnvelope<any> | any>(
        `${this.API}/enfermeria/residentes/${r.id}/observations`,
        {
          type: this.newObsTipo,
          text: txt,
          observed_at: new Date().toISOString()
        },
        { headers: this.authHeaders() }
      )
      .pipe(
        take(1),
        finalize(() => (this.saving = false))
      )
      .subscribe({
        next: () => {
          this.newObsText = '';
          this.newObsTipo = 'normal';
          this.loadResidenteDetalle(r.id);
        },
        error: (e) => (this.lastError = this.humanHttpError(e))
      });
  }

  /* =========================
     TEMPLATE HELPERS
  ========================= */
  trackById(_: number, row: { id: number }): number {
    return row.id;
  }

  /* =========================
     UTILS
  ========================= */
  private clean(v: unknown): string {
    return String(v ?? '').trim();
  }

  private combineTodayTimeToIso(hhmm: string): string {
    const [h, m] = (hhmm || '00:00').split(':').map(x => Number(x));
    const d = new Date();
    d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    return d.toISOString();
  }

  private humanHttpError(e: unknown): string {
    const err = e as HttpErrorResponse;

    const msg = (err as any)?.error?.error?.message || (err as any)?.error?.message;
    if (msg) return String(msg);

    if (err?.status) return `HTTP ${err.status} — ${err.statusText || 'Error'}`;
    return 'Error de red/servidor.';
  }
}
