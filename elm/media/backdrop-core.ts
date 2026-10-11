// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * backdrop-core.ts — the DOM-light half of the Elm client's background
 * renderer (v3/gap-appearance). backdrop.ts mounts it as
 * `window.OnyxBackdrop`; ports.js forwards the Elm `backgroundScene` port
 * (`{ id, motion, reduceMotion, surface }`) to `render`.
 *
 * The painting is the SolidJS client's own canvas engine and its 17 canvas
 * variants (src/backgrounds/engine.ts + variants/*), unchanged; the policy is
 * its own `deriveBackgroundPolicy` (Adaptive freezes narrow/coarse surfaces,
 * reduced motion → still, reduced data / Off → nothing, fps and DPR caps,
 * desktop pause on blur, idle deceleration and a 60 s idle hold, paused while
 * the tab is hidden — all inside BackgroundEngine).
 *
 * The seven DOM/SVG "scenes" are Solid components and cannot run here; each
 * paints its closest canvas preset instead (`SCENE_FALLBACK`, reported on the
 * canvas as `data-background-fallback`).
 *
 * Fail-closed: an invalid spec renders nothing; a canvas without a 2D context
 * never claims `data-scene` on <html>, so the shell keeps its opaque ground.
 */
import { BackgroundEngine, type BackgroundVariant } from '@/backgrounds/engine';
import { deriveBackgroundPolicy, type BackgroundPolicy } from '@/backgrounds/backgroundPolicy';
import { aurora } from '@/backgrounds/variants/aurora';
import { auroraRibbons } from '@/backgrounds/variants/aurora-ribbons';
import { bioluminescence } from '@/backgrounds/variants/bioluminescence';
import { caustics } from '@/backgrounds/variants/caustics';
import { deepCurrent } from '@/backgrounds/variants/deep-current';
import { ember } from '@/backgrounds/variants/ember';
import { forest } from '@/backgrounds/variants/forest';
import { frost } from '@/backgrounds/variants/frost';
import { goldVeins } from '@/backgrounds/variants/gold-veins';
import { inkWash } from '@/backgrounds/variants/ink-wash';
import { lapisGradient } from '@/backgrounds/variants/lapis-gradient';
import { mist } from '@/backgrounds/variants/mist';
import { obsidian } from '@/backgrounds/variants/obsidian';
import { paperGrain } from '@/backgrounds/variants/paper-grain';
import { pyriteField } from '@/backgrounds/variants/pyrite-field';
import { resin } from '@/backgrounds/variants/resin';
import { tideBands } from '@/backgrounds/variants/tide-bands';

export type SceneMotion = 'adaptive' | 'animated' | 'still' | 'off';
export type SceneSurface = 'app' | 'appearance';

export interface SceneSpec {
  id: string;
  motion: SceneMotion;
  reduceMotion: boolean;
  surface: SceneSurface;
}

export interface SceneEnvironment {
  /** OS prefers-reduced-motion. */
  osReducedMotion: boolean;
  /** prefers-reduced-data or Network Information saveData. */
  reducedData: boolean;
  viewportWidth: number;
  coarsePointer: boolean;
  devicePixelRatio: number;
}

/** Every canvas preset, keyed by its catalogue id. */
export const CANVAS_VARIANTS: Readonly<Record<string, BackgroundVariant>> = Object.freeze({
  'deep-current': deepCurrent,
  bioluminescence,
  caustics,
  aurora,
  'pyrite-field': pyriteField,
  'gold-veins': goldVeins,
  ember,
  forest,
  resin,
  'ink-wash': inkWash,
  mist,
  frost,
  'aurora-ribbons': auroraRibbons,
  'tide-bands': tideBands,
  obsidian,
  'lapis-gradient': lapisGradient,
  'paper-grain': paperGrain,
});

/** DOM/SVG scenes → the canvas preset closest in colour and motion. */
export const SCENE_FALLBACK: Readonly<Record<string, string>> = Object.freeze({
  'retro-arcade': 'tide-bands',
  starfield: 'bioluminescence',
  lightning: 'mist',
  phoenix: 'ember',
  'aurora-borealis': 'aurora-ribbons',
  volcanic: 'ember',
  'neon-night': 'aurora-ribbons',
});

export const DEFAULT_VARIANT_ID = 'deep-current';

const MOTIONS: readonly string[] = ['adaptive', 'animated', 'still', 'off'];
const SURFACES: readonly string[] = ['app', 'appearance'];
const ID_RE = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * Validate a raw port payload. Anything malformed (or a surface that does
 * not host a scene) is `null`: nothing renders.
 */
export function parseSceneSpec(raw: unknown): SceneSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return null;
  if (typeof r.motion !== 'string' || !MOTIONS.includes(r.motion)) return null;
  if (typeof r.surface !== 'string' || !SURFACES.includes(r.surface)) return null;
  return {
    id: r.id,
    motion: r.motion as SceneMotion,
    reduceMotion: r.reduceMotion === true,
    surface: r.surface as SceneSurface,
  };
}

