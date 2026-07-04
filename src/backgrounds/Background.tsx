import { createEffect, createSignal, onCleanup } from 'solid-js';
import { BackgroundEngine, type BackgroundQuality } from './engine';
import { getBackground, type BackgroundId } from './registry';

export interface BackgroundProps {
  id?: BackgroundId | string;
  quality?: BackgroundQuality;
}

export const DEFAULT_BACKGROUND_ID: BackgroundId = 'kintsugi-veins';
export const REDUCED_MOTION_BACKGROUND_ID: BackgroundId = 'lapis-gradient';

/**
 * Resolve the concrete variant to render. Reduced motion NO LONGER swaps to a
 * generic solid — the engine renders the theme's own scene as a still frame
 * (see `staticMode`), so a reduced-motion / low-power device still gets its
 * theme-coloured background, just frozen. Only a missing variant falls back.
 */
export function selectBackgroundId(id: string | undefined, _reducedMotion: boolean): BackgroundId {
  const requested = getBackground(id) ?? getBackground(DEFAULT_BACKGROUND_ID);
  return (requested?.id ?? REDUCED_MOTION_BACKGROUND_ID) as BackgroundId;
}

export function Background(props: BackgroundProps) {
  let canvas!: HTMLCanvasElement;
  const [reducedMotion, setReducedMotion] = createSignal(matchesReducedMotion());

  createEffect(() => {
    const query = getReducedMotionQuery();
    if (!query) return;

    const syncReducedMotion = () => setReducedMotion(query.matches);
    syncReducedMotion();

    if (query.addEventListener) {
      query.addEventListener('change', syncReducedMotion);
      onCleanup(() => query.removeEventListener('change', syncReducedMotion));
      return;
    }

    query.addListener?.(syncReducedMotion);
    onCleanup(() => query.removeListener?.(syncReducedMotion));
  });

  createEffect(() => {
    const reduce = reducedMotion();
    const selectedId = selectBackgroundId(props.id, reduce);
    const variant = getBackground(selectedId);
    if (!variant) return;

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

export default Background;

function matchesReducedMotion(): boolean {
  return getReducedMotionQuery()?.matches ?? false;
}

function getReducedMotionQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-reduced-motion: reduce)');
}
