// src/app/shared/models/settings.model.ts
export type ThemeMode = 'dark' | 'light' | 'dim';

export type UserSettings = {
  theme: ThemeMode;
  high_contrast: boolean;
  compact_mode: boolean;
  animations: boolean;
  dna_opacity: number; // 0.10..0.50 (según backend)
};
