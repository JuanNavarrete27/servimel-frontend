// src/app/pages/login/login.page.ts
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
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { gsap } from 'gsap';

// ✅ USAR el AuthService core (roles nuevos + setSession)
import { AuthService } from '../../core/auth/auth.service';

const TOKEN_KEY = 'servimel_token_v1';
const LEGACY_KEYS = [
  'servimel_token',
  'auth_token',
  'token',
  'jwt',
  'access_token',
  'servimelToken',
  'servimel_token_v0',
];

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

  @ViewChild('successBackdrop', { static: false }) successBackdrop?: ElementRef<HTMLElement>;
  @ViewChild('successModal', { static: false }) successModal?: ElementRef<HTMLElement>;
  successOpen = false;

  email = '';
  password = '';
  loading = false;
  error = '';

  private ctx?: ReturnType<typeof gsap.context>;
  private rafId: number | null = null;
  private pendingX = 0;
  private pendingY = 0;
  private hoverCapable = false;
  private successTl?: gsap.core.Timeline;

  // ✅ tween infinito del glow/pulse (para poder matarlo)
  private pulseTween?: gsap.core.Tween;

  private prevHeaderH = '';
  private prevFooterH = '';

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private auth: AuthService,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // ✅ si ya hay token, afuera del login
    const existingToken = this.getTokenFromStorage();
    if (existingToken) {
      queueMicrotask(() => this.router.navigateByUrl('/dashboard'));
      return;
    }

    const root = this.authRoot?.nativeElement;
    const card = this.cardEl?.nativeElement;
    if (!root || !card) return;

    const docEl = document.documentElement;
    const cs = getComputedStyle(docEl);
    this.prevHeaderH = cs.getPropertyValue('--header-h')?.trim() || '';
    this.prevFooterH = cs.getPropertyValue('--footer-h')?.trim() || '';

    docEl.style.setProperty('--header-h', '0px');
    docEl.style.setProperty('--footer-h', '0px');

    this.hoverCapable =
      !!window.matchMedia &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    root.style.setProperty('--mx', '50%');
    root.style.setProperty('--my', '40%');

    const reduceMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    if (reduceMotion) return;

    this.ctx = gsap.context(() => {
      // ✅ IMPORTANT: pueden NO existir según el HTML / *ngIf
      const title = card.querySelector<HTMLElement>('[data-anim="title"]');
      const fields = gsap.utils.toArray<HTMLElement>('[data-anim="field"]', card);
      const cta = card.querySelector<HTMLElement>('[data-anim="cta"]');
      const hint = card.querySelector<HTMLElement>('[data-anim="hint"]');

      // base
      gsap.set(card, { opacity: 1, y: 22, scale: 0.975, filter: 'blur(12px)' });

      // ✅ set SOLO a los que existen (evita warning target null)
      const present: HTMLElement[] = [
        ...(title ? [title] : []),
        ...fields,
        ...(cta ? [cta] : []),
        ...(hint ? [hint] : []),
      ];

      if (present.length) {
        gsap.set(present, { y: 14, opacity: 0, filter: 'blur(10px)' });
      }

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      tl.to(card, { y: 0, scale: 1, filter: 'blur(0px)', duration: 0.75 }, 0);

      // ✅ animar SOLO si el elemento existe
      if (title) {
        tl.to(title, { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.55 }, 0.14);
      }

      if (fields.length) {
        tl.to(
          fields,
          { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.52, stagger: 0.085 },
          0.22
        );
      }

      if (cta) {
        tl.to(cta, { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.52 }, 0.40);
      }

      if (hint) {
        tl.to(hint, { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.50 }, 0.48);
      }

      // ✅ tween infinito guardado para kill en destroy
      this.pulseTween?.kill();
      this.pulseTween = gsap.to(root, {
        '--pulse': 1,
        duration: 2.2,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
      } as any);
    }, root);
  }

  ngOnDestroy(): void {
    this.ctx?.revert();
    this.successTl?.kill();
    this.pulseTween?.kill();

    if (this.rafId) cancelAnimationFrame(this.rafId);

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
      // ✅ tu AuthService core debería implementar login(email,password)
      // y adentro guardar token + user (setSession)
      await (this.auth as any).login(this.email.trim(), this.password);

      this.loading = false;

      // ✅ si venía de una ruta protegida, volvemos ahí
      const redirect = this.route.snapshot.queryParamMap.get('redirect');
      const target = redirect && redirect.startsWith('/') ? redirect : '/dashboard';

      this.openSuccessModal(() => this.router.navigateByUrl(target));
    } catch (e: any) {
      this.loading = false;

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

  private getTokenFromStorage(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    try {
      const direct = localStorage.getItem(TOKEN_KEY);
      if (direct && direct.trim()) return direct.trim();

      for (const k of LEGACY_KEYS) {
        const v = localStorage.getItem(k);
        if (v && v.trim()) {
          try { localStorage.setItem(TOKEN_KEY, v.trim()); } catch {}
          return v.trim();
        }
      }
    } catch {
      // noop
    }

    return null;
  }
}
