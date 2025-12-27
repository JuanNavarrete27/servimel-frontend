// residente-detalle.page.ts
import {
  Component,
  HostListener,
  Inject,
  PLATFORM_ID,
  OnDestroy,
  NgZone,
  AfterViewInit,
  ElementRef,
  OnInit,
  ViewChild,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  HttpClient,
  HttpClientModule,
  HttpErrorResponse,
  HttpHeaders
} from '@angular/common/http';
import { Subscription, of } from 'rxjs';
import { catchError, finalize, map, switchMap, take } from 'rxjs/operators';
import { API_CONFIG } from '../../core/config/api.config';

type TabKey = 'signos' | 'medicacion' | 'observaciones' | 'historial';
type EstadoResidente = 'estable' | 'observacion' | 'critico';

type MedEstado = 'pendiente' | 'administrada' | 'atrasada' | 'suspendida';
type ObsTipo = 'normal' | 'alerta';

type SignosRow = {
  id: number;
  fecha: string; // ISO o "YYYY-MM-DDTHH:mm:ss"
  temp: string;
  presion: string;
  pulso: string;
  by: string;
};

type MedicacionRow = {
  id: number;
  medicamento: string;
  dosis: string;
  horario: string; // "08:00"
  estado: MedEstado;
  updatedAt?: string;
  updatedBy?: string;
};

type ObservacionRow = {
  id: number;
  fecha: string;
  tipo: ObsTipo;
  texto: string;
  updatedAt?: string;
  updatedBy?: string;
};

type HistorialRow = {
  id: number;
  fecha: string;
  titulo: string;
  detalle?: string;
  by: string;
};

type AuditoriaRow = {
  id: number;
  fecha: string;
  accion: 'create' | 'update' | 'delete';
  modulo: 'signos' | 'medicacion' | 'observaciones' | 'historial' | 'residentes';
  campo?: string;
  before?: string;
  after?: string;
  by: string;
};

type ResidenteDetail = {
  id: number;
  nombre: string;
  habitacion: string;
  estado: EstadoResidente;
  notas?: string;
  contactoNombre?: string;
  contactoTel?: string;

  signos: SignosRow[];
  medicacion: MedicacionRow[];
  observaciones: ObservacionRow[];
  historial: HistorialRow[];
  auditoria: AuditoriaRow[];
};

type Resumen = {
  medsPend: number;
  medsAtras: number;
  medsAdmin: number;
  obsAlert: number;
  lastSigno: SignosRow | null;
};

