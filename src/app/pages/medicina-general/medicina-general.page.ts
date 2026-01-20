// src/app/pages/medicina-general/medicina-general.page.ts
// ============================================================
// SERVIMEL — Medicina General (Médico)
// ✅ CRUD REAL por backend (HttpClient)
// ✅ API_CONFIG.baseUrl (NO hardcode "/api")
// ✅ unwrapApi unificado vía core/utils/api-unwrap
// ✅ OnPush + markForCheck() para UI consistente
// ✅ Residents desde /residentes
// ✅ Record COMPAT desde /medicina-general/records/:residentId
// ✅ CRUD REAL MG desde /medicina-general/:residentId/(header|diagnoses|controls|exams|evolution|documents|alerts)
// ✅ MEDICACIÓN REAL (enfermería):
//    - POST   /enfermeria/residentes/:id/medications
//    - PATCH  /enfermeria/medications/:medId   (fallback /enfermeria/residentes/:id/medications/:medId)
//    - DELETE /enfermeria/medications/:medId   (fallback /enfermeria/residentes/:id/medications/:medId)
//    - GET meds: /historial/residentes/:id?preset=all (timeline) usando ref_id real
//
// ✅ FIX DEBUG:
//    - Mutations NO silencian errores (NO fallback makeEmpty)
//    - Logs completos en consola (status/url/body)
// ============================================================

import {
  Component,
  ChangeDetectionStrategy,
  Inject,
  PLATFORM_ID,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  FormGroup,
} from '@angular/forms';
import {
  HttpClient,
  HttpClientModule,
  HttpHeaders,
} from '@angular/common/http';

import { Subscription, Observable, of, forkJoin, throwError } from 'rxjs';
import { catchError, finalize, map, switchMap } from 'rxjs/operators';

import { API_CONFIG } from '../../core/config/api.config';
import { unwrapApi, ApiResponse } from '../../core/utils/api-unwrap';
import { AuthService } from '../../shared/services/auth.service';

// ============================================================
// Tipos / Modelos (frontend)
// ============================================================

type RiskLevel = 'ALTO' | 'MEDIO' | 'BAJO';
type DiagnosisStatus = 'ACTIVO' | 'CONTROLADO' | 'RESUELTO';
type ControlType = 'RUTINA' | 'URGENCIA' | 'SEGUIMIENTO';
type EvolutionType = 'RUTINA' | 'SEGUIMIENTO' | 'URGENCIA';

// ✅ MEDICACIÓN — estado real backend
type MedEstadoBackend = 'pending' | 'administered' | 'late' | 'suspended';

export interface ResidentSummary {
  id: number;
  fullName: string;
  room?: string;
  age?: number;
  avatarUrl?: string;
  isActive?: boolean;
}

export interface ClinicalHeader {
  bloodGroup?: string;
  rh?: string;
  weightKg?: number | null;
  heightCm?: number | null;
  bmi?: number | null;
  allergies?: string[];
  chronicConditions?: string[];
  activeDiagnosesSummary?: string;
  riskLevel?: RiskLevel;
  treatingDoctor?: string;
  lastMedicalEval?: string | null;
  generalNotes?: string;
}

export interface Diagnosis {
  id: number;
  cie10?: string;
  name: string;
  date?: string;
  status: DiagnosisStatus;
  notes?: string;
}

export interface Medication {
  id: number; // ✅ id REAL de medications (ref_id desde timeline)
  name: string; // drug_name
  dose?: string;
  schedule?: string; // "08:00"
  route?: string;
  startDate?: string | null;
  endDate?: string | null;
  instructions?: string;

  // UI propia de MG
  status?: 'ACTIVO' | 'SUSPENDIDO' | 'FINALIZADO';
  prescribedBy?: string;

  // extras internos
  backendStatus?: MedEstadoBackend;
  scheduledAt?: string | null;
  administeredAt?: string | null;
}

export interface MedicalControl {
  id: number;
  date: string;
  type: ControlType;
  reason?: string;
  findings?: string;
  conclusion?: string;
  nextControl?: string | null;
}

export interface MedicalExam {
  id: number;
  date: string;
  type: string;
  result?: string;
  notes?: string;
  fileName?: string;
}

export interface EvolutionNote {
  id: number;
  date: string;
  type: EvolutionType;
  professional?: string;
  note: string;
}

export interface ClinicalAlert {
  id: number;
  date: string;
  kind: string;
  detail?: string;
  level?: 'INFO' | 'WARN' | 'CRIT';
  resolved?: boolean;
}

export interface ClinicalDocument {
  id: number;
  date: string;
  type: string;
  fileName: string;
  notes?: string;
}

export interface MedicinaGeneralRecord {
  residentId: number;
  header: ClinicalHeader;
  diagnoses: Diagnosis[];
  meds: Medication[];
  controls: MedicalControl[];
  exams: MedicalExam[];
  evolution: EvolutionNote[];
  alerts: ClinicalAlert[];
  documents: ClinicalDocument[];
  updatedAt?: string;
}

// ============================================================
// ✅ Endpoints CORRECTOS (según tu medicinaGeneral.routes.js)
// ============================================================

