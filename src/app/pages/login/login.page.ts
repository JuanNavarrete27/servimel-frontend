import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  Inject,
  PLATFORM_ID
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { gsap } from 'gsap';

import { AuthService } from '../../shared/services/auth.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
})
export class LoginPage implements AfterViewInit, OnDestroy {
  @ViewChild('authRoot', { static: true }) authRoot!: ElementRef<HTMLElement>;
  @ViewChild('cardEl', { static: true }) cardEl!: ElementRef<HTMLElement>;
  @ViewChild('btnEl', { static: true }) btnEl!: ElementRef<HTMLButtonElement>;

  // Modal success
  @ViewChild('successBackdrop', { static: false }) successBackdrop?: ElementRef<HTMLElement>;
  @ViewChild('successModal', { static: false }) successModal?: ElementRef<HTMLElement>;
  successOpen = false;

  email = '';
  password = '';
  loading = false;
  error = '';

  // ✅ FIX: tipado compatible con cualquier build
  private ctx?: ReturnType<typeof gsap.context>;

  // mouse glow (desktop only)
  private rafId: number | null = null;
  private pendingX = 0;
  private pendingY = 0;
  private hoverCapable = false;

  // timers/tweens
  private successTl?: gsap.core.Timeline;

  // ✅ guardar/restaurar vars globales (ADN usa :root, no :host)
  private prevHeaderH = '';
  private prevFooterH = '';

  constructor(
    private router: Router,
    private auth: AuthService,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // ✅ AUTH: si ya hay token válido en storage, no mostramos /login
    // (esto arregla el caso "nueva pestaña": el guard no siempre corre antes de cargar login)
    const existingToken = this.getTokenFromStorage();
    if (existingToken) {
      // micro-delay para evitar ExpressionChanged y que termine el ciclo
      queueMicrotask(() => this.router.navigateByUrl('/dashboard'));
      return;
    }

    const root = this.authRoot?.nativeElement;
    const card = this.cardEl?.nativeElement;
    if (!root || !card) return;

    // ✅ FIX ADN FULL: en login no hay header/footer → setear en :root
    const docEl = document.documentElement;
    const cs = getComputedStyle(docEl);
    this.prevHeaderH = cs.getPropertyValue('--header-h')?.trim() || '';
    this.prevFooterH = cs.getPropertyValue('--footer-h')?.trim() || '';

    docEl.style.setProperty('--header-h', '0px');
    docEl.style.setProperty('--footer-h', '0px');

    // hover capable?
    this.hoverCapable =
      !!window.matchMedia &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    // defaults glow local
    root.style.setProperty('--mx', '50%');
    root.style.setProperty('--my', '40%');

    const reduceMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    if (reduceMotion) return;

    this.ctx = gsap.context(() => {
      const title = card.querySelector<HTMLElement>('[data-anim="title"]');
      const fields = Array.from(card.querySelectorAll<HTMLElement>('[data-anim="field"]')); // ✅ FIX NodeList->Array
      const cta = card.querySelector<HTMLElement>('[data-anim="cta"]');
      const hint = card.querySelector<HTMLElement>('[data-anim="hint"]');

      gsap.set(card, { opacity: 1, y: 22, scale: 0.975, filter: 'blur(12px)' });
      gsap.set([title, ...fields, cta, hint].filter(Boolean) as any, { y: 14, opacity: 0, filter: 'blur(10px)' });

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      tl.to(card, { y: 0, scale: 1, filter: 'blur(0px)', duration: 0.75 }, 0)
        .to(title, { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.55 }, 0.14)
        .to(fields, { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.52, stagger: 0.085 }, 0.22)
        .to(cta, { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.52 }, 0.40)
        .to(hint, { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.50 }, 0.48);

      gsap.to(root, {
        '--pulse': 1,
        duration: 2.2,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1
      } as any);
    }, root);
  }

