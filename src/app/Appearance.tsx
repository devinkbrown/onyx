// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createMemo, createSignal, ErrorBoundary, For, onCleanup } from 'solid-js';
import { Background, type BackgroundId } from '@/backgrounds';
import { BackgroundPicker } from '@/backgrounds/picker/BackgroundPicker';
import { useTheme, THEMES, THEME_IDS } from '@/theme';
import { PublicLookPicker } from '@/theme/PublicLookPicker';
import { moveRadioGroup, swatchFromTokens } from '@/theme/publicLooks';
import { ThemeStudio } from '@/theme/ThemeStudio';
import { useStore, getState } from '@/lib/store';
import {
  DENSITIES,
  FONT_SCALES,
  preferences,
  setPreference,
  type Density,
  type FontScale,
} from '@/lib/prefs/preferences';
import { sceneMotion, setSceneMotion } from '@/lib/prefs/sceneMotion';
import { resolveBackgroundId } from '@/shell/themeBackground';
import './appearance.css';

type ThemeChip = { id: string; label: string; swatch: string[] };

const DENSITY_LABELS: Record<Density, string> = { compact: 'Compact', cozy: 'Cozy', roomy: 'Roomy' };
const FONT_SCALE_LABELS: Record<FontScale, string> = { sm: 'Small', md: 'Medium', lg: 'Large' };

function BackgroundFallback() {
  return <div aria-hidden="true" data-background-canvas="true" data-background-fallback="true" data-testid="background-fallback" class="ap-background-fallback" />;
}

/** Consumer appearance page. Theme Studio and the full catalogue stay under Advanced. */
export default function Appearance() {
  const theme = useTheme();
  const storedBackground = useStore((s) => s.backgroundId);
  const [candidate, setCandidate] = createSignal(storedBackground());
  const [preview, setPreview] = createSignal<string | null>(null);
  createEffect(() => setCandidate(storedBackground()));
  const renderedBackground = createMemo(() => resolveBackgroundId(preview() ?? candidate(), theme.themeId()) as BackgroundId);
  const dirty = createMemo(() => candidate() !== storedBackground());
  const previewMotion = createMemo(() => (
    sceneMotion() === 'off' && (preview() !== null || dirty()) ? 'still' : undefined
  ));
  let failedId: BackgroundId | undefined;
  let resetBoundary: (() => void) | undefined;
  createEffect(() => { if (failedId && renderedBackground() !== failedId) { failedId = undefined; resetBoundary?.(); resetBoundary = undefined; } });
  const apply = () => {
    getState().setBackground(candidate());
  };
  const cancel = () => { setPreview(null); setCandidate(storedBackground()); };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && dirty()) { event.preventDefault(); cancel(); } };
  onCleanup(() => setPreview(null));
  const themes = createMemo<ThemeChip[]>(() => [
    ...THEME_IDS.map((id) => ({ id, label: THEMES[id].label, swatch: swatchFromTokens(THEMES[id].tokens as Record<string, string>) })),
    ...theme.customThemes().map((item) => ({ id: item.id, label: item.name, swatch: ['var(--lapis)', 'var(--gold)', 'var(--shu)'] })),
  ]);
  return <main class="ap" onKeyDown={onKeyDown}>
    <ErrorBoundary fallback={(_error, reset) => { failedId = renderedBackground(); resetBoundary = reset; return <BackgroundFallback />; }}>
      <Background id={renderedBackground()} preview motionOverride={previewMotion()} />
    </ErrorBoundary>
    <header class="ap-bar"><a class="ap-back" href="/app/">← back to app</a><span class="ap-tag">Appearance</span><a class="ap-home" href="/">home</a></header>
    <section class="ap-wrap">
      <h1 class="ap-h1">Appearance</h1>
      <p class="ap-lede">Choose a look, text size, and motion. Changes apply on this device.</p>
      <section class="ap-group">
        <h2 class="ap-glabel">Look</h2>
        <PublicLookPicker class="ap-chips" groupLabel="Look" />
      </section>
      <section class="ap-group">
        <h2 class="ap-glabel">Text size</h2>
        <div class="ap-chips ap-chips--choices" role="radiogroup" aria-label="Text size">
          <For each={FONT_SCALES}>
            {(value) => (
              <button
                type="button"
                class="ap-chip"
                classList={{ on: preferences().fontScale === value }}
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
      <section class="ap-group">
        <h2 class="ap-glabel">Density</h2>
        <div class="ap-chips ap-chips--choices" role="radiogroup" aria-label="Density">
          <For each={DENSITIES}>
            {(value) => (
              <button
                type="button"
                class="ap-chip"
                classList={{ on: preferences().density === value }}
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
      <section class="ap-group">
        <h2 class="ap-glabel">Motion and data</h2>
        <div class="ap-choice-toggles">
          <button
            type="button"
            class="ap-choice-toggle"
            role="switch"
            aria-checked={preferences().reduceMotion}
            onClick={() => setPreference('reduceMotion', !preferences().reduceMotion)}
          >
            <span>Reduce motion</span>
            <b>{preferences().reduceMotion ? 'On' : 'Off'}</b>
          </button>
          <button
            type="button"
            class="ap-choice-toggle"
            role="switch"
            aria-checked={sceneMotion() === 'off'}
            onClick={() => setSceneMotion(sceneMotion() === 'off' ? 'adaptive' : 'off')}
          >
            <span>Use less data</span>
            <b>{sceneMotion() === 'off' ? 'On' : 'Off'}</b>
          </button>
        </div>
      </section>
      <details class="ap-studio" data-testid="appearance-advanced">
        <summary><span>Advanced</span><b>Theme Studio, more looks, and backgrounds</b></summary>
        <div class="ap-studio__body">
          <section class="ap-group">
            <h2 class="ap-glabel">All looks</h2>
            <div class="ap-chips" role="radiogroup" aria-label="All looks">
              <For each={themes()}>
                {(item) => (
                  <button
                    type="button"
                    class="ap-chip ap-chip--theme"
                    classList={{ on: theme.themeId() === item.id }}
                    role="radio"
                    aria-checked={theme.themeId() === item.id}
                    tabIndex={theme.themeId() === item.id ? 0 : -1}
                    onKeyDown={moveRadioGroup}
                    onClick={() => theme.setTheme(item.id)}
                  >
                    <span class="ap-swatch" aria-hidden="true">
                      <For each={item.swatch}>{(color) => <span style={{ background: color }} />}</For>
                    </span>
                    {item.label}
                  </button>
                )}
              </For>
            </div>
          </section>
          <section class="ap-group ap-background-stage">
            <div class="ap-background-stage__heading">
              <h2 class="ap-glabel">Background</h2>
              <span>{dirty() ? 'Preview only' : 'Saved'}</span>
            </div>
            <p class="ap-ghint">Focus or hover previews a background. Selection is staged until you apply.</p>
            <BackgroundPicker value={candidate} onSelect={setCandidate} onPreview={setPreview} />
            <div class="ap-background-actions">
              <button type="button" class="ap-action ap-action--quiet" disabled={!dirty()} onClick={cancel}>Cancel preview</button>
              <button type="button" class="ap-action ap-action--apply" disabled={!dirty()} onClick={apply}>Apply background</button>
            </div>
          </section>
          <ThemeStudio />
        </div>
      </details>
    </section>
  </main>;
}
