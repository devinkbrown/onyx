// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createMemo, createResource, onCleanup, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  BackgroundEngine,
  isSceneVariant,
  type BackgroundQuality,
  type BackgroundVariant,
  type SceneVariant,
} from './engine';
import { resolveBackgroundId, type BackgroundId } from './catalogue';
import { loadBackgroundVariant } from './loader';
import { preferences } from '@/lib/prefs/preferences';
import { sceneMotion } from '@/lib/prefs/sceneMotion';
import { makeMediaSignal } from '@/lib/a11y/mediaPrefs';
import { makeReducedDataSignal } from '@/lib/a11y/reducedData';

export interface BackgroundProps {
  id?: BackgroundId | string;
  quality?: BackgroundQuality;
}

export const DEFAULT_BACKGROUND_ID: BackgroundId = 'gold-veins';
export const REDUCED_MOTION_BACKGROUND_ID: BackgroundId = 'lapis-gradient';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Resolve the id of the background to render. Reduced motion NO LONGER swaps to
 * a generic solid — the engine renders the theme's own scene as a still frame
 * (see `staticMode`), so a reduced-motion / low-power device still gets its
 * theme-coloured background, just frozen. Only an unknown id falls back. Legacy
 * ids (pre-rename prefs / signatureBg) resolve to their canonical catalogue
 * id. This is metadata-only (no render code loaded), so the picker stays light.
 */
export function selectBackgroundId(id: string | undefined, _reducedMotion: boolean): BackgroundId {
  return resolveBackgroundId(id) ?? DEFAULT_BACKGROUND_ID;
}

export function Background(props: BackgroundProps) {
  const reducedMotion = makeMediaSignal(REDUCED_MOTION_QUERY);
  const reducedData = makeReducedDataSignal();
  const motion = createMemo(() => sceneMotion());
  const sceneDisabled = createMemo(() => motion() === 'off');
  const effectiveReducedMotion = createMemo(() => reducedMotion() || preferences().reduceMotion || motion() === 'still');

  // Metadata (id + kind) resolves synchronously from the catalogue; the heavy
  // render module is fetched on demand so only the ACTIVE variant's chunk loads.
  // An undefined resource source is Solid's explicit "do not fetch" state.
  // Keep Off outside the lazy-loader entirely; restoring Animated/Still changes
  // this source back to an id and loads the selected renderer normally.
  const activeId = createMemo(() => sceneDisabled() || reducedData()
    ? undefined
    : selectBackgroundId(props.id, effectiveReducedMotion()));
  const [variant] = createResource(activeId, loadBackgroundVariant);

  const scene = createMemo(() => {
    const active = variant();
    return active && isSceneVariant(active) ? active : undefined;
  });
  const canvasVariant = createMemo(() => {
    const active = variant();
    return active && !isSceneVariant(active) ? active : undefined;
  });

  return (
    <Show when={!sceneDisabled()} fallback={null}>
      <Show when={!reducedData()} fallback={<BackgroundPlaceholder reducedData={true} />}>
        <Show
          when={variant()}
          // First paint isn't blocked on the variant chunk: show a frozen themed
          // frame (matching the reduced-motion still) until it resolves.
          fallback={<BackgroundPlaceholder reducedData={false} />}
        >
          <Show
            when={scene()}
            fallback={<CanvasBackground variant={canvasVariant()} quality={props.quality} reducedMotion={effectiveReducedMotion()} />}
          >
            {(active) => <SceneBackground scene={active()} reducedMotion={effectiveReducedMotion()} />}
          </Show>
        </Show>
      </Show>
    </Show>
  );
}

/**
 * Static themed frame shown for the one tick between mount and the active
 * variant's chunk resolving. Matches the app's base surface so there's no flash
 * and no layout work — a fixed, non-interactive, painter-only layer.
 */
function BackgroundPlaceholder(props: { reducedData: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-background-canvas="true"
      data-background-placeholder="true"
      data-background-kind="solid"
      data-background-reduced-data={props.reducedData ? 'true' : undefined}
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

export default Background;

/** Canvas-engine path: renders a <canvas> driven by BackgroundEngine. */
function CanvasBackground(props: {
  variant: BackgroundVariant | undefined;
  quality?: BackgroundQuality;
  reducedMotion: boolean;
}) {
  let canvas!: HTMLCanvasElement;

  createEffect(() => {
    const variant = props.variant;
    if (!variant) return;

    const reduce = props.reducedMotion;
    canvas.dataset.backgroundId = variant.id;
    // Report the effective kind so tests/telemetry see a reduced-motion scene
    // as static even though its variant is authored 'animated'.
    canvas.dataset.backgroundKind = reduce ? 'solid' : variant.kind;

    const engine = new BackgroundEngine({
      canvas,
      variant,
      quality: props.quality ?? 'high',
      staticMode: reduce,
    });

    engine.start();
    onCleanup(() => engine.dispose());
  });

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      data-background-canvas="true"
      style={{
        position: 'fixed',
        inset: '0',
        width: '100%',
        height: '100%',
        'z-index': '-1',
        'pointer-events': 'none',
        display: 'block',
      }}
    />
  );
}

/**
 * Scene path: renders a DOM/SVG scene component inside a fixed full-screen
 * container. The container carries `data-background-canvas` so the mobile
 * visibility filter in global.css applies to scenes exactly like canvases.
 */
function SceneBackground(props: { scene: SceneVariant; reducedMotion: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-background-canvas="true"
      data-background-id={props.scene.id}
      data-background-kind={props.reducedMotion ? 'solid' : 'scene'}
      style={{
        position: 'fixed',
        inset: '0',
        'z-index': '-1',
        'pointer-events': 'none',
        overflow: 'hidden',
      }}
    >
      <Dynamic component={props.scene.component} reducedMotion={props.reducedMotion} />
    </div>
  );
}
