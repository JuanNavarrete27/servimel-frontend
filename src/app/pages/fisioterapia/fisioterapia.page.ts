// src/app/pages/fisioterapia/fisioterapia.page.ts
import {
  Component,
  HostListener,
  Inject,
  PLATFORM_ID,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';

import { API_CONFIG } from '../../core/config/api.config';
import { unwrapApi, ApiResponse } from '../../core/utils/api-unwrap';

type Section = {
  title: string;
  desc: string;
  bullets: string[];
};

type Highlight = {
  label: string;
  detail: string;
  tone: 'ok' | 'info' | 'warn' | 'muted';
};

// ============================================================
// SERVIMEL — Fisioterapia (REAL)
// ✅ Residentes REALES: GET /residentes (sin depender de ResidentesService)
// ✅ Modal por residente
// ✅ Fisio REAL:
//    - intenta leer del backend (si existen endpoints)
//    - y deja helpers listos para CREAR sesiones/notas si existen endpoints
//    - fallback a LocalStorage (sin romper UI) si el backend no los tiene aún
// ============================================================

type ResidentCard = {
  id: number;
  nombre: string;
  apellido: string;
  nroHabitacion?: string;
  cama?: string;
  avatarUrl?: string;
  isActive?: boolean;
};

type PhysioSessionType = 'movilidad' | 'fuerza' | 'respiratorio' | 'otros';

type PhysioSession = {
  id: number;
  dateISO: string; // YYYY-MM-DD
  type: PhysioSessionType;
  durationMin: number;
  objective?: string;
  result?: string;
};

type PhysioNote = {
  id: number;
  dateISO: string; // YYYY-MM-DD
  author: string;
  text: string;
};

type PhysioStatus = 'sin-plan' | 'en-plan' | 'pendiente' | 'alta';

type ResidentPhysio = {
  residentId: number;
  status: PhysioStatus;
  lastSessionISO?: string;
  planSummary?: string;
  sessions: PhysioSession[];
  notes: PhysioNote[];
};

type ModalTab = 'resumen' | 'sesiones' | 'notas';

const LS_PHYSIO_KEY = 'svm_physio_v1';

// Para no spamear el backend (y no pedir fisio 10 veces)
type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

@Component({
  selector: 'app-fisioterapia-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './fisioterapia.page.html',
  styleUrls: ['./fisioterapia.page.scss'],
})
export class FisioterapiaPage implements OnInit {
  // ============================================================
  // Guía visual (se mantiene)
  // ============================================================
  sections: Section[] = [
    {
      title: 'Agenda y sesiones',
      desc: 'Organizá turnos y sesiones individuales o grupales.',
      bullets: [
        'Marcá prioridades por evolución clínica y disponibilidad.',
        'Separá sesiones.',
        'Anotá observaciones breves para compartir con el equipo médico.',
      ],
    },
    {
      title: 'Protocolos y seguridad',
      desc: 'Checklist rápido de apoyo para cada intervención.',
      bullets: [
        'Revisá contraindicaciones y ayudas técnicas necesarias.',
        'Confirma elementos.',
        'Documentá incidencias.',
      ],
    },
    {
      title: 'Coordinación',
      desc: 'Puntos clave para sincronizar con enfermería y médicos.',
      bullets: [
        'Compartir información con enfermería.',
        'Solicitá indicaciones médicas cuando corresponda.',
        'Programá seguimientos según la evolución del residente.',
      ],
    },
  ];

  highlights: Highlight[] = [
    { label: 'Turnos', detail: 'Sin turnos cargados.', tone: 'muted' },
    { label: 'Seguimiento', detail: 'Cargá notas después de cada sesión.', tone: 'info' },
    { label: 'Prevención', detail: 'Protocolos para evitar recaídas.', tone: 'ok' },
  ];

  // ============================================================
  // Rol (storage)
  // ============================================================
  userRole: string | null = null;
  isFisioterapeuta = false;

  // ============================================================
  // Residentes (REALES)
  // ============================================================
  search = '';
  residents: ResidentCard[] = [];
  loadingResidents = false;
  errorMsg = '';

  // ============================================================
  // Fisioterapia por residente (cache)
  // ============================================================
  private physioByResident = new Map<number, ResidentPhysio>();
  private physioLoadState = new Map<number, LoadState>();

  // ============================================================
  // Modal
  // ============================================================
  isModalOpen = false;
  modalTab: ModalTab = 'resumen';
  selectedResident: ResidentCard | null = null;
  selectedPhysio: ResidentPhysio | null = null;
  loadingSelectedPhysio = false;

  readonly editSectionReady = false;

  // Injects
  private http = inject(HttpClient);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  ngOnInit(): void {
    this.detectRoleFromStorage();
    this.loadPhysioLocal();
    void this.fetchResidentsReal();
  }

  // ============================================================
  // AUTH headers (✅ FIX: backend protegido)
  // ============================================================
  private getToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    const keys = [
      'servimel_token_v1',
      'servimel_token',
      'auth_token',
      'token',
      'jwt',
      'access_token',
    ];

    for (const k of keys) {
      try {
        const v = localStorage.getItem(k);
        if (v && v.trim()) return v.trim();
      } catch {
        // ignore
      }
    }
    return null;
  }

  private authHeaders(): HttpHeaders {
    const t = this.getToken();
    if (!t) return new HttpHeaders();
    return new HttpHeaders({ Authorization: `Bearer ${t}` });
  }

  // ============================================================
  // API helpers
  // ============================================================
  private apiBase(): string {
    const base = (API_CONFIG?.baseUrl || '').toString().trim();

    // override opcional (debug)
    let override = '';
    try {
      override =
        localStorage.getItem('SERVIMEL_API_URL') ||
        localStorage.getItem('apiUrl') ||
        '';
    } catch {
      override = '';
    }

    return String(override || base || '').trim();
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

  private humanError(err: unknown, fallback: string): string {
    const e: any = err as any;
    const msg = e?.error?.message ?? e?.message ?? e?.statusText ?? '';
    return msg ? `${fallback} (${msg})` : fallback;
  }

  // ============================================================
  // Role
  // ============================================================
  private detectRoleFromStorage(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const role = this.tryReadRoleFromKnownStorageKeys();
    this.userRole = role;

    // En Servimel puede venir "fisioterapia" o "fisioterapeuta"
    const norm = this.normalizeRole(role);
    this.isFisioterapeuta = norm === 'fisioterapeuta' || norm === 'fisioterapia';
  }

  private tryReadRoleFromKnownStorageKeys(): string | null {
    try {
      const keys = [
        'user',
        'currentUser',
        'auth_user',
        'servimel_user',
        'servimel_user_v1',
        'servimelUser',
        'servimelUser_v1',
        'session_user',
      ];

      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;

        // string directo
        if (raw.length < 60 && !raw.trim().startsWith('{')) return raw;

        const obj = JSON.parse(raw);

        const candidate =
          obj?.rol ??
          obj?.role ??
          obj?.user?.rol ??
          obj?.user?.role ??
          obj?.data?.rol ??
          obj?.data?.role ??
          null;

        if (typeof candidate === 'string' && candidate.trim()) return candidate;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private normalizeRole(role: string | null): string {
    if (!role) return '';
    return String(role).trim().toLowerCase();
  }

  // ============================================================
  // ✅ RESIDENTES REALES (GET /residentes)
  //   Soporta:
  //   - ApiResponse<T> (con unwrapApi)
  //   - array plano
  //   - { items | data | residents }
  // ============================================================
  async fetchResidentsReal(): Promise<void> {
    this.loadingResidents = true;
    this.errorMsg = '';

    const base = this.apiBase();
    const url = this.joinUrl(base, '/residentes?limit=200&offset=0');

    try {
      const raw = await firstValueFrom(
        this.http
          .get<ApiResponse<any> | any>(url, { headers: this.authHeaders() })
          .pipe(map((r) => this.unwrapLoose<any>(r)))
      );

      const arr = Array.isArray(raw)
        ? raw
        : (raw?.items ?? raw?.data ?? raw?.residents ?? []);

      const mapped = (arr || [])
        .map((x: any) => this.mapResident(x))
        .filter((r: ResidentCard | null): r is ResidentCard => !!r);

      this.residents = mapped;

      // crea cache vacía por residente (sin inventar sesiones)
      for (const r of this.residents) this.ensurePhysioExists(r.id);

      this.loadingResidents = false;
    } catch (err: unknown) {
      this.loadingResidents = false;
      this.errorMsg = this.humanError(err, 'No se pudieron cargar residentes.');
    }
  }

  private mapResident(x: any): ResidentCard | null {
    if (!x) return null;

    const id = Number(x.id ?? x.residentId ?? x.residenteId);
    if (!Number.isFinite(id)) return null;

    // Tu endpoint /residentes en FE viejo: { id, nombre, habitacion, estado }
    // Pero también soportamos: first_name/last_name, etc.
    const nombreRaw = (x.nombre ?? x.first_name ?? x.firstName ?? '').toString().trim();
    const apellidoRaw = (x.apellido ?? x.last_name ?? x.lastName ?? '').toString().trim();

    const fullName = (x.fullName ?? x.name ?? '').toString().trim();

    let nombre = nombreRaw;
    let apellido = apellidoRaw;

    if (!nombre && fullName) {
      const parts = fullName.split(' ').filter(Boolean);
      nombre = parts.shift() || '';
      apellido = parts.join(' ');
    }

    if (!nombre) nombre = `Residente`;

    const hab = (x.habitacion ?? x.room ?? x.room_number ?? x.roomNumber ?? '').toString().trim();
    const cama = (x.cama ?? x.bed ?? '').toString().trim();

    const isActive = Boolean(x.is_active ?? x.isActive ?? x.activo ?? true);
    const avatarUrl = (x.avatar_url ?? x.avatarUrl ?? x.photo_url ?? '').toString().trim();

    return {
      id,
      nombre,
      apellido,
      nroHabitacion: hab || undefined,
      cama: cama || undefined,
      avatarUrl: avatarUrl || undefined,
      isActive,
    };
  }

  // ============================================================
  // UI: filtro + trackBy
  // ============================================================
  get filteredResidents(): ResidentCard[] {
    const q = String(this.search || '').trim().toLowerCase();
    if (!q) return this.residents;

    return this.residents.filter((r) => {
      const name = `${r.nombre} ${r.apellido}`.toLowerCase();
      const room = (r.nroHabitacion || '').toLowerCase();
      return (
        name.includes(q) ||
        room.includes(q) ||
        String(r.id).includes(q)
      );
    });
  }

  trackByResident(_index: number, item: ResidentCard): number {
    return item.id;
  }

  trackByTitle(_index: number, item: Section): string {
    return item.title;
  }

  trackByHighlight(_index: number, item: Highlight): string {
    return item.label;
  }

  // ============================================================
  // Modal
  // ============================================================
  openResidentModal(resident: ResidentCard): void {
    this.selectedResident = resident;

    // pinta instantáneo
    this.selectedPhysio = this.ensurePhysioExists(resident.id);

    this.modalTab = 'resumen';
    this.isModalOpen = true;

    // intenta backend real (si endpoints existen)
    void this.ensurePhysioFromApi(resident.id);
  }

  closeResidentModal(): void {
    this.isModalOpen = false;
    this.modalTab = 'resumen';
    this.selectedResident = null;
    this.selectedPhysio = null;
    this.loadingSelectedPhysio = false;
  }

  setModalTab(tab: ModalTab): void {
    this.modalTab = tab;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isModalOpen) this.closeResidentModal();
  }

  // ============================================================
  // UI helpers fisio
  // ============================================================
  getStatusLabel(status: PhysioStatus): string {
    switch (status) {
      case 'sin-plan':
        return 'Sin plan';
      case 'en-plan':
        return 'En plan';
      case 'pendiente':
        return 'Pendiente';
      case 'alta':
        return 'Alta';
      default:
        return '—';
    }
  }

  getStatusTone(status: PhysioStatus): 'ok' | 'info' | 'warn' | 'muted' {
    switch (status) {
      case 'en-plan':
        return 'ok';
      case 'pendiente':
        return 'warn';
      case 'alta':
        return 'info';
      case 'sin-plan':
      default:
        return 'muted';
    }
  }

  formatSessionType(t: PhysioSessionType): string {
    switch (t) {
      case 'movilidad':
        return 'Movilidad';
      case 'fuerza':
        return 'Fuerza';
      case 'respiratorio':
        return 'Respiratorio';
      case 'otros':
      default:
        return 'Otros';
    }
  }

  // ============================================================
  // Entry edit (placeholder)
  // ============================================================
  get canSeeEditEntry(): boolean {
    return this.isFisioterapeuta;
  }

  get editEntryLabel(): string {
    return 'EDITAR RESIDENTE';
  }

  getEditResidentLink(resident: ResidentCard | null): string {
    if (!resident) return '/fisioterapia';
    return `/fisioterapia/residentes/${resident.id}/editar`;
  }

  onEditResidentPlaceholder(): void {
    // placeholder
  }

  // ============================================================
  // ✅ PHYSIO: cache + backend if exists + fallback LS
  // ============================================================
  private ensurePhysioExists(residentId: number): ResidentPhysio {
    const existing = this.physioByResident.get(residentId);
    if (existing) return existing;

    const empty = this.buildEmptyPhysio(residentId);
    this.physioByResident.set(residentId, empty);
    this.persistPhysioLocal();
    this.physioLoadState.set(residentId, 'idle');
    return empty;
  }

  private async ensurePhysioFromApi(residentId: number): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const state = this.physioLoadState.get(residentId) ?? 'idle';
    if (state === 'loading' || state === 'loaded') return;

    const base = this.apiBase();
    if (!base) return;

    this.physioLoadState.set(residentId, 'loading');

    const isSelected = this.selectedResident?.id === residentId;
    if (isSelected) this.loadingSelectedPhysio = true;

    try {
      const physio = await this.tryFetchPhysioReal(residentId);
      if (physio) {
        const current = this.ensurePhysioExists(residentId);

        const merged: ResidentPhysio = {
          residentId,
          status: (physio.status || current.status) as PhysioStatus,
          lastSessionISO: physio.lastSessionISO ?? current.lastSessionISO,
          planSummary: physio.planSummary ?? current.planSummary,
          sessions: Array.isArray(physio.sessions) ? physio.sessions : current.sessions,
          notes: Array.isArray(physio.notes) ? physio.notes : current.notes,
        };

        this.physioByResident.set(residentId, merged);
        this.persistPhysioLocal();

        if (isSelected) this.selectedPhysio = merged;

        this.physioLoadState.set(residentId, 'loaded');
      } else {
        // no endpoint encontrado -> dejamos cache local y marcamos loaded igual (evita spam)
        this.physioLoadState.set(residentId, 'loaded');
      }
    } catch {
      this.physioLoadState.set(residentId, 'error');
    } finally {
      if (isSelected) this.loadingSelectedPhysio = false;
    }
  }

  // ------------------------------------------------------------
  // Intento de endpoints posibles
  // ------------------------------------------------------------
  private async tryFetchPhysioReal(residentId: number): Promise<ResidentPhysio | null> {
    const base = this.apiBase();

    const candidates = [
      // probables
      `/fisioterapia/residentes/${residentId}`,
      `/fisioterapia/residentes/${residentId}/resumen`,
      `/fisioterapia/${residentId}`,

      // variante servicios
      `/servicios/fisioterapia/residentes/${residentId}`,
      `/servicios/fisioterapia/residentes/${residentId}/resumen`,
      `/servicios/fisioterapia/${residentId}`,
    ];

    for (const path of candidates) {
      const url = this.joinUrl(base, path);
      try {
        const payload = await firstValueFrom(
          this.http
            .get<ApiResponse<any> | any>(url, { headers: this.authHeaders() })
            .pipe(map((r) => this.unwrapLoose<any>(r)))
        );

        const normalized = this.normalizePhysioPayload(payload, residentId);
        if (normalized) return normalized;
      } catch {
        // sigue
      }
    }

    return null;
  }

  private normalizePhysioPayload(payload: any, residentId: number): ResidentPhysio | null {
    if (!payload) return null;

    const data = payload?.data ?? payload;

    const statusRaw = (data?.status ?? data?.estado ?? 'sin-plan') as any;
    const status = (['sin-plan', 'en-plan', 'pendiente', 'alta'].includes(String(statusRaw))
      ? statusRaw
      : 'sin-plan') as PhysioStatus;

    const lastSessionISO = (
      data?.lastSessionISO ??
      data?.last_session_iso ??
      data?.lastSession ??
      data?.ultimaSesion ??
      ''
    )
      .toString()
      .slice(0, 10);

    const planSummary = (
      data?.planSummary ??
      data?.plan_summary ??
      data?.resumenPlan ??
      data?.plan ??
      ''
    ).toString();

    const rawSessions = data?.sessions ?? data?.sesiones ?? data?.items ?? [];
    const rawNotes = data?.notes ?? data?.notas ?? [];

    const sessions: PhysioSession[] = Array.isArray(rawSessions)
      ? (rawSessions
          .map((s: any) => {
            const id = Number(s?.id ?? s?.sessionId ?? s?.session_id);
            if (!Number.isFinite(id)) return null;

            const dateISO = String(s?.dateISO ?? s?.date ?? s?.fechaISO ?? s?.fecha ?? '')
              .slice(0, 10) || this.todayISO();

            const typeRaw = String(s?.type ?? s?.tipo ?? 'otros').toLowerCase();
            const type: PhysioSessionType =
              typeRaw.includes('mov') ? 'movilidad' :
              typeRaw.includes('fuer') ? 'fuerza' :
              typeRaw.includes('resp') ? 'respiratorio' : 'otros';

            const durationMin = Number(s?.durationMin ?? s?.duration_min ?? s?.minutos ?? s?.duration ?? 0);
            const safeDur = Number.isFinite(durationMin) ? durationMin : 0;

            return {
              id,
              dateISO,
              type,
              durationMin: safeDur,
              objective: s?.objective ?? s?.objetivo ?? undefined,
              result: s?.result ?? s?.resultado ?? undefined,
            } as PhysioSession;
          })
          .filter(Boolean)) as PhysioSession[]
      : [];

    const notes: PhysioNote[] = Array.isArray(rawNotes)
      ? (rawNotes
          .map((n: any) => {
            const id = Number(n?.id ?? n?.noteId ?? n?.note_id);
            if (!Number.isFinite(id)) return null;

            const dateISO = String(n?.dateISO ?? n?.date ?? n?.fechaISO ?? n?.fecha ?? '')
              .slice(0, 10) || this.todayISO();

            const author = String(n?.author ?? n?.autor ?? n?.createdBy ?? 'Fisioterapia');
            const text = String(n?.text ?? n?.nota ?? n?.contenido ?? '');

            return { id, dateISO, author, text } as PhysioNote;
          })
          .filter(Boolean)) as PhysioNote[]
      : [];

    return {
      residentId,
      status,
      lastSessionISO: lastSessionISO || (sessions[0]?.dateISO ?? undefined),
      planSummary: planSummary || undefined,
      sessions,
      notes,
    };
  }

  // ============================================================
  // ✅ Enviar datos reales (si existen endpoints)
  // - si NO existen, guarda en LocalStorage (fallback)
  //   (No rompe compile aunque no lo uses en HTML todavía)
  // ============================================================
  async addSessionReal(
    residentId: number,
    payload: { dateISO: string; type: PhysioSessionType; durationMin: number; objective?: string; result?: string }
  ): Promise<void> {
    const base = this.apiBase();
    if (!base) return;

    const candidates = [
      `/fisioterapia/residentes/${residentId}/sessions`,
      `/fisioterapia/residentes/${residentId}/sesiones`,
      `/servicios/fisioterapia/residentes/${residentId}/sessions`,
    ];

    for (const path of candidates) {
      const url = this.joinUrl(base, path);
      try {
        const res = await firstValueFrom(
          this.http
            .post<ApiResponse<any> | any>(url, payload, { headers: this.authHeaders() })
            .pipe(map((r) => this.unwrapLoose<any>(r)))
        );

        // si el backend devuelve algo útil, refrescamos
        void res;
        await this.refreshPhysio(residentId);
        return;
      } catch {
        // sigue
      }
    }

    // fallback local
    const current = this.ensurePhysioExists(residentId);
    const nextId = Date.now();
    const next: ResidentPhysio = {
      ...current,
      status: current.status === 'sin-plan' ? 'en-plan' : current.status,
      lastSessionISO: payload.dateISO,
      sessions: [
        {
          id: nextId,
          dateISO: payload.dateISO,
          type: payload.type,
          durationMin: payload.durationMin,
          objective: payload.objective,
          result: payload.result,
        },
        ...current.sessions,
      ],
    };
    this.physioByResident.set(residentId, next);
    this.persistPhysioLocal();

    if (this.selectedResident?.id === residentId) this.selectedPhysio = next;
  }

  async addNoteReal(
    residentId: number,
    payload: { dateISO: string; author: string; text: string }
  ): Promise<void> {
    const base = this.apiBase();
    if (!base) return;

    const candidates = [
      `/fisioterapia/residentes/${residentId}/notes`,
      `/fisioterapia/residentes/${residentId}/notas`,
      `/servicios/fisioterapia/residentes/${residentId}/notes`,
    ];

    for (const path of candidates) {
      const url = this.joinUrl(base, path);
      try {
        await firstValueFrom(
          this.http
            .post<ApiResponse<any> | any>(url, payload, { headers: this.authHeaders() })
            .pipe(map((r) => this.unwrapLoose<any>(r)))
        );

        await this.refreshPhysio(residentId);
        return;
      } catch {
        // sigue
      }
    }

    // fallback local
    const current = this.ensurePhysioExists(residentId);
    const nextId = Date.now();
    const next: ResidentPhysio = {
      ...current,
      notes: [{ id: nextId, ...payload }, ...current.notes],
    };
    this.physioByResident.set(residentId, next);
    this.persistPhysioLocal();

    if (this.selectedResident?.id === residentId) this.selectedPhysio = next;
  }

  private async refreshPhysio(residentId: number): Promise<void> {
    // reintenta aunque estaba "loaded"
    this.physioLoadState.set(residentId, 'idle');
    await this.ensurePhysioFromApi(residentId);
  }

  // ============================================================
  // LocalStorage fallback
  // ============================================================
  private loadPhysioLocal(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const raw = localStorage.getItem(LS_PHYSIO_KEY);
      if (!raw) return;

      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return;

      for (const [k, v] of Object.entries(obj)) {
        const id = Number(k);
        if (!Number.isFinite(id)) continue;

        const vv: any = v as any;

        const safe: ResidentPhysio = {
          residentId: id,
          status: (vv?.status ?? 'sin-plan') as PhysioStatus,
          lastSessionISO: vv?.lastSessionISO ?? undefined,
          planSummary: vv?.planSummary ?? undefined,
          sessions: Array.isArray(vv?.sessions) ? vv.sessions : [],
          notes: Array.isArray(vv?.notes) ? vv.notes : [],
        };

        this.physioByResident.set(id, safe);
      }
    } catch {
      // ignore
    }
  }

  private persistPhysioLocal(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const out: Record<string, ResidentPhysio> = {};
      this.physioByResident.forEach((v, k) => (out[String(k)] = v));
      localStorage.setItem(LS_PHYSIO_KEY, JSON.stringify(out));
    } catch {
      // ignore
    }
  }

  private buildEmptyPhysio(residentId: number): ResidentPhysio {
    return {
      residentId,
      status: 'sin-plan',
      // ✅ FIX: si no hay plan real, dejamos undefined para que el HTML muestre el fallback "Sin plan activo..."
      planSummary: undefined,
      sessions: [],
      notes: [],
    };
  }

  // ============================================================
  // Dates
  // ============================================================
  private todayISO(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}
