import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  OnInit,
  Inject,
  PLATFORM_ID
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule } from '@angular/router';
import { gsap } from 'gsap';

import {
  HttpClient,
  HttpClientModule,
  HttpErrorResponse,
  HttpHeaders
} from '@angular/common/http';

import { API_CONFIG } from '../../core/config/api.config';
import { Subscription, from, of, EMPTY, Observable } from 'rxjs';
import {
  catchError,
  concatMap,
  defaultIfEmpty,
  finalize,
  map,
  mergeMap,
  reduce,
  take,
  tap
} from 'rxjs/operators';

/**
 * KPI alineado a DB (MySQL)
 */
type Kpi = {
  key: 'residents_active' | 'records_today' | 'alerts_open';
  title: string;
  value: string;
  hint: string;
  tone?: 'ok' | 'warn' | 'info';
};

// =========================
// API (envelope)
// =========================
type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string; details?: any } };
type ApiEnvelope<T> = ApiOk<T> | ApiFail;

// =========================
// BACKEND TYPES (mínimos)
// =========================
type ResidentApi = {
  id: number;
  first_name?: string;
  last_name?: string;
  room?: string | null;
  status?: any;
  is_active?: number | boolean | string | null;
};

type ResidentListApi = {
  page: number;
  limit: number;
  total: number;
  items: ResidentApi[];
};

type TimelineItemApi = {
  id: number;
  resident_id: number;
  event_type: 'vital' | 'medication' | 'observation' | 'profile' | 'other';
  title: string;
  summary: string | null;
  occurred_at: string;
};

