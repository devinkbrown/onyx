// SPDX-License-Identifier: AGPL-3.0-or-later
export { Background, default, selectBackgroundId } from './Background';
export type { BackgroundProps } from './Background';
export { BackgroundEngine, isSceneVariant } from './engine';
export type {
  AnyBackgroundVariant,
  BackgroundEngineOptions,
  BackgroundFrameContext,
  BackgroundKind,
  BackgroundQuality,
  BackgroundVariant,
  CanvasBackgroundKind,
  SceneProps,
  SceneVariant,
} from './engine';
// Picker metadata + on-demand loader only — NO eager variant render code. The
// eager registry (allBackgroundVariants / backgroundRegistry / getBackground)
// is test-only and imported directly from './registry', so it never reaches the
// app chunk through this barrel.
export {
  BACKGROUND_CATALOGUE,
  SIGNATURE_FAMILIES,
  backgroundFamilies,
  backgroundIds,
  backgroundKinds,
  backgroundLabels,
  backgroundOptions,
  backgroundsInFamily,
  getBackgroundMeta,
  getSignatureFamily,
  getSignatureFamilyMeta,
  isBackgroundId,
  isSceneId,
  resolveBackgroundId,
} from './catalogue';
export type { BackgroundId, BackgroundMeta, SignatureFamily, SignatureFamilyMeta } from './catalogue';
export { loadBackgroundVariant } from './loader';
