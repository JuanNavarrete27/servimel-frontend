// src/app/shared/models/dashboard.model.ts
export type DashboardKpis = {
  residentes_activos: number;
  registros_hoy: number;
  alertas_pendientes: number;
};

export type DashboardQuickItem = {
  id: number;
  fecha: string;
  titulo: string;
  severity?: 'info' | 'warning' | 'critical';
  residenteId?: number;
};

export type DashboardQuick = {
  ultimas_alertas: DashboardQuickItem[];
};
