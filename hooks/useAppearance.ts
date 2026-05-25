'use client';

import { useEffect } from 'react';

export type MessageDensity = 'comfortable' | 'compact' | 'cozy';

export interface AppearanceSettings {
  theme: 'dark' | 'light';
  density: MessageDensity;
  fontSize: number;
  reduceMotion: boolean;
}

const STORAGE_KEY = 'ocean:appearance';

const DENSITY_CLASSES: MessageDensity[] = ['comfortable', 'compact', 'cozy'];

function getSystemReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function loadAppearance(): AppearanceSettings {
  if (typeof window === 'undefined') {
    return { theme: 'dark', density: 'comfortable', fontSize: 15, reduceMotion: false };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppearanceSettings>;
      return {
        theme: parsed.theme === 'light' ? 'light' : 'dark',
        density: DENSITY_CLASSES.includes(parsed.density as MessageDensity)
          ? (parsed.density as MessageDensity)
          : 'comfortable',
        fontSize: typeof parsed.fontSize === 'number'
          ? Math.min(18, Math.max(12, parsed.fontSize))
          : 15,
        reduceMotion: typeof parsed.reduceMotion === 'boolean'
          ? parsed.reduceMotion
          : getSystemReducedMotion(),
      };
    }
  } catch {
    // Ignore parse errors
  }
  return {
    theme: 'dark',
    density: 'comfortable',
    fontSize: 15,
    reduceMotion: getSystemReducedMotion(),
  };
}

export function saveAppearance(settings: AppearanceSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

export function applyAppearance(settings: AppearanceSettings): void {
  if (typeof document === 'undefined') return;

  // Font size — inject/update a style tag on <head>
  const styleId = 'ocean-appearance-fontsize';
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `:root { font-size: ${settings.fontSize}px; }`;

  // Density classes on <body>
  const body = document.body;
  body.classList.remove('density-comfortable', 'density-compact', 'density-cozy');
  body.classList.add(`density-${settings.density}`);

  // Reduce motion class
  if (settings.reduceMotion) {
    body.classList.add('reduce-motion');
  } else {
    body.classList.remove('reduce-motion');
  }
}

export function useAppearance(): void {
  useEffect(() => {
    const settings = loadAppearance();
    applyAppearance(settings);
  }, []);
}
