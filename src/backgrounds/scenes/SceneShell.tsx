import type { JSX } from 'solid-js';

/**
 * Deterministic PRNG (Lehmer / Park–Miller) so every mount renders the exact
 * same composition — scenes are seeded still-lifes, not random each load.
 */
export function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

export interface SceneShellProps {
  reducedMotion: boolean;
  /** Opaque base colorway painted under the scene layers. Scenes are fixed
   *  colorways (ported from darkbear) — they do NOT follow the active theme,
   *  so each brings its own backdrop instead of leaking the theme surface. */
  base: string;
  children: JSX.Element;
}

/**
 * Shared wrapper for DOM/SVG scene backgrounds. Fills the fixed container
 * mounted by <Background>, paints the scene's own base colorway, and freezes
 * every CSS animation when the user prefers reduced motion — prop-gated via
 * `data-scene-static`, with a `prefers-reduced-motion` media query as a
 * defence-in-depth fallback.
 */
export function SceneShell(props: SceneShellProps) {
  return (
    <div
      class="onyx-scene absolute inset-0 overflow-hidden"
      data-scene-static={props.reducedMotion ? 'true' : undefined}
      style={{ contain: 'layout style', background: props.base, 'pointer-events': 'none' }}
    >
      <style>{`
        .onyx-scene[data-scene-static], .onyx-scene[data-scene-static] * { animation: none !important; }
        @media (prefers-reduced-motion: reduce) { .onyx-scene, .onyx-scene * { animation: none !important; } }
      `}</style>
      {props.children}
    </div>
  );
}
