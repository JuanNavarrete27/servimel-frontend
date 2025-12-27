import {
  Component,
  AfterViewInit,
  OnDestroy,
  ElementRef,
  Inject,
  PLATFORM_ID,
  HostListener,
  OnInit,
} from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';

import {
  HttpClient,
  HttpClientModule,
  HttpErrorResponse,
  HttpHeaders
} from '@angular/common/http';

import { finalize, map, take } from 'rxjs/operators';
import { API_CONFIG } from '../../core/config/api.config';

/* =========================
   TYPES
========================= */
type EstadoResidente = 'estable' | 'observacion' | 'critico';

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string; details?: any } };
type ApiEnvelope<T> = ApiOk<T> | ApiFail;

type ResidentCreatePayload = {
  first_name: string;
  last_name: string;
  document_number: string | null;
  room: string | null;
  status: EstadoResidente;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  is_active: number | boolean;
};

type ResidentCreateResponse = {
  id: number;
};

type ToastType = 'ok' | 'warn' | 'error';
type Toast = { id: string; type: ToastType; title: string; msg?: string };

/* =========================
   COMPONENT
========================= */
@Component({
  selector: 'app-residentes-nuevo-page',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule, HttpClientModule],
  templateUrl: './residentes-nuevo.page.html',
  styleUrls: ['./residentes-nuevo.page.scss'],
})
export class ResidentesNuevoPage implements OnInit, AfterViewInit, OnDestroy {
  // ✅ Backend real (sin /api)
  private readonly API = API_CONFIG.baseUrl;

  form!: FormGroup;

  saving = false;
  lastError: string | null = null;

  toasts: Toast[] = [];

  private gsapCleanup: (() => void) | null = null;
  private navLock = false;

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private router: Router,
    private host: ElementRef<HTMLElement>,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  ngOnInit(): void {
    this.form = this.fb.group({
      first_name: ['', [Validators.required, Validators.minLength(2)]],
      last_name: ['', [Validators.required, Validators.minLength(2)]],
      document_number: [''],
      room: [''],
      status: ['estable', [Validators.required]],
      emergency_contact_name: [''],
      emergency_contact_phone: [''],
      notes: [''],
      is_active: [true],
    });
  }

  /* =========================
     GSAP ENTER (WOW)
  ========================= */
  async ngAfterViewInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    this.setMouseVars(50, 35);

