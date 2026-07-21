// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * catalogue — metadata-only background index.
 *
 * The picker (Appearance panel, Theme Studio, Spotlight command) only needs
 * `{ id, label, kind, family }` for every selectable background. This module
 * carries exactly that and imports NO variant render code, so the ~17 canvas
 * variants + 7 DOM/SVG scenes stay out of the eager app chunk. The active
 * variant's render module is fetched on demand by `loadBackgroundVariant`
 * (see ./loader) — only one background renders per session, so only one
 * variant chunk is ever loaded.
 *
 * Consolidation: every canvas id is a *preset of* one of five
 * signature families of the shared "Ink on Living Paper" pipeline
 * (ground + ink + grain + vignette + seal). IDs are preserved for theme
 * `signatureBg` bindings and existing prefs; the family field is the grouping
 * surface. DOM scenes share SceneShell legibility overlays and form their own
 * family. Keep this list in sync with ./variants + ./scenes (guarded by a
 * test that diffs it against the eager registry).
 */
import type { BackgroundKind } from './engine';

/**
 * Signature families of the Ink-on-Living-Paper system. Canvas presets map
 * 1:N into the five ink families; DOM/SVG scenes share the `scene` family.
 *
 */
export type SignatureFamily =
  | 'ink-drift'
  | 'gold-seam'
  | 'deep-current'
  | 'ember-field'
  | 'paper-still'
  | 'scene';

export interface SignatureFamilyMeta {
  id: SignatureFamily;
  label: string;
  /** Short picker blurb — what the family contributes as its ink character. */
  blurb: string;
}

/** Ordered family catalogue — picker group order. */
export const SIGNATURE_FAMILIES: readonly SignatureFamilyMeta[] = [
  { id: 'ink-drift', label: 'Ink Drift', blurb: 'Ink blooms and rain on living paper' },
  { id: 'gold-seam', label: 'Gold Seam', blurb: 'Gold seams on a dark ground' },
  { id: 'deep-current', label: 'Deep Current', blurb: 'Cool water, light, and tide' },
  { id: 'ember-field', label: 'Ember Field', blurb: 'Warm glow and banked fire' },
  { id: 'paper-still', label: 'Paper Still', blurb: 'Paper, grain, and quiet seal' },
  { id: 'scene', label: 'Scenes', blurb: 'Fixed-colorway DOM/SVG set pieces' },
] as const;

export interface BackgroundMeta {
  id: string;
  label: string;
  kind: BackgroundKind;
  /** Signature family this preset belongs to (grouping, not a render path). */
  family: SignatureFamily;
}

/** Canvas-engine variants (init/frame/dispose). Order = picker order. */
const CANVAS_META: readonly BackgroundMeta[] = [
  { id: 'deep-current',    label: 'Deep Current',    kind: 'animated', family: 'deep-current' },
  { id: 'bioluminescence', label: 'Bioluminescence', kind: 'animated', family: 'deep-current' },
  { id: 'caustics',        label: 'Caustic Tide',    kind: 'animated', family: 'deep-current' },
  { id: 'aurora',          label: 'Mineral Aurora',  kind: 'animated', family: 'deep-current' },
  { id: 'pyrite-field',    label: 'Pyrite Field',    kind: 'animated', family: 'gold-seam' },
  { id: 'gold-veins',      label: 'Gold Veins',      kind: 'animated', family: 'gold-seam' },
  { id: 'ember',           label: 'Ember',           kind: 'animated', family: 'ember-field' },
  { id: 'forest',          label: 'Grove',           kind: 'animated', family: 'ember-field' },
  { id: 'resin',           label: 'Resin',           kind: 'animated', family: 'ember-field' },
  { id: 'ink-wash',        label: 'Ink wash',        kind: 'animated', family: 'ink-drift' },
  { id: 'mist',            label: 'Mist',            kind: 'animated', family: 'ink-drift' },
  { id: 'frost',           label: 'Frost',           kind: 'animated', family: 'ink-drift' },
  { id: 'aurora-ribbons',  label: 'Aurora Ribbons',  kind: 'animated', family: 'deep-current' },
  { id: 'tide-bands',      label: 'Tide Bands',      kind: 'animated', family: 'deep-current' },
  { id: 'obsidian',        label: 'Obsidian',        kind: 'solid',    family: 'paper-still' },
  { id: 'lapis-gradient',  label: 'Lapis Gradient',  kind: 'solid',    family: 'gold-seam' },
  { id: 'paper-grain',     label: 'Paper grain',     kind: 'solid',    family: 'paper-still' },
];

