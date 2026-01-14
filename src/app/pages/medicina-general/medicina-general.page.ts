// src/app/pages/medicina-general/medicina-general.page.ts
// ============================================================
// SERVIMEL — Medicina General (Médico)
// ✅ CRUD REAL por backend (HttpClient)
// ✅ API_CONFIG.baseUrl (NO hardcode "/api")
// ✅ unwrapApi unificado vía core/utils/api-unwrap
// ✅ OnPush + markForCheck() para UI consistente
// ✅ Residents desde /residentes
// ✅ Record desde /medicina-general/records/:residentId  (ajustable en MG_ENDPOINTS)
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
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subscription, Observable, of } from 'rxjs';
import { catchError, finalize, map } from 'rxjs/operators';

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
  lastMedicalEval?: string;
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
  id: number;
  name: string;
  dose?: string;
  schedule?: string;
  route?: string;
  startDate?: string;
  endDate?: string;
  instructions?: string;
  status?: 'ACTIVO' | 'SUSPENDIDO' | 'FINALIZADO';
  prescribedBy?: string;
}

export interface MedicalControl {
  id: number;
  date: string;
  type: ControlType;
  reason?: string;
  findings?: string;
  conclusion?: string;
  nextControl?: string;
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
// Endpoints (AJUSTABLE si tu backend usa otro path)
// ============================================================

const MG_ENDPOINTS = {
  residents: () => `${API_CONFIG.baseUrl}/residentes`,
  record: (residentId: number) => `${API_CONFIG.baseUrl}/medicina-general/records/${residentId}`,
};

// ============================================================
// API HTTP (real)
// ============================================================

class MedicinaGeneralApiHttp {
  constructor(private http: HttpClient) {}