    try {
      const mod = await import('gsap');
      const gsap = mod.gsap;

      const root = this.host.nativeElement;

      const ctx = gsap.context(() => {
        const head = root.querySelector('.head');
        const grid = root.querySelector('.grid');
        const cards = Array.from(root.querySelectorAll('.card'));
        const fields = Array.from(root.querySelectorAll('.field'));
        const actions = root.querySelector('.actions');

        gsap.set([head, grid], { opacity: 1 });

        const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
        tl.from(head, { y: 10, opacity: 0, duration: 0.55 })
          .from(grid, { y: 8, opacity: 0, duration: 0.45 }, '-=0.30');

        if (cards.length) {
          tl.from(cards, { y: 10, opacity: 0, duration: 0.38, stagger: 0.07 }, '-=0.22');
        }
        if (fields.length) {
          tl.from(fields, { y: 8, opacity: 0, duration: 0.28, stagger: 0.03 }, '-=0.26');
        }
        if (actions) {
          tl.from(actions, { y: 10, opacity: 0, duration: 0.28 }, '-=0.18');
        }
      }, root);

      this.gsapCleanup = () => ctx.revert();
    } catch {
      // sin gsap, sin drama
    }
  }

  ngOnDestroy(): void {
    this.gsapCleanup?.();
    this.gsapCleanup = null;
  }

  /* =========================
     Mouse vars (glow global)
  ========================= */
  @HostListener('mousemove', ['$event'])
  onMove(ev: MouseEvent): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const x = (ev.clientX / (window.innerWidth || 1)) * 100;
    const y = (ev.clientY / (window.innerHeight || 1)) * 100;
    this.setMouseVars(x, y);
  }

  @HostListener('mouseleave')
  onLeave(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.setMouseVars(50, 35);
  }

  private setMouseVars(xPct: number, yPct: number): void {
    const x = Math.max(0, Math.min(100, xPct));
    const y = Math.max(0, Math.min(100, yPct));
    document.documentElement.style.setProperty('--mx', `${x.toFixed(2)}%`);
    document.documentElement.style.setProperty('--my', `${y.toFixed(2)}%`);
  }

  /* =========================
     AUTH
  ========================= */
  private getToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    const keys = [
      'servimel_token',
      'servimel_token_v1',
      'auth_token',
      'token',
      'jwt',
      'access_token'
    ];

    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v && v.trim()) return v.trim();
    }
    return null;
  }

  private authHeaders(): HttpHeaders {
    const t = this.getToken();
    if (!t) return new HttpHeaders();
    return new HttpHeaders({ Authorization: `Bearer ${t}` });
  }

  /* =========================
     ENVELOPE HELPERS
  ========================= */
  private unwrap<T>(raw: T | ApiEnvelope<T>): T {
    const r: any = raw as any;
    if (r && typeof r === 'object' && 'ok' in r) {
      if (r.ok === true) return r.data as T;
      throw new Error(r?.error?.message || 'API error');
    }
    return raw as T;
  }

  /* =========================
     UI HELPERS
  ========================= */
  estadoLabel(e: EstadoResidente): string {
    if (e === 'estable') return 'Estable';
    if (e === 'observacion') return 'Observación';
    return 'Crítico';
  }

  get estado(): EstadoResidente {
    return (this.form?.get('status')?.value || 'estable') as EstadoResidente;
  }

  get fullName(): string {
    const fn = String(this.form?.get('first_name')?.value || '').trim();
    const ln = String(this.form?.get('last_name')?.value || '').trim();
    return `${fn} ${ln}`.trim() || 'Nuevo residente';
  }

  isInvalid(name: string): boolean {
    const c = this.form.get(name);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  setEstado(s: EstadoResidente): void {
    this.form.get('status')?.setValue(s);
    this.form.get('status')?.markAsDirty();
  }

  /* =========================
     TOASTS
  ========================= */
  private pushToast(type: ToastType, title: string, msg?: string): void {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    this.toasts = [{ id, type, title, msg }, ...this.toasts].slice(0, 4);

    // autoclose suave
    setTimeout(() => this.cerrarToast(id), 3500);
  }

  cerrarToast(id: string): void {
    this.toasts = this.toasts.filter(t => t.id !== id);
  }

  /* =========================
     ACTIONS
  ========================= */
  async cancel(): Promise<void> {
    if (this.navLock) return;
    this.navLock = true;

    const root = this.host.nativeElement;
    root.classList.add('is-leaving');

    try {
      const mod = await import('gsap');
      const gsap = mod.gsap;

      await new Promise<void>((resolve) => {
        gsap.to(root, { opacity: 0, y: -8, duration: 0.20, ease: 'power2.inOut', onComplete: () => resolve() });
      });
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }

    await this.router.navigate(['/residentes']);
    setTimeout(() => (this.navLock = false), 450);
  }

  submit(): void {
    this.lastError = null;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.pushToast('warn', 'Revisá el formulario', 'Faltan datos obligatorios o hay campos inválidos.');
      return;
    }

    const v = this.form.value;

    const payload: ResidentCreatePayload = {
      first_name: String(v.first_name || '').trim(),
      last_name: String(v.last_name || '').trim(),
      document_number: this.cleanOrNull(v.document_number),
      room: this.cleanOrNull(v.room),
      status: (v.status || 'estable') as EstadoResidente,
      emergency_contact_name: this.cleanOrNull(v.emergency_contact_name),
      emergency_contact_phone: this.cleanOrNull(v.emergency_contact_phone),
      notes: this.cleanOrNull(v.notes),
      is_active: !!v.is_active
    };

    this.saving = true;

    this.http
      .post<ApiEnvelope<ResidentCreateResponse> | ResidentCreateResponse>(
        `${this.API}/residentes`,
        payload,
        { headers: this.authHeaders() }
      )
      .pipe(
        take(1),
        map(raw => this.unwrap<ResidentCreateResponse>(raw)),
        finalize(() => (this.saving = false))
      )
      .subscribe({
        next: async (res) => {
          const id = Number((res as any)?.id);

          this.pushToast('ok', 'Residente creado', id ? `ID: ${id}` : undefined);

          // ✅ Navega al detalle recién creado
          if (id && Number.isFinite(id)) {
            await this.navigateWithExit(['/residentes', id]);
          } else {
            await this.navigateWithExit(['/residentes']);
          }
        },
        error: (e) => {
          this.lastError = this.humanHttpError(e);
          this.pushToast('error', 'No se pudo crear', this.lastError || 'Error');
        }
      });
  }

  private async navigateWithExit(commands: any[]): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      await this.router.navigate(commands);
      return;
    }

    const root = this.host.nativeElement;
    root.classList.add('is-leaving');

    try {
      const mod = await import('gsap');
      const gsap = mod.gsap;

      await new Promise<void>((resolve) => {
        gsap.to(root, { opacity: 0, y: -8, duration: 0.20, ease: 'power2.inOut', onComplete: () => resolve() });
      });
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }

    await this.router.navigate(commands);
  }

  /* =========================
     UTILS
  ========================= */
  private cleanOrNull(v: unknown): string | null {
    const s = String(v ?? '').trim();
    return s ? s : null;
  }

  private humanHttpError(e: unknown): string {
    const err = e as HttpErrorResponse;

    const msg = (err as any)?.error?.error?.message || (err as any)?.error?.message;
    if (msg) return String(msg);

    if (err?.status) return `HTTP ${err.status} — ${err.statusText || 'Error'}`;
    return 'Error de red/servidor.';
  }
}
