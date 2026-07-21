// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AnyBackgroundVariant, BackgroundVariant } from './engine';
import { aurora } from './variants/aurora';
import { auroraRibbons } from './variants/aurora-ribbons';
import { bioluminescence } from './variants/bioluminescence';
import { caustics } from './variants/caustics';
import { deepCurrent } from './variants/deep-current';
import { ember } from './variants/ember';
import { forest } from './variants/forest';
import { frost } from './variants/frost';
import { goldVeins } from './variants/gold-veins';
import { lapisGradient } from './variants/lapis-gradient';
import { mist } from './variants/mist';
import { obsidian } from './variants/obsidian';
import { pyriteField } from './variants/pyrite-field';
import { resin } from './variants/resin';
import { inkWash } from './variants/ink-wash';
import { tideBands } from './variants/tide-bands';
import { paperGrain } from './variants/paper-grain';
import { sceneRegistry } from './scenes';

/** Canvas-engine variants only — everything here runs init/frame/dispose. */
export const backgroundRegistry = [
  deepCurrent,
  bioluminescence,
  caustics,
  aurora,
  pyriteField,
  goldVeins,
  ember,
  forest,
  resin,
  inkWash,
  mist,
  frost,
  auroraRibbons,
  tideBands,
  obsidian,
  lapisGradient,
  paperGrain,
] as const satisfies readonly BackgroundVariant[];

export { sceneRegistry };

/**
 * Every selectable background as EAGER variant objects (with init/frame/dispose
 * or a scene component). This pulls in all render code, so ONLY tests and the
 * catalogue-sync guard import it — the app renders via the metadata catalogue
 * (./catalogue) + on-demand loader (./loader) instead, keeping variant code out
 * of the eager app chunk.
 */
export const allBackgroundVariants = [
  ...backgroundRegistry,
  ...sceneRegistry,
] as const satisfies readonly AnyBackgroundVariant[];

// Picker metadata + id types now live in ./catalogue (single source of truth,
// no render code). Re-exported here so existing test imports keep resolving.
export {
  BACKGROUND_CATALOGUE,
  SIGNATURE_FAMILIES,
  backgroundOptions,
  backgroundIds,
  backgroundLabels,
  backgroundKinds,
  backgroundFamilies,
  backgroundsInFamily,
  getBackgroundMeta,
  getSignatureFamily,
  getSignatureFamilyMeta,
  isBackgroundId,
  resolveBackgroundId,
  type BackgroundId,
  type SignatureFamily,
  type SignatureFamilyMeta,
} from './catalogue';

/** Eager lookup by id — test-only; the app uses `loadBackgroundVariant`. */
export function getBackground(id: string | null | undefined): AnyBackgroundVariant | undefined {
  return allBackgroundVariants.find((variant) => variant.id === id);
}
