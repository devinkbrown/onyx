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
export {
  allBackgroundVariants,
  backgroundIds,
  backgroundKinds,
  backgroundLabels,
  backgroundOptions,
  backgroundRegistry,
  getBackground,
  sceneRegistry,
} from './registry';
export type { BackgroundId } from './registry';
