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
import { resolveBackgroundId } from './catalogue';

type VariantLoader = () => Promise<BackgroundVariant>;
type SceneLoader = () => Promise<SceneVariant>;

const CANVAS_LOADERS: Record<string, VariantLoader> = {
  'deep-current': () => import('./variants/deep-current').then((m) => m.deepCurrent),
  bioluminescence: () => import('./variants/bioluminescence').then((m) => m.bioluminescence),
  caustics: () => import('./variants/caustics').then((m) => m.caustics),
  aurora: () => import('./variants/aurora').then((m) => m.aurora),
  'pyrite-field': () => import('./variants/pyrite-field').then((m) => m.pyriteField),
  'gold-veins': () => import('./variants/gold-veins').then((m) => m.goldVeins),
  ember: () => import('./variants/ember').then((m) => m.ember),
  forest: () => import('./variants/forest').then((m) => m.forest),
  resin: () => import('./variants/resin').then((m) => m.resin),
  'ink-wash': () => import('./variants/ink-wash').then((m) => m.inkWash),
  mist: () => import('./variants/mist').then((m) => m.mist),
  frost: () => import('./variants/frost').then((m) => m.frost),
  'aurora-ribbons': () => import('./variants/aurora-ribbons').then((m) => m.auroraRibbons),
  'tide-bands': () => import('./variants/tide-bands').then((m) => m.tideBands),
  obsidian: () => import('./variants/obsidian').then((m) => m.obsidian),
  'lapis-gradient': () => import('./variants/lapis-gradient').then((m) => m.lapisGradient),
  'paper-grain': () => import('./variants/paper-grain').then((m) => m.paperGrain),
};

const SCENE_LOADERS: Record<string, SceneLoader> = {
  'retro-arcade': () => import('./scenes/RetroArcade').then((m) => m.retroArcade),
  starfield: () => import('./scenes/Starfield').then((m) => m.starfield),
  lightning: () => import('./scenes/Lightning').then((m) => m.lightning),
  phoenix: () => import('./scenes/Phoenix').then((m) => m.phoenix),
  'aurora-borealis': () => import('./scenes/AuroraBorealis').then((m) => m.auroraBorealis),
  volcanic: () => import('./scenes/Volcanic').then((m) => m.volcanic),
  'neon-night': () => import('./scenes/NeonNight').then((m) => m.neonNight),
};

/**
 * Fetch the render module for `id`. Resolves to the concrete variant (canvas or
 * scene) or `undefined` for an unknown id / failed chunk fetch. Import failures
 * (stale, missing, or network-failed hashed chunks a tab still references)
 * resolve to `undefined` instead of rejecting — `<Background>` keeps the inert
 * placeholder and a later different selection reloads cleanly.
 *
 * The caller decides canvas vs scene from the synchronous catalogue metadata
 * before awaiting this when it needs kind; a failed load looks like "no variant".
 */
export async function loadBackgroundVariant(id: string | null | undefined): Promise<AnyBackgroundVariant | undefined> {
  const canonical = resolveBackgroundId(id);
  if (canonical == null) return undefined;
  try {
    const canvas = CANVAS_LOADERS[canonical];
    if (canvas) return await canvas();
    const scene = SCENE_LOADERS[canonical];
    if (scene) return await scene();
    return undefined;
  } catch {
    // Stale/missing/network chunk failure. Do not poison createResource's error
    // channel (which would throw on read and can blank the shell). Placeholder +
    // later selection is the recovery path.
    return undefined;
  }
}
