// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * AppearancePanel.tsx — in-shell theme + background switcher.
 *
 * A right-hand Sheet (no full-page navigation) that surfaces the headline
 * customization surface where people actually are — in the chat. Switches the
 * theme and the live animated/solid background instantly, and links out to the
 * full Theme Studio for deep token tuning.
 *
 * SOLID IDIOMS: never destructure props; For/Show; createMemo; useStore accessor.
 */

import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { Sheet } from '@/primitives';
import { useStore, getState } from '@/lib/store';
import { useThemeOptional, THEMES, THEME_IDS, customThemeTokens, getCustomTheme, type CustomTheme } from '@/theme';
import { BackgroundPicker } from '@/backgrounds/picker/BackgroundPicker';
import {
  SCENE_MOTIONS,
  sceneMotion,
  setSceneMotion,
  type SceneMotion,
} from '@/lib/prefs/sceneMotion';
import { ThemeImportDialog } from './ThemeImportDialog';
import { getBackgroundMeta } from '@/backgrounds/catalogue';
import { createAppearanceRuntime } from '@/backgrounds/appearanceRuntime';
import './AppearancePanel.css';

type ThemeEntry = { id: string; label: string; title: string; swatch: string[]; custom: boolean };

/** Three representative swatch colours from a token set. */
function swatchFrom(tokens: Record<string, string>): string[] {
  return [
    tokens['--lapis'] ?? tokens['--accent'] ?? '#2bb4f0',
    tokens['--gold'] ?? '#d8b96a',
    tokens['--stone-2'] ?? tokens['--bg-raised'] ?? '#0f2740',
  ];
}

