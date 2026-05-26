'use client';
import { useEffect, useState, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import { _applyAccentColor } from '@/lib/store';

// ── useTheme hook ──────────────────────────────────────────────────────────────
// Reads from / writes to the Zustand store so it works anywhere in the tree
// without requiring a provider wrapper.

export type ThemeOption = 'midnight' | 'onyx' | 'ash' | 'amoled' | 'light' | 'system';

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
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'midnight' : 'light';
      }
      return 'onyx';
    }
    return storeTheme;
  });

  useEffect(() => {
    if (storeTheme !== 'system') {
      setResolvedTheme(storeTheme);
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (dark: boolean) => setResolvedTheme(dark ? 'onyx' : 'light');
    apply(mq.matches);
    const handler = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [storeTheme]);

  // ── Apply data-theme ────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme]);

  // ── Apply fontSize from store ────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.style.fontSize = storeFontSize + 'px';
  }, [storeFontSize]);

  // ── Legacy activeTheme support ──────────────────────────────────────────────
  useEffect(() => {
    const html = document.documentElement;
    // Only override data-theme with the legacy system if the new theme is still
    // at the default ('midnight'), so new-system themes take priority.
    if (storeTheme === 'midnight') {
      if (activeTheme === 'ocean' || activeTheme === 'midnight') {
        // Legacy defaults map to midnight — leave the new system in control
      } else {
        html.setAttribute('data-theme', activeTheme);
      }
    }
  }, [activeTheme, storeTheme]);

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