/** DOM/SVG scenes (Solid components). */
const SCENE_META: readonly BackgroundMeta[] = [
  { id: 'retro-arcade',    label: 'Retro Arcade',    kind: 'scene', family: 'scene' },
  { id: 'starfield',       label: 'Starfield',       kind: 'scene', family: 'scene' },
  { id: 'lightning',       label: 'Thunderstorm',    kind: 'scene', family: 'scene' },
  { id: 'phoenix',         label: 'Phoenix',         kind: 'scene', family: 'scene' },
  { id: 'aurora-borealis', label: 'Aurora Borealis', kind: 'scene', family: 'scene' },
  { id: 'volcanic',        label: 'Volcanic',        kind: 'scene', family: 'scene' },
  { id: 'neon-night',      label: 'Neon night',      kind: 'scene', family: 'scene' },
];

export const BACKGROUND_CATALOGUE: readonly BackgroundMeta[] = [...CANVAS_META, ...SCENE_META];

export type BackgroundId = (typeof BACKGROUND_CATALOGUE)[number]['id'];

/** For the picker: id + label + kind + family, in display order. */
export const backgroundOptions = BACKGROUND_CATALOGUE.map(({ id, label, kind, family }) => ({
  id,
  label,
  kind,
  family,
}));

export const backgroundIds = BACKGROUND_CATALOGUE.map(({ id }) => id) as BackgroundId[];

export const backgroundLabels = BACKGROUND_CATALOGUE.map(({ id, label }) => ({ id, label }));

export const backgroundKinds = BACKGROUND_CATALOGUE.reduce<Record<string, BackgroundKind>>(
  (kinds, meta) => {
    kinds[meta.id] = meta.kind;
    return kinds;
  },
  {},
);

export const backgroundFamilies = BACKGROUND_CATALOGUE.reduce<Record<string, SignatureFamily>>(
  (families, meta) => {
    families[meta.id] = meta.family;
    return families;
  },
  {},
);

const CATALOGUE_BY_ID = new Map(BACKGROUND_CATALOGUE.map((meta) => [meta.id, meta]));
const FAMILY_BY_ID = new Map(SIGNATURE_FAMILIES.map((meta) => [meta.id, meta]));

/**
 * Legacy public ids retained as aliases so stored prefs and theme `signatureBg`
 * values written before the rename still resolve. The canonical catalogue id is
 * what the picker shows and what the loader fetches.
 */
const LEGACY_ID_ALIASES: Readonly<Record<string, BackgroundId>> = {
  'kintsugi-veins': 'gold-veins',
  'sumi-e': 'ink-wash',
  washi: 'paper-grain',
  'tokyo-night': 'neon-night',
  // Half-finished rename that briefly landed in themes before ink-wash settled.
  'ink-e': 'ink-wash',
};

/** Resolve a possibly-legacy id to its canonical catalogue id. */
export function resolveBackgroundId(id: string | null | undefined): BackgroundId | undefined {
  if (id == null) return undefined;
  if (CATALOGUE_BY_ID.has(id)) return id as BackgroundId;
  return LEGACY_ID_ALIASES[id];
}

/** Metadata for an id (or legacy alias), or undefined for an unknown id. No render code loaded. */
export function getBackgroundMeta(id: string | null | undefined): BackgroundMeta | undefined {
  const canonical = resolveBackgroundId(id);
  return canonical == null ? undefined : CATALOGUE_BY_ID.get(canonical);
}

/** True for a canonical catalogue id *or* a known legacy alias. */
export function isBackgroundId(id: string | null | undefined): boolean {
  return resolveBackgroundId(id) != null;
}

export function isSceneId(id: string | null | undefined): boolean {
  return getBackgroundMeta(id)?.kind === 'scene';
}

/** Signature family for an id, or undefined for an unknown id. */
export function getSignatureFamily(id: string | null | undefined): SignatureFamily | undefined {
  return getBackgroundMeta(id)?.family;
}

/** Family metadata, or undefined for an unknown family id. */
export function getSignatureFamilyMeta(
  family: SignatureFamily | null | undefined,
): SignatureFamilyMeta | undefined {
  return family == null ? undefined : FAMILY_BY_ID.get(family);
}

/** All catalogue entries belonging to a signature family, in picker order. */
export function backgroundsInFamily(family: SignatureFamily): readonly BackgroundMeta[] {
  return BACKGROUND_CATALOGUE.filter((meta) => meta.family === family);
}
