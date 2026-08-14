// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Explicit background presentation contract.
 *
 * One pure function decides whether a wallpaper may animate, how expensive it
 * is allowed to be, and *why*. Hosts (Background, canvas engine, SceneShell)
 * consume the result — they do not re-derive mobile/off/still rules locally.
 *
 * Narrow/mobile stays animated by default. Automatic Off is reserved for
 * reduced-data / explicit Off, never for viewport width or a coarse pointer.
 */
import type { BackgroundQuality } from './engine';
import type { SceneMotion } from '@/lib/prefs/sceneMotion';

export type BackgroundMode = 'animated' | 'still' | 'off';
export type SceneDetail = 'sparse' | 'balanced' | 'full';
export type BackgroundPolicyReason =
  | 'user'
  | 'reduced-motion'
  | 'reduced-data'
  | 'runtime-pressure';

export interface BackgroundPolicy {
  mode: BackgroundMode;
  quality: BackgroundQuality;
  frameCapFps: number;
  dprCap: number;
  sceneDetail: SceneDetail;
  reason: BackgroundPolicyReason;
}

export interface BackgroundPolicyInput {
  sceneMotion: SceneMotion;
  /** OS prefers-reduced-motion or the in-app reduceMotion preference. */
  reducedMotion: boolean;
  /** prefers-reduced-data or Network Information saveData. */
  reducedData: boolean;
  viewportWidth: number;
  coarsePointer: boolean;
  devicePixelRatio: number;
  /** Picker / studio preview — always low, sparse, and capped. */
  preview?: boolean;
  /**
   * Sustained FPS-guard pressure represented by the renderer's current tier.
   * This is a floor, not a request to raise quality when the host is already
   * cheaper. Keeping the tier lets the policy converge to the engine rather
   * than losing information in a boolean flag.
   */
  runtimeQuality?: BackgroundQuality;
  /** @deprecated compatibility for callers that only know pressure occurred. */
  runtimePressure?: boolean;
  /** Host-requested quality ceiling (AppShell may pass `high`; never raises). */
  qualityCeiling?: BackgroundQuality;
}

export interface BackgroundRuntimeHints {
  hidden?: boolean;
  unfocused?: boolean;
}

export interface BackgroundRuntimeView extends BackgroundPolicy {
  paused: boolean;
}

/** Matches the existing canvas-visibility lift breakpoint in global.css. */
export const NARROW_VIEWPORT_MAX_PX = 680;
/** Mobile/narrow live cadence — inside the 18–24 fps contract band. */
export const MOBILE_FRAME_CAP_FPS = 21;
/** Desktop live cadence — same as the engine default. */
export const DESKTOP_FRAME_CAP_FPS = 30;
/** Preview / picker tiles — cheap and capped. */
export const PREVIEW_FRAME_CAP_FPS = 12;
/** Floor after runtime pressure on an already-throttled surface. */
export const PRESSURE_FRAME_CAP_FPS = 18;
export const MOBILE_DPR_CAP = 1.5;
export const DESKTOP_DPR_CAP = 2;
export const PREVIEW_DPR_CAP = 1;

const QUALITY_RANK: Record<BackgroundQuality, number> = { low: 0, med: 1, high: 2 };
const DETAIL_RANK: Record<SceneDetail, number> = { sparse: 0, balanced: 1, full: 2 };
const QUALITY_BY_RANK: BackgroundQuality[] = ['low', 'med', 'high'];
const DETAIL_BY_RANK: SceneDetail[] = ['sparse', 'balanced', 'full'];

export function isNarrowSurface(viewportWidth: number, coarsePointer: boolean): boolean {
  return coarsePointer || sanitizeWidth(viewportWidth) <= NARROW_VIEWPORT_MAX_PX;
}

export function minQuality(a: BackgroundQuality, b: BackgroundQuality): BackgroundQuality {
  return QUALITY_RANK[a] <= QUALITY_RANK[b] ? a : b;
}

