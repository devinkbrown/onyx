// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * backdrop.ts — bundle entry that mounts `window.OnyxBackdrop` for the Elm
 * client (built by elm/media/build-backdrop.mjs → backdrop.<hash>.js, loaded
 * by elm/index.html before ports.js). v3/gap-appearance.
 *
 * Browser glue only: one full-viewport <canvas id="onyx-scene"> appended to
 * <html> (Elm owns <body>'s children) at z-index -1 (behind the transcript,
 * never a hit target), the
 * `data-scene` flag on <html> that lets css/gap-appearance.css open the
 * shell's ground so the scene shows through a veil, and the environment
 * signals the oracle policy reads (OS reduced motion, reduced data, width,
 * coarse pointer, DPR) — re-derived when any of them changes.
 */
import { createBackdrop, startEngine, type SceneEnvironment, type SceneSurface } from './backdrop-core';

declare global {
  interface Window {
    OnyxBackdrop?: unknown;
  }
}

(function mountOnyxBackdrop() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || window.OnyxBackdrop) return;

  const media = (query: string): MediaQueryList | null => {
    try {
      return typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
    } catch {
      return null;
    }
  };
  const reducedMotionQuery = media('(prefers-reduced-motion: reduce)');
  const reducedDataQuery = media('(prefers-reduced-data: reduce)');
  const coarseQuery = media('(pointer: coarse)');

  const environment = (): SceneEnvironment => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const width = window.innerWidth;
    const dpr = window.devicePixelRatio;
    return {
      osReducedMotion: !!reducedMotionQuery?.matches,
      reducedData: !!reducedDataQuery?.matches || connection?.saveData === true,
      viewportWidth: Number.isFinite(width) && width > 0 ? width : 1024,
      coarsePointer: !!coarseQuery?.matches,
      devicePixelRatio: Number.isFinite(dpr) && dpr > 0 ? dpr : 1,
    };
  };

  const backdrop = createBackdrop({
    mountCanvas() {
      const existing = document.getElementById('onyx-scene');
      if (existing instanceof HTMLCanvasElement) existing.remove();
      const canvas = document.createElement('canvas');
      canvas.id = 'onyx-scene';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.dataset.backgroundCanvas = 'true';
      // Elm (Browser.application) owns <body>'s children and patches them by
      // index, so the canvas lives OUTSIDE body: a fixed layer under <html>.
      document.documentElement.appendChild(canvas);
      return canvas;
    },
    unmountCanvas(canvas) {
      canvas.remove();
    },
    setLive(surface: SceneSurface | null) {
      const root = document.documentElement;
      if (surface) root.dataset.scene = surface;
      else delete root.dataset.scene;
    },
    environment,
    createEngine: startEngine,
  });

  // The policy reads width / pointer / motion / data signals: re-derive when
  // they move (resize is coalesced to one animation frame).
  let resizeFrame = 0;
  const refresh = (): void => backdrop.refresh();
  window.addEventListener('resize', () => {
    if (resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      refresh();
    });
  }, { passive: true });
  for (const query of [reducedMotionQuery, reducedDataQuery, coarseQuery]) {
    try {
      query?.addEventListener('change', refresh);
    } catch { /* legacy MediaQueryList without addEventListener */ }
  }

  window.OnyxBackdrop = Object.freeze({
    render: (spec: unknown) => backdrop.render(spec),
    state: () => backdrop.state(),
  });
})();
