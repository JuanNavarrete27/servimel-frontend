// src/app/pages/ed-fisica/ed-fisica.page.ts
// ============================================================
// SERVIMEL — Educación Física (DB real)
// Standalone Page (Angular) + GSAP entrance
// ✅ Consume API real vía ServiciosService (NO mocks)
// ============================================================

import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Inject,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  ViewChild
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { gsap } from 'gsap';

import { ServiciosService } from '../../shared/services/servicios.service';
import type { ServiceCategory, ServiceItem } from '../../shared/models/servicio.model';

@Component({
  selector: 'app-ed-fisica',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ed-fisica.page.html',
  styleUrls: ['./ed-fisica.page.scss']
})
export class EdFisicaPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('pageRoot', { static: true }) pageRoot!: ElementRef<HTMLElement>;

  readonly slug = 'ed-fisica';

  loading = true;
  loadingItems = true;
  errorMsg: string | null = null;

  category: ServiceCategory | null = null;
  items: ServiceItem[] = [];

  // UI
  q = '';
  selected: ServiceItem | null = null;

  private isBrowser = false;
  private debounceT: any = null;

  constructor(
    private servicios: ServiciosService,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  async ngOnInit() {
    await this.loadAll();
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    // entrance
    gsap.fromTo(
      this.pageRoot.nativeElement,
      { autoAlpha: 0, y: 10 },
      { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out' }
    );
  }

  ngOnDestroy(): void {
    if (this.debounceT) clearTimeout(this.debounceT);
  }

  @HostListener('document:keydown.escape')
  onEsc() {
    if (this.selected) this.closeModal();
  }

  // ============================================================
  // Data (DB real)
  // ============================================================
  async loadAll() {
    this.loading = true;
    this.loadingItems = true;
    this.errorMsg = null;

    try {
      // ✅ trae category + items iniciales (o lo equivalente)
      const res = await this.servicios.getCategoryWithItems(this.slug);
      this.category = res.category ?? null;
      this.items = Array.isArray(res.items) ? res.items : [];

      // si querés búsqueda por server, el primer load igual queda OK
      this.loadingItems = false;
      this.loading = false;
    } catch (e: any) {
      this.errorMsg = this.humanizeError(e);
      this.loadingItems = false;
      this.loading = false;
    }
  }

  async refresh() {
    this.q = '';
    this.selected = null;
    await this.loadAll();
  }

  onSearchInput() {
    if (this.debounceT) clearTimeout(this.debounceT);
    this.debounceT = setTimeout(() => this.searchServer(), 250);
  }

  private async searchServer() {
    // si no hay query, volvemos al listado base
    const q = String(this.q || '').trim();
    if (!q) {
      // Reusa el "base" para evitar spam de requests
      await this.loadAll();
      return;
    }

    this.loadingItems = true;
    this.errorMsg = null;

    try {
      // ✅ endpoint real: GET /servicios/:slug/items?q=...
      const res = await this.servicios.listItems(this.slug, { page: 1, limit: 50, q });
      this.items = res.items ?? [];
      this.loadingItems = false;
    } catch (e: any) {
      this.errorMsg = this.humanizeError(e);
      this.loadingItems = false;
    }
  }

  // ============================================================
  // Modal
  // ============================================================
  openItem(it: ServiceItem) {
    this.selected = it;
    if (!this.isBrowser) return;

    gsap.fromTo(
      '.modal__card',
      { autoAlpha: 0, y: 12, scale: 0.98 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.18, ease: 'power2.out' }
    );
  }

  closeModal() {
    if (!this.isBrowser) {
      this.selected = null;
      return;
    }

    gsap.to('.modal__card', {
      autoAlpha: 0,
      y: 10,
      duration: 0.14,
      ease: 'power2.in',
      onComplete: () => (this.selected = null)
    });
  }

  // ============================================================
  // Utils
  // ============================================================
  trackById(_: number, it: ServiceItem) {
    return it.id;
  }

  private humanizeError(e: any): string {
    const msg =
      e?.error?.error?.message ||
      e?.error?.message ||
      e?.message ||
      'Error inesperado';
    return String(msg);
  }
}