export function minSceneDetail(a: SceneDetail, b: SceneDetail): SceneDetail {
  return DETAIL_RANK[a] <= DETAIL_RANK[b] ? a : b;
}

export function stepDownQuality(quality: BackgroundQuality): BackgroundQuality {
  return QUALITY_BY_RANK[Math.max(0, QUALITY_RANK[quality] - 1)] ?? 'low';
}

export function stepDownSceneDetail(detail: SceneDetail): SceneDetail {
  return DETAIL_BY_RANK[Math.max(0, DETAIL_RANK[detail] - 1)] ?? 'sparse';
}

export function backgroundPolicyAllowsRenderer(policy: BackgroundPolicy): boolean {
  return policy.mode !== 'off';
}

export function backgroundPolicyIsStatic(policy: BackgroundPolicy): boolean {
  return policy.mode === 'still';
}

/**
 * Combine the presentation contract with visibility/focus. Hidden or unfocused
 * surfaces pause — they do not change mode to Off or Still.
 */
export function applyBackgroundRuntime(
  policy: BackgroundPolicy,
  runtime: BackgroundRuntimeHints = {},
): BackgroundRuntimeView {
  const paused =
    policy.mode !== 'animated' || runtime.hidden === true || runtime.unfocused === true;
  return { ...policy, paused };
}

export function deriveBackgroundPolicy(input: BackgroundPolicyInput): BackgroundPolicy {
  const narrow = isNarrowSurface(input.viewportWidth, input.coarsePointer);
  const preview = input.preview === true;
  const legacyPressureQuality = input.runtimePressure === true
    ? stepDownQuality(environmentalQualityFor(narrow, preview))
    : undefined;
  const pressureQuality = input.runtimeQuality ?? legacyPressureQuality;
  const environmentalQuality = environmentalQualityFor(narrow, preview);
  // High-DPR fixtures (320@3, desktop@2+) stay on the input contract. The cap
  // is a class ceiling, not min(devicePixelRatio, cap).
  sanitizeDpr(input.devicePixelRatio);

  const environmental = environmentalPresentation(narrow, preview);
  let quality = environmental.quality;
  let sceneDetail = environmental.sceneDetail;
  let frameCapFps = environmental.frameCapFps;
  let dprCap = environmental.dprCap;

  if (input.qualityCeiling) {
    quality = minQuality(quality, input.qualityCeiling);
    if (input.qualityCeiling === 'low') sceneDetail = minSceneDetail(sceneDetail, 'sparse');
    else if (input.qualityCeiling === 'med') sceneDetail = minSceneDetail(sceneDetail, 'balanced');
  }

  const pressureApplied = pressureQuality !== undefined
    && (QUALITY_RANK[pressureQuality] < QUALITY_RANK[environmentalQuality] || input.runtimePressure === true);

  if (pressureApplied && pressureQuality) {
    const previousQuality = quality;
    quality = minQuality(quality, pressureQuality);
    if (quality !== previousQuality) {
      sceneDetail = quality === 'low'
        ? minSceneDetail(sceneDetail, 'sparse')
        : quality === 'med'
          ? minSceneDetail(sceneDetail, 'balanced')
          : stepDownSceneDetail(sceneDetail);
    }
    if (quality !== previousQuality || input.runtimePressure === true) {
      frameCapFps = preview
        ? PREVIEW_FRAME_CAP_FPS
        : narrow
          ? PRESSURE_FRAME_CAP_FPS
          : MOBILE_FRAME_CAP_FPS;
    }
    dprCap = Math.min(dprCap, quality === 'low' ? PREVIEW_DPR_CAP : MOBILE_DPR_CAP);
  }

  const modeDecision = decideMode(input);
  const reason = resolveReason(modeDecision.reason, pressureApplied, modeDecision.mode);

  return {
    mode: modeDecision.mode,
    quality,
    frameCapFps,
    dprCap,
    sceneDetail,
    reason,
  };
}

