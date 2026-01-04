import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

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

@Component({
  selector: 'app-medicina-general-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './medicina-general.page.html',
  styleUrls: ['./medicina-general.page.scss']
})
export class MedicinaGeneralPage {
  sections: Section[] = [
    {
      title: 'Consultas y evolución',
      desc: 'Espacio para registrar visitas médicas sin generar tráfico extra al backend.',
      bullets: [
        'Detalle motivo de consulta, hallazgos y conducta.',
        'Sugerí próximos controles o derivaciones.',
        'Anotá estudios solicitados y fechas tentativas.'
      ]
    },
    {
      title: 'Indicaciones y recetas',
      desc: 'Checklist para coordinar con enfermería y farmacia.',
      bullets: [
        'Indicá medicación, dosis y horarios.',
        'Adjuntá restricciones o consideraciones especiales.',
        'Anotaciones rápidas para seguimiento en sala.'
      ]
    },
    {
      title: 'Comunicación con familia',
      desc: 'Guía breve para mantener trazabilidad.',
      bullets: [
        'Resumen breve de la consulta para informar al contacto principal.',
        'Registrar dudas o requerimientos pendientes.',
        'Alinear próximos pasos y fecha de actualización.'
      ]
    }
  ];

  highlights: Highlight[] = [
    { label: 'Consultas', detail: 'No hay consultas cargadas en este módulo.', tone: 'muted' },
    { label: 'Indicaciones', detail: 'Se mostrarán cuando el backend envíe datos.', tone: 'info' },
    { label: 'Prioridad', detail: 'Mantener foco en casos críticos definidos en Historial.', tone: 'warn' }
  ];

  trackByTitle(_index: number, item: Section): string {
    return item.title;
  }

  trackByHighlight(_index: number, item: Highlight): string {
    return item.label;
  }
}
