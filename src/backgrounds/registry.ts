import type { BackgroundKind, BackgroundVariant } from './engine';
import { aurora } from './variants/aurora';
import { deepCurrent } from './variants/deep-current';
import { kintsugiVeins } from './variants/kintsugi-veins';
import { lapisGradient } from './variants/lapis-gradient';
import { obsidian } from './variants/obsidian';
import { pyriteField } from './variants/pyrite-field';
import { washi } from './variants/washi';

export const backgroundRegistry = [
  deepCurrent,
  aurora,
  pyriteField,
  kintsugiVeins,
  obsidian,
  lapisGradient,
  washi,
] as const satisfies readonly BackgroundVariant[];

export type BackgroundId = (typeof backgroundRegistry)[number]['id'];

export const backgroundOptions = backgroundRegistry.map(({ id, label, kind }) => ({ id, label, kind }));

export const backgroundIds = backgroundRegistry.map(({ id }) => id) as BackgroundId[];

export const backgroundLabels = backgroundRegistry.map(({ id, label }) => ({ id, label }));

export const backgroundKinds = backgroundRegistry.reduce<Record<BackgroundId, BackgroundKind>>(
  (kinds, variant) => ({ ...kinds, [variant.id]: variant.kind }),
  {} as Record<BackgroundId, BackgroundKind>,
);

export function getBackground(id: string | null | undefined): BackgroundVariant | undefined {
  return backgroundRegistry.find((variant) => variant.id === id);
}
