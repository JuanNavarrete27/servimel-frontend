// src/app/pages/admin-funcionarios/admin-funcionarios.page.ts
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, Inject, OnDestroy, PLATFORM_ID } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom, Subscription } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { API_CONFIG } from '../../core/config/api.config';

type CreateUserPayload = {
  email: string;
  password: string;
  role: string;
  first_name: string;
  last_name?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
};

const ROLE_OPTIONS = [
  { value: 'enfermeria', label: 'Enfermería (solo lectura)' },
  { value: 'medico', label: 'Médico' },
  { value: 'cocinero', label: 'Cocinero' },
  { value: 'ed_fisico', label: 'Ed. Físico' },        // ✅ underscore (más compatible)
  { value: 'fisioterapeuta', label: 'Fisioterapeuta' },
  { value: 'admin', label: 'admin' },
];

@Component({
  selector: 'app-admin-funcionarios-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './admin-funcionarios.page.html',
  styleUrls: ['./admin-funcionarios.page.scss'],
})
export class AdminFuncionariosPage implements OnDestroy {
  // ✅ 8 caracteres mínimo (evita VALIDATION_ERROR típico)
  readonly DEFAULT_PASSWORD = '12345678';
  readonly roleOptions = ROLE_OPTIONS;

  isAdmin = false;
  loading = false;
  okMsg = '';
  errMsg = '';

  form: ReturnType<FormBuilder['group']>;
  private sub?: Subscription;

  private readonly apiBase = this.normalizeBaseUrl(API_CONFIG?.baseUrl);

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private auth: AuthService,
    @Inject(PLATFORM_ID) private platformId: object
  ) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email, Validators.maxLength(190)]],
      nombre: ['', [Validators.required, Validators.maxLength(120)]],
      edad: [null as number | null, [Validators.required, Validators.min(16), Validators.max(110)]],
      rol: ['enfermeria', [Validators.required]],
    });

    this.sub = this.auth.user$?.subscribe((u: any) => {
      const role = String(u?.role ?? u?.rol ?? '').toLowerCase();
      this.isAdmin = role === 'admin';
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  get f() {
    return this.form.controls as any;
  }

  private normalizeBaseUrl(v: any): string {
    const s = String(v ?? '').trim();
    if (!s) return '';
    return s.endsWith('/') ? s.slice(0, -1) : s;
  }

  private url(path: string): string {
    if (!this.apiBase) return path;
    return `${this.apiBase}${path.startsWith('/') ? path : `/${path}`}`;
  }

  // ✅ normaliza roles (por si te llega con guiones o alias)
  private normalizeRole(raw: any): string {
    const r = String(raw ?? '').trim().toLowerCase();

    // casos comunes
    if (r === 'ed-fisico' || r === 'ed fisico' || r === 'edfisico') return 'ed_fisico';
    if (r === 'enfermería') return 'enfermeria';

    // fallback: guiones -> underscore
    return r.replace(/-/g, '_');
  }

  async crearFuncionario() {
    this.okMsg = '';
    this.errMsg = '';

    if (!this.isAdmin) {
      this.errMsg = 'Acceso denegado: solo ADMIN puede crear funcionarios.';
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errMsg = 'Revisá los campos.';
      return;
    }

    if (!isPlatformBrowser(this.platformId)) return;

    this.loading = true;

    const email = String(this.f.email.value || '').trim().toLowerCase();
    const nombre = String(this.f.nombre.value || '').trim();
    const rol = this.normalizeRole(this.f.rol.value);

    // ⚠️ edad todavía NO se guarda en tu backend actual
    const edad = this.f.edad.value;

    const payload: CreateUserPayload = {
      email,
      password: this.DEFAULT_PASSWORD,
      role: rol,
      first_name: nombre,
      last_name: null,
      phone: null,
      avatar_url: null,
    };

    try {
      const endpoint = this.url('/users');
      const res = await firstValueFrom(this.http.post<any>(endpoint, payload));

      this.okMsg =
        `Usuario creado: ${res?.data?.email || email} (rol: ${rol}). ` +
        `Contraseña por defecto: ${this.DEFAULT_PASSWORD}`;

      this.form.reset({
        email: '',
        nombre: '',
        edad: null,
        rol: rol || 'enfermeria',
      });
    } catch (e: any) {
      const msg = String(e?.error?.message || e?.message || 'Error al crear usuario');
      this.errMsg = msg;
    } finally {
      this.loading = false;
    }
  }
}
