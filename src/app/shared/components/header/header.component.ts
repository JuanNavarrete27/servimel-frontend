import {
  Component,
  HostListener,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  Inject,
  PLATFORM_ID
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { gsap } from 'gsap';

// ✅ FIX: estabas “dentro” de /shared/components/header,
// y el service está en /shared/services => sube 2 y entra a services
import { AuthService } from '../../services/auth.service';

type NavItem = { label: string; path: string };

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
})
export class HeaderComponent implements AfterViewInit, OnDestroy {
  @ViewChild('headerEl', { static: true }) headerEl!: ElementRef<HTMLElement>;
  @ViewChild('mobileEl', { static: true }) mobileEl!: ElementRef<HTMLElement>;
  @ViewChild('burgerEl', { static: true }) burgerEl!: ElementRef<HTMLButtonElement>;

  // ✅ Logout modal
  @ViewChild('logoutBackdrop', { static: false }) logoutBackdrop?: ElementRef<HTMLElement>;
  @ViewChild('logoutModal', { static: false }) logoutModal?: ElementRef<HTMLElement>;
  logoutOpen = false;
  private logoutTl?: gsap.core.Timeline;
  private loggingOut = false;

  isScrolled = false;
  isMenuOpen = false;

  logoPath = '/images/logo.png';

