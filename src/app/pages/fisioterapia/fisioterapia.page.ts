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
  selector: 'app-fisioterapia-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './fisioterapia.page.html',
  styleUrls: ['./fisioterapia.page.scss']
})
export class FisioterapiaPage {
  sections: Section[] = [
    {
      title: 'Agenda y sesiones',
      desc: 'Organizá turnos y sesiones individuales o grupales sin generar llamadas extra al backend.',
      bullets: [
        'Marcá prioridades por evolución clínica y disponibilidad.',
        'Separá sesiones de movilidad, fuerza o respiratorio.',
        'Anotá observaciones breves para compartir con el equipo médico.'
      ]
    },
    {
      title: 'Protocolos y seguridad',
      desc: 'Checklist rápido de apoyo para cada intervención.',
      bullets: [
        'Revisá contraindicaciones y ayudas técnicas necesarias.',
        'Confirma elementos de higiene y soporte postural.',
        'Documentá incidencias o derivaciones necesarias.'
      ]
    },
    {
      title: 'Coordinación interdisciplinaria',
      desc: 'Puntos clave para sincronizar con enfermería y médicos.',
      bullets: [
        'Comparte hallazgos relevantes con enfermería.',
        'Solicitá indicaciones médicas cuando corresponda.',
        'Programá seguimientos según la evolución del residente.'
      ]
    }
  ];

  highlights: Highlight[] = [
    { label: 'Turnos', detail: 'No hay turnos registrados en este rango.', tone: 'muted' },
    { label: 'Seguimiento', detail: 'Agregá notas después de cada sesión real.', tone: 'info' },
    { label: 'Prevención', detail: 'Usá los protocolos para evitar recaídas.', tone: 'ok' }
  ];

  trackByTitle(_index: number, item: Section): string {
    return item.title;
  }

  trackByHighlight(_index: number, item: Highlight): string {
    return item.label;
  }
}
