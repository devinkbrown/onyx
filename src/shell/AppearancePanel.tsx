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
import { backgroundOptions } from '@/backgrounds';
import { AUTO_BACKGROUND_ID } from './themeBackground';
import { ThemeImportDialog } from './ThemeImportDialog';

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

  function importTheme(imported: CustomTheme): void {
    const id = theme.saveCustom(imported.name, imported.base, imported.overrides);
    theme.setTheme(id);
  }

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
                      style={{ 'min-height': '44px', 'touch-action': 'manipulation' }}
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
            <h3 class="ap-panel-label">Background</h3>
            <div class="ap-panel-bgs" role="radiogroup" aria-label="Background" style={{ 'touch-action': 'manipulation' }}>
              <button
                type="button"
                class="ap-bg-chip"
                classList={{ 'ap-bg-chip--on': backgroundId() === AUTO_BACKGROUND_ID }}
                role="radio"
                aria-checked={backgroundId() === AUTO_BACKGROUND_ID}
                aria-label="Auto — theme-matched background"
                style={{ 'min-height': '44px', 'touch-action': 'manipulation' }}
                onClick={() => getState().setBackground(AUTO_BACKGROUND_ID)}
              >
                <span class="ap-bg-name">Auto</span>
                <span class="ap-bg-kind" data-kind="animated">match theme</span>
              </button>
              <For each={backgroundOptions}>
                {(opt) => {
                  const active = () => backgroundId() === opt.id;
                  return (
                    <button
                      type="button"
                      class="ap-bg-chip"
                      classList={{ 'ap-bg-chip--on': active() }}
                      role="radio"
                      aria-checked={active()}
                      style={{ 'min-height': '44px', 'touch-action': 'manipulation' }}
                      onClick={() => getState().setBackground(opt.id)}
                    >
                      <span class="ap-bg-name">{opt.label}</span>
                      <span class="ap-bg-kind" data-kind={opt.kind}>{opt.kind}</span>
                    </button>
                  );
                }}
              </For>
            </div>
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
