// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * loader — on-demand fetch of a single background's render module.
 *
 * Each entry is an explicit `() => import(...)` so Vite/Rollup splits every
 * variant into its own lazy chunk; only the active background's chunk is ever
 * fetched. Metadata (id/label/kind) is served synchronously by ./catalogue —
 * this module is only touched by <Background> once it knows which variant to
 * render, so the picker never pulls render code.
 */
import type { AnyBackgroundVariant, BackgroundVariant, SceneVariant } from './engine';

type VariantLoader = () => Promise<BackgroundVariant>;
type SceneLoader = () => Promise<SceneVariant>;

const CANVAS_LOADERS: Record<string, VariantLoader> = {
  'deep-current': () => import('./variants/deep-current').then((m) => m.deepCurrent),
  bioluminescence: () => import('./variants/bioluminescence').then((m) => m.bioluminescence),
  caustics: () => import('./variants/caustics').then((m) => m.caustics),
  aurora: () => import('./variants/aurora').then((m) => m.aurora),
  'pyrite-field': () => import('./variants/pyrite-field').then((m) => m.pyriteField),
  'kintsugi-veins': () => import('./variants/kintsugi-veins').then((m) => m.kintsugiVeins),
  ember: () => import('./variants/ember').then((m) => m.ember),
  forest: () => import('./variants/forest').then((m) => m.forest),
  resin: () => import('./variants/resin').then((m) => m.resin),
  'sumi-e': () => import('./variants/sumi-e').then((m) => m.sumiE),
  mist: () => import('./variants/mist').then((m) => m.mist),
  frost: () => import('./variants/frost').then((m) => m.frost),
  obsidian: () => import('./variants/obsidian').then((m) => m.obsidian),
  'lapis-gradient': () => import('./variants/lapis-gradient').then((m) => m.lapisGradient),
  washi: () => import('./variants/washi').then((m) => m.washi),
};

const SCENE_LOADERS: Record<string, SceneLoader> = {
  'retro-arcade': () => import('./scenes/RetroArcade').then((m) => m.retroArcade),
  starfield: () => import('./scenes/Starfield').then((m) => m.starfield),
  lightning: () => import('./scenes/Lightning').then((m) => m.lightning),
  phoenix: () => import('./scenes/Phoenix').then((m) => m.phoenix),
  'aurora-borealis': () => import('./scenes/AuroraBorealis').then((m) => m.auroraBorealis),
  volcanic: () => import('./scenes/Volcanic').then((m) => m.volcanic),
  'tokyo-night': () => import('./scenes/TokyoNight').then((m) => m.tokyoNight),
};

/**
 * Fetch the render module for `id`. Resolves to the concrete variant (canvas or
 * scene) or `undefined` for an unknown id. The caller decides canvas vs scene
 * from the synchronous catalogue metadata before awaiting this.
 */
export async function loadBackgroundVariant(id: string | null | undefined): Promise<AnyBackgroundVariant | undefined> {
  if (id == null) return undefined;
  const canvas = CANVAS_LOADERS[id];
  if (canvas) return canvas();
  const scene = SCENE_LOADERS[id];
  if (scene) return scene();
  return undefined;
}