  ngOnDestroy(): void {
    this.ctx?.revert();
    this.successTl?.kill();
    if (this.rafId) cancelAnimationFrame(this.rafId);

    // ✅ restaurar vars globales
    if (isPlatformBrowser(this.platformId)) {
      const docEl = document.documentElement;
      if (this.prevHeaderH) docEl.style.setProperty('--header-h', this.prevHeaderH);
      else docEl.style.removeProperty('--header-h');

      if (this.prevFooterH) docEl.style.setProperty('--footer-h', this.prevFooterH);
      else docEl.style.removeProperty('--footer-h');
    }
  }

  onMouseMove(ev: MouseEvent) {
    if (!this.hoverCapable) return;

    this.pendingX = ev.clientX;
    this.pendingY = ev.clientY;

    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.applyMouseGlow(this.pendingX, this.pendingY);
    });
  }

  private applyMouseGlow(clientX: number, clientY: number) {
    const root = this.authRoot?.nativeElement;
    if (!root) return;

    const rect = root.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;

    root.style.setProperty('--mx', `${Math.max(0, Math.min(100, x)).toFixed(2)}%`);
    root.style.setProperty('--my', `${Math.max(0, Math.min(100, y)).toFixed(2)}%`);
  }

  async login() {
    this.error = '';

    if (!this.email || !this.password) {
      this.error = 'Completá email y contraseña.';
      this.shakeCard();
      return;
    }

    if (!isPlatformBrowser(this.platformId)) return;

    this.loading = true;
    this.pulseButton();

    try {
      await this.auth.login(this.email.trim(), this.password);

      this.loading = false;
      this.openSuccessModal(() => this.router.navigateByUrl('/dashboard'));
    } catch (e: any) {
      this.loading = false;

      // Mensaje legible
      const msg = (e?.message || '').toLowerCase();
      if (msg.includes('invalid') || msg.includes('cred') || msg.includes('401')) {
        this.error = 'Credenciales inválidas.';
      } else if (msg.includes('network') || msg.includes('0 unknown error')) {
        this.error = 'No se pudo conectar con el servidor.';
      } else {
        this.error = e?.message || 'Error al iniciar sesión.';
      }

      this.shakeCard();
    }
  }

  private openSuccessModal(onDone: () => void) {
    if (!isPlatformBrowser(this.platformId)) {
      onDone();
      return;
    }

    this.successOpen = true;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const bd = this.successBackdrop?.nativeElement;
        const md = this.successModal?.nativeElement;

        if (!bd || !md) {
          onDone();
          return;
        }

        this.successTl?.kill();

        gsap.set(bd, { opacity: 0 });
        gsap.set(md, { opacity: 0, y: 14, scale: 0.98, filter: 'blur(10px)' });

        this.successTl = gsap.timeline({ defaults: { ease: 'power3.out' } });

        this.successTl
          .to(bd, { opacity: 1, duration: 0.18 }, 0)
          .to(md, { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.28 }, 0.02)
          .to(md, { y: -2, duration: 0.18, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 0.32)
          .to(md, { opacity: 0, y: 10, filter: 'blur(10px)', duration: 0.22, ease: 'power2.inOut' }, 0.92)
          .to(bd, { opacity: 0, duration: 0.18 }, 0.98)
          .add(() => {
            this.successOpen = false;
            onDone();
          });
      });
    });
  }

  private shakeCard() {
    if (!isPlatformBrowser(this.platformId)) return;
    const card = this.cardEl?.nativeElement;
    if (!card) return;

    gsap.killTweensOf(card);
    gsap.fromTo(
      card,
      { x: 0 },
      { x: 10, duration: 0.06, ease: 'power1.inOut', yoyo: true, repeat: 5, clearProps: 'x' }
    );
  }

  private pulseButton() {
    if (!isPlatformBrowser(this.platformId)) return;
    const btn = this.btnEl?.nativeElement;
    if (!btn) return;

    gsap.killTweensOf(btn);
    gsap.fromTo(
      btn,
      { scale: 1 },
      { scale: 0.985, duration: 0.12, yoyo: true, repeat: 1, ease: 'power2.out' }
    );
  }

  // ============================================================
  // AUTH helpers (local, no rompe nada)
  // ============================================================
  private getTokenFromStorage(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    const keys = [
      'servimel_token_v1',
      'servimel_token',
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
}
