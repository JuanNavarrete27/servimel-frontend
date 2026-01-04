// ajustes.page.ts
// ============================================================
// SERVIMEL — Ajustes (Configuración del sistema)
// Standalone Page (Angular) + Reactive Forms + GSAP Animations
//
// ✅ MOCK 100% funcional (sin romper UI / sin spam de consola):
// - Tema / alto contraste / compact / animaciones / font size -> aplica al DOM + localStorage
// - No dispara requests a endpoints inventados (0 spam 404)
// - Backend opcional y “limpio”: SOLO /auth/me y /settings/me (flat)
// - Si backend falla -> queda en localStorage (sin romper UX)
//
// ✅ FIX NG9: métodos usados en template EXISTEN y son públicos
// ✅ AUTH: si no hay token -> /login
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
import { Router, RouterModule } from '@angular/router';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { gsap } from 'gsap';

import {
  HttpClient,
  HttpClientModule,
  HttpErrorResponse,
  HttpHeaders
} from '@angular/common/http';
import { firstValueFrom, Subscription } from 'rxjs';

import { API_CONFIG } from '../../core/config/api.config';
import { UiPrefsService } from '../../shared/services/ui-prefs.service';

type Role = 'admin' | 'enfermeria' | 'medico' | 'recepcion' | 'cocinero' | 'fisio' | 'entrenador_fisico';

type ToastType = 'ok' | 'warn' | 'error';
type Toast = { id: number; type: ToastType; title: string; msg?: string };

type FontSizeKey = 'sm' | 'md' | 'lg';
type ThemeKey = 'servimel-dark' | 'high-contrast';
type NotifChannel = 'interno' | 'email' | 'ambos';

type IntervalKey = '4h' | '6h' | '8h' | '12h';

type UiPrefs = {
  compact: boolean;
  animations: boolean;
  fontSize: FontSizeKey;
  theme: ThemeKey;
};

type ClinicalConfig = {
  vitalsInterval: IntervalKey;
  spo2Alert: number;
  feverAlert: number;
  painAlert: number;
  autoHistory: boolean;
};

type NotifConfig = {
  criticalAlerts: boolean;
  lateMeds: boolean;
  dailySummary: boolean;
  channel: NotifChannel;
  email: string;
};

type PermissionRow = {
  key: string;
  label: string;
  allowed: boolean;
};

// API envelope
type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string; details?: any } };
type ApiEnvelope<T> = ApiOk<T> | ApiFail;

// /auth/me tolerante
type MeApi = {
  id?: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  role?: Role;
};

// Ajustes API (backend real /settings/me flat + compat viejo)
type SettingsApi = {
  uiPrefs?: Partial<UiPrefs>;
  clinicalConfig?: Partial<ClinicalConfig>;
  notifConfig?: Partial<NotifConfig>;
  role?: Role;
  permissions?: Array<Partial<PermissionRow>>;

  // ✅ backend real (/settings/me)
  theme?: string;           // 'dark' | 'light' | 'dim'
  high_contrast?: boolean;
  compact_mode?: boolean;
  animations?: boolean;
  dna_opacity?: number;
};