  nav: NavItem[] = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Residentes', path: '/residentes' },
    { label: 'Enfermería', path: '/enfermeria' },
    { label: 'Medicina General', path: '/medicina-general' },
    { label: 'Fisioterapia', path: '/fisioterapia' },
    { label: 'Historial', path: '/historial' },
    { label: 'Ed. Física', path: '/ed-fisica' },
    { label: 'Yoga', path: '/yoga' },
    { label: 'Cocina', path: '/cocina' },
    { label: 'Ajustes', path: '/ajustes' },
  ];

  // FX (mouse glow) — throttled
  private rafId: number | null = null;
  private pendingX = 0;
  private pendingY = 0;
  private hoverCapable = false;

  // Header height observer
  private ro?: ResizeObserver;
  private heightRaf: number | null = null;

  // GSAP
  private tlMenu?: gsap.core.Timeline;
  private reduceMotion = false;

  private isBrowser = false;

  constructor(
    private router: Router,
    private auth: AuthService,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    // Reduced motion?
    this.reduceMotion =
      !!window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Hover capable?
    this.hoverCapable =
      !!window.matchMedia &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    // Defaults
    this.setHeaderVar('--mx', '50%');
    this.setHeaderVar('--my', '0%');
    this.setHeaderVar('--scrollGlow', '0');

    // Medir alto real del header y setear --header-h (en :root)
    this.applyHeaderHeight();
    this.ro = new ResizeObserver(() => this.applyHeaderHeight());
    this.ro.observe(this.headerEl.nativeElement);
    window.addEventListener('resize', this.applyHeaderHeight, { passive: true });

    // Init scroll state
    this.onScroll();

    // GSAP menu init
    this.setupMenuTimeline();
  }

  ngOnDestroy(): void {
    if (!this.isBrowser) return;

    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.heightRaf) cancelAnimationFrame(this.heightRaf);
    this.ro?.disconnect();
    window.removeEventListener('resize', this.applyHeaderHeight as any);

    this.tlMenu?.kill();
    this.tlMenu = undefined;

    this.logoutTl?.kill();
  }

  private setupMenuTimeline() {
    const mobile = this.mobileEl?.nativeElement;
    if (!mobile) return;

    // Estado base (cerrado)
    gsap.set(mobile, {
      height: 0,
      opacity: 0,
      y: -6,
      filter: 'blur(6px)',
      pointerEvents: 'none',
    });

    if (this.reduceMotion) return;

    const links = Array.from(mobile.querySelectorAll('.m-link')) as HTMLElement[];

    this.tlMenu = gsap
      .timeline({ paused: true })
      .to(mobile, {
        height: 'auto',
        duration: 0.38,
        ease: 'power3.out',
      })
      .to(
        mobile,
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: 0.28,
          ease: 'power2.out',
        },
        0
      )
      .set(mobile, { pointerEvents: 'auto' }, 0.05)
      .fromTo(
        links,
        { opacity: 0, y: -8 },
        {
          opacity: 1,
          y: 0,
          duration: 0.28,
          ease: 'power2.out',
          stagger: 0.045,
        },
        0.08
      );
  }

  private applyHeaderHeight = () => {
    if (!this.isBrowser) return;

    if (this.heightRaf) cancelAnimationFrame(this.heightRaf);
    this.heightRaf = requestAnimationFrame(() => {
      const el = this.headerEl?.nativeElement;
      if (!el) return;
      const h = Math.ceil(el.getBoundingClientRect().height || 0);
      document.documentElement.style.setProperty('--header-h', `${h}px`);
    });
  };

  @HostListener('window:scroll')
  onScroll() {
    if (!this.isBrowser) return;

    const y = window.scrollY || 0;
    this.isScrolled = y > 10;

    const t = Math.max(0, Math.min(1, y / 220));
    this.setHeaderVar('--scrollGlow', String(t));
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(ev: MouseEvent) {
    if (!this.isBrowser) return;
    if (!this.hoverCapable) return;

    this.pendingX = ev.clientX;
    this.pendingY = ev.clientY;

    if (this.rafId !== null) return;
    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = null;
      this.applyMouseGlow(this.pendingX, this.pendingY);
    });
  }

  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;

    this.animateMenu(this.isMenuOpen);
    this.applyHeaderHeight();
  }

  closeMenu() {
    if (!this.isMenuOpen) return;
    this.isMenuOpen = false;

    this.animateMenu(false);
    this.applyHeaderHeight();
  }

  private animateMenu(open: boolean) {
    const mobile = this.mobileEl?.nativeElement;
    if (!mobile) return;

    if (this.reduceMotion || !this.tlMenu) {
      gsap.killTweensOf(mobile);
      gsap.set(mobile, {
        height: open ? 'auto' : 0,
        opacity: open ? 1 : 0,
        y: open ? 0 : -6,
        filter: open ? 'blur(0px)' : 'blur(6px)',
        pointerEvents: open ? 'auto' : 'none',
      });
      return;
    }

    if (open) {
      this.tlMenu.timeScale(1).play(0);
    } else {
      this.tlMenu.timeScale(1.05).reverse();
      gsap.delayedCall(0.42, () => {
        if (this.isMenuOpen) return;
        gsap.set(mobile, { pointerEvents: 'none' });
      });
    }
  }

  // ✅ Logout real + animación tipo login
  async logout(): Promise<void> {
    if (!this.isBrowser) return;
    if (this.loggingOut) return;

    this.loggingOut = true;
    this.closeMenu();

    const doLogout = async () => {
      await this.performLogout();
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      this.loggingOut = false;
    };

    if (this.reduceMotion) {
      await doLogout();
      return;
    }

    this.openLogoutModal(doLogout);
  }

  private openLogoutModal(onDone: () => void) {
    this.logoutOpen = true;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const bd = this.logoutBackdrop?.nativeElement;
        const md = this.logoutModal?.nativeElement;

        if (!bd || !md) {
          this.logoutOpen = false;
          onDone();
          return;
        }

        this.logoutTl?.kill();

        gsap.set(bd, { opacity: 0 });
        gsap.set(md, { opacity: 0, y: 14, scale: 0.98, filter: 'blur(10px)' });

        this.logoutTl = gsap.timeline({ defaults: { ease: 'power3.out' } });

        this.logoutTl
          .to(bd, { opacity: 1, duration: 0.18 }, 0)
          .to(md, { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.28 }, 0.02)
          .to(md, { y: -2, duration: 0.18, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 0.32)
          .to(md, { opacity: 0, y: 10, filter: 'blur(10px)', duration: 0.22, ease: 'power2.inOut' }, 0.92)
          .to(bd, { opacity: 0, duration: 0.18 }, 0.98)
          .add(() => {
            this.logoutOpen = false;
            onDone();
          });
      });
    });
  }

  private async performLogout(): Promise<void> {
    try {
      const maybe = (this.auth as any)?.logout?.();
      if (maybe && typeof maybe.then === 'function') await maybe;
    } catch {
      // ignore
    }

    const keys = [
      'servimel_token_v1',
      'servimel_token',
      'auth_token',
      'token',
      'jwt',
      'access_token',
      'accessToken',
      'refresh_token',
      'refreshToken',
      'auth',
      'user',
      'servimel_user_v1'
    ];

    try {
      keys.forEach(k => localStorage.removeItem(k));
      keys.forEach(k => sessionStorage.removeItem(k));
    } catch {
      // ignore
    }
  }

  handleImgError(ev: Event) {
    const img = ev.target as HTMLImageElement;
    img.style.display = 'none';
  }

  private applyMouseGlow(clientX: number, clientY: number) {
    const el = this.headerEl?.nativeElement;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;

    const cx = Math.max(0, Math.min(100, x));
    const cy = Math.max(0, Math.min(100, y));

    this.setHeaderVar('--mx', `${cx.toFixed(2)}%`);
    this.setHeaderVar('--my', `${cy.toFixed(2)}%`);
  }

  private setHeaderVar(name: string, value: string) {
    const el = this.headerEl?.nativeElement;
    if (!el) return;
    el.style.setProperty(name, value);
  }
}
