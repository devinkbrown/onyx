// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AnyBackgroundVariant, BackgroundKind, BackgroundVariant } from './engine';
import { aurora } from './variants/aurora';
import { bioluminescence } from './variants/bioluminescence';
import { caustics } from './variants/caustics';
import { deepCurrent } from './variants/deep-current';
import { ember } from './variants/ember';
import { forest } from './variants/forest';
import { frost } from './variants/frost';
import { kintsugiVeins } from './variants/kintsugi-veins';
import { lapisGradient } from './variants/lapis-gradient';
import { mist } from './variants/mist';
import { obsidian } from './variants/obsidian';
import { pyriteField } from './variants/pyrite-field';
import { resin } from './variants/resin';
import { sumiE } from './variants/sumi-e';
import { washi } from './variants/washi';
import { sceneRegistry } from './scenes';

/** Canvas-engine variants only — everything here runs init/frame/dispose. */
export const backgroundRegistry = [
  deepCurrent,
  bioluminescence,
  caustics,
  aurora,
  pyriteField,
  kintsugiVeins,
  ember,
  forest,
  resin,
  sumiE,
  mist,
  frost,
  obsidian,
  lapisGradient,
  washi,
] as const satisfies readonly BackgroundVariant[];

export { sceneRegistry };

/** Every selectable background: canvas variants first, then DOM scenes. */
export const allBackgroundVariants = [
  ...backgroundRegistry,
  ...sceneRegistry,
] as const satisfies readonly AnyBackgroundVariant[];

export type BackgroundId = (typeof allBackgroundVariants)[number]['id'];

export const backgroundOptions = allBackgroundVariants.map(({ id, label, kind }) => ({ id, label, kind }));

export const backgroundIds = allBackgroundVariants.map(({ id }) => id) as BackgroundId[];

export const backgroundLabels = allBackgroundVariants.map(({ id, label }) => ({ id, label }));

export const backgroundKinds = allBackgroundVariants.reduce<Record<BackgroundId, BackgroundKind>>(
  (kinds, variant) => ({ ...kinds, [variant.id]: variant.kind }),
  {} as Record<BackgroundId, BackgroundKind>,
);

export function getBackground(id: string | null | undefined): AnyBackgroundVariant | undefined {
  return allBackgroundVariants.find((variant) => variant.id === id);
}
