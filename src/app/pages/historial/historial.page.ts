// historial.page.ts
// ============================================================
// SERVIMEL — Historial (Clínico)
// Standalone Page (Angular) + GSAP entrance animations
//
// ✅ FIX GSAP (evita: Cannot read properties of undefined (reading 'opacity')):
// - NO pasamos NodeList anidados a gsap.set / tl.to
// - Usamos gsap.utils.toArray(...) (array plano) + guardas si está vacío
//
// ✅ BACKEND REAL (sin mocks):
// - GET /residentes?limit=200
// - Timeline (intenta en orden):
//    1) GET /historial?preset=all&limit=200
//    2) GET /historial?limit=200
//    3) GET /timeline?limit=200
//    4) GET /api/historial?preset=all&limit=200
//    5) GET /api/timeline?limit=200
// - Fallback SI NO EXISTE timeline global:
//    - GET /historial/residentes/:id?preset=all&limit=60 (para cada residente)
//    - (también prueba /api/historial/residentes/:id...)
// - Soporta respuesta directa o envelope { ok:true, data:{...} }
// - Auth: Bearer token (localStorage) o cookies (withCredentials si no hay token)
// ============================================================

import {
  AfterViewInit,
  Component,
  ElementRef,
  Inject,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  ViewChild,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule } from '@angular/router';
import { gsap } from 'gsap';

import {
  HttpClient,
  HttpClientModule,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';

import { API_CONFIG } from '../../core/config/api.config';

import {
  Subscription,
  from,
  EMPTY,
  of,
  Observable,
} from 'rxjs';
import {
  catchError,
  concatMap,
  defaultIfEmpty,
  finalize,
  map,
  mergeMap,
  switchMap,
  take,
  toArray,
} from 'rxjs/operators';

// =========================
// DB-ALIGNED TYPES
// =========================
type EstadoResidente = 'estable' | 'observacion' | 'critico';

type Residente = {
  id: number;
  first_name: string;
  last_name: string;
  document_number?: string | null;
  room: string | null;
  status: EstadoResidente;
};

// timeline_events.event_type
type TimelineType = 'vital' | 'medication' | 'observation' | 'profile' | 'other';

// timeline_events.severity
type Severity = 'info' | 'warning' | 'critical';

// UI types (compatibles con tu HTML actual)
type EventTypeUI = 'signos' | 'medicacion' | 'observacion' | 'alerta';
type MedStatusDb = 'administered' | 'pending' | 'late' | 'suspended';

// Unificamos en un modelo UI (para timeline)
type HistorialEvent = {
  id: number;
  fechaIso: string; // occurred_at ISO
  tipo: EventTypeUI;

  titulo: string; // title
  detalle: string; // summary / detalle armado

  residenteId: number; // resident_id
  residenteNombre: string;
  ci?: string;
  habitacion: string;
  estadoResidente: EstadoResidente;

  by: string;
  severity: Severity;

  // para KPI "medicación pendiente"
  medStatus?: MedStatusDb;

  // referencia a tabla real (para fetch detalle si querés)
  ref_table?: string;
  ref_id?: number;
};

type RangeKey = 'hoy' | '7d' | '30d' | 'todo';
type OrderKey = 'desc' | 'asc';

type Kpis = {
  eventos: number;
  alertas: number;
  medsPendientes: number;
  ultimaActualizacion: string;
  ultimaIso: string | null;
};

// =========================
// API (envelope + lists)
// =========================
type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string; details?: any } };
type ApiEnvelope<T> = ApiOk<T> | ApiFail;

type ListApi<T> = { page?: number; limit?: number; total?: number; items: T[] };

// residentes API (puede venir paginado o array)
type ResidentApi = {
  id: number;
  first_name: string;
  last_name: string;
  document_number?: string | null;
  room: string | null;
  status: EstadoResidente;
  is_active?: number | boolean;
};

// timeline API
type TimelineItemApi = {
  id: number;
  resident_id: number;
  user_id: number | null;
  event_type: TimelineType;
  ref_table: string;
  ref_id: number;
  severity: Severity;
  title: string;
  summary: string | null;
  occurred_at: string;
  created_at: string;
  user_email?: string | null;
  user_first_name?: string | null;
  user_last_name?: string | null;
  // (si algún día tu backend lo agrega)
  med_status?: MedStatusDb | null;
};

