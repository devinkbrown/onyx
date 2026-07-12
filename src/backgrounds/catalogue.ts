// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * catalogue — metadata-only background index.
 *
 * The picker (Appearance panel, Theme Studio, Spotlight command) only needs
 * `{ id, label, kind }` for every selectable background. This module carries
 * exactly that and imports NO variant render code, so the ~15 canvas variants +
 * 7 DOM/SVG scenes stay out of the eager app chunk. The active variant's render
 * module is fetched on demand by `loadBackgroundVariant` (see ./loader) — only
 * one background renders per session, so only one variant chunk is ever loaded.
 *
 * Keep this list in sync with ./variants + ./scenes (guarded by a test that
 * diffs it against the eager registry). Canvas variants come first (their order
 * is the picker order), then scenes.
 */
import type { BackgroundKind } from './engine';

export interface BackgroundMeta {
  id: string;
  label: string;
  kind: BackgroundKind;
}

/** Canvas-engine variants (init/frame/dispose). Order = picker order. */
const CANVAS_META: readonly BackgroundMeta[] = [
  { id: 'deep-current',   label: 'Deep Current',   kind: 'animated' },
  { id: 'bioluminescence', label: 'Bioluminescence', kind: 'animated' },
  { id: 'caustics',       label: 'Caustic Tide',   kind: 'animated' },
  { id: 'aurora',         label: 'Mineral Aurora', kind: 'animated' },
  { id: 'pyrite-field',   label: 'Pyrite Field',   kind: 'animated' },
  { id: 'kintsugi-veins', label: 'Gold Veins',     kind: 'animated' },
  { id: 'ember',          label: 'Ember',          kind: 'animated' },
  { id: 'forest',         label: 'Grove',          kind: 'animated' },
  { id: 'resin',          label: 'Resin',          kind: 'animated' },
  { id: 'sumi-e',         label: 'Sumi-e',         kind: 'animated' },
  { id: 'mist',           label: 'Mist',           kind: 'animated' },
  { id: 'frost',          label: 'Frost',          kind: 'animated' },
  { id: 'aurora-ribbons', label: 'Aurora Ribbons', kind: 'animated' },
  { id: 'tide-bands',     label: 'Tide Bands',     kind: 'animated' },
  { id: 'obsidian',       label: 'Obsidian',       kind: 'solid' },
  { id: 'lapis-gradient', label: 'Lapis Gradient', kind: 'solid' },
  { id: 'washi',          label: 'Paper Grain',    kind: 'solid' },
];

/** DOM/SVG scenes (Solid components). */
const SCENE_META: readonly BackgroundMeta[] = [
  { id: 'retro-arcade',   label: 'Retro Arcade',   kind: 'scene' },
  { id: 'starfield',      label: 'Starfield',      kind: 'scene' },
  { id: 'lightning',      label: 'Thunderstorm',   kind: 'scene' },
  { id: 'phoenix',        label: 'Phoenix',        kind: 'scene' },
  { id: 'aurora-borealis', label: 'Aurora Borealis', kind: 'scene' },
  { id: 'volcanic',       label: 'Volcanic',       kind: 'scene' },
  { id: 'tokyo-night',    label: 'Tokyo Night',    kind: 'scene' },
];

export const BACKGROUND_CATALOGUE: readonly BackgroundMeta[] = [...CANVAS_META, ...SCENE_META];

export type BackgroundId = (typeof BACKGROUND_CATALOGUE)[number]['id'];

/** For the picker: id + label + kind, in display order. */
export const backgroundOptions = BACKGROUND_CATALOGUE.map(({ id, label, kind }) => ({ id, label, kind }));

export const backgroundIds = BACKGROUND_CATALOGUE.map(({ id }) => id) as BackgroundId[];

export const backgroundLabels = BACKGROUND_CATALOGUE.map(({ id, label }) => ({ id, label }));

export const backgroundKinds = BACKGROUND_CATALOGUE.reduce<Record<string, BackgroundKind>>(
  (kinds, meta) => {
    kinds[meta.id] = meta.kind;
    return kinds;
  },
  {},
);

const CATALOGUE_BY_ID = new Map(BACKGROUND_CATALOGUE.map((meta) => [meta.id, meta]));

/** Metadata for an id, or undefined for an unknown id. No render code loaded. */
export function getBackgroundMeta(id: string | null | undefined): BackgroundMeta | undefined {
  return id == null ? undefined : CATALOGUE_BY_ID.get(id);
}

export function isBackgroundId(id: string | null | undefined): id is BackgroundId {
  return id != null && CATALOGUE_BY_ID.has(id);
}

export function isSceneId(id: string | null | undefined): boolean {
  return getBackgroundMeta(id)?.kind === 'scene';
}