/** The canvas preset to paint for a catalogue id, and the scene it stands in for. */
export function resolveVariantId(id: string): { id: string; fallbackFrom: string | null } {
  if (Object.prototype.hasOwnProperty.call(CANVAS_VARIANTS, id)) return { id, fallbackFrom: null };
  const scene = Object.prototype.hasOwnProperty.call(SCENE_FALLBACK, id) ? SCENE_FALLBACK[id] : undefined;
  if (scene) return { id: scene, fallbackFrom: id };
  return { id: DEFAULT_VARIANT_ID, fallbackFrom: id };
}

/** The oracle presentation contract for one spec in one environment. */
export function policyFor(spec: SceneSpec, env: SceneEnvironment): BackgroundPolicy {
  return deriveBackgroundPolicy({
    sceneMotion: spec.motion,
    reducedMotion: env.osReducedMotion || spec.reduceMotion,
    reducedData: env.reducedData,
    viewportWidth: env.viewportWidth,
    coarsePointer: env.coarsePointer,
    devicePixelRatio: env.devicePixelRatio,
  });
}

export interface BackdropHost {
  /** Create (or return) the full-viewport canvas behind the app. */
  mountCanvas(): HTMLCanvasElement;
  /** Remove the canvas. */
  unmountCanvas(canvas: HTMLCanvasElement): void;
  /** `data-scene` on <html>: the live surface, or null when nothing paints. */
  setLive(surface: SceneSurface | null): void;
  environment(): SceneEnvironment;
  createEngine(canvas: HTMLCanvasElement, variant: BackgroundVariant, policy: BackgroundPolicy): EngineLike;
}

export interface EngineLike {
  start(): void;
  dispose(): void;
  applyPresentation(next: { quality: BackgroundPolicy['quality']; frameCapFps: number; dprCap: number; staticMode: boolean }): void;
  /** False when the canvas had no usable 2D context (the engine stopped itself). */
  readonly alive: boolean;
}

export interface Backdrop {
  render(raw: unknown): void;
  /** Re-derive the policy after an environment change (resize, media query). */
  refresh(): void;
  /** Diagnostics: what is painting right now. */
  state(): { id: string | null; mode: string; surface: string | null; fallbackFrom: string | null };
}

export function createBackdrop(host: BackdropHost): Backdrop {
  let spec: SceneSpec | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let engine: EngineLike | null = null;
  let variantId: string | null = null;
  let fallbackFrom: string | null = null;
  let mode = 'off';

  const teardown = (): void => {
    if (engine) {
      try { engine.dispose(); } catch { /* already gone */ }
    }
    engine = null;
    variantId = null;
    fallbackFrom = null;
    if (canvas) {
      try { host.unmountCanvas(canvas); } catch { /* detached */ }
    }
    canvas = null;
    mode = 'off';
    host.setLive(null);
  };

  const apply = (): void => {
    if (!spec) {
      teardown();
      return;
    }
    const policy = policyFor(spec, host.environment());
    if (policy.mode === 'off') {
      teardown();
      return;
    }
    const target = resolveVariantId(spec.id);
    const presentation = {
      quality: policy.quality,
      frameCapFps: policy.frameCapFps,
      dprCap: policy.dprCap,
      staticMode: policy.mode === 'still',
    };
    if (engine && variantId === target.id && engine.alive) {
      engine.applyPresentation(presentation);
    } else {
      teardown();
      const variant = CANVAS_VARIANTS[target.id] ?? CANVAS_VARIANTS[DEFAULT_VARIANT_ID];
      if (!variant) return;
      canvas = host.mountCanvas();
      canvas.dataset.backgroundId = target.id;
      if (target.fallbackFrom) canvas.dataset.backgroundFallback = target.fallbackFrom;
      else delete canvas.dataset.backgroundFallback;
      engine = host.createEngine(canvas, variant, policy);
      engine.start();
      if (!engine.alive) {
        // No 2D context: keep the shell's opaque ground (fail closed).
        teardown();
        return;
      }
      variantId = target.id;
      fallbackFrom = target.fallbackFrom;
    }
    mode = policy.mode;
    if (canvas) {
      canvas.dataset.backgroundMode = policy.mode;
      canvas.dataset.backgroundReason = policy.reason;
    }
    host.setLive(spec.surface);
  };

  return {
    render(raw: unknown): void {
      spec = parseSceneSpec(raw);
      apply();
    },
    refresh(): void {
      if (spec) apply();
    },
    state() {
      return { id: variantId, mode, surface: spec && variantId ? spec.surface : null, fallbackFrom };
    },
  };
}

/** The real engine behind `EngineLike` (live lease, oracle policy caps). */
export function startEngine(canvas: HTMLCanvasElement, variant: BackgroundVariant, policy: BackgroundPolicy): EngineLike {
  const engine = new BackgroundEngine({
    canvas,
    variant,
    quality: policy.quality,
    frameCapFps: policy.frameCapFps,
    dprCap: policy.dprCap,
    staticMode: policy.mode === 'still',
    live: true,
  });
  let started = false;
  return {
    start() {
      engine.start();
      started = true;
    },
    dispose() {
      engine.dispose();
    },
    applyPresentation(next) {
      engine.applyPresentation(next);
    },
    get alive() {
      // BackgroundEngine stops itself when getContext('2d') fails.
      return started && engine.canResumeLiveLease();
    },
  };
}
