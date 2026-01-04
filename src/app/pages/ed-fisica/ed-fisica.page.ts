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
  selector: 'app-ed-fisica-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './ed-fisica.page.html',
  styleUrls: ['./ed-fisica.page.scss']
})
export class EdFisicaPage {
  sections: Section[] = [
    {
      title: 'Planes de actividad',
      desc: 'Estructurá rutinas ligeras para movilidad y fuerza adaptada.',
      bullets: [
        'Define bloques de calentamiento, movilidad y enfriamiento.',
        'Anotá restricciones médicas o post-operatorias.',
        'Agrupá residentes por nivel de esfuerzo tolerado.'
      ]
    },
    {
      title: 'Control y seguridad',
      desc: 'Checklist breve antes de iniciar actividades.',
      bullets: [
        'Verificá signos vitales recientes cuando existan.',
        'Prepará hidratación y elementos de apoyo.',
        'Documentá cualquier incidencia o fatiga.'
      ]
    },
    {
      title: 'Seguimiento',
      desc: 'Notas rápidas para mejorar la próxima sesión.',
      bullets: [
        'Registrar tolerancia y progresión percibida.',
        'Solicitar feedback al equipo clínico si algo cambia.',
        'Agenda la próxima actividad según evolución.'
      ]
    }
  ];

  highlights: Highlight[] = [
    { label: 'Sesiones', detail: 'No hay actividades planificadas todavía.', tone: 'muted' },
    { label: 'Seguridad', detail: 'Revisá contraindicaciones antes de iniciar.', tone: 'warn' },
    { label: 'Progresión', detail: 'Añadí notas reales después de cada sesión.', tone: 'info' }
  ];

  trackByTitle(_index: number, item: Section): string {
    return item.title;
  }

  trackByHighlight(_index: number, item: Highlight): string {
    return item.label;
  }
}
