import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable } from 'rxjs';

export type UiFont = 'sm' | 'md' | 'lg';
export type UiTheme = 'servimel-dark' | 'high-contrast';

export type UiSettings = {
  animations: boolean;
  hi_contrast: boolean;
  compact: boolean;
  dna_opacity: number; // 0.10–0.50
  font?: UiFont;
  theme?: UiTheme;
};

@Injectable({ providedIn: 'root' })
export class UiPrefsService {
  private readonly isBrowser: boolean;

  private readonly LS_SETTINGS = 'servimel_settings_v1';

  private readonly defaults: UiSettings = {
    animations: true,
    hi_contrast: false,
    compact: false,
    dna_opacity: 0.22,
    font: 'md',
    theme: 'servimel-dark'
  };

  private readonly _state = new BehaviorSubject<UiSettings>({ ...this.defaults });

  readonly changes: Observable<UiSettings> = this._state.asObservable();

  get snapshot(): UiSettings {
    return this._state.value;
  }

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  /** ✅ Para APP_INITIALIZER (main.ts) */
  init(): void {
    if (!this.isBrowser) return;
    const loaded = this.load();
    this._state.next(loaded);
    this.apply(false);
  }

  // ============================================================
  // API usada por /perfil
  // ============================================================
  setAnimations(v: boolean): UiSettings {
    const next = this.sanitize({ ...this.snapshot, animations: !!v });
    this._state.next(next);
    this.save();
    return next;
  }

  setHiContrast(v: boolean): UiSettings {
    const nextRaw: UiSettings = { ...this.snapshot, hi_contrast: !!v };

    // ✅ FIX CLAVE:
    // si apagás hi_contrast, NO podés dejar theme en high-contrast
    if (nextRaw.hi_contrast) {
      nextRaw.theme = 'high-contrast';
    } else {
      if (nextRaw.theme === 'high-contrast') nextRaw.theme = 'servimel-dark';
    }

    const next = this.sanitize(nextRaw);
    this._state.next(next);
    this.save();
    return next;
  }

  setCompact(v: boolean): UiSettings {
    const next = this.sanitize({ ...this.snapshot, compact: !!v });
    this._state.next(next);
    this.save();
    return next;
  }

  setDnaOpacity(v: number | string, persist = true): UiSettings {
    const num = Number(v);
    const clamped = Math.min(0.5, Math.max(0.1, Number.isFinite(num) ? num : 0.22));
    const next = this.sanitize({ ...this.snapshot, dna_opacity: clamped });

    this._state.next(next);
    if (persist) this.save();
    return next;
  }

  setFont(font: UiFont): UiSettings {
    const next = this.sanitize({ ...this.snapshot, font });
    this._state.next(next);
    this.save();
    return next;
  }

  setTheme(theme: UiTheme): UiSettings {
    const nextRaw: UiSettings = { ...this.snapshot, theme };

    // ✅ coherencia bidireccional
    if (theme === 'high-contrast') {
      nextRaw.hi_contrast = true;
    } else {
      nextRaw.hi_contrast = false;
    }

    const next = this.sanitize(nextRaw);
    this._state.next(next);
    this.save();
    return next;
  }

  /** ✅ /perfil.page.ts llama this.uiPrefs.apply(true) */
  apply(_withFx: boolean): void {
    if (!this.isBrowser) return;
    this.applyToDom(this.snapshot);
  }

  /** ✅ /perfil.page.ts llama this.uiPrefs.save() */
  save(): void {
    if (!this.isBrowser) return;
    try {
      window.localStorage.setItem(this.LS_SETTINGS, JSON.stringify(this.snapshot));
    } catch {
      // ignore
    }
  }

  // ============================================================
  // Internals
  // ============================================================
  private load(): UiSettings {
    try {
      const raw = window.localStorage.getItem(this.LS_SETTINGS);
      if (!raw) return { ...this.defaults };

      const parsed = JSON.parse(raw) as any;

      const merged: UiSettings = {
        animations: !!(parsed.animations ?? this.defaults.animations),
        hi_contrast: !!(parsed.hi_contrast ?? parsed.hiContrast ?? this.defaults.hi_contrast),
        compact: !!(parsed.compact ?? this.defaults.compact),
        dna_opacity: Number(parsed.dna_opacity ?? parsed.dnaOpacity ?? this.defaults.dna_opacity),
        font: (parsed.font ?? this.defaults.font) as UiFont,
        theme: (parsed.theme ?? this.defaults.theme) as UiTheme
      };

      return this.sanitize(merged);
    } catch {
      return { ...this.defaults };
    }
  }

  private sanitize(s: UiSettings): UiSettings {
    const font: UiFont =
      (s.font === 'sm' || s.font === 'lg' || s.font === 'md') ? s.font : 'md';

    let theme: UiTheme =
      (s.theme === 'high-contrast' || s.theme === 'servimel-dark') ? s.theme : 'servimel-dark';

    const opacity = Math.min(
      0.5,
      Math.max(0.1, Number.isFinite(Number(s.dna_opacity)) ? Number(s.dna_opacity) : 0.22)
    );

    // ✅ coherencia final (a prueba de estados pegados):
    // - si hi_contrast true => theme debe ser high-contrast
    // - si hi_contrast false => theme NO puede ser high-contrast
    const hi = !!s.hi_contrast;
    if (hi) theme = 'high-contrast';
    if (!hi && theme === 'high-contrast') theme = 'servimel-dark';

    return {
      animations: !!s.animations,
      hi_contrast: hi,
      compact: !!s.compact,
      dna_opacity: opacity,
      font,
      theme
    };
  }

  private applyToDom(prefs: UiSettings): void {
    const html = document.documentElement;

    // ✅ Clases
    html.classList.toggle('hi-contrast', !!prefs.hi_contrast);
    html.classList.toggle('ui-compact', !!prefs.compact);
    html.classList.toggle('reduced-motion', !prefs.animations);

    // ✅ Atributos
    const theme: UiTheme = prefs.hi_contrast ? 'high-contrast' : (prefs.theme ?? 'servimel-dark');
    const font: UiFont = prefs.font ?? 'md';

    html.setAttribute('data-servimel-theme', theme);
    html.setAttribute('data-servimel-compact', prefs.compact ? '1' : '0');
    html.setAttribute('data-servimel-font', font);

    // ✅ ADN global
    html.style.setProperty('--dna-opacity', String(prefs.dna_opacity));
  }
}