const MG_ENDPOINTS = {
  residents: () => `${API_CONFIG.baseUrl}/residentes`,

  // ✅ Record compat
  recordCompat: (residentId: number) =>
    `${API_CONFIG.baseUrl}/medicina-general/records/${residentId}`,

  // ✅ CRUD REAL MG
  header: (residentId: number) =>
    `${API_CONFIG.baseUrl}/medicina-general/${residentId}/header`,

  diagnoses: (residentId: number) =>
    `${API_CONFIG.baseUrl}/medicina-general/${residentId}/diagnoses`,
  diagnosis: (residentId: number, id: number) =>
    `${API_CONFIG.baseUrl}/medicina-general/${residentId}/diagnoses/${id}`,

  controls: (residentId: number) =>
    `${API_CONFIG.baseUrl}/medicina-general/${residentId}/controls`,
  control: (residentId: number, id: number) =>
    `${API_CONFIG.baseUrl}/medicina-general/${residentId}/controls/${id}`,

  exams: (residentId: number) =>
    `${API_CONFIG.baseUrl}/medicina-general/${residentId}/exams`,
  exam: (residentId: number, id: number) =>
    `${API_CONFIG.baseUrl}/medicina-general/${residentId}/exams/${id}`,

  evolution: (residentId: number) =>
    `${API_CONFIG.baseUrl}/medicina-general/${residentId}/evolution`,
  evo: (residentId: number, id: number) =>
    `${API_CONFIG.baseUrl}/medicina-general/${residentId}/evolution/${id}`,

  documents: (residentId: number) =>
    `${API_CONFIG.baseUrl}/medicina-general/${residentId}/documents`,
  document: (residentId: number, id: number) =>
    `${API_CONFIG.baseUrl}/medicina-general/${residentId}/documents/${id}`,

  alerts: (residentId: number) =>
    `${API_CONFIG.baseUrl}/medicina-general/${residentId}/alerts`,
  alert: (residentId: number, id: number) =>
    `${API_CONFIG.baseUrl}/medicina-general/${residentId}/alerts/${id}`,
  alertToggle: (residentId: number, id: number) =>
    `${API_CONFIG.baseUrl}/medicina-general/${residentId}/alerts/${id}/toggle`,

  // ✅ timeline meds reales
  timelineAll: (residentId: number) =>
    `${API_CONFIG.baseUrl}/historial/residentes/${residentId}?preset=all&limit=200`,

  // ✅ meds reales (enfermeria)
  medsCreate: (residentId: number) =>
    `${API_CONFIG.baseUrl}/enfermeria/residentes/${residentId}/medications`,

  medPatch1: (medId: number) =>
    `${API_CONFIG.baseUrl}/enfermeria/medications/${medId}`,
  medPatch2: (residentId: number, medId: number) =>
    `${API_CONFIG.baseUrl}/enfermeria/residentes/${residentId}/medications/${medId}`,

  medDelete1: (medId: number) =>
    `${API_CONFIG.baseUrl}/enfermeria/medications/${medId}`,
  medDelete2: (residentId: number, medId: number) =>
    `${API_CONFIG.baseUrl}/enfermeria/residentes/${residentId}/medications/${medId}`,
};

// ============================================================
// Helpers timeline
// ============================================================

type TimelineItemApi = {
  id: number;
  resident_id: number;
  event_type: 'vital' | 'medication' | 'observation' | 'profile' | 'other';
  ref_table: string;
  ref_id: number; // ✅ id real de tabla
  title: string;
  summary: string | null;
  occurred_at: string;
};

type TimelineListApi = {
  page: number;
  limit: number;
  total: number;
  items: TimelineItemApi[];
};

// ============================================================
// API HTTP (real)
// ============================================================

class MedicinaGeneralApiHttp {
  private isBrowser = false;

  constructor(private http: HttpClient, private platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  // ---------- auth ----------
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

    // ✅ DEBUG TOKEN
    console.log('[MG] tokenExists=', !!t, 'tokenLen=', t?.length ?? 0);

    if (!t) return new HttpHeaders();
    return new HttpHeaders({ Authorization: `Bearer ${t}` });
  }

  private options() {
    return { headers: this.authHeaders() };
  }

  private logHttpError(tag: string, err: any): void {
    const status = err?.status;
    const url = err?.url;
    const message = err?.message;

    console.group(`🚨 [MG API ERROR] ${tag}`);
    console.log('status:', status);
    console.log('url:', url);
    console.log('message:', message);
    console.log('error body:', err?.error);
    console.log('full:', err);
    console.groupEnd();
  }

  // ---------- record map ----------
  private mapRecord(
    res: ApiResponse<any>,
    residentIdFallback?: number
  ): MedicinaGeneralRecord {
    const data = unwrapApi<any>(res);
    const rec = (data?.record ?? data?.data ?? data) as any;

    if (
      rec &&
      typeof rec === 'object' &&
      Number.isFinite(Number(rec.residentId))
    ) {
      return rec as MedicinaGeneralRecord;
    }

    const rid = residentIdFallback ?? Number(rec?.residentId) ?? 0;
    return this.makeEmpty(rid || 0);
  }

  private makeEmpty(residentId: number): MedicinaGeneralRecord {
    return {
      residentId,
      header: {
        allergies: [],
        chronicConditions: [],
        riskLevel: 'BAJO',
        rh: '+',
      },
      diagnoses: [],
      meds: [],
      controls: [],
      exams: [],
      evolution: [],
      alerts: [],
      documents: [],
      updatedAt: new Date().toISOString(),
    };
  }

