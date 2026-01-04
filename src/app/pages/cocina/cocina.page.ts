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
  selector: 'app-cocina-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './cocina.page.html',
  styleUrls: ['./cocina.page.scss']
})
export class CocinaPage {
  sections: Section[] = [
    {
      title: 'Menú diario',
      desc: 'Planificación de platos y dietas especiales alineada con el turno actual.',
      bullets: [
        'Definí platos principales, guarniciones y postres.',
        'Marcá requerimientos por residente (diabético, licuado, sin sal).',
        'Confirmá horarios de despacho por piso o sector.'
      ]
    },
    {
      title: 'Pedidos y rutas internas',
      desc: 'Organizá entregas hacia enfermería, salas comunes y habitaciones.',
      bullets: [
        'Verificá bandejas pendientes y prioridad por horario.',
        'Etiquetá pedidos especiales para evitar demoras.',
        'Coordina retiros con el personal de piso cuando aplique.'
      ]
    },
    {
      title: 'Abastecimiento',
      desc: 'Control rápido de insumos clave para el servicio diario.',
      bullets: [
        'Chequeá stock de proteínas, vegetales, lácteos y descartables.',
        'Agregá notas para compras urgentes o sustituciones.',
        'Documentá incidencias (falta de insumo, cambio de proveedor).'
      ]
    }
  ];

  highlights: Highlight[] = [
    { label: 'Pedidos', detail: 'Sin pedidos pendientes en este turno.', tone: 'muted' },
    { label: 'Dietas especiales', detail: 'Recordá revisar las notas de enfermería.', tone: 'info' },
    { label: 'Entrega a tiempo', detail: 'Usá la ruta interna para evitar retrasos.', tone: 'ok' }
  ];

  trackByTitle(_index: number, item: Section): string {
    return item.title;
  }

  trackByHighlight(_index: number, item: Highlight): string {
    return item.label;
  }
}
