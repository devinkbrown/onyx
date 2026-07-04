import type { SceneVariant } from '../engine';
import { auroraBorealis } from './AuroraBorealis';
import { lightning } from './Lightning';
import { phoenix } from './Phoenix';
import { retroArcade } from './RetroArcade';
import { starfield } from './Starfield';
import { tokyoNight } from './TokyoNight';
import { volcanic } from './Volcanic';

/**
 * DOM/SVG scene backgrounds ported from darkbear. Fixed colorways, selectable
 * from the background picker alongside the canvas variants; rendered by
 * <Background> as Solid components instead of the canvas engine.
 */
export const sceneRegistry = [
  retroArcade,
  starfield,
  lightning,
  phoenix,
  auroraBorealis,
  volcanic,
  tokyoNight,
] as const satisfies readonly SceneVariant[];

export { SceneShell, seededRand } from './SceneShell';
