// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { startSceneRuntime } from './sceneRuntime';

type SvgTimeline = SVGSVGElement & {
  pauseAnimations?: () => void;
  unpauseAnimations?: () => void;
};

type SvgTimelineController = SvgTimeline & {
  pauseAnimations: () => void;
  unpauseAnimations: () => void;
};

function hasSvgTimelineController(svg: SvgTimeline): svg is SvgTimelineController {
  return typeof svg.pauseAnimations === 'function' && typeof svg.unpauseAnimations === 'function';
}

function callSvgTimelineMethod(
  svg: SvgTimeline,
  method: 'pauseAnimations' | 'unpauseAnimations',
): boolean {
  const callback = svg[method];
  if (typeof callback !== 'function') return false;

  try {
    callback.call(svg);
    return true;
  } catch {
    // Some browsers expose partial SMIL APIs that throw for inactive SVGs.
    return false;
  }
}

function syncSvgTimelines(
  root: HTMLDivElement,
  shouldPause: boolean,
  pausedTimelines: Set<SvgTimeline>,
): void {
  if (shouldPause) {
    for (const svg of pausedTimelines) {
      if (!root.contains(svg)) pausedTimelines.delete(svg);
    }
    for (const svg of root.querySelectorAll<SvgTimeline>('svg')) {
      if (pausedTimelines.has(svg) || !hasSvgTimelineController(svg)) continue;
      if (callSvgTimelineMethod(svg, 'pauseAnimations')) pausedTimelines.add(svg);
    }
    return;
  }

  for (const svg of pausedTimelines) {
    if (!root.contains(svg)) {
      pausedTimelines.delete(svg);
      continue;
    }
    if (callSvgTimelineMethod(svg, 'unpauseAnimations')) pausedTimelines.delete(svg);
  }
}

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
  const [runtimePaused, setRuntimePaused] = createSignal(false);
  const pausedTimelines = new Set<SvgTimeline>();
  let root: HTMLDivElement | undefined;

  onMount(() => {
    const dispose = startSceneRuntime(setRuntimePaused);
    onCleanup(dispose);
  });

  createEffect(() => {
    // Read both sources even when the first is true. A Still -> Animated change
    // while the runtime remains paused must not resume the SMIL timeline.
    const runtimePauseActive = runtimePaused();
    const reducedMotionActive = props.reducedMotion;
    if (root) {
      syncSvgTimelines(root, runtimePauseActive || reducedMotionActive, pausedTimelines);
    }
  });

  return (
    <div
      ref={root}
      class="onyx-scene absolute inset-0 overflow-hidden"
      data-scene-static={props.reducedMotion ? 'true' : undefined}
      data-scene-runtime-paused={runtimePaused() ? 'true' : undefined}
      style={{ contain: 'layout style', background: props.base, 'pointer-events': 'none' }}
    >
      <style>{`
        .onyx-scene[data-scene-static], .onyx-scene[data-scene-static] * { animation: none !important; }
        .onyx-scene[data-scene-runtime-paused],
        .onyx-scene[data-scene-runtime-paused] *,
        .onyx-scene[data-scene-runtime-paused] *::before,
        .onyx-scene[data-scene-runtime-paused] *::after { animation-play-state: paused !important; }
        @media (prefers-reduced-motion: reduce) { .onyx-scene, .onyx-scene * { animation: none !important; } }
      `}</style>
      {props.children}
    </div>
  );
}
