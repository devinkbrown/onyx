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

import { For, type JSX } from 'solid-js';
import { Sheet } from '@/primitives';
import { useStore, getState } from '@/lib/store';
import { useThemeOptional, THEMES, THEME_IDS } from '@/theme';
import { backgroundOptions } from '@/backgrounds';

/** Pull a few representative swatch colours out of a theme's token set. */
function themeSwatch(id: (typeof THEME_IDS)[number]): string[] {
  const t = THEMES[id].tokens as Record<string, string>;
  return [
    t['--lapis'] ?? t['--accent'] ?? '#2bb4f0',
    t['--gold'] ?? '#d8b96a',
    t['--stone-2'] ?? t['--bg-raised'] ?? '#0f2740',
  ];
}

export function AppearancePanel(): JSX.Element {
  const theme = useThemeOptional();
  const open = useStore((s) => s.showAppearance);
  const backgroundId = useStore((s) => s.backgroundId);

  return (
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
          <h3 class="ap-panel-label">Theme</h3>
          <div class="ap-panel-themes" role="radiogroup" aria-label="Theme">
            <For each={THEME_IDS}>
              {(id) => {
                const active = () => theme.themeId() === id;
                const sw = themeSwatch(id);
                return (
                  <button
                    type="button"
                    class="ap-theme-chip"
                    classList={{ 'ap-theme-chip--on': active() }}
                    role="radio"
                    aria-checked={active()}
                    aria-label={`${THEMES[id].label} theme`}
                    title={THEMES[id].description}
                    onClick={() => theme.setTheme(id)}
                  >
                    <span class="ap-theme-swatch" aria-hidden="true">
                      <For each={sw}>{(c) => <span style={{ background: c }} />}</For>
                    </span>
                    <span class="ap-theme-name">{THEMES[id].label}</span>
                  </button>
                );
              }}
            </For>
          </div>
        </section>

        {/* ── Background ── */}
        <section class="ap-panel-group">
          <h3 class="ap-panel-label">Background</h3>
          <div class="ap-panel-bgs" role="radiogroup" aria-label="Background">
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
        <a class="ap-panel-studio" href="/appearance">
          Open the full Theme Studio →
        </a>
      </div>
    </Sheet>
  );
}