  private occurredToIso(s: string): string {
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

  private mapBackendStatusFromSummary(
    summary: string | null
  ): MedEstadoBackend {
    const s = (summary || '').toLowerCase();
    if (s.includes('administered')) return 'administered';
    if (s.includes('late')) return 'late';
    if (s.includes('suspended')) return 'suspended';
    return 'pending';
  }

  // ✅ meds reales desde timeline:
  private mapMedsFromTimeline(tl: TimelineListApi): Medication[] {
    const items = tl?.items || [];
    const medsEv = items.filter((ev) => ev.event_type === 'medication');

    const mapped: Medication[] = medsEv.map((ev) => {
      const parts = (ev.summary || '')
        .split('·')
        .map((x) => x.trim())
        .filter(Boolean);

      const realMedId = Number(ev.ref_id);

      return {
        id:
          Number.isFinite(realMedId) && realMedId > 0
            ? realMedId
            : Number(ev.id),
        name: parts[0] || ev.title || 'Medicación',
        dose: parts[1] || '',
        schedule: this.hhmmFromOccurredAt(ev.occurred_at),
        route: '',
        status: 'ACTIVO',
        backendStatus: this.mapBackendStatusFromSummary(ev.summary),
        scheduledAt: this.occurredToIso(ev.occurred_at),
      };
    });

    return mapped.sort((a, b) =>
      String(b.scheduledAt || '').localeCompare(String(a.scheduledAt || ''))
    );
  }

  // ---------- residents ----------
  getResidents(): Observable<ResidentSummary[]> {
    const url = MG_ENDPOINTS.residents();

    return this.http.get<ApiResponse<any>>(url, this.options()).pipe(
      map((res) => {
        const data = unwrapApi<any>(res);
        const arr: any[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data?.rows)
          ? data.rows
          : Array.isArray(data?.data)
          ? data.data
          : [];

        return (arr || []).map((r: any) => {
          const id = Number(r?.id);
          const nombre = (r?.nombre ?? r?.first_name ?? r?.name ?? '').toString();
          const apellido = (r?.apellido ?? r?.last_name ?? '').toString();
          const fullName = `${nombre} ${apellido}`.trim() || `Residente #${id}`;

          const room =
            (r?.habitacion ?? r?.room ?? '').toString().trim() || undefined;
          const age = r?.age != null ? Number(r.age) : undefined;

          return {
            id,
            fullName,
            room,
            age: Number.isFinite(age as any) ? age : undefined,
            avatarUrl: r?.avatarUrl || r?.avatar_url || undefined,
            isActive: r?.isActive ?? r?.active ?? r?.is_active ?? true,
          } as ResidentSummary;
        });
      }),
      catchError((err) => {
        this.logHttpError('getResidents', err);
        return of<ResidentSummary[]>([]);
      })
    );
  }

  // ✅ record compat + meds reales (timeline)
  getRecord(residentId: number): Observable<MedicinaGeneralRecord> {
    const base$ = this.http
      .get<ApiResponse<any>>(MG_ENDPOINTS.recordCompat(residentId), this.options())
      .pipe(
        map((res) => this.mapRecord(res, residentId)),
        catchError((err) => {
          this.logHttpError('getRecord(base)', err);
          return of(this.makeEmpty(residentId));
        })
      );

    const meds$ = this.http
      .get<ApiResponse<any>>(MG_ENDPOINTS.timelineAll(residentId), this.options())
      .pipe(
        map((res) => {
          const data = unwrapApi<any>(res) as any;
          const tl: TimelineListApi =
            (data?.items ? data : data?.data?.items ? data.data : data) as any;

          const norm: TimelineListApi = {
            page: Number(tl?.page ?? 1),
            limit: Number(tl?.limit ?? 200),
            total: Number(tl?.total ?? (tl?.items?.length ?? 0)),
            items: Array.isArray(tl?.items) ? tl.items : [],
          };

          return this.mapMedsFromTimeline(norm);
        }),
        catchError((err) => {
          this.logHttpError('getRecord(medsTimeline)', err);
          return of<Medication[]>([]);
        })
      );

    return forkJoin([base$, meds$]).pipe(
      map(([rec, meds]) => ({
        ...rec,
        meds: Array.isArray(meds) ? meds : [],
        updatedAt: new Date().toISOString(),
      }))
    );
  }

  // ==========================================================
  // ✅ MUTATIONS: NO SILENCIAR ERRORES
  // ==========================================================

  // ---------- header ----------
  upsertHeader(
    residentId: number,
    header: ClinicalHeader
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .put<ApiResponse<any>>(MG_ENDPOINTS.header(residentId), header, this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('upsertHeader', err);
          return throwError(() => err);
        })
      );
  }

  // ---------- diagnoses ----------
  createDiagnosis(
    residentId: number,
    payload: Omit<Diagnosis, 'id'>
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .post<ApiResponse<any>>(MG_ENDPOINTS.diagnoses(residentId), payload, this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('createDiagnosis', err);
          return throwError(() => err);
        })
      );
  }

  updateDiagnosis(
    residentId: number,
    id: number,
    payload: Omit<Diagnosis, 'id'>
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .put<ApiResponse<any>>(MG_ENDPOINTS.diagnosis(residentId, id), payload, this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('updateDiagnosis', err);
          return throwError(() => err);
        })
      );
  }

  deleteDiagnosis(
    residentId: number,
    id: number
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .delete<ApiResponse<any>>(MG_ENDPOINTS.diagnosis(residentId, id), this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('deleteDiagnosis', err);
          return throwError(() => err);
        })
      );
  }

  // ==========================================================
  // ✅ MEDICACIÓN REAL (enfermería)
  // ==========================================================

  private mapMgStatusToBackend(
    status: 'ACTIVO' | 'SUSPENDIDO' | 'FINALIZADO' | undefined
  ): MedEstadoBackend {
    if (status === 'SUSPENDIDO') return 'suspended';
    if (status === 'FINALIZADO') return 'administered';
    return 'pending';
  }

  private buildMedicationCreateBody(
    payload: Omit<Medication, 'id'>
  ): any {
    const now = new Date();
    const scheduled_at = payload?.schedule
      ? this.combineTodayTimeToIso(payload.schedule)
      : now.toISOString();

    return {
      drug_name: payload.name,
      dose: payload.dose || '',
      route: payload.route || null,
      status: this.mapMgStatusToBackend(payload.status),
      scheduled_at,
      administered_at: null,
      notes: payload.instructions || null,
    };
  }

  private buildMedicationPatchBody(payload: Omit<Medication, 'id'>): any {
    const body: any = {};

    if (payload.name) body.drug_name = payload.name;
    if (payload.dose != null) body.dose = payload.dose;
    if (payload.route != null) body.route = payload.route;
    if (payload.instructions != null) body.notes = payload.instructions;

    if (payload.schedule) {
      body.scheduled_at = this.combineTodayTimeToIso(payload.schedule);
    }

    if (payload.status) {
      const st = this.mapMgStatusToBackend(payload.status);
      body.status = st;

      if (st === 'administered') {
        body.administered_at = new Date().toISOString();
      }
    }

    return body;
  }

  private tryPatchMedication(
    residentId: number,
    medId: number,
    body: any
  ): Observable<any> {
    const url1 = MG_ENDPOINTS.medPatch1(medId);
    const url2 = MG_ENDPOINTS.medPatch2(residentId, medId);

    return this.http.patch<ApiResponse<any>>(url1, body, this.options()).pipe(
      catchError((e1: any) => {
        const sc = Number(e1?.status);
        if (sc === 404 || sc === 405) {
          return this.http.patch<ApiResponse<any>>(url2, body, this.options());
        }
        return throwError(() => e1);
      })
    );
  }

  private tryDeleteMedication(residentId: number, medId: number): Observable<any> {
    const url1 = MG_ENDPOINTS.medDelete1(medId);
    const url2 = MG_ENDPOINTS.medDelete2(residentId, medId);

    return this.http.delete<ApiResponse<any>>(url1, this.options()).pipe(
      catchError((e1: any) => {
        const sc = Number(e1?.status);
        if (sc === 404 || sc === 405) {
          return this.http.delete<ApiResponse<any>>(url2, this.options());
        }
        return throwError(() => e1);
      })
    );
  }

  createMedication(
    residentId: number,
    payload: Omit<Medication, 'id'>
  ): Observable<MedicinaGeneralRecord> {
    const body = this.buildMedicationCreateBody(payload);

    return this.http
      .post<ApiResponse<any>>(MG_ENDPOINTS.medsCreate(residentId), body, this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('createMedication', err);
          return throwError(() => err);
        })
      );
  }

  updateMedication(
    residentId: number,
    id: number,
    payload: Omit<Medication, 'id'>
  ): Observable<MedicinaGeneralRecord> {
    const body = this.buildMedicationPatchBody(payload);

    return this.tryPatchMedication(residentId, id, body).pipe(
      switchMap(() => this.getRecord(residentId)),
      catchError((err) => {
        this.logHttpError('updateMedication', err);
        return throwError(() => err);
      })
    );
  }

  deleteMedication(
    residentId: number,
    id: number
  ): Observable<MedicinaGeneralRecord> {
    return this.tryDeleteMedication(residentId, id).pipe(
      switchMap(() => this.getRecord(residentId)),
      catchError((err) => {
        this.logHttpError('deleteMedication', err);
        return throwError(() => err);
      })
    );
  }

  // ---------- controls ----------
  createControl(
    residentId: number,
    payload: Omit<MedicalControl, 'id'>
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .post<ApiResponse<any>>(MG_ENDPOINTS.controls(residentId), payload, this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('createControl', err);
          return throwError(() => err);
        })
      );
  }

  updateControl(
    residentId: number,
    id: number,
    payload: Omit<MedicalControl, 'id'>
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .put<ApiResponse<any>>(MG_ENDPOINTS.control(residentId, id), payload, this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('updateControl', err);
          return throwError(() => err);
        })
      );
  }

  deleteControl(
    residentId: number,
    id: number
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .delete<ApiResponse<any>>(MG_ENDPOINTS.control(residentId, id), this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('deleteControl', err);
          return throwError(() => err);
        })
      );
  }

  // ---------- exams ----------
  createExam(
    residentId: number,
    payload: Omit<MedicalExam, 'id'>
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .post<ApiResponse<any>>(MG_ENDPOINTS.exams(residentId), payload, this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('createExam', err);
          return throwError(() => err);
        })
      );
  }

  updateExam(
    residentId: number,
    id: number,
    payload: Omit<MedicalExam, 'id'>
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .put<ApiResponse<any>>(MG_ENDPOINTS.exam(residentId, id), payload, this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('updateExam', err);
          return throwError(() => err);
        })
      );
  }

  deleteExam(
    residentId: number,
    id: number
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .delete<ApiResponse<any>>(MG_ENDPOINTS.exam(residentId, id), this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('deleteExam', err);
          return throwError(() => err);
        })
      );
  }

  // ---------- evolution ----------
  createEvolution(
    residentId: number,
    payload: Omit<EvolutionNote, 'id'>
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .post<ApiResponse<any>>(MG_ENDPOINTS.evolution(residentId), payload, this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('createEvolution', err);
          return throwError(() => err);
        })
      );
  }

  updateEvolution(
    residentId: number,
    id: number,
    payload: Omit<EvolutionNote, 'id'>
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .put<ApiResponse<any>>(MG_ENDPOINTS.evo(residentId, id), payload, this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('updateEvolution', err);
          return throwError(() => err);
        })
      );
  }

  deleteEvolution(
    residentId: number,
    id: number
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .delete<ApiResponse<any>>(MG_ENDPOINTS.evo(residentId, id), this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('deleteEvolution', err);
          return throwError(() => err);
        })
      );
  }

  // ---------- documents ----------
  createDocument(
    residentId: number,
    payload: Omit<ClinicalDocument, 'id'>
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .post<ApiResponse<any>>(MG_ENDPOINTS.documents(residentId), payload, this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('createDocument', err);
          return throwError(() => err);
        })
      );
  }

  updateDocument(
    residentId: number,
    id: number,
    payload: Omit<ClinicalDocument, 'id'>
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .put<ApiResponse<any>>(MG_ENDPOINTS.document(residentId, id), payload, this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('updateDocument', err);
          return throwError(() => err);
        })
      );
  }

  deleteDocument(
    residentId: number,
    id: number
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .delete<ApiResponse<any>>(MG_ENDPOINTS.document(residentId, id), this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('deleteDocument', err);
          return throwError(() => err);
        })
      );
  }

  // ---------- alerts ----------
  createAlert(
    residentId: number,
    payload: Omit<ClinicalAlert, 'id'>
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .post<ApiResponse<any>>(MG_ENDPOINTS.alerts(residentId), payload, this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('createAlert', err);
          return throwError(() => err);
        })
      );
  }

  updateAlert(
    residentId: number,
    id: number,
    payload: Omit<ClinicalAlert, 'id'>
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .put<ApiResponse<any>>(MG_ENDPOINTS.alert(residentId, id), payload, this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('updateAlert', err);
          return throwError(() => err);
        })
      );
  }

  deleteAlert(
    residentId: number,
    id: number
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .delete<ApiResponse<any>>(MG_ENDPOINTS.alert(residentId, id), this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('deleteAlert', err);
          return throwError(() => err);
        })
      );
  }

  toggleAlert(
    residentId: number,
    id: number
  ): Observable<MedicinaGeneralRecord> {
    return this.http
      .patch<ApiResponse<any>>(MG_ENDPOINTS.alertToggle(residentId, id), {}, this.options())
      .pipe(
        switchMap(() => this.getRecord(residentId)),
        catchError((err) => {
          this.logHttpError('toggleAlert', err);
          return throwError(() => err);
        })
      );
  }

  // ---------- helpers ----------
  private combineTodayTimeToIso(hhmm: string): string {
    const [h, m] = (hhmm || '00:00').split(':').map((x) => Number(x));
    const d = new Date();
    d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    return d.toISOString();
  }
}

