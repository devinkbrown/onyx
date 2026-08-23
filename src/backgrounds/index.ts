// SPDX-License-Identifier: AGPL-3.0-or-later
export { Background, default, DEFAULT_BACKGROUND_ID, selectBackgroundId } from './Background';
export type { BackgroundProps } from './Background';
export { SceneAtmosphere } from './SceneAtmosphere';
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
export {
  applyBackgroundPolicyDataset,
  applyBackgroundRuntime,
  deriveBackgroundPolicy,
  shouldPauseWhenUnfocused,
  DESKTOP_DPR_CAP,
  DESKTOP_FRAME_CAP_FPS,
  MOBILE_DPR_CAP,
  MOBILE_FRAME_CAP_FPS,
  NARROW_VIEWPORT_MAX_PX,
  PREVIEW_DPR_CAP,
  PREVIEW_FRAME_CAP_FPS,
} from './backgroundPolicy';
export type {
  BackgroundMode,
  BackgroundPolicy,
  BackgroundPolicyInput,
  BackgroundPolicyReason,
  BackgroundRuntimeView,
  SceneDetail,
} from './backgroundPolicy';
// Picker metadata + on-demand loader. The ocean default (`deep-current`) is
// eager so a stale hashed lazy chunk cannot 404 the flagship scene. The full
// registry remains test-only (`./registry`) and does not ship through this barrel.
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