@Component({
  selector: 'app-historial-page',
  standalone: true,
  imports: [CommonModule, RouterModule, HttpClientModule],
  templateUrl: './historial.page.html',
  styleUrls: ['./historial.page.scss'],
})
export class HistorialPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('pageRoot', { static: true }) pageRoot!: ElementRef<HTMLElement>;

  // ✅ Backend real (sin /api fijo)
  private readonly API = API_CONFIG.baseUrl;

  // ------------------------------------------------------------
  // Estado backend
  // ------------------------------------------------------------
  loading = false;
  lastError: string | null = null;

  // ------------------------------------------------------------
  // Data (backend)
  // ------------------------------------------------------------
  residentes: Residente[] = [];
  eventsAll: HistorialEvent[] = [];

  // ------------------------------------------------------------
  // UI State (filtros)
  // ------------------------------------------------------------
  search = '';
  activeType: EventTypeUI | 'all' = 'all';
  activeRange: RangeKey = '7d';
  order: OrderKey = 'desc';

  // selección
  selectedId: number | null = null;

  // cache para no filtrar en el HTML
  filteredSorted: HistorialEvent[] = [];

  // KPIs
  kpis: Kpis = {
    eventos: 0,
    alertas: 0,
    medsPendientes: 0,
    ultimaActualizacion: '—',
    ultimaIso: null,
  };

  // ------------------------------------------------------------
  // GSAP
  // ------------------------------------------------------------
  private gsapCtx?: ReturnType<typeof gsap.context>;
  private isBrowser = false;

  private subs = new Subscription();

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    // ✅ SIEMPRE backend (sin mocks)
    this.loadFromBackend();
  }

  // ============================================================
  // Lifecycle
  // ============================================================
  ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    if (this.prefersReducedMotion()) return;

    this.gsapCtx = gsap.context(() => {
      const root = this.pageRoot?.nativeElement;
      if (!root) return;

      // ✅ arrays planos (no NodeList anidados)
      const headerEls = gsap.utils.toArray<HTMLElement>('.js-anim-header', root).filter(Boolean);
      const kpiEls = gsap.utils.toArray<HTMLElement>('.js-anim-kpi', root).filter(Boolean);
      const cards = gsap.utils.toArray<HTMLElement>('.js-anim-card', root).filter(Boolean);
      const rows = gsap.utils.toArray<HTMLElement>('.js-anim-row', root).filter(Boolean);

      const all = [...headerEls, ...kpiEls, ...cards, ...rows].filter(Boolean);
      if (all.length) gsap.set(all, { opacity: 0, y: 14 });

      const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });

      const add = (
        targets: HTMLElement[],
        vars: gsap.TweenVars,
        position?: gsap.Position
      ) => {
        if (targets && targets.length) tl.to(targets, vars, position as any);
      };

      add(headerEls, { opacity: 1, y: 0, duration: 0.55, stagger: 0.06 });
      add(kpiEls, { opacity: 1, y: 0, duration: 0.45, stagger: 0.05 }, '-=0.15');
      add(cards, { opacity: 1, y: 0, duration: 0.55, stagger: 0.08 }, '-=0.10');
      add(rows, { opacity: 1, y: 0, duration: 0.35, stagger: 0.03 }, '-=0.20');

      // glow KPI (solo si hay KPIs)
      if (kpiEls.length) {
        tl.to(
          kpiEls,
          {
            duration: 0.55,
            keyframes: [
              { boxShadow: '0 0 0 6px rgba(182,203,51,.10), 0 20px 60px rgba(0,0,0,.35)' },
              { boxShadow: '0 0 0 0 rgba(182,203,51,0), 0 14px 44px rgba(0,0,0,.32)' },
            ],
            stagger: 0.06,
          },
          '+=0.05'
        );
      }
    }, this.pageRoot.nativeElement);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.gsapCtx?.revert();
  }

  // ============================================================
  // Actions UI
  // ============================================================
  setType(t: EventTypeUI | 'all'): void {
    this.activeType = t;
    this.recompute(true);
  }

  setRange(r: RangeKey): void {
    this.activeRange = r;
    this.recompute(true);
  }

  setOrder(o: OrderKey): void {
    this.order = o;
    this.recompute(true);
  }

  onSearchInput(val: string): void {
    this.search = val;
    this.recompute(true);
  }

  selectEvent(ev: HistorialEvent): void {
    this.selectedId = ev.id;
    this.bumpSelectedDetail();

    // Si luego querés detalle real por tabla/ID:
    // GET /{ref_table}/{ref_id}
  }

  // ============================================================
  // Derived
  // ============================================================
  get selected(): HistorialEvent | null {
    if (this.selectedId === null) return null;
    return this.filteredSorted.find(e => e.id === this.selectedId) ?? null;
  }

  get selectedResidente(): Residente | null {
    const s = this.selected;
    if (!s) return null;
    return this.residentes.find(r => r.id === s.residenteId) ?? null;
  }

  // ============================================================
  // Recompute (filtrado + orden + KPIs)
  // ============================================================
  private recompute(keepSelection = false): void {
    const q = this.search.trim().toLowerCase();
    const now = new Date();
    const minDate = this.rangeStart(this.activeRange, now);

    let list = this.eventsAll;

    // rango
    if (minDate) {
      list = list.filter(e => new Date(e.fechaIso) >= minDate);
    }

    // tipo
    if (this.activeType !== 'all') {
      list = list.filter(e => e.tipo === this.activeType);
    }

    // search
    if (q) {
      list = list.filter(e => {
        const blob = [
          e.residenteNombre,
          e.ci ?? '',
          e.habitacion,
          e.titulo,
          e.detalle,
          e.by,
          e.tipo,
          e.estadoResidente,
          e.severity,
        ].join(' ').toLowerCase();
        return blob.includes(q);
      });
    }

    // orden
    list = [...list].sort((a, b) => {
      const ta = new Date(a.fechaIso).getTime();
      const tb = new Date(b.fechaIso).getTime();
      return this.order === 'desc' ? tb - ta : ta - tb;
    });

    this.filteredSorted = list;

    // KPIs (sobre lista filtrada actual)
    const eventos = list.length;
    const alertas = list.filter(e => e.tipo === 'alerta' || e.severity === 'critical').length;

    const medsPendientes = list.filter(
      e => e.tipo === 'medicacion' && (e.medStatus === 'pending' || e.medStatus === 'late')
    ).length;

    const first = list[0] ?? null;
    const ultimaIso = first?.fechaIso ?? null;

    this.kpis = {
      eventos,
      alertas,
      medsPendientes,
      ultimaActualizacion: ultimaIso ? this.formatDateTime(ultimaIso) : '—',
      ultimaIso,
    };

    // selección
    if (!keepSelection) {
      this.selectedId = list[0]?.id ?? null;
      return;
    }

    if (this.selectedId === null) {
      this.selectedId = list[0]?.id ?? null;
      return;
    }

    const stillExists = list.some(e => e.id === this.selectedId);
    this.selectedId = stillExists ? this.selectedId : (list[0]?.id ?? null);
  }

  // ============================================================
  // Labels / UI helpers
  // ============================================================
  estadoLabel(e: EstadoResidente): string {
    if (e === 'estable') return 'Estable';
    if (e === 'observacion') return 'Observación';
    return 'Crítico';
  }

  typeLabel(t: EventTypeUI): string {
    switch (t) {
      case 'signos': return 'Signos';
      case 'medicacion': return 'Medicación';
      case 'observacion': return 'Observación';
      case 'alerta': return 'Alerta';
    }
  }

  typeIcon(t: EventTypeUI): string {
    switch (t) {
      case 'signos': return '🩺';
      case 'medicacion': return '💊';
      case 'observacion': return '📝';
      case 'alerta': return '⚠️';
    }
  }

  typeClass(t: EventTypeUI): string {
    return `chip chip--${t}`;
  }

  residentStateClass(s: EstadoResidente): string {
    return `chip chip--state chip--${s}`;
  }

  // ============================================================
  // Micro animaciones de UX
  // ============================================================
  private bumpSelectedDetail(): void {
    if (!this.isBrowser) return;
    if (this.prefersReducedMotion()) return;

    const root = this.pageRoot?.nativeElement;
    if (!root) return;

    const panel = root.querySelector<HTMLElement>('.js-detail-panel');
    if (!panel) return;

    gsap.fromTo(
      panel,
      { opacity: 0.85, y: 8 },
      { opacity: 1, y: 0, duration: 0.30, ease: 'power2.out' }
    );
  }

  // ============================================================
  // AUTH (Bearer o cookie)
  // ============================================================
  private getToken(): string | null {
    if (!this.isBrowser) return null;

    const keys = [
      'servimel_token',
      'servimel_token_v1',
      'auth_token',
      'token',
      'jwt',
      'access_token',
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

  private requestOpts(): { headers: HttpHeaders; withCredentials: boolean } {
    const headers = this.authHeaders();
    const token = this.getToken();
    const withCredentials = !token; // si no hay token, probamos cookies
    return { headers, withCredentials };
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

  private humanHttpError(e: unknown): string {
    const err = e as HttpErrorResponse;
    const msg = (err as any)?.error?.error?.message || (err as any)?.error?.message;
    if (msg) return String(msg);
    if (err?.status) return `HTTP ${err.status} — ${err.statusText || 'Error'}`;
    return 'Error de red/servidor.';
  }

  private pickItems<T>(raw: unknown): T[] {
    if (Array.isArray(raw)) return raw as T[];
    const r = raw as any;
    if (r && typeof r === 'object' && Array.isArray(r.items)) return r.items as T[];
    return [];
  }

  private tryFirst<T>(urls: string[], make$: (url: string) => Observable<T>): Observable<T | null> {
    return from(urls).pipe(
      concatMap((url) => make$(url).pipe(catchError(() => EMPTY))),
      take(1),
      defaultIfEmpty(null as T | null)
    );
  }

  // ============================================================
  // BACKEND LOAD (REAL)
  // ============================================================
  private loadFromBackend(): void {
    this.loading = true;
    this.lastError = null;

    this.subs.add(
      this.fetchResidents().pipe(
        switchMap((residents) => {
          this.residentes = residents;
          const resMap = new Map<number, Residente>(residents.map(r => [r.id, r]));
          return this.fetchTimelineEvents(residents, resMap);
        }),
        finalize(() => (this.loading = false))
      ).subscribe({
        next: (events) => {
          this.eventsAll = events;
          this.recompute();
          this.selectedId = this.filteredSorted[0]?.id ?? null;
        },
        error: (e) => {
          this.lastError = this.humanHttpError(e);
          this.eventsAll = [];
          this.recompute();
          this.selectedId = null;
        }
      })
    );
  }

  // GET /residentes (soporta /api/residentes)
  private fetchResidents(): Observable<Residente[]> {
    const opts = this.requestOpts();

    const urls = [
      `${this.API}/residentes?limit=200`,
      `${this.API}/api/residentes?limit=200`,
    ];

    const make$ = (url: string): Observable<Residente[]> =>
      this.http.get<
        ApiEnvelope<ListApi<ResidentApi> | ResidentApi[]> | ListApi<ResidentApi> | ResidentApi[]
      >(url, opts).pipe(
        map((raw) => this.unwrap<any>(raw)),
        map((unwrapped) => this.pickItems<ResidentApi>(unwrapped)),
        map((items) =>
          (items || []).map((r) => ({
            id: Number(r.id),
            first_name: r.first_name ?? '',
            last_name: r.last_name ?? '',
            document_number: r.document_number ?? null,
            room: r.room ?? null,
            status: (r.status ?? 'estable') as EstadoResidente,
          }) as Residente)
        )
      );

    return this.tryFirst<Residente[]>(urls, make$).pipe(
      map((rows) => rows ?? []),
      map((rows) => {
        return [...rows].sort((a, b) => {
          const ra = (a.room ?? 'ZZZ').toString();
          const rb = (b.room ?? 'ZZZ').toString();
          if (ra !== rb) return ra.localeCompare(rb);
          return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`);
        });
      })
    );
  }

  // Timeline global (o fallback por residente)
  private fetchTimelineEvents(
    residents: Residente[],
    resMap: Map<number, Residente>
  ): Observable<HistorialEvent[]> {
    const opts = this.requestOpts();

    const globalUrls = [
      `${this.API}/historial?preset=all&limit=200`,
      `${this.API}/historial?limit=200`,
      `${this.API}/timeline?limit=200`,
      `${this.API}/api/historial?preset=all&limit=200`,
      `${this.API}/api/timeline?limit=200`,
    ];

    const makeGlobal$ = (url: string): Observable<HistorialEvent[]> =>
      this.http.get<
        ApiEnvelope<ListApi<TimelineItemApi> | TimelineItemApi[]> | ListApi<TimelineItemApi> | TimelineItemApi[]
      >(url, opts).pipe(
        map((raw) => this.unwrap<any>(raw)),
        map((unwrapped) => this.pickItems<TimelineItemApi>(unwrapped)),
        map((items) => (items || []).map((ev) => this.mapTimelineToUi(ev, resMap)))
      );

    return this.tryFirst<HistorialEvent[]>(globalUrls, makeGlobal$).pipe(
      switchMap((eventsGlobal: HistorialEvent[] | null) => {
        if (eventsGlobal && eventsGlobal.length > 0) {
          return of(this.dedupeById(eventsGlobal));
        }

        const ids = (residents || []).map(r => r.id).filter((x): x is number => Number.isFinite(x));

        if (!ids.length) {
          this.lastError = 'No hay residentes cargados para consultar historial.';
          return of([] as HistorialEvent[]);
        }

        const makePerResident$ = (rid: number): Observable<HistorialEvent[]> => {
          const urls = [
            `${this.API}/historial/residentes/${rid}?preset=all&limit=60`,
            `${this.API}/api/historial/residentes/${rid}?preset=all&limit=60`,
          ];

          const make$ = (url: string): Observable<HistorialEvent[]> =>
            this.http.get<
              ApiEnvelope<ListApi<TimelineItemApi> | TimelineItemApi[]> | ListApi<TimelineItemApi> | TimelineItemApi[]
            >(url, opts).pipe(
              map((raw) => this.unwrap<any>(raw)),
              map((unwrapped) => this.pickItems<TimelineItemApi>(unwrapped)),
              map((items) => (items || []).map((ev) => this.mapTimelineToUi(ev, resMap)))
            );

          return this.tryFirst<HistorialEvent[]>(urls, make$).pipe(
            map((rows) => rows ?? [])
          );
        };

        // concurrencia 3 (no mata el backend)
        return from(ids).pipe(
          mergeMap((rid) => makePerResident$((rid as number)), 3),
          toArray(), // HistorialEvent[][]
          map((chunks: HistorialEvent[][]) =>
            chunks.reduce((acc, cur) => acc.concat(cur), [] as HistorialEvent[])
          ),
          map((all: HistorialEvent[]) => this.dedupeById(all)),
          map((all: HistorialEvent[]) => {
            if (!all.length) {
              this.lastError =
                'No se pudo obtener historial (no existe timeline global y el fallback por residente devolvió vacío).';
            }
            return all;
          })
        );
      })
    );
  }

  private dedupeById(list: HistorialEvent[]): HistorialEvent[] {
    const m = new Map<number, HistorialEvent>();
    for (const e of list) m.set(e.id, e);
    return Array.from(m.values());
  }

  private mapTimelineToUi(ev: TimelineItemApi, resMap: Map<number, Residente>): HistorialEvent {
    const r = resMap.get(Number(ev.resident_id));
    const residenteNombre = r ? this.fullName(r) : `Residente #${ev.resident_id}`;
    const ci = r?.document_number ?? undefined;
    const habitacion = r ? this.safeRoom(r) : '—';
    const estadoResidente = (r?.status ?? 'estable') as EstadoResidente;

    const tipo = this.mapEventType(ev.event_type, ev.severity);

    const by =
      `${ev.user_first_name ?? ''} ${ev.user_last_name ?? ''}`.trim()
      || (ev.user_email ?? '')
      || '—';

    const medStatus =
      ev.event_type === 'medication'
        ? ((ev.med_status as MedStatusDb | null) ?? this.guessMedStatus(ev.title, ev.summary))
        : undefined;

    return {
      id: Number(ev.id),
      fechaIso: ev.occurred_at,
      tipo,
      titulo: ev.title ?? '—',
      detalle: ev.summary ?? '',
      residenteId: Number(ev.resident_id),
      residenteNombre,
      ci,
      habitacion,
      estadoResidente,
      by,
      severity: (ev.severity ?? 'info') as Severity,
      medStatus,
      ref_table: ev.ref_table ?? undefined,
      ref_id: Number.isFinite(Number(ev.ref_id)) ? Number(ev.ref_id) : undefined,
    };
  }

  private guessMedStatus(title: string, summary: string | null): MedStatusDb {
    const t = (title || '').toLowerCase();
    const s = (summary || '').toLowerCase();

    if (t.includes('administr') || s.includes('administr')) return 'administered';
    if (t.includes('atras') || s.includes('late')) return 'late';
    if (t.includes('suspend') || s.includes('suspend')) return 'suspended';
    return 'pending';
  }

  private mapEventType(eventType: TimelineType, severity: Severity): EventTypeUI {
    if (severity === 'critical') return 'alerta';
    if (eventType === 'vital') return 'signos';
    if (eventType === 'medication') return 'medicacion';
    if (eventType === 'observation') return 'observacion';
    return 'observacion';
  }

  // ============================================================
  // Utils
  // ============================================================
  private prefersReducedMotion(): boolean {
    if (!this.isBrowser) return true;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  }

  private rangeStart(range: RangeKey, now: Date): Date | null {
    const d = new Date(now);
    if (range === 'todo') return null;

    if (range === 'hoy') {
      d.setHours(0, 0, 0, 0);
      return d;
    }

    if (range === '7d') {
      d.setDate(d.getDate() - 7);
      return d;
    }

    d.setDate(d.getDate() - 30);
    return d;
  }

  private formatDateTime(iso: string): string {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm} ${hh}:${mi}`;
  }

  private fullName(r: Residente): string {
    return `${r.first_name} ${r.last_name}`.trim();
  }

  private safeRoom(r: Residente): string {
    return r.room ?? '—';
  }

  trackById(_: number, row: { id: number }): number {
    return row.id;
  }
}
