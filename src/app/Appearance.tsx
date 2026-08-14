// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createMemo, createSignal, ErrorBoundary, For, onCleanup, Show } from 'solid-js';
import { Background, type BackgroundId } from '@/backgrounds';
import { BackgroundPicker } from '@/backgrounds/picker/BackgroundPicker';
import { useTheme, THEMES, THEME_IDS, type ThemeId } from '@/theme';
import { ThemeStudio } from '@/theme/ThemeStudio';
import { useStore, getState } from '@/lib/store';
import { sceneMotion, setSceneMotion } from '@/lib/prefs/sceneMotion';
import { resolveBackgroundId } from '@/shell/themeBackground';
import './appearance.css';

type ThemeChip = { id: string; label: string; swatch: string[] };

function themeSwatch(id: string): string[] {
  const tokens = THEMES[id as ThemeId]?.tokens;
  return [tokens?.['--lapis'] ?? '#2bb4f0', tokens?.['--gold'] ?? '#d8b96a', tokens?.['--shu'] ?? '#b45a50'];
}

function BackgroundFallback() {
  return <div aria-hidden="true" data-background-canvas="true" data-background-fallback="true" data-testid="background-fallback" class="ap-background-fallback" />;
}

/** The deliberate, staged appearance studio. A card changes the candidate;
 * Apply persists it, while transient 160ms previews never change preference. */
export default function Appearance() {
  const theme = useTheme();
  const storedBackground = useStore((s) => s.backgroundId);
  const [candidate, setCandidate] = createSignal(storedBackground());
  const [preview, setPreview] = createSignal<string | null>(null);
  createEffect(() => setCandidate(storedBackground()));
  const renderedBackground = createMemo(() => resolveBackgroundId(preview() ?? candidate(), theme.themeId()) as BackgroundId);
  const dirty = createMemo(() => candidate() !== storedBackground());
  const previewMotion = createMemo(() => (
    sceneMotion() === 'off' && (preview() !== null || dirty()) ? 'animated' : undefined
  ));
  let failedId: BackgroundId | undefined;
  let resetBoundary: (() => void) | undefined;
  createEffect(() => { if (failedId && renderedBackground() !== failedId) { failedId = undefined; resetBoundary?.(); resetBoundary = undefined; } });
  const apply = () => {
    if (sceneMotion() === 'off') setSceneMotion('animated');
    getState().setBackground(candidate());
  };
  const cancel = () => { setPreview(null); setCandidate(storedBackground()); };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && dirty()) { event.preventDefault(); cancel(); } };
  onCleanup(() => setPreview(null));
  const themes = createMemo<ThemeChip[]>(() => [
    ...THEME_IDS.map((id) => ({ id, label: THEMES[id].label, swatch: themeSwatch(id) })),
    ...theme.customThemes().map((item) => ({ id: item.id, label: item.name, swatch: ['var(--lapis)', 'var(--gold)', 'var(--shu)'] })),
  ]);
  const moveThemeRadio = (event: KeyboardEvent): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const current = event.currentTarget as HTMLButtonElement;
    const group = current.closest<HTMLElement>('.ap-chips');
    const radios = group ? [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')] : [];
    const index = radios.indexOf(current);
    if (index < 0 || radios.length === 0) return;
    event.preventDefault();
    const targetIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? radios.length - 1
        : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + radios.length) % radios.length;
    const target = radios[targetIndex];
    target?.focus();
    target?.click();
  };
  return <main class="ap" onKeyDown={onKeyDown}>
    <ErrorBoundary fallback={(_error, reset) => { failedId = renderedBackground(); resetBoundary = reset; return <BackgroundFallback />; }}>
      <Background id={renderedBackground()} preview motionOverride={previewMotion()} />
    </ErrorBoundary>
    <header class="ap-bar"><a class="ap-back" href="/app/">← back to app</a><span class="ap-tag">◆ · appearance</span><a class="ap-home" href="/">home</a></header>
    <section class="ap-wrap">
      <p class="ap-kicker">customization</p><h1 class="ap-h1">Set the <span class="gold">atmosphere</span></h1>
      <p class="ap-lede">Choose a background, let it settle in behind the page, then apply it when it feels right. <Show when={preview()}><span class="ap-lede-hint">Previewing now</span></Show></p>
      <section class="ap-group"><h2 class="ap-glabel">Theme</h2><div class="ap-chips" role="radiogroup" aria-label="Theme"><For each={themes()}>{(item) => <button type="button" class="ap-chip ap-chip--theme" classList={{ on: theme.themeId() === item.id }} role="radio" aria-checked={theme.themeId() === item.id} tabIndex={theme.themeId() === item.id ? 0 : -1} onKeyDown={moveThemeRadio} onClick={() => theme.setTheme(item.id)}><span class="ap-swatch" aria-hidden="true"><For each={item.swatch}>{(color) => <span style={{ background: color }} />}</For></span>{item.label}</button>}</For></div></section>
      <section class="ap-group ap-background-stage"><div class="ap-background-stage__heading"><h2 class="ap-glabel">Background</h2><span>{dirty() ? 'Not applied' : 'Applied'}</span></div><p class="ap-ghint">Hover or focus for a short live preview. On touch, choose a card then apply.</p><BackgroundPicker value={candidate} onSelect={setCandidate} onPreview={setPreview} /><div class="ap-background-actions"><button type="button" class="ap-action ap-action--quiet" disabled={!dirty()} onClick={cancel}>Cancel</button><button type="button" class="ap-action ap-action--apply" disabled={!dirty()} onClick={apply}>Apply background</button></div></section>
      <div class="ap-studio"><ThemeStudio /></div>
    </section>
  </main>;
}