@Component({
  selector: 'app-ajustes-page',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule, HttpClientModule],
  templateUrl: './ajustes.page.html',
  styleUrls: ['./ajustes.page.scss']
})
export class AjustesPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('pageRoot', { static: true }) pageRoot!: ElementRef<HTMLElement>;

  private isBrowser = false;

  // ✅ BaseUrl limpio (sin candidates /api para evitar 404 extra)
  // Setealo bien: "http://localhost:3000" o "http://localhost:3000/api"
  private readonly API = String(API_CONFIG.baseUrl || '').replace(/\/$/, '');

  loading = false;
  lastError: string | null = null;

  role: Role = 'enfermeria';

  permissions: PermissionRow[] = [
    { key: 'residentes_view', label: 'Ver residentes', allowed: true },
    { key: 'residentes_edit', label: 'Editar residentes', allowed: false },
    { key: 'enfermeria_write', label: 'Registrar signos/medicación/observaciones', allowed: true },
    { key: 'historial_view', label: 'Ver historial clínico', allowed: true },
    { key: 'roles_manage', label: 'Administrar roles', allowed: false },
    { key: 'backup_manage', label: 'Exportar/Importar datos', allowed: false }
  ];

  public roleLabel(r: Role): string {
    switch (r) {
      case 'admin': return 'Administrador';
      case 'enfermeria': return 'Enfermería';
      case 'medico': return 'Médico';
      case 'cocinero': return 'Cocinero';
      case 'fisio': return 'Fisioterapia';
      case 'entrenador_fisico': return 'Entrenador físico';
      case 'recepcion': return 'Recepción';
    }
  }

  private LS_KEY = 'servimel_settings_v1';

  uiPrefs: UiPrefs = {
    compact: false,
    animations: true,
    fontSize: 'md',
    theme: 'servimel-dark'
  };

  clinicalConfig: ClinicalConfig = {
    vitalsInterval: '6h',
    spo2Alert: 92,
    feverAlert: 38.0,
    painAlert: 7,
    autoHistory: true
  };

  notifConfig: NotifConfig = {
    criticalAlerts: true,
    lateMeds: true,
    dailySummary: false,
    channel: 'interno',
    email: 'notificaciones@servimel.local'
  };

  // Forms
  accountForm!: FormGroup<{
    nombre: FormControl<string>;
    apellido: FormControl<string>;
    email: FormControl<string>;
    cerrarOtros: FormControl<boolean>;
  }>;

  passwordForm!: FormGroup<{
    actual: FormControl<string>;
    nueva: FormControl<string>;
    confirmar: FormControl<string>;
  }>;

  uiForm!: FormGroup<{
    compact: FormControl<boolean>;
    animations: FormControl<boolean>;
    fontSize: FormControl<FontSizeKey>;
    theme: FormControl<ThemeKey>;
  }>;

  clinicalForm!: FormGroup<{
    vitalsInterval: FormControl<IntervalKey>;
    spo2Alert: FormControl<number | null>;
    feverAlert: FormControl<number | null>;
    painAlert: FormControl<number | null>;
    autoHistory: FormControl<boolean>;
  }>;

  notifForm!: FormGroup<{
    criticalAlerts: FormControl<boolean>;
    lateMeds: FormControl<boolean>;
    dailySummary: FormControl<boolean>;
    channel: FormControl<NotifChannel>;
    email: FormControl<string>;
  }>;

  // Toasts
  toasts: Toast[] = [];
  private toastSeq = 100;

  // Restore modal
  showRestoreModal = false;
  modalAnimating = false;

  // GSAP
  private gsapCtx?: ReturnType<typeof gsap.context>;
  private subs = new Subscription();

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private http: HttpClient,
    private uiPrefsSvc: UiPrefsService,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);

    this.hydrateFromStorage();     // uiPrefs/clinical/notif
    this.buildForms();
    this.hydrateAccountFromStorage(); // nombre/apellido/email
    this.pushUiPrefsToService(false);
    this.applyUiPrefsToDom(false);
  }

  async ngOnInit(): Promise<void> {
    // ✅ AUTH: si no hay token, no dejes acceder a Ajustes
    if (this.isBrowser && !this.getToken()) {
      await this.router.navigateByUrl('/login').catch(() => this.router.navigateByUrl('/'));
      return;
    }

    // ✅ Backend opcional: SOLO si hay API configurada (evita errores cuando no hay server)
    if (this.backendEnabled()) {
      await this.loadFromBackend();
    }
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    if (this.prefersReducedMotion()) return;
    if (!this.uiPrefs.animations) return;

    this.gsapCtx = gsap.context(() => {
      const root = this.pageRoot.nativeElement;

      const headerEls = root.querySelectorAll<HTMLElement>('.js-anim-header');
      const cards = root.querySelectorAll<HTMLElement>('.js-anim-card');
      const rows = root.querySelectorAll<HTMLElement>('.js-anim-row');
      const glows = root.querySelectorAll<HTMLElement>('.js-anim-glow');

      gsap.set([headerEls, cards, rows], { opacity: 0, y: 14 });
      gsap.set(glows, { opacity: 0, scale: 0.98 });

      const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });

      tl.to(headerEls, { opacity: 1, y: 0, duration: 0.55, stagger: 0.06 })
        .to(cards, { opacity: 1, y: 0, duration: 0.55, stagger: 0.08 }, '-=0.15')
        .to(rows, { opacity: 1, y: 0, duration: 0.35, stagger: 0.03 }, '-=0.20')
        .to(glows, { opacity: 1, scale: 1, duration: 0.45, stagger: 0.08 }, '-=0.15');
    }, this.pageRoot.nativeElement);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.gsapCtx?.revert();
  }

  // ============================================================
  // ✅ TEMPLATE HELPERS (públicos)
  // ============================================================
  public isInvalid(form: FormGroup, controlName: string): boolean {
    const c = form.get(controlName);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  public permissionChipClass(allowed: boolean): string {
    return allowed ? 'chip chip--ok' : 'chip chip--muted';
  }

  public permissionChipLabel(allowed: boolean): string {
    return allowed ? 'Permitido' : 'Restringido';
  }

  // ============================================================
  // Builders
  // ============================================================
  private buildForms(): void {
    this.accountForm = this.fb.group({
      nombre: this.fb.control<string>('—', { nonNullable: true, validators: [Validators.required, Validators.maxLength(40)] }),
      apellido: this.fb.control<string>('—', { nonNullable: true, validators: [Validators.required, Validators.maxLength(40)] }),
      email: this.fb.control<string>('—', { nonNullable: true, validators: [Validators.required, Validators.email, Validators.maxLength(80)] }),
      cerrarOtros: this.fb.control<boolean>(false, { nonNullable: true })
    });

    this.passwordForm = this.fb.group(
      {
        actual: this.fb.control<string>('', { nonNullable: true, validators: [Validators.required, Validators.minLength(6)] }),
        nueva: this.fb.control<string>('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] }),
        confirmar: this.fb.control<string>('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] })
      },
      { validators: [this.passwordsMatchValidator] }
    );

    this.uiForm = this.fb.group({
      compact: this.fb.control<boolean>(this.uiPrefs.compact, { nonNullable: true }),
      animations: this.fb.control<boolean>(this.uiPrefs.animations, { nonNullable: true }),
      fontSize: this.fb.control<FontSizeKey>(this.uiPrefs.fontSize, { nonNullable: true, validators: [Validators.required] }),
      theme: this.fb.control<ThemeKey>(this.uiPrefs.theme, { nonNullable: true, validators: [Validators.required] })
    });

    this.clinicalForm = this.fb.group({
      vitalsInterval: this.fb.control<IntervalKey>(this.clinicalConfig.vitalsInterval, { nonNullable: true, validators: [Validators.required] }),
      spo2Alert: this.fb.control<number | null>(this.clinicalConfig.spo2Alert, { validators: [Validators.required, Validators.min(50), Validators.max(100)] }),
      feverAlert: this.fb.control<number | null>(this.clinicalConfig.feverAlert, { validators: [Validators.required, Validators.min(35), Validators.max(42)] }),
      painAlert: this.fb.control<number | null>(this.clinicalConfig.painAlert, { validators: [Validators.required, Validators.min(0), Validators.max(10)] }),
      autoHistory: this.fb.control<boolean>(this.clinicalConfig.autoHistory, { nonNullable: true })
    });

    this.notifForm = this.fb.group({
      criticalAlerts: this.fb.control<boolean>(this.notifConfig.criticalAlerts, { nonNullable: true }),
      lateMeds: this.fb.control<boolean>(this.notifConfig.lateMeds, { nonNullable: true }),
      dailySummary: this.fb.control<boolean>(this.notifConfig.dailySummary, { nonNullable: true }),
      channel: this.fb.control<NotifChannel>(this.notifConfig.channel, { nonNullable: true, validators: [Validators.required] }),
      email: this.fb.control<string>(this.notifConfig.email, { nonNullable: true, validators: [Validators.required, Validators.email, Validators.maxLength(80)] })
    });

    // ✅ Live apply UI prefs + persist local + push to UiPrefsService
    this.subs.add(
      this.uiForm.valueChanges.subscribe(v => {
        this.uiPrefs = {
          compact: !!v.compact,
          animations: !!v.animations,
          fontSize: (v.fontSize || 'md') as FontSizeKey,
          theme: (v.theme || 'servimel-dark') as ThemeKey
        };

        this.persistToStorage();
        this.pushUiPrefsToService(true);
        this.applyUiPrefsToDom(true);

        if (this.isBrowser && !this.uiPrefs.animations) {
          this.gsapCtx?.revert();
          this.gsapCtx = undefined;
        }
      })
    );
  }

  // ============================================================
  // ✅ MÉTODOS QUE TU HTML LLAMA (públicos)
  // ============================================================
  public async guardarCambiosGlobal(): Promise<void> {
    const allValid = [
      this.accountForm.valid,
      this.passwordForm.valid || this.isPasswordEmpty(),
      this.uiForm.valid,
      this.clinicalForm.valid,
      this.notifForm.valid
    ].every(Boolean);

    if (!allValid) {
      this.toast('error', 'Revisá los campos', 'Hay validaciones pendientes en Ajustes.');
      this.bumpInvalid();
      return;
    }

    this.syncModelsFromForms();
    this.persistToStorage();
    this.pushUiPrefsToService(false);
    this.applyUiPrefsToDom(false);

    // ✅ Backend limpio (solo /settings/me). Si falla -> queda local
    if (this.backendEnabled()) {
      try {
        await this.saveSettingsToBackend();
        this.toast('ok', 'Cambios guardados', 'Preferencias aplicadas.');
        this.sparkPulse('.js-save-pulse');
        return;
      } catch (e) {
        this.lastError = this.humanHttpError(e);
        this.toast('warn', 'Guardado local', 'No se pudo guardar en el backend. Quedó en tu navegador.');
        this.sparkPulse('.js-save-pulse');
        return;
      }
    }

    // mock only
    this.toast('ok', 'Cambios guardados', 'Configuración aplicada (mock, local).');
    this.sparkPulse('.js-save-pulse');
  }

  public volver(): void {
    this.router.navigateByUrl('/dashboard').catch(() => this.router.navigateByUrl('/residentes'));
  }

  // ✅ MOCK (sin requests): evita 404/401 hasta que exista endpoint real
  public actualizarPerfil(): void {
    this.touchAll(this.accountForm);
    if (this.accountForm.invalid) {
      this.toast('error', 'Perfil incompleto', 'Completá nombre, apellido y email.');
      this.bumpInvalid();
      return;
    }

    // guardado local (mock)
    const v = this.accountForm.getRawValue();
    this.persistAccountToStorage(v.nombre, v.apellido, v.email);
    this.toast('ok', 'Perfil actualizado', 'Guardado local (mock).');
    this.sparkPulse('.js-profile-pulse');
  }

  // ✅ MOCK (sin requests)
  public cambiarPassword(): void {
    this.touchAll(this.passwordForm);
    if (this.passwordForm.invalid) {
      const msg = this.passwordForm.hasError('passwordsMismatch')
        ? 'La confirmación no coincide.'
        : 'Verificá los campos (mínimo 8 caracteres).';
      this.toast('error', 'No se pudo cambiar', msg);
      this.bumpInvalid();
      return;
    }

    this.toast('ok', 'Contraseña actualizada', 'Cambio simulado (mock).');
    this.passwordForm.reset({ actual: '', nueva: '', confirmar: '' });
    this.sparkPulse('.js-pass-pulse');
  }

  // ✅ MOCK (sin requests)
  public guardarClinica(): void {
    this.touchAll(this.clinicalForm);
    if (this.clinicalForm.invalid) {
      this.toast('error', 'Config clínica inválida', 'Revisá umbrales e intervalos.');
      this.bumpInvalid();
      return;
    }

    this.syncModelsFromForms();
    this.persistToStorage();
    this.toast('ok', 'Config clínica guardada', 'Guardado local (mock).');
    this.sparkPulse('.js-clinic-pulse');
  }

  // ✅ MOCK (sin requests)
  public guardarNotificaciones(): void {
    this.touchAll(this.notifForm);
    if (this.notifForm.invalid) {
      this.toast('error', 'Notificaciones inválidas', 'Revisá email y canal.');
      this.bumpInvalid();
      return;
    }

    this.syncModelsFromForms();
    this.persistToStorage();
    this.toast('ok', 'Notificaciones guardadas', 'Guardado local (mock).');
    this.sparkPulse('.js-notif-pulse');
  }

  // ✅ MOCK (sin requests)
  public exportarDatos(): void {
    this.toast('warn', 'Exportación', 'Función mock. Falta endpoint de exportación en backend.');
    this.sparkPulse('.js-backup-pulse');
  }

  public importarDatos(): void {
    this.toast('warn', 'Importar', 'Acá iría un selector de archivo (UI).');
    this.sparkPulse('.js-backup-pulse');
  }

  public openRestoreDefaults(): void {
    this.showRestoreModal = true;
    this.modalAnimating = true;
    this.modalEnter();
  }

  public cancelarRestore(): void {
    this.modalLeave(() => {
      this.showRestoreModal = false;
      this.modalAnimating = false;
    });
  }

  public async confirmarRestore(): Promise<void> {
    this.restoreDefaults();

    this.modalLeave(async () => {
      this.showRestoreModal = false;
      this.modalAnimating = false;

      // backend limpio (solo /settings/me)
      if (this.backendEnabled()) {
        try {
          await this.saveSettingsToBackend();
          this.toast('ok', 'Restaurado', 'Valores por defecto aplicados.');
        } catch {
          this.toast('warn', 'Restaurado local', 'Valores aplicados en el navegador (backend no disponible).');
        }
      } else {
        this.toast('ok', 'Restaurado', 'Valores por defecto aplicados (mock).');
      }

      this.sparkPulse('.js-save-pulse');
    });
  }

  // ============================================================
  // Backend (limpio): SOLO /auth/me y /settings/me
  // ============================================================
  private backendEnabled(): boolean {
    // si no hay baseUrl, NO hacemos requests (0 errores)
    if (!this.isBrowser) return false;
    if (!this.API || !this.API.trim()) return false;
    if (!this.getToken()) return false;
    return true;
  }

  private apiUrl(path: string): string {
    const p = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
    return this.API ? `${this.API}${p}` : p;
  }

  private async loadFromBackend(): Promise<void> {
    this.loading = true;
    this.lastError = null;

    try {
      const me = await this.fetchMeOnce();
      this.applyMeToForm(me);

      const st = await this.fetchSettingsOnce();
      this.applySettings(st);

      this.pushUiPrefsToService(false);
      this.applyUiPrefsToDom(false);
    } catch (e) {
      this.lastError = this.humanHttpError(e);
      // queda en localStorage (mock) sin romper
    } finally {
      this.loading = false;
    }
  }

  private async fetchMeOnce(): Promise<MeApi | null> {
    const raw = await firstValueFrom(
      this.http.get<ApiEnvelope<MeApi> | MeApi>(this.apiUrl('/auth/me'), this.requestOpts())
    );
    return this.unwrap<MeApi>(raw) ?? null;
  }

  private async fetchSettingsOnce(): Promise<SettingsApi | null> {
    const raw = await firstValueFrom(
      this.http.get<ApiEnvelope<SettingsApi> | SettingsApi>(this.apiUrl('/settings/me'), this.requestOpts())
    );
    return this.unwrap<SettingsApi>(raw) ?? null;
  }

  private async saveSettingsToBackend(): Promise<void> {
    const backendPayload = this.mapUiPrefsToBackendPayload(this.uiPrefs);
    const raw = await firstValueFrom(
      this.http.put<ApiEnvelope<any> | any>(this.apiUrl('/settings/me'), backendPayload, this.requestOpts())
    );
    this.unwrap<any>(raw);
  }

  private applyMeToForm(me: MeApi | null): void {
    if (!me) return;

    const first = (me.first_name ?? '').trim();
    const last = (me.last_name ?? '').trim();
    const email = (me.email ?? '').trim();

    if (me.role) this.role = me.role;

    if (first || last || email) {
      this.accountForm.patchValue(
        {
          nombre: first || this.accountForm.controls.nombre.value,
          apellido: last || this.accountForm.controls.apellido.value,
          email: email || this.accountForm.controls.email.value
        },
        { emitEvent: false }
      );

      this.persistAccountToStorage(
        this.accountForm.controls.nombre.value,
        this.accountForm.controls.apellido.value,
        this.accountForm.controls.email.value
      );
    }
  }

  private applySettings(st: SettingsApi | null): void {
    if (!st) return;

    if (st.role) this.role = st.role;

    // compat viejo (uiPrefs anidado)
    if (st.uiPrefs) {
      this.uiPrefs = { ...this.uiPrefs, ...st.uiPrefs } as UiPrefs;
    }

    // backend real flat (/settings/me)
    if (
      st.theme !== undefined ||
      st.high_contrast !== undefined ||
      st.compact_mode !== undefined ||
      st.animations !== undefined
    ) {
      const merged = this.mapBackendSettingsToUiPrefs(st);
      this.uiPrefs = { ...this.uiPrefs, ...merged } as UiPrefs;
    }

    if (st.clinicalConfig) {
      this.clinicalConfig = { ...this.clinicalConfig, ...st.clinicalConfig } as ClinicalConfig;
      this.clinicalForm.patchValue(this.clinicalConfig, { emitEvent: false });
    }

    if (st.notifConfig) {
      this.notifConfig = { ...this.notifConfig, ...st.notifConfig } as NotifConfig;
      this.notifForm.patchValue(this.notifConfig, { emitEvent: false });
    }

    if (Array.isArray(st.permissions) && st.permissions.length) {
      const mapByKey = new Map<string, PermissionRow>();
      for (const p of this.permissions) mapByKey.set(p.key, { ...p });

      for (const p of st.permissions) {
        const key = String(p.key ?? '').trim();
        if (!key) continue;

        const prev = mapByKey.get(key);
        mapByKey.set(key, {
          key,
          label: String(p.label ?? prev?.label ?? key),
          allowed: !!(p.allowed ?? prev?.allowed ?? false)
        });
      }

      this.permissions = Array.from(mapByKey.values());
    }

    // forms
    this.uiForm.patchValue(this.uiPrefs, { emitEvent: false });
    this.persistToStorage();
  }

  // ============================================================
  // ✅ MAPEO UI <-> BACKEND (/settings/me)
  // ============================================================
  private mapUiPrefsToBackendPayload(ui: UiPrefs): any {
    const isHigh = ui.theme === 'high-contrast';
    return {
      theme: 'dark',
      high_contrast: isHigh,
      compact_mode: !!ui.compact,
      animations: !!ui.animations
      // dna_opacity opcional -> no se maneja desde esta UI todavía
    };
  }

  private mapBackendSettingsToUiPrefs(st: SettingsApi): Partial<UiPrefs> {
    const hc = st.high_contrast === true;
    const compact = st.compact_mode === true;
    const anim = st.animations !== undefined ? !!st.animations : this.uiPrefs.animations;

    return {
      compact,
      animations: anim,
      theme: hc ? 'high-contrast' : 'servimel-dark'
      // fontSize sigue local
    };
  }

  // ============================================================
  // Sync models from forms
  // ============================================================
  private syncModelsFromForms(): void {
    const ui = this.uiForm.getRawValue();
    this.uiPrefs = {
      compact: !!ui.compact,
      animations: !!ui.animations,
      fontSize: ui.fontSize,
      theme: ui.theme
    };

    const cl = this.clinicalForm.getRawValue();
    this.clinicalConfig = {
      vitalsInterval: cl.vitalsInterval,
      spo2Alert: Number(cl.spo2Alert),
      feverAlert: Number(cl.feverAlert),
      painAlert: Number(cl.painAlert),
      autoHistory: !!cl.autoHistory
    };

    const nf = this.notifForm.getRawValue();
    this.notifConfig = {
      criticalAlerts: !!nf.criticalAlerts,
      lateMeds: !!nf.lateMeds,
      dailySummary: !!nf.dailySummary,
      channel: nf.channel,
      email: nf.email.trim()
    };
  }

  // ============================================================
  // UiPrefsService bridge (para que el resto de páginas reaccione en vivo)
  // ============================================================
  private pushUiPrefsToService(saveAlso: boolean): void {
    // mapeo: ThemeKey -> hi_contrast
    const hi = this.uiPrefs.theme === 'high-contrast';

    try {
      this.uiPrefsSvc.setAnimations(!!this.uiPrefs.animations);
      this.uiPrefsSvc.setCompact(!!this.uiPrefs.compact);
      this.uiPrefsSvc.setHiContrast(!!hi);

      // aplica (clases/vars globales)
      this.uiPrefsSvc.apply(true);

      if (saveAlso) this.uiPrefsSvc.save();
    } catch {
      // si el service cambia, igual queda en local + DOM
    }
  }

  // ============================================================
  // Auth
  // ============================================================
  private getToken(): string | null {
    if (!this.isBrowser) return null;

    const keys = [
      'servimel_token',
      'servimel_token_v1',
      'auth_token',
      'token',
      'jwt',
      'access_token',
      'accessToken',
      'refresh_token',
      'refreshToken'
    ];

    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v && v.trim()) return v.trim();
    }

    try {
      const raw = localStorage.getItem('auth');
      if (raw) {
        const parsed = JSON.parse(raw);
        const t = parsed?.token || parsed?.accessToken || parsed?.access_token;
        if (t && String(t).trim()) return String(t).trim();
      }
    } catch {
      // ignore
    }

    return null;
  }

  private authHeaders(): HttpHeaders {
    const t = this.getToken();
    if (!t) return new HttpHeaders();
    return new HttpHeaders({ Authorization: `Bearer ${t}` });
  }

  private requestOpts(): { headers: HttpHeaders; withCredentials: boolean } {
    const headers = this.authHeaders();
    const token = this.getToken();
    return { headers, withCredentials: !token };
  }

  // Helpers
  private unwrap<T>(raw: T | ApiEnvelope<T>): T {
    const r: any = raw as any;
    if (r && typeof r === 'object' && 'ok' in r) {
      if (r.ok === true) return r.data as T;
      throw new Error(r?.error?.message || 'API error');
    }
    return raw as T;
  }

  private humanHttpError(e: unknown): string {
    const err = e as HttpErrorResponse;
    const msg = (err as any)?.error?.error?.message || (err as any)?.error?.message;
    if (msg) return String(msg);
    if (err?.status) return `HTTP ${err.status} — ${err.statusText || 'Error'}`;
    return 'Error de red/servidor.';
  }

  // ============================================================
  // Persistence
  // ============================================================
  private hydrateFromStorage(): void {
    if (!this.isBrowser) return;

    try {
      const raw = window.localStorage.getItem(this.LS_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as {
        uiPrefs?: Partial<UiPrefs>;
        clinicalConfig?: Partial<ClinicalConfig>;
        notifConfig?: Partial<NotifConfig>;
      };

      if (parsed.uiPrefs) this.uiPrefs = { ...this.uiPrefs, ...parsed.uiPrefs } as UiPrefs;
      if (parsed.clinicalConfig) this.clinicalConfig = { ...this.clinicalConfig, ...parsed.clinicalConfig } as ClinicalConfig;
      if (parsed.notifConfig) this.notifConfig = { ...this.notifConfig, ...parsed.notifConfig } as NotifConfig;
    } catch {
      // ignore
    }
  }

  private persistToStorage(): void {
    if (!this.isBrowser) return;
    try {
      window.localStorage.setItem(
        this.LS_KEY,
        JSON.stringify({
          uiPrefs: this.uiPrefs,
          clinicalConfig: this.clinicalConfig,
          notifConfig: this.notifConfig
        })
      );
    } catch {
      // ignore
    }
  }

  private hydrateAccountFromStorage(): void {
    if (!this.isBrowser) return;

    const tryParse = (raw: string | null): any => {
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    };

    const profile = tryParse(localStorage.getItem('servimel_profile_v1'));
    const auth = tryParse(localStorage.getItem('auth'));
    const user = tryParse(localStorage.getItem('user')) || tryParse(localStorage.getItem('servimel_user_v1'));

    const first =
      (profile?.first_name ?? profile?.nombre ?? auth?.user?.first_name ?? user?.first_name ?? user?.nombre ?? '') as string;
    const last =
      (profile?.last_name ?? profile?.apellido ?? auth?.user?.last_name ?? user?.last_name ?? user?.apellido ?? '') as string;
    const email =
      (profile?.email ?? auth?.user?.email ?? user?.email ?? '') as string;

    const f = String(first || '').trim();
    const l = String(last || '').trim();
    const e = String(email || '').trim();

    if (f || l || e) {
      this.accountForm.patchValue(
        {
          nombre: f || this.accountForm.controls.nombre.value,
          apellido: l || this.accountForm.controls.apellido.value,
          email: e || this.accountForm.controls.email.value
        },
        { emitEvent: false }
      );
    }
  }

  private persistAccountToStorage(nombre: string, apellido: string, email: string): void {
    if (!this.isBrowser) return;

    // guardamos mínimo en auth/user por compat, sin romper nada
    try {
      const raw = localStorage.getItem('auth');
      if (raw) {
        const parsed = JSON.parse(raw);
        parsed.user = parsed.user || {};
        parsed.user.first_name = nombre;
        parsed.user.last_name = apellido;
        parsed.user.email = email;
        localStorage.setItem('auth', JSON.stringify(parsed));
      }
    } catch {
      // ignore
    }

    try {
      const profRaw = localStorage.getItem('servimel_profile_v1');
      const prof = profRaw ? JSON.parse(profRaw) : {};
      prof.first_name = nombre;
      prof.last_name = apellido;
      prof.email = email;
      localStorage.setItem('servimel_profile_v1', JSON.stringify(prof));
    } catch {
      // ignore
    }
  }

  private restoreDefaults(): void {
    this.uiPrefs = { compact: false, animations: true, fontSize: 'md', theme: 'servimel-dark' };
    this.clinicalConfig = { vitalsInterval: '6h', spo2Alert: 92, feverAlert: 38.0, painAlert: 7, autoHistory: true };
    this.notifConfig = { criticalAlerts: true, lateMeds: true, dailySummary: false, channel: 'interno', email: 'notificaciones@servimel.local' };

    this.uiForm.patchValue(this.uiPrefs, { emitEvent: true });
    this.clinicalForm.patchValue(this.clinicalConfig, { emitEvent: false });
    this.notifForm.patchValue(this.notifConfig, { emitEvent: false });
    this.passwordForm.reset({ actual: '', nueva: '', confirmar: '' });

    this.persistToStorage();
    this.pushUiPrefsToService(true);
    this.applyUiPrefsToDom(false);
  }

  // ============================================================
  // DOM apply (tema / font / compact) — mock real
  // ============================================================
  private applyUiPrefsToDom(withFx: boolean): void {
    if (!this.isBrowser) return;

    const root = document.documentElement;
    root.setAttribute('data-servimel-theme', this.uiPrefs.theme);
    root.setAttribute('data-servimel-font', this.uiPrefs.fontSize);
    root.setAttribute('data-servimel-compact', this.uiPrefs.compact ? '1' : '0');
    root.setAttribute('data-servimel-anim', this.uiPrefs.animations ? '1' : '0');

    if (withFx && !this.prefersReducedMotion() && this.uiPrefs.animations) {
      this.sparkPulse('.js-preview-pulse');
    }
  }

  private prefersReducedMotion(): boolean {
    if (!this.isBrowser) return true;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  }

  // ============================================================
  // Visual helpers
  // ============================================================
  private sparkPulse(selector: string): void {
    if (!this.isBrowser) return;
    if (this.prefersReducedMotion()) return;
    if (!this.uiPrefs.animations) return;

    const rootEl = this.pageRoot?.nativeElement;
    if (!rootEl) return;

    const el = rootEl.querySelector<HTMLElement>(selector);
    if (!el) return;

    gsap.fromTo(
      el,
      { filter: 'brightness(1)', boxShadow: '0 14px 44px rgba(0,0,0,.32)' },
      {
        duration: 0.55,
        keyframes: [
          { filter: 'brightness(1.18)', boxShadow: '0 0 0 7px rgba(182,203,51,.10), 0 26px 80px rgba(0,0,0,.35)' },
          { filter: 'brightness(1)', boxShadow: '0 14px 44px rgba(0,0,0,.32)' }
        ],
        ease: 'power2.out'
      }
    );
  }

  private bumpInvalid(): void {
    if (!this.isBrowser) return;
    if (this.prefersReducedMotion()) return;
    if (!this.uiPrefs.animations) return;

    const rootEl = this.pageRoot?.nativeElement;
    if (!rootEl) return;

    const invalids = rootEl.querySelectorAll<HTMLElement>('.input--invalid');
    if (!invalids.length) return;

    gsap.fromTo(invalids, { x: 0 }, { x: 6, duration: 0.06, yoyo: true, repeat: 5, ease: 'power1.inOut' });
  }

  private modalEnter(): void {
    if (!this.isBrowser) return;
    if (this.prefersReducedMotion() || !this.uiPrefs.animations) {
      this.modalAnimating = false;
      return;
    }

    const root = this.pageRoot.nativeElement;
    const overlay = root.querySelector<HTMLElement>('.modalOverlay');
    const modal = root.querySelector<HTMLElement>('.modal');
    if (!overlay || !modal) { this.modalAnimating = false; return; }

    gsap.set(overlay, { opacity: 0 });
    gsap.set(modal, { opacity: 0, y: 12, scale: 0.98 });

    gsap.timeline({
      defaults: { ease: 'power2.out' },
      onComplete: () => { this.modalAnimating = false; }
    })
      .to(overlay, { opacity: 1, duration: 0.18 })
      .to(modal, { opacity: 1, y: 0, scale: 1, duration: 0.22 }, '-=0.10');
  }

  private modalLeave(done: () => void): void {
    if (!this.isBrowser) { done(); return; }
    if (this.prefersReducedMotion() || !this.uiPrefs.animations) { done(); return; }

    const root = this.pageRoot.nativeElement;
    const overlay = root.querySelector<HTMLElement>('.modalOverlay');
    const modal = root.querySelector<HTMLElement>('.modal');
    if (!overlay || !modal) { done(); return; }

    gsap.timeline({ defaults: { ease: 'power2.inOut' }, onComplete: done })
      .to(modal, { opacity: 0, y: 10, scale: 0.985, duration: 0.18 })
      .to(overlay, { opacity: 0, duration: 0.16 }, '-=0.08');
  }

  // ============================================================
  // Toasts
  // ============================================================
  private toast(type: ToastType, title: string, msg?: string): void {
    const t: Toast = { id: ++this.toastSeq, type, title, msg };
    this.toasts = [t, ...this.toasts].slice(0, 4);

    if (this.isBrowser) {
      window.setTimeout(() => this.cerrarToast(t.id), 3200);
    }

    if (this.isBrowser && !this.prefersReducedMotion() && this.uiPrefs.animations) {
      const stack = this.pageRoot?.nativeElement?.querySelector<HTMLElement>('.toast-stack');
      if (stack) {
        gsap.fromTo(stack, { y: -6, opacity: 0.92 }, { y: 0, opacity: 1, duration: 0.25, ease: 'power2.out' });
      }
    }
  }

  public cerrarToast(id: number): void {
    this.toasts = this.toasts.filter(x => x.id !== id);
  }

  // ============================================================
  // Validators
  // ============================================================
  private passwordsMatchValidator(group: AbstractControl) {
    const g = group as FormGroup;
    const n = g.get('nueva')?.value;
    const c = g.get('confirmar')?.value;
    if (!n || !c) return null;
    return n === c ? null : { passwordsMismatch: true };
  }

  private isPasswordEmpty(): boolean {
    const v = this.passwordForm.getRawValue();
    return !v.actual && !v.nueva && !v.confirmar;
  }

  private touchAll(form: FormGroup): void {
    Object.values(form.controls).forEach((c: AbstractControl) => c.markAsTouched());
  }
}
