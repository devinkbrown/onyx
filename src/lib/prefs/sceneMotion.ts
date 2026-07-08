/**
 * sceneMotion.ts - user-driven background scene motion preference model.
 *
 * A tiny vanilla store (module-level Solid signal + localStorage), kept apart
 * from the broader preferences model until the settings integration pass wires
 * it into the app.
 */

import { createSignal, type Accessor } from 'solid-js';

export const SCENE_MOTIONS = ['animated', 'still', 'off'] as const;
export type SceneMotion = (typeof SCENE_MOTIONS)[number];

export const DEFAULT_SCENE_MOTION: SceneMotion = 'animated';

const STORAGE_KEY = 'onyx:scene-motion';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function isSceneMotion(value: unknown): value is SceneMotion {
  return typeof value === 'string' && (SCENE_MOTIONS as readonly string[]).includes(value);
}

export function loadSceneMotion(): SceneMotion {
  if (!hasStorage()) return DEFAULT_SCENE_MOTION;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isSceneMotion(stored) ? stored : DEFAULT_SCENE_MOTION;
  } catch {
    return DEFAULT_SCENE_MOTION;
  }
}

function persistSceneMotion(value: SceneMotion): void {
  if (!hasStorage()) return;

  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* storage unavailable / quota - non-fatal */
  }
}

/**
 * Reflect the current scene motion preference onto `document.documentElement`
 * so CSS can drive the background layer without touching the renderer.
 */
export function applySceneMotion(value: SceneMotion = sceneMotion()): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.sceneMotion = value;
}

const [sceneMotionAccessor, setSceneMotionSignal] = createSignal<SceneMotion>(loadSceneMotion());

export const sceneMotion: Accessor<SceneMotion> = sceneMotionAccessor;

export function setSceneMotion(value: SceneMotion): void {
  setSceneMotionSignal(value);
  persistSceneMotion(value);
  applySceneMotion(value);
}
