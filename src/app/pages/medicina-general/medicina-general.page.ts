// src/app/pages/medicina-general/medicina-general.page.ts
// ============================================================
// SERVIMEL — Servicios / Medicina General (DB real)
// ✅ Consume API real (service_categories + service_items)
// ✅ Sin mocks
// ✅ Búsqueda con debounce (server-side) + fallback client-side
// ✅ Modal detalle (content/description)
// ============================================================

import {
  AfterViewInit,
  Component,
  ElementRef,
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
import {
  ServiceCategory,
  ServiceItem,
  ServiceListResponse
} from '../../shared/models/servicio.model';

@Component({
  selector: 'app-medicina-general',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './medicina-general.page.html',
  styleUrl: './medicina-general.page.scss'
})
export class MedicinaGeneralPage implements OnInit, AfterViewInit, OnDestroy {
  private readonly isBrowser: boolean;

  readonly slug = 'medicina-general';

  category: ServiceCategory | null = null;

  // dataset actual (puede ser full o resultado de búsqueda)
  items: ServiceItem[] = [];

  // dataset “base” (cargado al entrar desde /:slug)
  private baseItems: ServiceItem[] = [];

  // UI
  loading = false;
  error: string | null = null;

  q = '';
  private searchTimer: any = null;
  searching = false;

  // modal
  modalOpen = false;
  selected: ServiceItem | null = null;

  @ViewChild('pageRoot', { static: true }) pageRoot!: ElementRef<HTMLElement>;

  constructor(
    private servicios: ServiciosService,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  async ngOnInit(): Promise<void> {
    await this.loadBase();
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    try {
      gsap.fromTo(
        this.pageRoot.nativeElement,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }
      );
    } catch {
      // ignore
    }
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  // ============================================================
  // Data
  // ============================================================
  async loadBase(): Promise<void> {
    this.loading = true;
    this.error = null;

    try {
      // ✅ Trae category + items (según lo que devuelva tu backend)
      const res = await this.servicios.getCategoryWithItems(this.slug);
      this.category = res.category ?? null;

      const list = Array.isArray(res.items) ? (res.items as ServiceItem[]) : [];
      this.baseItems = list;
      this.items = [...list];
    } catch (e: any) {
      this.error = this.getErrMessage(e) || 'No se pudo cargar Medicina General.';
    } finally {
      this.loading = false;
    }
  }

  // ============================================================
  // Search (server-side con debounce)
  // ============================================================
  onSearchChange(v: string): void {
    this.q = v ?? '';

    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.runSearch(), 320);
  }

  async runSearch(): Promise<void> {
    const term = String(this.q || '').trim();

    // reset -> base
    if (!term) {
      this.items = [...this.baseItems];
      this.searching = false;
      return;
    }

    // Para no spamear DB con 1 char
    if (term.length < 2) {
      this.items = this.filterLocal(term);
      this.searching = false;
      return;
    }

    this.searching = true;
    this.error = null;

    try {
      // ✅ FIX: ServiceListResponse es genérico => ServiceListResponse<ServiceItem>
      const r: ServiceListResponse<ServiceItem> = await this.servicios.listItems(this.slug, {
        page: 1,
        limit: 50,
        q: term
      });

      this.items = Array.isArray(r?.items) ? r.items : [];
    } catch (e: any) {
      // fallback pro: búsqueda local si falló endpoint
      this.items = this.filterLocal(term);
      this.error = null;
    } finally {
      this.searching = false;
    }
  }

  private filterLocal(term: string): ServiceItem[] {
    const t = term.toLowerCase();
    const src = this.baseItems;

    return src.filter((x) => {
      const a = String(x.title ?? '').toLowerCase();
      const b = String(x.description ?? '').toLowerCase();
      const c = String(x.content ?? '').toLowerCase();
      return a.includes(t) || b.includes(t) || c.includes(t);
    });
  }

  clearSearch(): void {
    this.q = '';
    this.items = [...this.baseItems];
  }

  // ============================================================
  // Modal
  // ============================================================
  openItem(item: ServiceItem): void {
    this.selected = item;
    this.modalOpen = true;

    if (!this.isBrowser) return;
    try {
      gsap.fromTo(
        '.modal__card',
        { opacity: 0, y: 12, scale: 0.98 },
        { opacity: 1, y: 0, scale: 1, duration: 0.22, ease: 'power2.out' }
      );
    } catch {
      // ignore
    }
  }

  closeModal(): void {
    this.modalOpen = false;
    this.selected = null;
  }

  // ============================================================
  // Helpers
  // ============================================================
  trackById(_i: number, it: ServiceItem): number {
    return Number(it.id);
  }

  fmtDate(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString();
  }

  private getErrMessage(e: any): string {
    // backend payload: { ok:false, error:{ message } }
    const msg =
      e?.error?.error?.message ||
      e?.error?.message ||
      e?.message ||
      '';

    return String(msg || '').trim();
  }
}