export function AppearancePanel(): JSX.Element {
  const theme = useThemeOptional();
  const open = useStore((s) => s.showAppearance);
  const backgroundId = useStore((s) => s.backgroundId);
  const [themeDialogOpen, setThemeDialogOpen] = createSignal(false);
  const appearance = createAppearanceRuntime();
  function chooseBackground(id: string): void {
    // Wallpaper and motion are independent preferences. In particular, never
    // turn an explicit accessibility/battery-saving Off choice back on.
    getState().setBackground(id);
  }

  const motionLabel: Record<SceneMotion, string> = {
    adaptive: 'Adaptive',
    animated: 'Animated',
    still: 'Still',
    off: 'Off',
  };

  // Built-in themes followed by the user's saved custom themes.
  const themeEntries = createMemo<ThemeEntry[]>(() => {
    const builtin: ThemeEntry[] = THEME_IDS.map((id) => ({
      id,
      label: THEMES[id].label,
      title: THEMES[id].description,
      swatch: swatchFrom(THEMES[id].tokens as Record<string, string>),
      custom: false,
    }));
    const custom: ThemeEntry[] = theme.customThemes().map((ct) => ({
      id: ct.id,
      label: ct.name,
      title: `Custom theme based on ${THEMES[ct.base]?.label ?? ct.base}`,
      swatch: swatchFrom(customThemeTokens(ct)),
      custom: true,
    }));
    return [...builtin, ...custom];
  });

  const shareTheme = createMemo<CustomTheme | undefined>(() => {
    const active = theme.themeId();
    return getCustomTheme(active);
  });
  const backgroundLabel = createMemo(() => backgroundId() === 'auto'
    ? 'Match my theme'
    : (getBackgroundMeta(backgroundId())?.label ?? 'Match my theme'));
  const effectiveMotionLabel = createMemo(() => {
    const policy = appearance.policy();
    if (policy.mode === 'off') return policy.reason === 'reduced-data' ? 'Off · Data Saver' : 'Background off';
    if (policy.mode === 'still') {
      if (policy.reason === 'reduced-motion') return 'Still · Reduced motion';
      if (policy.reason === 'adaptive') return 'Still · This device';
      return 'Still frame';
    }
    return policy.reason === 'adaptive' ? 'Animated · This device' : 'Animated';
  });

  function importTheme(imported: CustomTheme): void {
    const id = theme.saveCustom(imported.name, imported.base, imported.overrides);
    theme.setTheme(id);
  }

  const movePanelRadio = (event: KeyboardEvent): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const current = event.currentTarget as HTMLButtonElement | null;
    if (!current) return;
    const group = current.closest<HTMLElement>('[role="radiogroup"]');
    const radios = group ? [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')] : [];
    const index = radios.indexOf(current);
    if (index < 0) return;
    event.preventDefault();
    const targetIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? radios.length - 1
          : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + radios.length) % radios.length;
    const target = radios[targetIndex];
    target?.focus();
    target?.click();
  };

  return (
    <>
      <Sheet
        open={open()}
        title="Appearance"
        description="Theme and background — applied live."
        onOpenChange={(next) => (next ? getState().openAppearance() : getState().closeAppearance())}
        closeLabel="Close appearance"
      >
        <div class="ap-panel" data-testid="appearance-panel">
          {/* ── Theme ── */}
          <section class="ap-panel-group">
            <div class="ap-panel-heading-row">
              <h3 class="ap-panel-label">Theme</h3>
              <button
                type="button"
                class="ap-panel-link"
                onClick={() => setThemeDialogOpen(true)}
              >
                Share / import
              </button>
            </div>
            <div class="ap-panel-themes" role="radiogroup" aria-label="Theme" style={{ 'touch-action': 'manipulation' }}>
              <For each={themeEntries()}>
                {(entry) => {
                  const active = () => theme.themeId() === entry.id;
                  return (
                    <button
                      type="button"
                      class="ap-theme-chip"
                      classList={{ 'ap-theme-chip--on': active(), 'ap-theme-chip--custom': entry.custom }}
                      role="radio"
                      aria-checked={active()}
                      aria-label={`${entry.label} theme`}
                      title={entry.title}
                      tabIndex={active() ? 0 : -1}
                      style={{ 'min-height': '44px', 'touch-action': 'manipulation' }}
                      onKeyDown={movePanelRadio}
                      onClick={() => theme.setTheme(entry.id)}
                    >
                      <span class="ap-theme-swatch" aria-hidden="true">
                        <For each={entry.swatch}>{(c) => <span style={{ background: c }} />}</For>
                      </span>
                      <span class="ap-theme-name">{entry.label}</span>
                    </button>
                  );
                }}
              </For>
            </div>
          </section>

          {/* ── Background ── */}
          <section class="ap-panel-group">
            <div class="ap-panel-heading-row">
              <h3 class="ap-panel-label">Background</h3>
              <span class="ap-panel-current" aria-live="polite">
                {effectiveMotionLabel()}
              </span>
            </div>
            <div class="ap-motion-control">
              <span class="ap-motion-label">Motion</span>
              <div class="ap-motion-options" role="radiogroup" aria-label="Background motion">
                <For each={SCENE_MOTIONS}>
                {(value) => (
                    <button
                      type="button"
                      class="ap-motion-option"
                      classList={{ 'ap-motion-option--on': sceneMotion() === value }}
                      role="radio"
                      aria-checked={sceneMotion() === value}
                      tabIndex={sceneMotion() === value ? 0 : -1}
                      onKeyDown={movePanelRadio}
                      onClick={() => setSceneMotion(value)}
                    >
                      {motionLabel[value]}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <details class="ap-panel-background-browser">
              <summary>
                <span>Choose background</span>
                <b>{backgroundLabel()}</b>
              </summary>
              <div class="ap-panel-background-browser__body">
                <BackgroundPicker value={backgroundId} onSelect={chooseBackground} label="Background" immediate />
              </div>
            </details>
          </section>

          {/* ── Deep customization ── */}
          <a class="ap-panel-studio" href="/appearance/">
            Open the full Theme Studio →
          </a>
        </div>
      </Sheet>
      <Show when={open()}>
        <ThemeImportDialog
          open={themeDialogOpen()}
          onClose={() => setThemeDialogOpen(false)}
          onImport={importTheme}
          shareTheme={shareTheme()}
        />
      </Show>
    </>
  );
}
