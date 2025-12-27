import {
  Component,
  Input,
  ViewChild,
  ElementRef,
  AfterViewInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

type FooterLink = { label: string; path: string };

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.scss'],
})
export class FooterComponent implements AfterViewInit {
  @Input() year = new Date().getFullYear();

  // Info interna
  @Input() version = 'v0.1 (MVP)';
  @Input() environment: 'MVP' | 'QA' | 'PROD' = 'MVP';

  // Soporte
  @Input() supportLabel = 'Soporte: Administración';
  @Input() supportRoute = '/ajustes';

  // Accesos rápidos
  links: FooterLink[] = [
    { label: 'Residentes', path: '/residentes' },
    { label: 'Enfermería', path: '/enfermeria' },
    { label: 'Historial', path: '/historial' },
    { label: 'Ajustes', path: '/ajustes' },
  ];

  // Watermark sutil
  logoPath = '/images/logo.png';

  @ViewChild('footerEl', { static: true }) footerEl!: ElementRef<HTMLElement>;

  private rafId: number | null = null;
  private pendingX = 0;
  private pendingY = 0;

  private hoverCapable = false;

  ngAfterViewInit(): void {
    this.hoverCapable =
      typeof window !== 'undefined' &&
      !!window.matchMedia &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    // defaults para que no “salte”
    this.setVar('--mx', '50%');
    this.setVar('--my', '50%');
  }

  onMove(ev: MouseEvent) {
    if (!this.hoverCapable) return;

    const el = this.footerEl?.nativeElement;
    if (!el) return;

    this.pendingX = ev.clientX;
    this.pendingY = ev.clientY;

    if (this.rafId !== null) return;
    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = null;
      this.applyGlow(this.pendingX, this.pendingY);
    });
  }

  onLeave() {
    // vuelve al centro (suave desde CSS)
    this.setVar('--mx', '50%');
    this.setVar('--my', '50%');
  }

  handleImgError(ev: Event) {
    const img = ev.target as HTMLImageElement;
    img.style.display = 'none';
  }

  private applyGlow(clientX: number, clientY: number) {
    const el = this.footerEl?.nativeElement;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;

    const cx = Math.max(0, Math.min(100, x));
    const cy = Math.max(0, Math.min(100, y));

    this.setVar('--mx', `${cx.toFixed(2)}%`);
    this.setVar('--my', `${cy.toFixed(2)}%`);
  }

  private setVar(name: string, value: string) {
    const el = this.footerEl?.nativeElement;
    if (!el) return;
    el.style.setProperty(name, value);
  }
}
