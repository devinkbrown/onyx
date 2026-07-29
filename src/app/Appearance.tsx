// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createMemo, createSignal, ErrorBoundary, For, onCleanup, Show } from 'solid-js';
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

/** Short intent window that prevents a pointer sweep from fetching every
 * background chunk it crosses. Focus and activation bypass this delay. */
export const POINTER_PREVIEW_DELAY_MS = 160;

/** True for primary touch contacts — never used for delayed hover-preview. */
export function isTouchPointerEvent(event: { pointerType?: string }): boolean {
  return event.pointerType === 'touch';
}

/**
 * Devices without real hover must not arm the delayed pointer-preview path.
 * Touch/pen still activate via click; keyboard still previews on focus.
 * JSDOM/default matchMedia returns matches:false → preview stays enabled for
 * the existing mouse pointer-sweep unit tests.
 */
export function prefersNoHoverPreview(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(hover: none)').matches;
  } catch {
    return false;
  }
}

function allowsPointerHoverPreview(event: { pointerType?: string }): boolean {
  if (isTouchPointerEvent(event)) return false;
  if (prefersNoHoverPreview()) return false;
  return true;
}

/** Palette dots for a built-in theme, read straight from its token map. */
function themeSwatch(id: string): string[] {
  const t = THEMES[id as ThemeId]?.tokens;
  if (!t) return ['var(--lapis)', 'var(--gold)', 'var(--shu)'];
  return [t['--lapis'] ?? '#7f7f7f', t['--gold'] ?? '#7f7f7f', t['--shu'] ?? '#7f7f7f'];
}

/** Inert fixed layer used when the live Background tree throws — keeps the
 * Appearance chrome (bar + chips) mounted so a bad wallpaper never blanks UI. */
function BackgroundFallback() {
  return (
    <div
      aria-hidden="true"
      data-background-canvas="true"
      data-background-fallback="true"
      data-testid="background-fallback"
      style={{
        position: 'fixed',
        inset: '0',
        'z-index': '-1',
        'pointer-events': 'none',
        background:
          'radial-gradient(120% 120% at 50% 0%, color-mix(in oklab, var(--lapis) 22%, var(--ink)) 0%, var(--ink) 60%)',
      }}
    />
  );
}

/** /appearance — the customization surface: live theme + background gallery over
 *  an animated backdrop, plus the full Theme Studio. Headline feature. */