export function applyBackgroundPolicyDataset(
  element: HTMLElement,
  policy: BackgroundPolicy,
  extra: {
    preview?: boolean;
    paused?: boolean;
    renderer?: 'canvas' | 'scene' | 'placeholder';
  } = {},
): void {
  element.dataset.backgroundMode = policy.mode;
  element.dataset.backgroundQuality = policy.quality;
  element.dataset.backgroundDetail = policy.sceneDetail;
  element.dataset.backgroundReason = policy.reason;
  // A canvas engine enforces this cadence. CSS/SMIL scenes do not have a
  // frame-rate governor, so exposing the same key there would claim a cap the
  // browser is free to ignore. Keep the requested policy value separately for
  // diagnostics and identify the actual display-driven cadence.
  if (extra.renderer === 'scene') {
    delete element.dataset.backgroundFps;
    element.dataset.backgroundPolicyFps = String(policy.frameCapFps);
    element.dataset.backgroundCadence = 'display-driven';
  } else if (extra.renderer === 'placeholder') {
    delete element.dataset.backgroundFps;
    element.dataset.backgroundPolicyFps = String(policy.frameCapFps);
    element.dataset.backgroundCadence = 'placeholder';
  } else {
    element.dataset.backgroundFps = String(policy.frameCapFps);
    delete element.dataset.backgroundPolicyFps;
    delete element.dataset.backgroundCadence;
  }
  element.dataset.backgroundDprCap = String(policy.dprCap);
  if (extra.preview) element.dataset.backgroundPreview = 'true';
  else delete element.dataset.backgroundPreview;
  if (extra.paused) element.dataset.backgroundPaused = 'true';
  else delete element.dataset.backgroundPaused;
}

export function readViewportWidth(): number {
  if (typeof window === 'undefined') return 1024;
  const width = window.innerWidth;
  return sanitizeWidth(width);
}

export function readDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  const dpr = window.devicePixelRatio;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

export function readCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

function decideMode(input: BackgroundPolicyInput): {
  mode: BackgroundMode;
  reason: BackgroundPolicyReason;
} {
  if (input.sceneMotion === 'off') return { mode: 'off', reason: 'user' };
  if (input.reducedData) return { mode: 'off', reason: 'reduced-data' };
  if (input.reducedMotion) return { mode: 'still', reason: 'reduced-motion' };
  if (input.sceneMotion === 'still') return { mode: 'still', reason: 'user' };
  return { mode: 'animated', reason: 'user' };
}

function resolveReason(
  modeReason: BackgroundPolicyReason,
  pressure: boolean,
  mode: BackgroundMode,
): BackgroundPolicyReason {
  if (modeReason !== 'user') return modeReason;
  if (pressure && mode === 'animated') return 'runtime-pressure';
  return modeReason;
}

function environmentalPresentation(
  narrow: boolean,
  preview: boolean,
): Pick<BackgroundPolicy, 'quality' | 'sceneDetail' | 'frameCapFps' | 'dprCap'> {
  if (preview) {
    return {
      quality: 'low',
      sceneDetail: 'sparse',
      frameCapFps: PREVIEW_FRAME_CAP_FPS,
      dprCap: PREVIEW_DPR_CAP,
    };
  }
  if (narrow) {
    return {
      quality: 'med',
      sceneDetail: 'balanced',
      frameCapFps: MOBILE_FRAME_CAP_FPS,
      dprCap: MOBILE_DPR_CAP,
    };
  }
  return {
    quality: 'high',
    sceneDetail: 'full',
    frameCapFps: DESKTOP_FRAME_CAP_FPS,
    dprCap: DESKTOP_DPR_CAP,
  };
}

function environmentalQualityFor(narrow: boolean, preview: boolean): BackgroundQuality {
  return environmentalPresentation(narrow, preview).quality;
}

function sanitizeWidth(width: number): number {
  return Number.isFinite(width) && width > 0 ? width : 1024;
}

function sanitizeDpr(dpr: number): number {
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}