  getResidents(): Observable<ResidentSummary[]> {
    const url = MG_ENDPOINTS.residents();

    return this.http.get<ApiResponse<any>>(url).pipe(
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

          const room = (r?.habitacion ?? r?.room ?? '').toString().trim() || undefined;
          const age = r?.age != null ? Number(r.age) : undefined;

          return {
            id,
            fullName,
            room,
            age: Number.isFinite(age as any) ? age : undefined,
            avatarUrl: r?.avatarUrl || r?.avatar_url || undefined,
            isActive: r?.isActive ?? r?.active ?? true,
          } as ResidentSummary;
        });
      }),
      catchError(() => of<ResidentSummary[]>([]))
    );
  }

  getRecord(residentId: number): Observable<MedicinaGeneralRecord> {
    const url = MG_ENDPOINTS.record(residentId);

    return this.http.get<ApiResponse<any>>(url).pipe(
      map((res) => {
        const data = unwrapApi<any>(res);
        const rec = (data?.record ?? data?.data ?? data) as any;
        return (rec && typeof rec === 'object' ? rec : null) as MedicinaGeneralRecord | null;
      }),
      map((rec) => rec || this.makeEmpty(residentId)),
      catchError(() => of(this.makeEmpty(residentId)))
    );
  }

  saveRecord(record: MedicinaGeneralRecord): Observable<MedicinaGeneralRecord> {
    const url = MG_ENDPOINTS.record(record.residentId);

    return this.http.put<ApiResponse<any>>(url, record).pipe(
      map((res) => {
        const data = unwrapApi<any>(res);
        const saved = (data?.record ?? data?.data ?? data) as any;
        return (saved && typeof saved === 'object' ? saved : null) as MedicinaGeneralRecord | null;
      }),
      map((saved) => saved || record),
      catchError(() => of(record))
    );
  }

  private makeEmpty(residentId: number): MedicinaGeneralRecord {
    return {
      residentId,
      header: {
        allergies: [],
        chronicConditions: [],
        riskLevel: 'BAJO',
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
  imports: [CommonModule, ReactiveFormsModule],
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

  // Permisos (conectado a Auth real)
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

  // Tabs config
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
    this.api = new MedicinaGeneralApiHttp(this.http);

    // Rol real (AuthService + fallback localStorage)
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
    // 1) AuthService (si existe)
    try {
      const u: any =
        (this.auth as any)?.getUser?.() ||
        (this.auth as any)?.currentUserValue ||
        (this.auth as any)?.user?.value ||
        (this.auth as any)?.currentUser?.value ||
        null;

      const role = (u?.rol || u?.role || (this.auth as any)?.getRole?.() || '').toString().toLowerCase();
      if (role) return role === 'medico' || role === 'doctor' || role === 'médico';
    } catch {
      // sigue abajo
    }

    // 2) fallback localStorage (mismo enfoque que tu app)
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
        } catch {
          // ignore
        }
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
      dose: [''],
      schedule: [''],
      route: ['VO'],
      startDate: [''],
      endDate: [''],
      instructions: [''],
      status: ['ACTIVO'],
      prescribedBy: [''],
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

    // Calcula BMI live
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
      .pipe(finalize(() => {
        this.loadingResidents = false;
        this.cd.markForCheck();
      }))
      .subscribe({
        next: (list) => {
          this.residents = list || [];
          this.residentsFiltered = [...this.residents];

          // Auto-select first
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
      .pipe(finalize(() => {
        this.loadingRecord = false;
        this.cd.markForCheck();
      }))
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
        riskLevel: rec.header?.riskLevel || 'BAJO',
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

    // orden preferente
    safe.evolution = [...safe.evolution].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    safe.controls = [...safe.controls].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    safe.exams = [...safe.exams].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    safe.alerts = [...safe.alerts].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    safe.documents = [...safe.documents].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    safe.diagnoses = [...safe.diagnoses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

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

  // ============================================================
  // Header
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

    const updated: ClinicalHeader = {
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
      lastMedicalEval: value.lastMedicalEval || '',
      generalNotes: (value.generalNotes || '').trim(),
    };

    this.record = { ...this.record, header: updated };
    this.persistRecord(true);
  }

  // ============================================================
  // Diagnósticos
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

    const payload: Diagnosis = {
      id: this.editingId ?? this.nextId(this.record.diagnoses),
      cie10: (v.cie10 || '').trim(),
      name: (v.name || '').trim(),
      date: v.date || this.todayISO(),
      status: (v.status || 'ACTIVO') as DiagnosisStatus,
      notes: (v.notes || '').trim(),
    };

    const list = [...this.record.diagnoses];
    const idx = list.findIndex((x) => x.id === payload.id);
    if (idx >= 0) list[idx] = payload;
    else list.unshift(payload);

    this.record = { ...this.record, diagnoses: list };
    this.persistRecord(true);
    this.closeModal();
  }

  deleteDiagnosis(id: number): void {
    if (!this.record) return;
    const list = this.record.diagnoses.filter((d) => d.id !== id);
    this.record = { ...this.record, diagnoses: list };
    this.persistRecord(false);
  }

  // ============================================================
  // Medicación
  // ============================================================

  private resetMedForm(editId: number | null): void {
    this.medForm.reset({
      name: '',
      dose: '',
      schedule: '',
      route: 'VO',
      startDate: '',
      endDate: '',
      instructions: '',
      status: 'ACTIVO',
      prescribedBy: '',
    });

    if (!this.record || editId == null) return;

    const item = this.record.meds.find((m) => m.id === editId);
    if (!item) return;

    this.medForm.patchValue({
      name: item.name || '',
      dose: item.dose || '',
      schedule: item.schedule || '',
      route: item.route || 'VO',
      startDate: item.startDate || '',
      endDate: item.endDate || '',
      instructions: item.instructions || '',
      status: item.status || 'ACTIVO',
      prescribedBy: item.prescribedBy || '',
    });
  }

  saveMedication(): void {
    if (!this.record) return;
    if (this.medForm.invalid) {
      this.medForm.markAllAsTouched();
      return;
    }

    const v = this.medForm.value;

    const payload: Medication = {
      id: this.editingId ?? this.nextId(this.record.meds),
      name: (v.name || '').trim(),
      dose: (v.dose || '').trim(),
      schedule: (v.schedule || '').trim(),
      route: (v.route || 'VO').trim(),
      startDate: v.startDate || '',
      endDate: v.endDate || '',
      instructions: (v.instructions || '').trim(),
      status: (v.status || 'ACTIVO') as any,
      prescribedBy: (v.prescribedBy || '').trim(),
    };

    const list = [...this.record.meds];
    const idx = list.findIndex((x) => x.id === payload.id);
    if (idx >= 0) list[idx] = payload;
    else list.unshift(payload);

    this.record = { ...this.record, meds: list };
    this.persistRecord(true);
    this.closeModal();
  }

  deleteMedication(id: number): void {
    if (!this.record) return;
    const list = this.record.meds.filter((m) => m.id !== id);
    this.record = { ...this.record, meds: list };
    this.persistRecord(false);
  }

  // ============================================================
  // Controles
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

    const payload: MedicalControl = {
      id: this.editingId ?? this.nextId(this.record.controls),
      date: v.date || this.todayISO(),
      type: (v.type || 'RUTINA') as ControlType,
      reason: (v.reason || '').trim(),
      findings: (v.findings || '').trim(),
      conclusion: (v.conclusion || '').trim(),
      nextControl: v.nextControl || '',
    };

    const list = [...this.record.controls];
    const idx = list.findIndex((x) => x.id === payload.id);
    if (idx >= 0) list[idx] = payload;
    else list.unshift(payload);

    this.record = { ...this.record, controls: list };
    this.persistRecord(true);
    this.closeModal();
  }

  deleteControl(id: number): void {
    if (!this.record) return;
    const list = this.record.controls.filter((c) => c.id !== id);
    this.record = { ...this.record, controls: list };
    this.persistRecord(false);
  }

  // ============================================================
  // Exámenes
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

    const payload: MedicalExam = {
      id: this.editingId ?? this.nextId(this.record.exams),
      date: v.date || this.todayISO(),
      type: (v.type || '').trim(),
      result: (v.result || '').trim(),
      notes: (v.notes || '').trim(),
      fileName: (v.fileName || '').trim(),
    };

    const list = [...this.record.exams];
    const idx = list.findIndex((x) => x.id === payload.id);
    if (idx >= 0) list[idx] = payload;
    else list.unshift(payload);

    this.record = { ...this.record, exams: list };
    this.persistRecord(true);
    this.closeModal();
  }

  deleteExam(id: number): void {
    if (!this.record) return;
    const list = this.record.exams.filter((e) => e.id !== id);
    this.record = { ...this.record, exams: list };
    this.persistRecord(false);
  }

  // ============================================================
  // Evolución
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

    const payload: EvolutionNote = {
      id: this.editingId ?? this.nextId(this.record.evolution),
      date: v.date || this.todayISO(),
      type: (v.type || 'RUTINA') as EvolutionType,
      professional: (v.professional || '').trim(),
      note: (v.note || '').trim(),
    };

    const list = [...this.record.evolution];
    const idx = list.findIndex((x) => x.id === payload.id);
    if (idx >= 0) list[idx] = payload;
    else list.unshift(payload);

    this.record = { ...this.record, evolution: list };
    this.persistRecord(true);
    this.closeModal();
  }

  deleteEvolution(id: number): void {
    if (!this.record) return;
    const list = this.record.evolution.filter((e) => e.id !== id);
    this.record = { ...this.record, evolution: list };
    this.persistRecord(false);
  }

  // ============================================================
  // Documentos
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

    const payload: ClinicalDocument = {
      id: this.editingId ?? this.nextId(this.record.documents),
      date: v.date || this.todayISO(),
      type: (v.type || '').trim(),
      fileName: (v.fileName || '').trim(),
      notes: (v.notes || '').trim(),
    };

    const list = [...this.record.documents];
    const idx = list.findIndex((x) => x.id === payload.id);
    if (idx >= 0) list[idx] = payload;
    else list.unshift(payload);

    this.record = { ...this.record, documents: list };
    this.persistRecord(true);
    this.closeModal();
  }

  deleteDocument(id: number): void {
    if (!this.record) return;
    const list = this.record.documents.filter((d) => d.id !== id);
    this.record = { ...this.record, documents: list };
    this.persistRecord(false);
  }

  // ============================================================
  // Alertas
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

    const payload: ClinicalAlert = {
      id: this.editingId ?? this.nextId(this.record.alerts),
      date: v.date || this.todayISO(),
      kind: (v.kind || '').trim(),
      detail: (v.detail || '').trim(),
      level: (v.level || 'WARN') as any,
      resolved: !!v.resolved,
    };

    const list = [...this.record.alerts];
    const idx = list.findIndex((x) => x.id === payload.id);
    if (idx >= 0) list[idx] = payload;
    else list.unshift(payload);

    this.record = { ...this.record, alerts: list };
    this.persistRecord(true);
    this.closeModal();
  }

  deleteAlert(id: number): void {
    if (!this.record) return;
    const list = this.record.alerts.filter((a) => a.id !== id);
    this.record = { ...this.record, alerts: list };
    this.persistRecord(false);
  }

  toggleAlertResolved(id: number): void {
    if (!this.record) return;
    const list = this.record.alerts.map((a) => (a.id === id ? { ...a, resolved: !a.resolved } : a));
    this.record = { ...this.record, alerts: list };
    this.persistRecord(false);
  }

  // ============================================================
  // Persist (REAL)
  // ============================================================

  private persistRecord(closeHeaderModal: boolean): void {
    if (!this.record) return;

    this.saving = true;
    this.cd.markForCheck();

    const sub = this.api
      .saveRecord(this.record)
      .pipe(
        finalize(() => {
          this.saving = false;
          this.cd.markForCheck();
        })
      )
      .subscribe({
        next: (saved) => {
          this.record = this.normalizeRecord(saved);
          if (closeHeaderModal && this.modal === 'header') this.closeModal();
          this.cd.markForCheck();
        },
        error: () => {
          // si falla, igual queda el estado local en memoria
        },
      });

    this.subs.add(sub);
  }

  // ============================================================
  // Helpers
  // ============================================================

  trackById(_: number, item: { id: number }) {
    return item.id;
  }

  todayISO(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private nextId(list: Array<{ id: number }>): number {
    const max = list.reduce((acc, x) => Math.max(acc, x.id), 0);
    return max + 1;
  }

  private splitComma(value: string): string[] {
    const v = (value || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    return Array.from(new Set(v));
  }

  // UI badges
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