export default function Appearance() {
  const theme = useTheme();
  const backgroundId = useStore((s) => s.backgroundId);
  const chooseBg = (id: string) => getState().setBackground(id);

  // Pointer hover waits for intent before changing the lazy Background source;
  // keyboard focus and explicit activation stay immediate. Touch / (hover:none)
  // never arm the delayed path — they commit only via click/activation so a
  // finger sweep cannot thrash wallpaper chunks or leave a sticky preview.
  const [hoverBg, setHoverBg] = createSignal<string | null>(null);
  let pointerPreviewTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingPointerBg: string | null = null;
  // Touch focus-before-click: suppress focus-preview so leave/cancel cannot
  // desync hover state before activation commits the real selection.
  let suppressFocusPreview = false;

  const cancelPointerPreview = (id?: string): void => {
    if (pointerPreviewTimer === undefined) return;
    if (id !== undefined && pendingPointerBg !== id) return;
    clearTimeout(pointerPreviewTimer);
    pointerPreviewTimer = undefined;
    pendingPointerBg = null;
  };

  const schedulePointerPreview = (id: string): void => {
    cancelPointerPreview();
    pendingPointerBg = id;
    pointerPreviewTimer = setTimeout(() => {
      pointerPreviewTimer = undefined;
      pendingPointerBg = null;
      setHoverBg(id);
    }, POINTER_PREVIEW_DELAY_MS);
  };

  const previewImmediately = (id: string): void => {
    cancelPointerPreview();
    setHoverBg(id);
  };

  const restoreSelectedBackground = (id: string): void => {
    cancelPointerPreview(id);
    setHoverBg((current) => (current === id ? null : current));
  };

  const selectBackground = (id: string): void => {
    suppressFocusPreview = false;
    cancelPointerPreview();
    // Active selection truth is the store; clear any transient preview first so
    // aria-pressed / .on never compete with a leftover hoverBg after activation.
    setHoverBg(null);
    chooseBg(id);
  };

  onCleanup(() => cancelPointerPreview());

  const previewBgId = createMemo(
    () => resolveBackgroundId(hoverBg() ?? backgroundId(), theme.themeId()) as BackgroundId,
  );
  let failedWallpaperId: BackgroundId | undefined;
  let resetWallpaperBoundary: (() => void) | undefined;
  createEffect(() => {
    const current = previewBgId();
    if (failedWallpaperId !== undefined && current !== failedWallpaperId) {
      failedWallpaperId = undefined;
      resetWallpaperBoundary?.();
      resetWallpaperBoundary = undefined;
    }
  });

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

  const onBgPointerEnter = (id: string, event: { pointerType?: string }): void => {
    if (!allowsPointerHoverPreview(event)) return;
    schedulePointerPreview(id);
  };

  const onBgPointerLeave = (id: string, event: { pointerType?: string }): void => {
    if (!allowsPointerHoverPreview(event)) return;
    restoreSelectedBackground(id);
  };

  const onBgPointerDown = (event: { pointerType?: string }): void => {
    // Touch focuses the button before click; skip focus-preview for that gesture.
    suppressFocusPreview = isTouchPointerEvent(event);
  };

  const onBgFocus = (id: string): void => {
    if (suppressFocusPreview) {
      // Consume the flag for this focus cycle; click still commits.
      suppressFocusPreview = false;
      return;
    }
    previewImmediately(id);
  };

  const onBgPointerCancel = (id: string): void => {
    suppressFocusPreview = false;
    restoreSelectedBackground(id);
  };

  const bgChip = (opt: BgChip) => (
    <button
      type="button"
      class="ap-chip"
      classList={{ on: backgroundId() === opt.id, previewing: hoverBg() === opt.id }}
      aria-pressed={backgroundId() === opt.id}
      onPointerDown={onBgPointerDown}
      onPointerUp={() => { suppressFocusPreview = false; }}
      onPointerEnter={(event) => onBgPointerEnter(opt.id, event)}
      onPointerLeave={(event) => onBgPointerLeave(opt.id, event)}
      onPointerCancel={() => onBgPointerCancel(opt.id)}
      onFocus={() => onBgFocus(opt.id)}
      onBlur={() => restoreSelectedBackground(opt.id)}
      onClick={() => selectBackground(opt.id)}
    >
      {opt.label}
      <i class="ap-kind" data-kind={opt.kind}>{opt.kind}</i>
    </button>
  );

  return (
    <main class="ap">
      <ErrorBoundary
        fallback={(_error, reset) => {
          failedWallpaperId = previewBgId();
          resetWallpaperBoundary = reset;
          return <BackgroundFallback />;
        }}
      >
        <Background id={previewBgId()} />
      </ErrorBoundary>

      <header class="ap-bar">
        <a class="ap-back" href="/app/">← back to app</a>
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
          <p class="ap-ghint ap-ghint--fine">Hover or focus to preview live · click to keep</p>
          <p class="ap-ghint ap-ghint--coarse">Tap a background to apply it</p>
          <div class="ap-chips">
            <button
              type="button"
              class="ap-chip ap-chip--auto"
              classList={{ on: backgroundId() === AUTO_BACKGROUND_ID }}
              aria-pressed={backgroundId() === AUTO_BACKGROUND_ID}
              onPointerDown={onBgPointerDown}
              onPointerUp={() => { suppressFocusPreview = false; }}
              onPointerEnter={(event) => onBgPointerEnter(AUTO_BACKGROUND_ID, event)}
              onPointerLeave={(event) => onBgPointerLeave(AUTO_BACKGROUND_ID, event)}
              onPointerCancel={() => onBgPointerCancel(AUTO_BACKGROUND_ID)}
              onFocus={() => onBgFocus(AUTO_BACKGROUND_ID)}
              onBlur={() => restoreSelectedBackground(AUTO_BACKGROUND_ID)}
              onClick={() => selectBackground(AUTO_BACKGROUND_ID)}
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
