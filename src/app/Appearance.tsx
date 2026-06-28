import { createMemo, For } from 'solid-js';
import { Background, backgroundOptions, type BackgroundId } from '@/backgrounds';
import { useTheme, THEMES, THEME_IDS, ThemeStudio } from '@/theme';
import { useStore, getState } from '@/lib/store';
import './appearance.css';

type ThemeChip = { id: string; label: string; custom: boolean };

/** /appearance — the customization surface: live theme + background pickers over
 *  an animated backdrop, plus the full Theme Studio. Headline feature. */
export default function Appearance() {
  const theme = useTheme();
  // Background lives in the reactive store so the choice persists and applies
  // live across the whole app (shell + this page) without a reload.
  const backgroundId = useStore((s) => s.backgroundId);
  const chooseBg = (id: BackgroundId) => getState().setBackground(id);

  const themeChips = createMemo<ThemeChip[]>(() => [
    ...THEME_IDS.map((id) => ({ id, label: THEMES[id].label, custom: false })),
    ...theme.customThemes().map((ct) => ({ id: ct.id, label: ct.name, custom: true })),
  ]);

  return (
    <main class="ap">
      <Background id={backgroundId()} />

      <header class="ap-bar">
        <a class="ap-back" href="/app">← back to app</a>
        <span class="ap-tag">◆ · appearance</span>
        <a class="ap-home" href="/">home</a>
      </header>

      <section class="ap-wrap">
        <p class="ap-kicker">customization</p>
        <h1 class="ap-h1">Make it <span class="gold">yours</span></h1>
        <p class="ap-lede">
          Seven gem palettes, living and solid backgrounds, and a studio to tune every
          token — all previewing live and (soon) following your account across the mesh.
        </p>

        <div class="ap-group">
          <span class="ap-glabel">Theme</span>
          <div class="ap-chips">
            <For each={themeChips()}>
              {(chip) => (
                <button
                  type="button"
                  class="ap-chip"
                  classList={{ on: theme.themeId() === chip.id, 'ap-chip--custom': chip.custom }}
                  aria-pressed={theme.themeId() === chip.id}
                  onClick={() => theme.setTheme(chip.id)}
                >
                  {chip.label}
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="ap-group">
          <span class="ap-glabel">Background</span>
          <div class="ap-chips">
            <For each={backgroundOptions}>
              {(opt) => (
                <button
                  type="button"
                  class="ap-chip"
                  classList={{ on: backgroundId() === opt.id }}
                  aria-pressed={backgroundId() === opt.id}
                  onClick={() => chooseBg(opt.id as BackgroundId)}
                >
                  {opt.label}
                  <i class="ap-kind">{opt.kind}</i>
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="ap-studio">
          <ThemeStudio />
        </div>
      </section>
    </main>
  );
}