type TimelineListApi = { page: number; limit: number; total: number; items: TimelineItemApi[] };

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, RouterModule, HttpClientModule],
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
})
export class DashboardPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('pageRoot', { static: true }) pageRoot!: ElementRef<HTMLElement>;

  // ✅ BaseUrl flexible (puede venir con /api o sin /api, o vacío)
  private readonly BASE = String(API_CONFIG.baseUrl || '').replace(/\/$/, '');

  loadingKpis = false;
  lastError: string | null = null;

  /**
   * KPIs (SE CALCULAN DESDE BACKEND REAL)
   */
  kpis: Kpi[] = [
    {
      key: 'residents_active',
      title: 'Residentes activos',
      value: '—',
      hint: 'Activos en el sistema',
      tone: 'info'
    },
    {
      key: 'records_today',
      title: 'Registros hoy',
      value: '—',
      hint: 'Signos · Medicamentos · Observaciones',
      tone: 'ok'
    },
    {
      key: 'alerts_open',
      title: 'Alertas',
      value: '—',
      hint: 'Pendientes según historial',
      tone: 'warn'
    }
  ];

  /**
   * Acciones rápidas (routing real)
   */
  quick = [
    { label: 'Nuevo residente', path: '/residentes', desc: 'Alta y datos base' },
    { label: 'Registrar signos', path: '/enfermeria', desc: 'Ingreso rápido' },
    { label: 'Cargar medicación', path: '/enfermeria', desc: 'Tratamientos' },
    { label: 'Ver historial', path: '/historial', desc: 'Evolución clínica' },
  ];

  private ctx?: ReturnType<typeof gsap.context>;
  private hoverCapable = false;
  private cleanupFns: Array<() => void> = [];
  private subs = new Subscription();
  private isBrowser = false;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit(): void {
    this.loadKpis();
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    const root = this.pageRoot?.nativeElement;
    if (!root) return;

    const reduceMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

    this.hoverCapable =
      window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches ?? false;

    root.style.setProperty('--dash-safe-bottom', 'max(18px, env(safe-area-inset-bottom))');

    if (reduceMotion) {
      root.style.opacity = '1';
      root.style.transform = 'none';
      this.bindCardHover(root);
      return;
    }

    this.ctx = gsap.context(() => {
      const head = root.querySelector<HTMLElement>('[data-anim="head"]');
      const kpiCards = Array.from(root.querySelectorAll<HTMLElement>('[data-anim="kpi-card"]'));
      const quickCards = Array.from(root.querySelectorAll<HTMLElement>('[data-anim="quick-card"]'));

      gsap.set([head, ...kpiCards, ...quickCards], {
        opacity: 0,
        y: 22,
        scale: 0.92,
        filter: 'blur(10px)',
      });

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' }, delay: 0.16 });

      tl.to(head, { opacity: 1, y: 0, scale: 1, filter: 'blur(0)', duration: 0.72 }, 0)
        .to(kpiCards, {
          opacity: 1,
          y: 0,
          scale: 1,
          filter: 'blur(0)',
          duration: 0.7,
          ease: 'back.out(1.55)',
          stagger: 0.09,
        }, 0.18)
        .to(quickCards, {
          opacity: 1,
          y: 0,
          scale: 1,
          filter: 'blur(0)',
          duration: 0.7,
          ease: 'back.out(1.45)',
          stagger: 0.08,
        }, 0.30);

      this.bindCardHover(root);
    }, root);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.ctx?.revert();
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }

  // ============================================================
  // AUTH
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
  // HELPERS
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

  private fmt(n: number | null | undefined): string {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('es-UY');
  }

  private setKpi(key: Kpi['key'], value: string, tone?: Kpi['tone']): void {
    const i = this.kpis.findIndex(k => k.key === key);
    if (i === -1) return;
    const prev = this.kpis[i];
    this.kpis[i] = { ...prev, value, tone: tone ?? prev.tone };
  }

  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private parseDate(input: string | Date | null | undefined): Date {
    if (!input) return new Date(0);
    if (input instanceof Date) return input;

    const s = String(input);

    if (s.includes('T')) {
      const d = new Date(s);
      return isNaN(d.getTime()) ? new Date(0) : d;
    }

    // "YYYY-MM-DD HH:mm:ss"
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(:\d{2})?$/.test(s)) {
      const d = new Date(s.replace(' ', 'T') + 'Z');
      return isNaN(d.getTime()) ? new Date(0) : d;
    }

    const d = new Date(s);
    return isNaN(d.getTime()) ? new Date(0) : d;
  }

  private isActiveResident(r: ResidentApi): boolean {
    const v: any = (r as any)?.is_active;
    return v === 1 || v === true || v === '1' || v === 'true';
  }

  // ============================================================
  // ✅ URL + FALLBACK (/api <-> sin /api) (SIN ruido)
  // ============================================================
  private buildUrl(path: string, base: string): string {
    const p = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
    if (!base) return p; // relativo
    return `${base}${p}`;
  }

  private apiCandidates(path: string): string[] {
    const cleanBase = this.BASE; // '' | 'http://...' | '/api' | 'http://.../api'
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

    return Array.from(new Set(urls.filter(Boolean)));
  }

  /**
   * Intenta una lista de URLs en orden y devuelve el PRIMER éxito.
   * Si ninguno responde, devuelve null.
   */
  private firstSuccess<T>(urls: string[], req: (url: string) => Observable<T>): Observable<T | null> {
    return from(urls).pipe(
      concatMap((u) =>
        req(u).pipe(
          take(1),
          catchError(() => EMPTY)
        )
      ),
      take(1),
      defaultIfEmpty(null as T | null)
    );
  }

  // ============================================================
  // BACKEND: fetch residents (para residents_active)
  // ============================================================
  private getResidents$(): Observable<ResidentApi[] | null> {
    const headers = this.authHeaders();
    const token = this.getToken();
    const withCredentials = !token;

    const urls = this.apiCandidates(`/residentes?limit=200`);

    return this.firstSuccess<ResidentApi[]>(
      urls,
      (url) =>
        this.http
          .get<ApiEnvelope<ResidentListApi> | ResidentListApi | ApiEnvelope<ResidentApi[]> | ResidentApi[]>(url, {
            headers,
            withCredentials
          })
          .pipe(
            map((raw) => this.unwrap<any>(raw)),
            map((data: any) => {
              // Soporta:
              // - {page,limit,total,items:[...]}
              // - [...]
              const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
              return (items as any[]).map((x) => ({ ...x, id: Number(x.id) })) as ResidentApi[];
            })
          )
    );
  }

  // ============================================================
  // BACKEND: fetch timeline per resident (para records_today + alerts_open)
  // ============================================================
  private getTimelineForResident$(id: number): Observable<TimelineItemApi[] | null> {
    const headers = this.authHeaders();
    const token = this.getToken();
    const withCredentials = !token;

    const urls = this.apiCandidates(`/historial/residentes/${id}?preset=all&limit=200`);

    return this.firstSuccess<TimelineItemApi[]>(
      urls,
      (url) =>
        this.http
          .get<ApiEnvelope<TimelineListApi> | TimelineListApi>(url, { headers, withCredentials })
          .pipe(
            map((raw) => this.unwrap<TimelineListApi>(raw)),
            map((list) => (list?.items || []) as TimelineItemApi[])
          )
    );
  }

  // ============================================================
  // KPI CALC (REAL): basado en endpoints existentes (SIN 404)
  // ============================================================
  private loadKpis(): void {
    this.loadingKpis = true;
    this.lastError = null;

    // placeholders
    this.setKpi('residents_active', '—');
    this.setKpi('records_today', '—');
    this.setKpi('alerts_open', '—');

    const todayStart = this.startOfToday();

    const looksResolved = (txt: string) => {
      const t = (txt || '').toLowerCase();
      return (
        t.includes('resuelta') ||
        t.includes('resuelto') ||
        t.includes('cerrada') ||
        t.includes('cerrado') ||
        t.includes('resolved') ||
        t.includes('closed')
      );
    };

    const isAlertText = (ev: TimelineItemApi) => {
      const txt = `${ev.title || ''} ${ev.summary || ''}`.toLowerCase();
      return txt.includes('alerta');
    };

    this.subs.add(
      this.getResidents$()
        .pipe(
          take(1),
          mergeMap((residents) => {
            if (!residents) {
              this.lastError = 'No se pudo leer /residentes (ruta o auth).';
              return of({ activeCount: 0, recordsToday: 0, alertsOpen: 0 });
            }

            const active = residents.filter((r) => this.isActiveResident(r));
            const activeIds = active.map((r) => Number(r.id)).filter((x) => Number.isFinite(x));

            const activeCount = activeIds.length;

            if (!activeIds.length) {
              return of({ activeCount, recordsToday: 0, alertsOpen: 0 });
            }

            return from(activeIds).pipe(
              mergeMap(
                (id) =>
                  this.getTimelineForResident$(id).pipe(
                    take(1),
                    map((tl) => {
                      const tlItems = Array.isArray(tl) ? tl : [];

                      // records_today: desde timeline
                      const recordsToday = tlItems
                        .filter((ev) => ev.event_type === 'vital' || ev.event_type === 'medication' || ev.event_type === 'observation')
                        .filter((ev) => this.parseDate(ev.occurred_at) >= todayStart)
                        .length;

                      // alerts_open: SOLO desde timeline (para evitar GET /observations que hoy es 404)
                      // criterio: observation + contiene "alerta" + no suena a “resuelta/cerrada”.
                      // (si más adelante agregás endpoint real, lo conectamos acá)
                      const alertsOpen = tlItems
                        .filter((ev) => ev.event_type === 'observation')
                        .filter((ev) => isAlertText(ev))
                        .filter((ev) => !looksResolved(`${ev.title || ''} ${ev.summary || ''}`))
                        .length;

                      return { recordsToday, alertsOpen };
                    }),
                    catchError(() => of({ recordsToday: 0, alertsOpen: 0 }))
                  ),
                6 // ✅ concurrency
              ),
              reduce(
                (acc, cur) => ({
                  activeCount,
                  recordsToday: acc.recordsToday + cur.recordsToday,
                  alertsOpen: acc.alertsOpen + cur.alertsOpen
                }),
                { activeCount, recordsToday: 0, alertsOpen: 0 }
              )
            );
          }),
          tap((k) => {
            this.setKpi('residents_active', this.fmt(k.activeCount), 'info');
            this.setKpi('records_today', this.fmt(k.recordsToday), 'ok');
            this.setKpi('alerts_open', this.fmt(k.alertsOpen), 'warn');
          }),
          finalize(() => {
            this.loadingKpis = false;
          }),
          catchError((e) => {
            this.lastError = this.humanHttpError(e);
            this.loadingKpis = false;
            return EMPTY;
          })
        )
        .subscribe()
    );
  }

  // ============================================================
  // Hover FX
  // ============================================================
  private bindCardHover(root: HTMLElement) {
    if (!this.hoverCapable) return;

    const cards = Array.from(root.querySelectorAll<HTMLElement>('.card'));
    cards.forEach(card => {
      const inner = card.querySelector<HTMLElement>('.card__inner');
      if (!inner) return;

      let raf: number | null = null;

      const onMove = (ev: MouseEvent) => {
        const r = card.getBoundingClientRect();
        const x = ((ev.clientX - r.left) / r.width) * 100;
        const y = ((ev.clientY - r.top) / r.height) * 100;

        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = null;
          card.style.setProperty('--hx', `${x}%`);
          card.style.setProperty('--hy', `${y}%`);
          inner.style.setProperty('--rx', `${((y - 50) / 50) * -4}deg`);
          inner.style.setProperty('--ry', `${((x - 50) / 50) * 5}deg`);
        });
      };

      const onLeave = () => {
        card.style.setProperty('--hx', '50%');
        card.style.setProperty('--hy', '45%');
        inner.style.setProperty('--rx', '0deg');
        inner.style.setProperty('--ry', '0deg');
      };

      card.addEventListener('mousemove', onMove, { passive: true });
      card.addEventListener('mouseleave', onLeave, { passive: true });

      this.cleanupFns.push(() => {
        if (raf) cancelAnimationFrame(raf);
        card.removeEventListener('mousemove', onMove);
        card.removeEventListener('mouseleave', onLeave);
      });
    });
  }
}
