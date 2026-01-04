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
  selector: 'app-yoga-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './yoga.page.html',
  styleUrls: ['./yoga.page.scss']
})
export class YogaPage {
  sections: Section[] = [
    {
      title: 'Sesiones guiadas',
      desc: 'Define bloques de movilidad suave y respiración consciente para residentes.',
      bullets: [
        'Planeá sesiones grupales o individuales según capacidad.',
        'Incluí adaptaciones para sillas de ruedas o apoyo.',
        'Marcar duración, nivel y objetivos de relajación.'
      ]
    },
    {
      title: 'Condiciones y cuidados',
      desc: 'Checklist rápido antes de iniciar la práctica.',
      bullets: [
        'Verificá contraindicaciones médicas recientes.',
        'Disponé de colchonetas, sillas o soportes necesarios.',
        'Asegurá ventilación y temperatura adecuadas.'
      ]
    },
    {
      title: 'Seguimiento',
      desc: 'Notas breves para compartir con enfermería o familia.',
      bullets: [
        'Cómo toleró el residente la sesión.',
        'Registrar molestias o recomendaciones posteriores.',
        'Agendar el próximo encuentro si corresponde.'
      ]
    }
  ];

  highlights: Highlight[] = [
    { label: 'Próximas sesiones', detail: 'No hay sesiones agendadas aún.', tone: 'muted' },
    { label: 'Adaptaciones', detail: 'Usá soportes ligeros para evitar lesiones.', tone: 'info' },
    { label: 'Bienestar', detail: 'Priorizar respiración y confort de cada residente.', tone: 'ok' }
  ];

  trackByTitle(_index: number, item: Section): string {
    return item.title;
  }

  trackByHighlight(_index: number, item: Highlight): string {
    return item.label;
  }
}