// ============================================================
// Página
// ============================================================

type TabKey =
  | 'ficha'
  | 'diagnosticos'
  | 'medicacion'
  | 'controles'
  | 'examenes'
  | 'evolucion'
  | 'documentos'
  | 'alertas';

type ModalKey =
  | 'header'
  | 'diagnosis'
  | 'med'
  | 'control'
  | 'exam'
  | 'evolution'
  | 'document'
  | 'alert'
  | null;

@Component({
  selector: 'app-medicina-general-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, HttpClientModule],
  templateUrl: './medicina-general.page.html',
  styleUrls: ['./medicina-general.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MedicinaGeneralPage implements OnInit, OnDestroy {
  // UI
  activeTab: TabKey = 'ficha';
  modal: ModalKey = null;

  // Estado
  residents: ResidentSummary[] = [];
  residentsFiltered: ResidentSummary[] = [];
  searchTerm = '';
  selectedResident: ResidentSummary | null = null;

  record: MedicinaGeneralRecord | null = null;

  loadingResidents = true;
  loadingRecord = false;
  saving = false;

  // Permisos
  isMedico = false;

  // Forms
  headerForm!: FormGroup;
  diagnosisForm!: FormGroup;
  medForm!: FormGroup;
  controlForm!: FormGroup;
  examForm!: FormGroup;
  evolutionForm!: FormGroup;
  documentForm!: FormGroup;
  alertForm!: FormGroup;

  // Edit IDs
  editingId: number | null = null;

  // API HTTP
  private api: MedicinaGeneralApiHttp;
  private subs = new Subscription();
  private isBrowser: boolean;

  readonly tabs: Array<{ key: TabKey; label: string; icon: string }> = [
    { key: 'ficha', label: 'Ficha', icon: '🧬' },
    { key: 'diagnosticos', label: 'Diagnósticos', icon: '🧠' },
    { key: 'medicacion', label: 'Medicación', icon: '💊' },
    { key: 'controles', label: 'Controles', icon: '🩻' },
    { key: 'examenes', label: 'Exámenes', icon: '🧪' },
    { key: 'evolucion', label: 'Evolución', icon: '📈' },
    { key: 'documentos', label: 'Documentos', icon: '📄' },
    { key: 'alertas', label: 'Alertas', icon: '🚨' },
  ];

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private cd: ChangeDetectorRef,
    private auth: AuthService,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    this.api = new MedicinaGeneralApiHttp(this.http, platformId);
    this.isMedico = this.computeIsMedico();
  }

  ngOnInit(): void {
    this.buildForms();
    this.loadResidents();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  // ============================================================
  // Role
  // ============================================================
  private computeIsMedico(): boolean {
    try {
      const u: any =
        (this.auth as any)?.getUser?.() ||
        (this.auth as any)?.currentUserValue ||
        (this.auth as any)?.user?.value ||
        (this.auth as any)?.currentUser?.value ||
        null;

      const role = (
        u?.rol ||
        u?.role ||
        (this.auth as any)?.getRole?.() ||
        ''
      )
        .toString()
        .toLowerCase();

      if (role) return role === 'medico' || role === 'doctor' || role === 'médico';
    } catch {}

    if (this.isBrowser) {
      const userRaw =
        localStorage.getItem('user') ||
        localStorage.getItem('servimel_user') ||
        localStorage.getItem('servimel_user_v1') ||
        null;

      if (userRaw) {
        try {
          const u = JSON.parse(userRaw);
          const role = (u?.rol || u?.role || '').toString().toLowerCase();
          if (role) return role === 'medico' || role === 'doctor' || role === 'médico';
        } catch {}
      }
    }

    return false;
  }

  // ============================================================
  // Init / Loads
  // ============================================================

  private buildForms(): void {
    this.headerForm = this.fb.group({
      bloodGroup: [''],
      rh: ['+'],
      weightKg: [null],
      heightCm: [null],
      bmi: [{ value: null, disabled: true }],
      allergiesText: [''],
      chronicText: [''],
      activeDiagnosesSummary: [''],
      riskLevel: ['BAJO', Validators.required],
      treatingDoctor: [''],
      lastMedicalEval: [''],
      generalNotes: [''],
    });

    this.diagnosisForm = this.fb.group({
      cie10: [''],
      name: ['', [Validators.required, Validators.minLength(2)]],
      date: [''],
      status: ['ACTIVO', Validators.required],
      notes: [''],
    });

    this.medForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      dose: ['', Validators.required],
      schedule: ['08:00', Validators.required],
      route: ['VO'],
      instructions: [''],
      status: ['ACTIVO'],
    });

    this.controlForm = this.fb.group({
      date: [this.todayISO(), Validators.required],
      type: ['RUTINA', Validators.required],
      reason: [''],
      findings: [''],
      conclusion: [''],
      nextControl: [''],
    });

    this.examForm = this.fb.group({
      date: [this.todayISO(), Validators.required],
      type: ['', Validators.required],
      result: [''],
      notes: [''],
      fileName: [''],
    });

    this.evolutionForm = this.fb.group({
      date: [this.todayISO(), Validators.required],
      type: ['RUTINA', Validators.required],
      professional: [''],
      note: ['', [Validators.required, Validators.minLength(3)]],
    });

    this.documentForm = this.fb.group({
      date: [this.todayISO(), Validators.required],
      type: ['', Validators.required],
      fileName: ['', Validators.required],
      notes: [''],
    });

    this.alertForm = this.fb.group({
      date: [this.todayISO(), Validators.required],
      kind: ['', Validators.required],
      detail: [''],
      level: ['WARN', Validators.required],
      resolved: [false],
    });

    // BMI live
    this.subs.add(
      this.headerForm.valueChanges.subscribe(() => {
        const w = Number(this.headerForm.get('weightKg')?.value);
        const hCm = Number(this.headerForm.get('heightCm')?.value);

        if (w > 0 && hCm > 0) {
          const h = hCm / 100;
          const bmi = Math.round((w / (h * h)) * 10) / 10;
          this.headerForm.get('bmi')?.setValue(bmi, { emitEvent: false });
        } else {
          this.headerForm.get('bmi')?.setValue(null, { emitEvent: false });
        }
      })
    );
  }

  private loadResidents(): void {
    this.loadingResidents = true;
    this.cd.markForCheck();

    const sub = this.api
      .getResidents()
      .pipe(
        finalize(() => {
          this.loadingResidents = false;
          this.cd.markForCheck();
        })
      )
      .subscribe({
        next: (list) => {
          this.residents = list || [];
          this.residentsFiltered = [...this.residents];
          if (this.residents.length > 0) this.selectResident(this.residents[0]);
        },
        error: () => {
          this.residents = [];
          this.residentsFiltered = [];
        },
      });

    this.subs.add(sub);
  }

  selectResident(r: ResidentSummary): void {
    this.selectedResident = r;
    this.activeTab = 'ficha';
    this.cd.markForCheck();
    this.loadRecord(r.id);
  }

  private loadRecord(residentId: number): void {
    this.loadingRecord = true;
    this.record = null;
    this.cd.markForCheck();

    const sub = this.api
      .getRecord(residentId)
      .pipe(
        finalize(() => {
          this.loadingRecord = false;
          this.cd.markForCheck();
        })
      )
      .subscribe({
        next: (rec) => {
          this.record = this.normalizeRecord(rec);
          this.patchHeaderFormFromRecord();
          this.cd.markForCheck();
        },
        error: () => {
          this.record = null;
        },
      });

    this.subs.add(sub);
  }

  private normalizeRecord(rec: MedicinaGeneralRecord): MedicinaGeneralRecord {
    const safe: MedicinaGeneralRecord = {
      residentId: rec.residentId,
      header: {
        allergies: rec.header?.allergies || [],
        chronicConditions: rec.header?.chronicConditions || [],
        bloodGroup: rec.header?.bloodGroup || '',
        rh: rec.header?.rh || '+',
        weightKg: rec.header?.weightKg ?? null,
        heightCm: rec.header?.heightCm ?? null,
        bmi: rec.header?.bmi ?? null,
        activeDiagnosesSummary: rec.header?.activeDiagnosesSummary || '',
        riskLevel: (rec.header?.riskLevel || 'BAJO') as RiskLevel,
        treatingDoctor: rec.header?.treatingDoctor || '',
        lastMedicalEval: rec.header?.lastMedicalEval || '',
        generalNotes: rec.header?.generalNotes || '',
      },
      diagnoses: Array.isArray(rec.diagnoses) ? rec.diagnoses : [],
      meds: Array.isArray(rec.meds) ? rec.meds : [],
      controls: Array.isArray(rec.controls) ? rec.controls : [],
      exams: Array.isArray(rec.exams) ? rec.exams : [],
      evolution: Array.isArray(rec.evolution) ? rec.evolution : [],
      alerts: Array.isArray(rec.alerts) ? rec.alerts : [],
      documents: Array.isArray(rec.documents) ? rec.documents : [],
      updatedAt: rec.updatedAt || new Date().toISOString(),
    };

    safe.evolution = [...safe.evolution].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    );
    safe.controls = [...safe.controls].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    );
    safe.exams = [...safe.exams].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    );
    safe.alerts = [...safe.alerts].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    );
    safe.documents = [...safe.documents].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    );
    safe.diagnoses = [...safe.diagnoses].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    );

    safe.meds = [...safe.meds].sort((a, b) =>
      String(b.scheduledAt || '').localeCompare(String(a.scheduledAt || ''))
    );

    return safe;
  }

  // ============================================================
  // Search Residents
  // ============================================================
  onSearch(term: string): void {
    this.searchTerm = term;
    const v = (term || '').trim().toLowerCase();

    if (!v) {
      this.residentsFiltered = [...this.residents];
      this.cd.markForCheck();
      return;
    }

    this.residentsFiltered = this.residents.filter((r) => {
      return (
        (r.fullName || '').toLowerCase().includes(v) ||
        (r.room || '').toLowerCase().includes(v) ||
        String(r.id).includes(v)
      );
    });

    this.cd.markForCheck();
  }

  // ============================================================
  // Tabs
  // ============================================================
  setTab(tab: TabKey): void {
    this.activeTab = tab;
    this.cd.markForCheck();
  }

  // ============================================================
  // Modal / CRUD helpers
  // ============================================================
  openModal(key: Exclude<ModalKey, null>, editId: number | null = null): void {
    if (!this.isMedico) return;

    this.editingId = editId;
    this.modal = key;

    if (key === 'header') this.patchHeaderFormFromRecord();
    if (key === 'diagnosis') this.resetDiagnosisForm(editId);
    if (key === 'med') this.resetMedForm(editId);
    if (key === 'control') this.resetControlForm(editId);
    if (key === 'exam') this.resetExamForm(editId);
    if (key === 'evolution') this.resetEvolutionForm(editId);
    if (key === 'document') this.resetDocumentForm(editId);
    if (key === 'alert') this.resetAlertForm(editId);

    this.cd.markForCheck();
  }

  closeModal(): void {
    this.modal = null;
    this.editingId = null;
    this.cd.markForCheck();
  }

  private runMutation$(
    obs$: Observable<MedicinaGeneralRecord>,
    closeModalAfter = true,
    patchHeaderAfter = false
  ): void {
    if (!this.record) return;

    this.saving = true;
    this.cd.markForCheck();

    const sub = obs$
      .pipe(
        finalize(() => {
          this.saving = false;
          this.cd.markForCheck();
        })
      )
      .subscribe({
        next: (saved) => {
          this.record = this.normalizeRecord(saved);
          if (patchHeaderAfter) this.patchHeaderFormFromRecord();
          if (closeModalAfter) this.closeModal();
          this.cd.markForCheck();
        },
        error: (err) => {
          console.group('❌ [MG MUTATION FAILED]');
          console.log('residentId:', this.record?.residentId);
          console.log('editingId:', this.editingId);
          console.log('activeTab:', this.activeTab);
          console.log('status:', err?.status);
          console.log('url:', err?.url);
          console.log('message:', err?.message);
          console.log('body:', err?.error);
          console.log('full:', err);
          console.groupEnd();
        },
      });

    this.subs.add(sub);
  }

  // ============================================================
  // Header (REAL)
  // ============================================================
  private patchHeaderFormFromRecord(): void {
    if (!this.record) return;

    const h = this.record.header || {};
    this.headerForm.patchValue(
      {
        bloodGroup: h.bloodGroup || '',
        rh: h.rh || '+',
        weightKg: h.weightKg ?? null,
        heightCm: h.heightCm ?? null,
        bmi: h.bmi ?? null,
        allergiesText: (h.allergies || []).join(', '),
        chronicText: (h.chronicConditions || []).join(', '),
        activeDiagnosesSummary: h.activeDiagnosesSummary || '',
        riskLevel: h.riskLevel || 'BAJO',
        treatingDoctor: h.treatingDoctor || '',
        lastMedicalEval: h.lastMedicalEval || '',
        generalNotes: h.generalNotes || '',
      },
      { emitEvent: true }
    );
  }

  saveHeader(): void {
    if (!this.record) return;

    const value = this.headerForm.getRawValue();
    const allergies = this.splitComma(value.allergiesText);
    const chronic = this.splitComma(value.chronicText);

    const payload: ClinicalHeader = {
      bloodGroup: (value.bloodGroup || '').trim(),
      rh: value.rh || '+',
      weightKg: value.weightKg ?? null,
      heightCm: value.heightCm ?? null,
      bmi: value.bmi ?? null,
      allergies,
      chronicConditions: chronic,
      activeDiagnosesSummary: (value.activeDiagnosesSummary || '').trim(),
      riskLevel: value.riskLevel as RiskLevel,
      treatingDoctor: (value.treatingDoctor || '').trim(),
      lastMedicalEval: value.lastMedicalEval || null,
      generalNotes: (value.generalNotes || '').trim(),
    };

    this.runMutation$(
      this.api.upsertHeader(this.record.residentId, payload),
      true,
      true
    );
  }

  // ============================================================
  // Diagnósticos (REAL)
  // ============================================================
  private resetDiagnosisForm(editId: number | null): void {
    this.diagnosisForm.reset({
      cie10: '',
      name: '',
      date: '',
      status: 'ACTIVO',
      notes: '',
    });

    if (!this.record || editId == null) return;

    const item = this.record.diagnoses.find((d) => d.id === editId);
    if (!item) return;

    this.diagnosisForm.patchValue({
      cie10: item.cie10 || '',
      name: item.name || '',
      date: item.date || '',
      status: item.status || 'ACTIVO',
      notes: item.notes || '',
    });
  }

  saveDiagnosis(): void {
    if (!this.record) return;
    if (this.diagnosisForm.invalid) {
      this.diagnosisForm.markAllAsTouched();
      return;
    }

    const v = this.diagnosisForm.value;
    const payload: Omit<Diagnosis, 'id'> = {
      cie10: (v.cie10 || '').trim(),
      name: (v.name || '').trim(),
      date: v.date || this.todayISO(),
      status: (v.status || 'ACTIVO') as DiagnosisStatus,
      notes: (v.notes || '').trim(),
    };

    const rid = this.record.residentId;

    if (this.editingId != null) {
      this.runMutation$(this.api.updateDiagnosis(rid, this.editingId, payload));
    } else {
      this.runMutation$(this.api.createDiagnosis(rid, payload));
    }
  }

  deleteDiagnosis(id: number): void {
    if (!this.record) return;
    this.runMutation$(
      this.api.deleteDiagnosis(this.record.residentId, id),
      false
    );
  }

  // ============================================================
  // Medicación REAL (enfermería)
  // ============================================================
  private resetMedForm(editId: number | null): void {
    this.medForm.reset({
      name: '',
      dose: '',
      schedule: '08:00',
      route: 'VO',
      instructions: '',
      status: 'ACTIVO',
    });

    if (!this.record || editId == null) return;

    const item = this.record.meds.find((m) => m.id === editId);
    if (!item) return;

    this.medForm.patchValue({
      name: item.name || '',
      dose: item.dose || '',
      schedule: item.schedule || '08:00',
      route: item.route || 'VO',
      instructions: item.instructions || '',
      status: item.status || 'ACTIVO',
    });
  }

  saveMedication(): void {
    if (!this.record) return;
    if (this.medForm.invalid) {
      this.medForm.markAllAsTouched();
      return;
    }

    const v = this.medForm.value;
    const payload: Omit<Medication, 'id'> = {
      name: (v.name || '').trim(),
      dose: (v.dose || '').trim(),
      schedule: (v.schedule || '08:00').trim(),
      route: (v.route || 'VO').trim(),
      instructions: (v.instructions || '').trim(),
      status: (v.status || 'ACTIVO') as any,
    };

    const rid = this.record.residentId;

    if (this.editingId != null) {
      this.runMutation$(this.api.updateMedication(rid, this.editingId, payload));
    } else {
      this.runMutation$(this.api.createMedication(rid, payload));
    }
  }

  deleteMedication(id: number): void {
    if (!this.record) return;
    this.runMutation$(
      this.api.deleteMedication(this.record.residentId, id),
      false
    );
  }

  // ============================================================
  // Controles (REAL)
  // ============================================================
  private resetControlForm(editId: number | null): void {
    this.controlForm.reset({
      date: this.todayISO(),
      type: 'RUTINA',
      reason: '',
      findings: '',
      conclusion: '',
      nextControl: '',
    });

    if (!this.record || editId == null) return;

    const item = this.record.controls.find((c) => c.id === editId);
    if (!item) return;

    this.controlForm.patchValue({
      date: item.date || this.todayISO(),
      type: item.type || 'RUTINA',
      reason: item.reason || '',
      findings: item.findings || '',
      conclusion: item.conclusion || '',
      nextControl: item.nextControl || '',
    });
  }

  saveControl(): void {
    if (!this.record) return;
    if (this.controlForm.invalid) {
      this.controlForm.markAllAsTouched();
      return;
    }

    const v = this.controlForm.value;
    const payload: Omit<MedicalControl, 'id'> = {
      date: v.date || this.todayISO(),
      type: (v.type || 'RUTINA') as ControlType,
      reason: (v.reason || '').trim(),
      findings: (v.findings || '').trim(),
      conclusion: (v.conclusion || '').trim(),
      nextControl: v.nextControl || null,
    };

    const rid = this.record.residentId;

    if (this.editingId != null) {
      this.runMutation$(this.api.updateControl(rid, this.editingId, payload));
    } else {
      this.runMutation$(this.api.createControl(rid, payload));
    }
  }

  deleteControl(id: number): void {
    if (!this.record) return;
    this.runMutation$(this.api.deleteControl(this.record.residentId, id), false);
  }

  // ============================================================
  // Exámenes (REAL)
  // ============================================================
  private resetExamForm(editId: number | null): void {
    this.examForm.reset({
      date: this.todayISO(),
      type: '',
      result: '',
      notes: '',
      fileName: '',
    });

    if (!this.record || editId == null) return;

    const item = this.record.exams.find((e) => e.id === editId);
    if (!item) return;

    this.examForm.patchValue({
      date: item.date || this.todayISO(),
      type: item.type || '',
      result: item.result || '',
      notes: item.notes || '',
      fileName: item.fileName || '',
    });
  }

  saveExam(): void {
    if (!this.record) return;
    if (this.examForm.invalid) {
      this.examForm.markAllAsTouched();
      return;
    }

    const v = this.examForm.value;
    const payload: Omit<MedicalExam, 'id'> = {
      date: v.date || this.todayISO(),
      type: (v.type || '').trim(),
      result: (v.result || '').trim(),
      notes: (v.notes || '').trim(),
      fileName: (v.fileName || '').trim(),
    };

    const rid = this.record.residentId;

    if (this.editingId != null) {
      this.runMutation$(this.api.updateExam(rid, this.editingId, payload));
    } else {
      this.runMutation$(this.api.createExam(rid, payload));
    }
  }

  deleteExam(id: number): void {
    if (!this.record) return;
    this.runMutation$(this.api.deleteExam(this.record.residentId, id), false);
  }

  // ============================================================
  // Evolución (REAL)
  // ============================================================
  private resetEvolutionForm(editId: number | null): void {
    this.evolutionForm.reset({
      date: this.todayISO(),
      type: 'RUTINA',
      professional: '',
      note: '',
    });

    if (!this.record || editId == null) return;

    const item = this.record.evolution.find((n) => n.id === editId);
    if (!item) return;

    this.evolutionForm.patchValue({
      date: item.date || this.todayISO(),
      type: item.type || 'RUTINA',
      professional: item.professional || '',
      note: item.note || '',
    });
  }

  saveEvolution(): void {
    if (!this.record) return;
    if (this.evolutionForm.invalid) {
      this.evolutionForm.markAllAsTouched();
      return;
    }

    const v = this.evolutionForm.value;
    const payload: Omit<EvolutionNote, 'id'> = {
      date: v.date || this.todayISO(),
      type: (v.type || 'RUTINA') as EvolutionType,
      professional: (v.professional || '').trim(),
      note: (v.note || '').trim(),
    };

    const rid = this.record.residentId;

    if (this.editingId != null) {
      this.runMutation$(this.api.updateEvolution(rid, this.editingId, payload));
    } else {
      this.runMutation$(this.api.createEvolution(rid, payload));
    }
  }

  deleteEvolution(id: number): void {
    if (!this.record) return;
    this.runMutation$(
      this.api.deleteEvolution(this.record.residentId, id),
      false
    );
  }

  // ============================================================
  // Documentos (REAL)
  // ============================================================
  private resetDocumentForm(editId: number | null): void {
    this.documentForm.reset({
      date: this.todayISO(),
      type: '',
      fileName: '',
      notes: '',
    });

    if (!this.record || editId == null) return;

    const item = this.record.documents.find((d) => d.id === editId);
    if (!item) return;

    this.documentForm.patchValue({
      date: item.date || this.todayISO(),
      type: item.type || '',
      fileName: item.fileName || '',
      notes: item.notes || '',
    });
  }

  saveDocument(): void {
    if (!this.record) return;
    if (this.documentForm.invalid) {
      this.documentForm.markAllAsTouched();
      return;
    }

    const v = this.documentForm.value;
    const payload: Omit<ClinicalDocument, 'id'> = {
      date: v.date || this.todayISO(),
      type: (v.type || '').trim(),
      fileName: (v.fileName || '').trim(),
      notes: (v.notes || '').trim(),
    };

    const rid = this.record.residentId;

    if (this.editingId != null) {
      this.runMutation$(this.api.updateDocument(rid, this.editingId, payload));
    } else {
      this.runMutation$(this.api.createDocument(rid, payload));
    }
  }

  deleteDocument(id: number): void {
    if (!this.record) return;
    this.runMutation$(
      this.api.deleteDocument(this.record.residentId, id),
      false
    );
  }

  // ============================================================
  // Alertas (REAL)
  // ============================================================
  private resetAlertForm(editId: number | null): void {
    this.alertForm.reset({
      date: this.todayISO(),
      kind: '',
      detail: '',
      level: 'WARN',
      resolved: false,
    });

    if (!this.record || editId == null) return;

    const item = this.record.alerts.find((a) => a.id === editId);
    if (!item) return;

    this.alertForm.patchValue({
      date: item.date || this.todayISO(),
      kind: item.kind || '',
      detail: item.detail || '',
      level: item.level || 'WARN',
      resolved: !!item.resolved,
    });
  }

  saveAlert(): void {
    if (!this.record) return;
    if (this.alertForm.invalid) {
      this.alertForm.markAllAsTouched();
      return;
    }

    const v = this.alertForm.value;
    const payload: Omit<ClinicalAlert, 'id'> = {
      date: v.date || this.todayISO(),
      kind: (v.kind || '').trim(),
      detail: (v.detail || '').trim(),
      level: (v.level || 'WARN') as any,
      resolved: !!v.resolved,
    };

    const rid = this.record.residentId;

    if (this.editingId != null) {
      this.runMutation$(this.api.updateAlert(rid, this.editingId, payload));
    } else {
      this.runMutation$(this.api.createAlert(rid, payload));
    }
  }

  deleteAlert(id: number): void {
    if (!this.record) return;
    this.runMutation$(this.api.deleteAlert(this.record.residentId, id), false);
  }

  toggleAlertResolved(id: number): void {
    if (!this.record) return;
    this.runMutation$(this.api.toggleAlert(this.record.residentId, id), false);
  }

  // ============================================================
  // Helpers
  // ============================================================
  trackById(_: number, item: { id: number }): number {
    return item.id;
  }

  todayISO(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private splitComma(value: string): string[] {
    const v = (value || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    return Array.from(new Set(v));
  }

  get riskLevel(): RiskLevel {
    return (this.record?.header?.riskLevel || 'BAJO') as RiskLevel;
  }

  get allergies(): string[] {
    return this.record?.header?.allergies || [];
  }

  get chronicConditions(): string[] {
    return this.record?.header?.chronicConditions || [];
  }
}
