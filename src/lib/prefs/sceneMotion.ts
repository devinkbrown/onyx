// SPDX-License-Identifier: AGPL-3.0-or-later
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

export const SCENE_MOTION_STORAGE_KEY = 'onyx:scene-motion';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function isSceneMotion(value: unknown): value is SceneMotion {
  return typeof value === 'string' && (SCENE_MOTIONS as readonly string[]).includes(value);
}

export function parseSceneMotion(value: unknown): SceneMotion | null {
  return isSceneMotion(value) ? value : null;
}

export function loadSceneMotion(): SceneMotion {
  if (!hasStorage()) return DEFAULT_SCENE_MOTION;

  try {
    const stored = localStorage.getItem(SCENE_MOTION_STORAGE_KEY);
    return isSceneMotion(stored) ? stored : DEFAULT_SCENE_MOTION;
  } catch {
    return DEFAULT_SCENE_MOTION;
  }
}

function persistSceneMotion(value: SceneMotion): void {
  if (!hasStorage()) return;

  try {
    localStorage.setItem(SCENE_MOTION_STORAGE_KEY, value);
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

export function resetSceneMotion(): void {
  setSceneMotion(DEFAULT_SCENE_MOTION);
}

// Initialize every route, including the standalone Appearance route, before an
// AppShell exists. Also converge motion changes made in another browser tab;
// the storage event never fires in the tab that performed the write, whose
// setSceneMotion call has already updated the signal synchronously.
if (typeof window !== 'undefined') {
  applySceneMotion(sceneMotion());
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== SCENE_MOTION_STORAGE_KEY && event.key !== null) return;
    if (event.storageArea && event.storageArea !== localStorage) return;
    const next = loadSceneMotion();
    setSceneMotionSignal(next);
    applySceneMotion(next);
  });
}
