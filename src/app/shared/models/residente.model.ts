// src/app/shared/models/residente.model.ts

export type TabKey = 'signos' | 'medicacion' | 'observaciones' | 'historial';
export type EstadoResidente = 'estable' | 'observacion' | 'critico';

// UI enums
export type MedEstado = 'pendiente' | 'administrada' | 'atrasada' | 'suspendida';
export type ObsTipo = 'normal' | 'alerta';

// =========================
// UI MODELS (los que usa tu frontend hoy)
// =========================
export type SignosRow = {
  id: number;
  fecha: string;
  temp: string;
  presion: string;
  pulso: string;
  by: string;
};

export type MedicacionRow = {
  id: number;
  medicamento: string;
  dosis: string;
  horario: string;
  estado: MedEstado;
  updatedAt?: string;
  updatedBy?: string;
};

export type ObservacionRow = {
  id: number;
  fecha: string;
  tipo: ObsTipo;
  texto: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type HistorialRow = {
  id: number;
  fecha: string;
  titulo: string;
  detalle?: string;
  by: string;
};

export type AuditoriaRow = {
  id: number;
  fecha: string;
  accion: 'create' | 'update' | 'delete';
  modulo: 'signos' | 'medicacion' | 'observaciones' | 'historial' | 'residentes';
  campo?: string;
  before?: string;
  after?: string;
  by: string;
};

// Core del residente (lo mínimo real)
export type ResidenteCore = {
  id: number;
  nombre: string;
  habitacion: string;
  estado: EstadoResidente;
  notas?: string;
  contactoNombre?: string;
  contactoTel?: string;
};

// Tu detail en UI (en backend normalmente lo armás combinando endpoints)
export type ResidenteDetail = ResidenteCore & {
  signos: SignosRow[];
  medicacion: MedicacionRow[];
  observaciones: ObservacionRow[];
  historial: HistorialRow[];
  auditoria: AuditoriaRow[];
};

// Helper: crear detail vacío sin romper pantallas
export function createEmptyResidenteDetail(core: ResidenteCore): ResidenteDetail {
  return {
    ...core,
    signos: [],
    medicacion: [],
    observaciones: [],
    historial: [],
    auditoria: [],
  };
}

// =========================
// API MODELS (flexibles para tu backend)
// =========================

// (lista)
export type ApiResidenteListItem = {
  id: number;
  nombre?: string;
  full_name?: string;
  habitacion?: string;
  room?: string;
  estado?: EstadoResidente;
  status?: EstadoResidente;
};

// vitals
export type ApiVital = {
  id: number;
  created_at?: string;
  occurred_at?: string;
  temp?: string | null;
  presion?: string | null;
  pulso?: string | null;
  by_name?: string | null; // si backend lo trae
  user_name?: string | null;
};

// meds
export type ApiMedication = {
  id: number;
  medicamento: string;
  dosis: string;
  horario: string;
  estado?: string;          // backend puede usar pending/administered/late/suspended
  status?: string;
  updated_at?: string;
  updated_by_name?: string | null;
};

// observations
export type ApiObservation = {
  id: number;
  created_at?: string;
  tipo?: string;            // normal/alerta
  severity?: string;        // info/warning/critical
  texto?: string;
  updated_at?: string;
  updated_by_name?: string | null;
  resolved_at?: string | null;
};

// timeline/historial
export type ApiTimelineEvent = {
  id: number;
  occurred_at?: string;
  created_at?: string;
  type?: string;            // vital|medication|observation|...
  title?: string;
  detail?: string;
  by_name?: string | null;
};

// auditoria
export type ApiAudit = {
  id: number;
  created_at?: string;
  module?: string;
  action?: string;
  field?: string | null;
  before_json?: any;
  after_json?: any;
  user_name?: string | null;
};

// =========================
// MAPPERS básicos (API -> UI)
// =========================

function pickFecha(...vals: Array<string | undefined | null>): string {
  return vals.find(v => typeof v === 'string' && v.length > 0) ?? new Date().toISOString();
}

function pickBy(...vals: Array<string | undefined | null>): string {
  return vals.find(v => typeof v === 'string' && v.trim().length > 0) ?? 'Sistema';
}

export function mapApiVitalToSignosRow(v: ApiVital): SignosRow {
  return {
    id: v.id,
    fecha: pickFecha(v.occurred_at, v.created_at),
    temp: String(v.temp ?? ''),
    presion: String(v.presion ?? ''),
    pulso: String(v.pulso ?? ''),
    by: pickBy(v.by_name, v.user_name),
  };
}

export function mapApiMedicationEstadoToUi(estado?: string | null): MedEstado {
  const e = (estado ?? '').toLowerCase();

  if (e === 'administered' || e === 'done' || e === 'administrada') return 'administrada';
  if (e === 'late' || e === 'atrasada') return 'atrasada';
  if (e === 'suspended' || e === 'suspendida') return 'suspendida';

  // default
  return 'pendiente';
}

export function mapApiMedicationToMedicacionRow(m: ApiMedication): MedicacionRow {
  return {
    id: m.id,
    medicamento: m.medicamento,
    dosis: m.dosis,
    horario: m.horario,
    estado: mapApiMedicationEstadoToUi(m.estado ?? m.status),
    updatedAt: m.updated_at ?? undefined,
    updatedBy: m.updated_by_name ?? undefined,
  };
}

export function mapApiObservationToObservacionRow(o: ApiObservation): ObservacionRow {
  const tipoApi = (o.tipo ?? '').toLowerCase();
  const severity = (o.severity ?? '').toLowerCase();

  const tipo: ObsTipo =
    tipoApi === 'alerta' || severity === 'critical' || severity === 'warning'
      ? 'alerta'
      : 'normal';

  return {
    id: o.id,
    fecha: pickFecha(o.created_at),
    tipo,
    texto: o.texto ?? '',
    updatedAt: o.updated_at ?? undefined,
    updatedBy: o.updated_by_name ?? undefined,
  };
}

export function mapApiTimelineToHistorialRow(e: ApiTimelineEvent): HistorialRow {
  return {
    id: e.id,
    fecha: pickFecha(e.occurred_at, e.created_at),
    titulo: e.title ?? e.type ?? 'Evento',
    detalle: e.detail ?? undefined,
    by: pickBy(e.by_name),
  };
}

export function mapApiAuditToAuditoriaRow(a: ApiAudit): AuditoriaRow {
  const accion =
    (a.action ?? '').toLowerCase() === 'delete' ? 'delete'
    : (a.action ?? '').toLowerCase() === 'update' ? 'update'
    : 'create';

  const moduloRaw = (a.module ?? '').toLowerCase();
  const modulo =
    (['signos','medicacion','observaciones','historial','residentes'] as const).includes(moduloRaw as any)
      ? (moduloRaw as AuditoriaRow['modulo'])
      : 'residentes';

  return {
    id: a.id,
    fecha: pickFecha(a.created_at),
    accion,
    modulo,
    campo: a.field ?? undefined,
    before: a.before_json ? JSON.stringify(a.before_json) : undefined,
    after: a.after_json ? JSON.stringify(a.after_json) : undefined,
    by: pickBy(a.user_name),
  };
}
