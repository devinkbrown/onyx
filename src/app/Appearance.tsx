import { createSignal, For } from 'solid-js';
import { Background, backgroundOptions, type BackgroundId } from '@/backgrounds';

const DEFAULT_BG = (backgroundOptions[0]?.id ?? 'kintsugi-veins') as BackgroundId;
import { useTheme, THEMES, THEME_IDS, ThemeStudio } from '@/theme';
import './appearance.css';

const BG_KEY = 'ruri:bg';

/** /appearance — the customization surface: live theme + background pickers over
 *  an animated backdrop, plus the full Theme Studio. Headline feature. */
export default function Appearance() {
  const theme = useTheme();

  const stored = (() => {
    try {
      return localStorage.getItem(BG_KEY) as BackgroundId | null;
    } catch {
      return null;
    }
  })();
  const [bg, setBg] = createSignal<BackgroundId>(stored ?? DEFAULT_BG);
  const chooseBg = (id: BackgroundId) => {
    setBg(id);
    try {
      localStorage.setItem(BG_KEY, id);
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <main class="ap">
      <Background id={bg()} />

      <header class="ap-bar">
        <a class="ap-back" href="/app">← back to app</a>
        <span class="ap-tag">瑠璃 · appearance</span>
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
            <For each={THEME_IDS}>
              {(id) => (
                <button
                  type="button"
                  class="ap-chip"
                  classList={{ on: theme.themeId() === id }}
                  aria-pressed={theme.themeId() === id}
                  onClick={() => theme.setTheme(id)}
                >
                  {THEMES[id].label}
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
                  classList={{ on: bg() === opt.id }}
                  aria-pressed={bg() === opt.id}
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