/* =========================
   BACKEND TYPES
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
  status: EstadoResidente;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  is_active: number | boolean;
  created_at?: string;
  updated_at?: string;
};

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
  selector: 'app-residente-detalle-page',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, HttpClientModule],
  templateUrl: './residente-detalle.page.html',
  styleUrls: ['./residente-detalle.page.scss'],
})
export class ResidenteDetallePage implements OnInit, AfterViewInit, OnDestroy {
  private readonly API = API_CONFIG.baseUrl;

  @ViewChild('pdfRoot', { static: false }) pdfRoot!: ElementRef<HTMLElement>;

  id = 0;
  tab: TabKey = 'signos';

  currentUser = 'Sesión activa';

  // ===== PDF =====
  pdfLoading = false;
  exportMode = false; // ✅ cuando true: NO muestra formularios, muestra todo en lectura

  // ===== Edit mocks (mantengo para app, pero NO salen en PDF) =====
  editingMedId: number | null = null;
  medDraft: Partial<MedicacionRow> = {};

  editingObsId: number | null = null;
  obsDraft: Partial<ObservacionRow> = {};

  temp = '';
  presion = '';
  pulso = '';

  newMedNombre = '';
  newMedDosis = '';
  newMedHora = '08:00';

  newObsTipo: ObsTipo = 'normal';
  newObsText = '';

  private nextSignosId = 100;
  private nextMedId = 200;
  private nextObsId = 300;
  private nextHistId = 400;
  private nextAuditId = 500;

  residente: ResidenteDetail = {
    id: 0,
    nombre: '',
    habitacion: '',
    estado: 'estable',
    notas: '',
    contactoNombre: '',
    contactoTel: '',
    signos: [],
    medicacion: [],
    observaciones: [],
    historial: [],
    auditoria: [],
  };

  isBrowser = false;

  loading = false;
  saving = false;
  lastError: string | null = null;

  private routeSub: Subscription | null = null;

  private gsapCleanup: (() => void) | null = null;
  private gsapRef: { context: Function; set: Function; timeline: Function; to: Function; killTweensOf: Function } | null =
    null;
  private prefersReducedMotion = false;

  constructor(
    private route: ActivatedRoute,
    private zone: NgZone,
    private host: ElementRef<HTMLElement>,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);

    if (this.isBrowser) {
      this.setRootCssVar('--mx', '50%');
      this.setRootCssVar('--my', '30%');

      try {
        this.prefersReducedMotion =
          window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
      } catch {
        this.prefersReducedMotion = false;
      }
    }
  }

  ngOnInit(): void {
    this.routeSub = this.route.paramMap.subscribe(pm => {
      const id = Number(pm.get('id') || 0);
      this.id = id;

      if (!this.id) return;

      this.loadDetalle();
    });
  }

  /* =========================
     BACKEND HELPERS
  ========================= */
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

  private unwrap<T>(raw: T | ApiEnvelope<T>): T {
    const r: any = raw as any;
    if (r && typeof r === 'object' && 'ok' in r) {
      if (r.ok === true) return r.data as T;
      throw new Error(r?.error?.message || 'API error');
    }
    return raw as T;
  }

  private humanHttpError(e: unknown): string {
    const err = e as HttpErrorResponse;

    const msg = (err as any)?.error?.error?.message || (err as any)?.error?.message;
    if (msg) return String(msg);

    if (err?.status) return `HTTP ${err.status} — ${err.statusText || 'Error'}`;
    return 'Error de red/servidor.';
  }

  private mapResident(api: ResidentApi): ResidenteDetail {
    const nombre = `${api.first_name ?? ''} ${api.last_name ?? ''}`.trim();

    return {
      id: Number(api.id),
      nombre: nombre || `Residente #${api.id}`,
      habitacion: api.room ?? '',
      estado: (api.status ?? 'estable') as EstadoResidente,
      notas: api.notes ?? '',
      contactoNombre: api.emergency_contact_name ?? '',
      contactoTel: api.emergency_contact_phone ?? '',
      signos: [],
      medicacion: [],
      observaciones: [],
      historial: [],
      auditoria: [],
    };
  }

  private timelineUserLabel(t: TimelineItemApi): string {
    const fn = (t.user_first_name ?? '').trim();
    const ln = (t.user_last_name ?? '').trim();
    const full = `${fn} ${ln}`.trim();
    return full || (t.user_email ?? 'Sistema');
  }

  private occurredToIso(s: string): string {
    // "YYYY-MM-DD HH:mm:ss" -> "YYYY-MM-DDTHH:mm:ss"
    const raw = String(s || '').trim();
    if (!raw) return new Date().toISOString();
    if (raw.includes('T')) return raw;
    return raw.replace(' ', 'T');
  }

  private hhmmFromOccurredAt(occurredAt: string): string {
    const m = String(occurredAt || '').match(/\s(\d{2}):(\d{2})/);
    if (m) return `${m[1]}:${m[2]}`;
    const iso = this.occurredToIso(occurredAt);
    const mm = iso.match(/T(\d{2}):(\d{2})/);
    return mm ? `${mm[1]}:${mm[2]}` : '00:00';
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

  private parseVitals(summary: string | null): { temp: string; presion: string; pulso: string } {
    const s = (summary || '').replace(/\s+/g, ' ').trim();

    const temp =
      s.match(/temp(?:eratura)?\s*([0-9]{2}\.?[0-9]*)/i)?.[1] ||
      s.match(/([0-9]{2}\.?[0-9]*)\s*°?c/i)?.[1] ||
      '—';

    const presion =
      s.match(/pa\s*([0-9]{2,3}\/[0-9]{2,3})/i)?.[1] ||
      s.match(/presi[oó]n\s*([0-9]{2,3}\/[0-9]{2,3})/i)?.[1] ||
      s.match(/\b([0-9]{2,3}\/[0-9]{2,3})\b/)?.[1] ||
      '—';

    const pulso =
      s.match(/pulso\s*([0-9]{2,3})/i)?.[1] ||
      s.match(/\b([0-9]{2,3})\s*bpm\b/i)?.[1] ||
      '—';

    return { temp: String(temp), presion: String(presion), pulso: String(pulso) };
  }

  private sortByFechaDesc<T extends { fecha: string }>(arr: T[]): T[] {
    return [...arr].sort((a, b) => {
      const da = new Date(this.occurredToIso(a.fecha)).getTime();
      const db = new Date(this.occurredToIso(b.fecha)).getTime();
      return db - da;
    });
  }

  /* =========================
     LOADERS (Backend)
  ========================= */
  private loadDetalle(): void {
    this.loading = true;
    this.lastError = null;

    this.http
      .get<ApiEnvelope<ResidentApi> | ResidentApi>(
        `${this.API}/residentes/${this.id}`,
        { headers: this.authHeaders() }
      )
      .pipe(
        take(1),
        map(raw => this.unwrap<ResidentApi>(raw)),
        switchMap((residentApi) => {
          const base = this.mapResident(residentApi);

          return this.http
            .get<ApiEnvelope<TimelineListApi> | TimelineListApi>(
              `${this.API}/historial/residentes/${this.id}?preset=all&limit=200`,
              { headers: this.authHeaders() }
            )
            .pipe(
              take(1),
              map(raw => this.unwrap<TimelineListApi>(raw)),
              map(tl => {
                const items = tl?.items || [];

                const historial: HistorialRow[] = items.map(ev => ({
                  id: ev.id,
                  fecha: this.occurredToIso(ev.occurred_at),
                  titulo: ev.title,
                  detalle: ev.summary ?? '',
                  by: this.timelineUserLabel(ev)
                }));

                const medicacion: MedicacionRow[] = items
                  .filter(ev => ev.event_type === 'medication')
                  .map(ev => {
                    const parts = (ev.summary || '').split('·').map(x => x.trim()).filter(Boolean);
                    return {
                      id: ev.id,
                      medicamento: parts[0] || 'Medicación',
                      dosis: parts[1] || '',
                      horario: this.hhmmFromOccurredAt(ev.occurred_at),
                      estado: this.mapMedStatusFromBackend(ev.summary),
                      updatedAt: this.occurredToIso(ev.occurred_at),
                      updatedBy: this.timelineUserLabel(ev)
                    };
                  });

                const observaciones: ObservacionRow[] = items
                  .filter(ev => ev.event_type === 'observation')
                  .map(ev => ({
                    id: ev.id,
                    fecha: this.occurredToIso(ev.occurred_at),
                    tipo: this.mapObsTypeFromTitle(ev.title),
                    texto: ev.summary ?? '',
                    updatedAt: this.occurredToIso(ev.occurred_at),
                    updatedBy: this.timelineUserLabel(ev)
                  }));

                const signos: SignosRow[] = items
                  .filter(ev => ev.event_type === 'vital')
                  .map(ev => {
                    const p = this.parseVitals(ev.summary);
                    return {
                      id: ev.id,
                      fecha: this.occurredToIso(ev.occurred_at),
                      temp: p.temp,
                      presion: p.presion,
                      pulso: p.pulso,
                      by: this.timelineUserLabel(ev)
                    };
                  });

                const detail: ResidenteDetail = {
                  ...base,
                  signos: this.sortByFechaDesc(signos),
                  historial: this.sortByFechaDesc(historial),
                  medicacion: [...medicacion], // horario manda, no fecha
                  observaciones: this.sortByFechaDesc(observaciones),
                  auditoria: []
                };

                return detail;
              }),
              catchError(() => of(base as ResidenteDetail))
            );
        }),
        finalize(() => (this.loading = false))
      )
      .subscribe({
        next: (detail) => {
          this.residente = detail;

          this.nextSignosId = Math.max(this.nextSignosId, ...(detail.signos.map(s => s.id + 1)), 100);
          this.nextMedId = Math.max(this.nextMedId, ...(detail.medicacion.map(m => m.id + 1)), 200);
          this.nextObsId = Math.max(this.nextObsId, ...(detail.observaciones.map(o => o.id + 1)), 300);
          this.nextHistId = Math.max(this.nextHistId, ...(detail.historial.map(h => h.id + 1)), 400);
        },
        error: (e) => {
          this.lastError = this.humanHttpError(e);
        }
      });
  }

  /* =========================
     GSAP ENTER + MICRO FX
  ========================= */
  async ngAfterViewInit(): Promise<void> {
    if (!this.isBrowser || this.prefersReducedMotion) return;

    try {
      const mod = await import('gsap');
      const gsap = mod.gsap;

      this.gsapRef = gsap as any;

      const root = this.host.nativeElement;

      const ctx = gsap.context(() => {
        const head = root.querySelector<HTMLElement>('.head');
        const tabs = root.querySelector<HTMLElement>('.tabs');
        const card = root.querySelector<HTMLElement>('.card');

        gsap.set([head, tabs, card].filter(Boolean), { opacity: 1 });

        const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });

        tl.from(head, { y: 10, opacity: 0, duration: 0.55 })
          .from(tabs, { y: 10, opacity: 0, duration: 0.42 }, '-=0.28')
          .from(card, { y: 8, opacity: 0, duration: 0.4 }, '-=0.22');

        gsap.to([head, tabs].filter(Boolean), {
          boxShadow: '0 0 0 6px rgba(0,74,173,.06), 0 18px 60px rgba(0,74,173,.10)',
          duration: 2.8,
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
        });
      }, root);

      this.gsapCleanup = () => ctx.revert();
    } catch {
      this.gsapCleanup = null;
      this.gsapRef = null;
    }
  }

  ngOnDestroy(): void {
    this.gsapCleanup?.();
    this.gsapCleanup = null;
    this.gsapRef = null;

    this.routeSub?.unsubscribe();
    this.routeSub = null;
  }

  // -------------------------
  // UI
  // -------------------------
  setTab(t: TabKey): void {
    this.tab = t;
    this.cancelMedEdit();
    this.cancelObsEdit();

    if (this.isBrowser && this.gsapRef && !this.prefersReducedMotion) {
      this.zone.runOutsideAngular(() => {
        requestAnimationFrame(() => this.animateTabIn());
      });
    }
  }

  private animateTabIn(): void {
    const gsap = this.gsapRef as any;
    if (!gsap) return;

    const root = this.host.nativeElement;
    const card = root.querySelector<HTMLElement>('.card');
    if (!card) return;

    gsap.killTweensOf(card);

    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo(card, { y: 6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.26 });
  }

  estadoLabel(e: EstadoResidente): string {
    if (e === 'estable') return 'Estable';
    if (e === 'observacion') return 'Observación';
    return 'Crítico';
  }

  get resumen(): Resumen {
    const medsPend = this.residente.medicacion.filter((m) => m.estado === 'pendiente').length;
    const medsAtras = this.residente.medicacion.filter((m) => m.estado === 'atrasada').length;
    const medsAdmin = this.residente.medicacion.filter((m) => m.estado === 'administrada').length;
    const obsAlert = this.residente.observaciones.filter((o) => o.tipo === 'alerta').length;
    const lastSigno = this.residente.signos.length ? this.residente.signos[0] : null;

    return { medsPend, medsAtras, medsAdmin, obsAlert, lastSigno };
  }

  medEstadoLabel(e: MedEstado): string {
    if (e === 'pendiente') return 'Pendiente';
    if (e === 'administrada') return 'Administrada';
    if (e === 'atrasada') return 'Atrasada';
    return 'Suspendida';
  }

  obsTipoLabel(t: ObsTipo): string {
    return t === 'alerta' ? 'Alerta' : 'Normal';
  }

  /* =========================
     PDF EXPORT (SOLO LECTURA)
  ========================= */
  async exportarPdf(): Promise<void> {
    if (!this.isBrowser || this.pdfLoading) return;
    if (!this.pdfRoot?.nativeElement) return;

    this.pdfLoading = true;
    this.lastError = null;

    // ✅ forzamos modo lectura
    this.exportMode = true;
    this.cancelMedEdit();
    this.cancelObsEdit();

    // render DOM ya con exportMode
    this.cdr.detectChanges();
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    await new Promise<void>(r => requestAnimationFrame(() => r()));

    try {
      const mod: any = await import('html2pdf.js');
      const html2pdf: any = mod?.default ?? mod;

      const el = this.pdfRoot.nativeElement;

      const filename = `residente-${this.residente?.id || this.id}.pdf`;

      await html2pdf()
        .from(el)
        .set({
          margin: [10, 10, 10, 10],
          filename,
          pagebreak: { mode: ['css', 'legacy'] },
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: null,
            logging: false,
            scrollX: 0,
            scrollY: 0,
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        })
        .save();
    } catch (e) {
      this.lastError = 'No se pudo generar el PDF. Revisá instalación de html2pdf.js y typings.';
    } finally {
      this.exportMode = false;
      this.pdfLoading = false;
      this.cdr.detectChanges();
    }
  }

  /* =========================
     SIGNOS (Backend)
     POST /enfermeria/residentes/:id/vitals
  ========================= */
  guardarSignos(): void {
    if (!this.temp.trim() && !this.presion.trim() && !this.pulso.trim()) return;
    if (!this.id) return;

    this.saving = true;
    this.lastError = null;

    this.http
      .post<ApiEnvelope<any> | any>(
        `${this.API}/enfermeria/residentes/${this.id}/vitals`,
        {
          temperature: this.temp.trim() || null,
          blood_pressure: this.presion.trim() || null,
          pulse: this.pulso.trim() || null,
          measured_at: new Date().toISOString()
        },
        { headers: this.authHeaders() }
      )
      .pipe(
        take(1),
        finalize(() => (this.saving = false))
      )
      .subscribe({
        next: () => {
          this.temp = '';
          this.presion = '';
          this.pulso = '';
          this.loadDetalle();
        },
        error: (e) => (this.lastError = this.humanHttpError(e))
      });
  }

  /* =========================
     MEDICACIÓN (Backend)
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
    this.lastError = 'Editar medicación aún no está conectado al backend (faltan endpoints PATCH meds/:id).';
    this.cancelMedEdit();
  }

  addMedMock(): void {
    if (!this.id) return;

    const nombre = this.newMedNombre.trim();
    const dosis = this.newMedDosis.trim();
    const hora = this.newMedHora.trim();
    if (!nombre || !dosis || !hora) return;

    this.saving = true;
    this.lastError = null;

    const scheduledAtIso = this.combineTodayTimeToIso(hora);

    this.http
      .post<ApiEnvelope<any> | any>(
        `${this.API}/enfermeria/residentes/${this.id}/medications`,
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
          this.loadDetalle();
        },
        error: (e) => (this.lastError = this.humanHttpError(e))
      });
  }

  setMedEstado(_: MedicacionRow, __: MedEstado): void {
    this.lastError = 'Cambiar estado de medicación aún no está conectado (faltan endpoints PATCH meds/:id).';
  }

  /* =========================
     OBSERVACIONES (Backend)
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
    this.lastError = 'Editar observación aún no está conectado al backend (faltan endpoints PATCH observations/:id).';
    this.cancelObsEdit();
  }

  addObsMock(): void {
    if (!this.id) return;

    const txt = this.newObsText.trim();
    if (!txt) return;

    this.saving = true;
    this.lastError = null;

    this.http
      .post<ApiEnvelope<any> | any>(
        `${this.API}/enfermeria/residentes/${this.id}/observations`,
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
          this.loadDetalle();
        },
        error: (e) => (this.lastError = this.humanHttpError(e))
      });
  }

  // -------------------------
  // Mouse vars (glow global)
  // -------------------------
  @HostListener('mousemove', ['$event'])
  onMouseMove(ev: MouseEvent): void {
    if (!this.isBrowser) return;

    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;

    const x = (ev.clientX / w) * 100;
    const y = (ev.clientY / h) * 100;

    this.setRootCssVar('--mx', `${x.toFixed(2)}%`);
    this.setRootCssVar('--my', `${y.toFixed(2)}%`);
  }

  private setRootCssVar(name: string, value: string): void {
    if (!this.isBrowser) return;
    document.documentElement.style.setProperty(name, value);
  }

  // -------------------------
  // Utils
  // -------------------------
  private combineTodayTimeToIso(hhmm: string): string {
    const [h, m] = (hhmm || '00:00').split(':').map(x => Number(x));
    const d = new Date();
    d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    return d.toISOString();
  }

  trackById(_: number, row: { id: number }): number {
    return row.id;
  }
}
