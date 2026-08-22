// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * AppearancePanel.tsx — in-shell look switcher.
 *
 * Default path: ocean-safe faces plus text size, density, and motion. Theme
 * Studio, the full palette, and background scenes live under Advanced.
 *
 * SOLID IDIOMS: never destructure props; For/Show; createMemo; useStore accessor.
 */

import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { Sheet } from '@/primitives';
import { useStore, getState } from '@/lib/store';
import { useThemeOptional, THEMES, THEME_IDS, customThemeTokens, getCustomTheme, type CustomTheme } from '@/theme';
import { PublicLookPicker } from '@/theme/PublicLookPicker';
import { moveRadioGroup, swatchFromTokens } from '@/theme/publicLooks';
import { BackgroundPicker } from '@/backgrounds/picker/BackgroundPicker';
import {
  DENSITIES,
  FONT_SCALES,
  preferences,
  setPreference,
  type Density,
  type FontScale,
} from '@/lib/prefs/preferences';
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

const DENSITY_LABELS: Record<Density, string> = { compact: 'Compact', cozy: 'Cozy', roomy: 'Roomy' };
const FONT_SCALE_LABELS: Record<FontScale, string> = { sm: 'Small', md: 'Medium', lg: 'Large' };
const MOTION_LABELS: Record<SceneMotion, string> = {
  adaptive: 'Adaptive',
  animated: 'Animated',
  still: 'Still',
  off: 'Off',
};

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

  const themeEntries = createMemo<ThemeEntry[]>(() => {
    const builtin: ThemeEntry[] = THEME_IDS.map((id) => ({
      id,
      label: THEMES[id].label,
      title: THEMES[id].description,
      swatch: swatchFromTokens(THEMES[id].tokens as Record<string, string>),
      custom: false,
    }));
    const custom: ThemeEntry[] = theme.customThemes().map((ct) => ({
      id: ct.id,
      label: ct.name,
      title: `Custom theme based on ${THEMES[ct.base]?.label ?? ct.base}`,
      swatch: swatchFromTokens(customThemeTokens(ct)),
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

  return (
    <>
      <Sheet
        open={open()}
        title="Appearance"
        description="Look, text size, and motion — applied live."
        onOpenChange={(next) => (next ? getState().openAppearance() : getState().closeAppearance())}
        closeLabel="Close appearance"
      >
        <div class="ap-panel" data-testid="appearance-panel">
          <section class="ap-panel-group">
            <div class="ap-panel-heading-row">
              <h3 class="ap-panel-label">Look</h3>
            </div>
            <PublicLookPicker />
          </section>

          <section class="ap-panel-group">
            <h3 class="ap-panel-label">Text size</h3>
            <div class="ap-motion-options" role="radiogroup" aria-label="Text size">
              <For each={FONT_SCALES}>
                {(value) => (
                  <button
                    type="button"
                    class="ap-motion-option"
                    classList={{ 'ap-motion-option--on': preferences().fontScale === value }}
                    role="radio"
                    aria-checked={preferences().fontScale === value}
                    tabIndex={preferences().fontScale === value ? 0 : -1}
                    onKeyDown={moveRadioGroup}
                    onClick={() => setPreference('fontScale', value)}
                  >
                    {FONT_SCALE_LABELS[value]}
                  </button>
                )}
              </For>
            </div>
          </section>

          <section class="ap-panel-group">
            <h3 class="ap-panel-label">Density</h3>
            <div class="ap-motion-options" role="radiogroup" aria-label="Density">
              <For each={DENSITIES}>
                {(value) => (
                  <button
                    type="button"
                    class="ap-motion-option"
                    classList={{ 'ap-motion-option--on': preferences().density === value }}
                    role="radio"
                    aria-checked={preferences().density === value}
                    tabIndex={preferences().density === value ? 0 : -1}
                    onKeyDown={moveRadioGroup}
                    onClick={() => setPreference('density', value)}
                  >
                    {DENSITY_LABELS[value]}
                  </button>
                )}
              </For>
            </div>
          </section>

          <section class="ap-panel-group">
            <h3 class="ap-panel-label">Motion and data</h3>
            <div class="ap-panel-toggles">
              <button
                type="button"
                class="ap-panel-switch"
                role="switch"
                aria-checked={preferences().reduceMotion}
                onClick={() => setPreference('reduceMotion', !preferences().reduceMotion)}
              >
                <span>Reduce motion</span>
                <b>{preferences().reduceMotion ? 'On' : 'Off'}</b>
              </button>
              <button
                type="button"
                class="ap-panel-switch"
                role="switch"
                aria-checked={sceneMotion() === 'off'}
                onClick={() => setSceneMotion(sceneMotion() === 'off' ? 'adaptive' : 'off')}
              >
                <span>Use less data</span>
                <b>{sceneMotion() === 'off' ? 'On' : 'Off'}</b>
              </button>
            </div>
          </section>

          <details class="ap-panel-advanced" data-testid="appearance-advanced">
            <summary>
              <span>Advanced</span>
              <b>Theme Studio, more looks, and backgrounds</b>
            </summary>
            <div class="ap-panel-advanced__body">
              <section class="ap-panel-group">
                <div class="ap-panel-heading-row">
                  <h3 class="ap-panel-label">All looks</h3>
                  <button
                    type="button"
                    class="ap-panel-link"
                    onClick={() => setThemeDialogOpen(true)}
                  >
                    Share / import
                  </button>
                </div>
                <div class="ap-panel-themes" role="radiogroup" aria-label="All looks" style={{ 'touch-action': 'manipulation' }}>
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
                          onKeyDown={moveRadioGroup}
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
                          onKeyDown={moveRadioGroup}
                          onClick={() => setSceneMotion(value)}
                        >
                          {MOTION_LABELS[value]}
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

              <a class="ap-panel-studio" href="/appearance/">
                Open Theme Studio
              </a>
            </div>
          </details>
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
