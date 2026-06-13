'use client';
import { useEffect, useState, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import { _applyAccentColor } from '@/lib/store';

// ── useTheme hook ──────────────────────────────────────────────────────────────
// Reads from / writes to the Zustand store so it works anywhere in the tree
// without requiring a provider wrapper.

export type ThemeOption = 'lacquer' | 'midnight' | 'onyx' | 'ash' | 'amoled' | 'light' | 'system';

export interface ThemeContextValue {
  theme: ThemeOption;
  setTheme: (t: ThemeOption) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
}

export function useTheme(): ThemeContextValue {
  const theme         = useOnyxStore(s => s.theme) as ThemeOption;
  const setDisplayTheme = useOnyxStore(s => s.setDisplayTheme);
  const fontSize      = useOnyxStore(s => s.fontSize);
  const setFontSize   = useOnyxStore(s => s.setFontSize);

  const setTheme = useCallback((t: ThemeOption) => {
    setDisplayTheme(t);
  }, [setDisplayTheme]);

  return { theme, setTheme, fontSize, setFontSize };
}

// ── ThemeProvider ──────────────────────────────────────────────────────────────

export default function ThemeProvider() {
  const activeTheme     = useOnyxStore(s => s.activeTheme);
  const messageFontSize = useOnyxStore(s => s.messageFontSize);
  const accentColor     = useOnyxStore(s => s.accentColor);
  const reducedMotion   = useOnyxStore(s => s.reducedMotion);
  const chatBackground  = useOnyxStore(s => s.chatBackground);
  const uiFont          = useOnyxStore(s => s.uiFont);
  const bubbleMode      = useOnyxStore(s => s.bubbleMode);
  const customCss       = useOnyxStore(s => s.customCss);
  const sidebarWidth    = useOnyxStore(s => s.sidebarWidth);
  const messageMaxWidth = useOnyxStore(s => s.messageMaxWidth);
  const glassSidebar     = useOnyxStore(s => s.glassSidebar);
  const highContrastMode = useOnyxStore(s => s.highContrastMode);
  const storeTheme       = useOnyxStore(s => s.theme) as ThemeOption;
  const storeFontSize    = useOnyxStore(s => s.fontSize);

  // ── Resolve 'system' theme ──────────────────────────────────────────────────
  const [resolvedTheme, setResolvedTheme] = useState<string>(() => {
    if (storeTheme === 'system') {
      if (typeof window !== 'undefined') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'lacquer' : 'light';
      }
      return 'lacquer';
    }
    return storeTheme;
  });

  useEffect(() => {
    if (storeTheme !== 'system') {
      setResolvedTheme(storeTheme);
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (dark: boolean) => setResolvedTheme(dark ? 'lacquer' : 'light');
    apply(mq.matches);
    const handler = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [storeTheme]);

  // ── Apply data-theme (single source of truth) ───────────────────────────────
  // The Theme modal always writes `activeTheme` (the full set of named themes)
  // and only mirrors the overlapping ones into the new-system `theme`. Treat
  // `activeTheme` as authoritative for the visual theme; `resolvedTheme` only
  // governs the 'system' (auto light/dark) option. Previously two effects fought
  // over data-theme and the legacy one was gated on storeTheme === 'midnight',
  // so picking a pure-ocean theme (coral/kelp/brine/abyss/bathyal/arctic) while
  // the new-system theme was anything else silently did nothing.
  useEffect(() => {
    if (storeTheme === 'system' || activeTheme === 'system') {
      document.documentElement.setAttribute('data-theme', resolvedTheme);
      return;
    }
    if (activeTheme && activeTheme !== 'ocean') {
      document.documentElement.setAttribute('data-theme', activeTheme);
      return;
    }
    document.documentElement.removeAttribute('data-theme');
  }, [activeTheme, storeTheme, resolvedTheme]);

  // ── Apply fontSize from store ────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.style.fontSize = storeFontSize + 'px';
  }, [storeFontSize]);

  useEffect(() => {
    document.documentElement.style.setProperty('--msg-font-size', `${messageFontSize}px`);
  }, [messageFontSize]);

  useEffect(() => {
    _applyAccentColor(accentColor);
  }, [accentColor]);

  useEffect(() => {
    document.documentElement.classList.toggle('reduced-motion', reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    document.documentElement.setAttribute('data-bg', chatBackground);
  }, [chatBackground]);

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-font', uiFont);
  }, [uiFont]);

  useEffect(() => {
    document.body.classList.toggle('bubble-mode', bubbleMode);
  }, [bubbleMode]);

  useEffect(() => {
    let el = document.getElementById('ocean-custom-css') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'ocean-custom-css';
      document.head.appendChild(el);
    }
    el.textContent = customCss;
  }, [customCss]);

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', sidebarWidth + 'px');
  }, [sidebarWidth]);

  useEffect(() => {
    document.documentElement.style.setProperty('--msg-max-width', messageMaxWidth === 0 ? 'none' : messageMaxWidth + 'px');
  }, [messageMaxWidth]);

  useEffect(() => {
    document.documentElement.classList.toggle('glass-sidebar', glassSidebar);
  }, [glassSidebar]);

  useEffect(() => {
    document.documentElement.setAttribute('data-contrast', highContrastMode ? 'high' : 'normal');
  }, [highContrastMode]);

  return null;
}
