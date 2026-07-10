import { createMemo, createSignal, For, Show } from 'solid-js';
import { Background, backgroundOptions, type BackgroundId } from '@/backgrounds';
import { useTheme, THEMES, THEME_IDS, type ThemeId } from '@/theme';
// Import ThemeStudio from its module directly, NOT via the '@/theme' barrel.
// index.tsx eagerly imports that barrel for ThemeProvider, so re-exporting the
// 2k-line ThemeStudio through it hoists ThemeStudio into the eager entry chunk
// (shipped on every route incl. the landing). The direct import keeps it in
// this lazy /appearance chunk, where it's the sole consumer.
import { ThemeStudio } from '@/theme/ThemeStudio';
import { useStore, getState } from '@/lib/store';
import { AUTO_BACKGROUND_ID, resolveBackgroundId } from '@/shell/themeBackground';
import './appearance.css';

type ThemeChip = { id: string; label: string; custom: boolean; swatch: string[] };
type BgChip = { id: string; label: string; kind: string };

/** Palette dots for a built-in theme, read straight from its token map. */
function themeSwatch(id: string): string[] {
  const t = THEMES[id as ThemeId]?.tokens;
  if (!t) return ['var(--lapis)', 'var(--gold)', 'var(--shu)'];
  return [t['--lapis'] ?? '#7f7f7f', t['--gold'] ?? '#7f7f7f', t['--shu'] ?? '#7f7f7f'];
}

/** /appearance — the customization surface: live theme + background gallery over
 *  an animated backdrop, plus the full Theme Studio. Headline feature. */
export default function Appearance() {
  const theme = useTheme();
  const backgroundId = useStore((s) => s.backgroundId);
  const chooseBg = (id: string) => getState().setBackground(id);

  // Hover-to-preview: hovering/focusing a background chip previews it live on the
  // full-page backdrop without committing; leaving reverts to the selected one.
  const [hoverBg, setHoverBg] = createSignal<string | null>(null);
  const previewBgId = createMemo(
    () => resolveBackgroundId(hoverBg() ?? backgroundId(), theme.themeId()) as BackgroundId,
  );

  const themeChips = createMemo<ThemeChip[]>(() => [
    ...THEME_IDS.map((id) => ({ id, label: THEMES[id].label, custom: false, swatch: themeSwatch(id) })),
    ...theme.customThemes().map((ct) => ({
      id: ct.id, label: ct.name, custom: true,
      swatch: ['var(--lapis)', 'var(--gold)', 'var(--shu)'],
    })),
  ]);

  // Ambient = canvas scenes that follow the theme; Scenes = the dramatic
  // fixed-colorway DOM backgrounds (retro arcade, starfield, …).
  const ambientBgs = backgroundOptions.filter((o) => o.kind !== 'scene') as BgChip[];
  const sceneBgs = backgroundOptions.filter((o) => o.kind === 'scene') as BgChip[];

  const bgChip = (opt: BgChip) => (
    <button
      type="button"
      class="ap-chip"
      classList={{ on: backgroundId() === opt.id, previewing: hoverBg() === opt.id }}
      aria-pressed={backgroundId() === opt.id}
      onMouseEnter={() => setHoverBg(opt.id)}
      onMouseLeave={() => setHoverBg((v) => (v === opt.id ? null : v))}
      onFocus={() => setHoverBg(opt.id)}
      onBlur={() => setHoverBg((v) => (v === opt.id ? null : v))}
      onClick={() => chooseBg(opt.id)}
    >
      {opt.label}
      <i class="ap-kind" data-kind={opt.kind}>{opt.kind}</i>
    </button>
  );

  return (
    <main class="ap">
      <Background id={previewBgId()} />

      <header class="ap-bar">
        <a class="ap-back" href="/app">← back to app</a>
        <span class="ap-tag">◆ · appearance</span>
        <a class="ap-home" href="/">home</a>
      </header>

      <section class="ap-wrap">
        <p class="ap-kicker">customization</p>
        <h1 class="ap-h1">Make it <span class="gold">yours</span></h1>
        <p class="ap-lede">
          A vault of gem palettes, living ambient backdrops and dramatic scenes, and a studio
          to generate or tune every token — all previewing live behind this page.
          <Show when={hoverBg()}>
            <span class="ap-lede-hint"> · previewing <b>{hoverBg()}</b></span>
          </Show>
        </p>

        <div class="ap-group">
          <span class="ap-glabel">Theme</span>
          <div class="ap-chips">
            <For each={themeChips()}>
              {(chip) => (
                <button
                  type="button"
                  class="ap-chip ap-chip--theme"
                  classList={{ on: theme.themeId() === chip.id, 'ap-chip--custom': chip.custom }}
                  aria-pressed={theme.themeId() === chip.id}
                  onClick={() => theme.setTheme(chip.id)}
                >
                  <span class="ap-swatch" aria-hidden="true">
                    <For each={chip.swatch}>{(c) => <span style={{ background: c }} />}</For>
                  </span>
                  {chip.label}
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="ap-group">
          <span class="ap-glabel">Background</span>
          <p class="ap-ghint">Hover to preview live · click to keep</p>
          <div class="ap-chips">
            <button
              type="button"
              class="ap-chip ap-chip--auto"
              classList={{ on: backgroundId() === AUTO_BACKGROUND_ID }}
              aria-pressed={backgroundId() === AUTO_BACKGROUND_ID}
              onMouseEnter={() => setHoverBg(AUTO_BACKGROUND_ID)}
              onMouseLeave={() => setHoverBg((v) => (v === AUTO_BACKGROUND_ID ? null : v))}
              onClick={() => chooseBg(AUTO_BACKGROUND_ID)}
            >
              Auto
              <i class="ap-kind" data-kind="auto">match theme</i>
            </button>
          </div>

          <span class="ap-subglabel">Ambient</span>
          <div class="ap-chips"><For each={ambientBgs}>{bgChip}</For></div>

          <span class="ap-subglabel">Scenes</span>
          <div class="ap-chips"><For each={sceneBgs}>{bgChip}</For></div>
        </div>

        <div class="ap-studio">
          <ThemeStudio />
        </div>
      </section>
    </main>
  );
}
