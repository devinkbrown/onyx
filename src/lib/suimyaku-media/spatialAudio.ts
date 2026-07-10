export interface SpatialPadPoint {
  readonly x: number;
  readonly y: number;
}

export interface SpatialAudioPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ListenerOrientation {
  readonly forwardX: number;
  readonly forwardY: number;
  readonly forwardZ: number;
  readonly upX: number;
  readonly upY: number;
  readonly upZ: number;
}

export interface PadToPositionOptions {
  readonly roomRadius?: number;
  readonly height?: number;
  readonly listenerYawRadians?: number;
}

export interface AudioParamLike {
  value: number;
}

export interface PannerLike {
  readonly positionX?: AudioParamLike;
  readonly positionY?: AudioParamLike;
  readonly positionZ?: AudioParamLike;
  readonly orientationX?: AudioParamLike;
  readonly orientationY?: AudioParamLike;
  readonly orientationZ?: AudioParamLike;
  setPosition?: (x: number, y: number, z: number) => void;
  setOrientation?: (x: number, y: number, z: number) => void;
}

export interface ListenerLike {
  readonly positionX?: AudioParamLike;
  readonly positionY?: AudioParamLike;
  readonly positionZ?: AudioParamLike;
  readonly forwardX?: AudioParamLike;
  readonly forwardY?: AudioParamLike;
  readonly forwardZ?: AudioParamLike;
  readonly upX?: AudioParamLike;
  readonly upY?: AudioParamLike;
  readonly upZ?: AudioParamLike;
  setPosition?: (x: number, y: number, z: number) => void;
  setOrientation?: (forwardX: number, forwardY: number, forwardZ: number, upX: number, upY: number, upZ: number) => void;
}

export interface HrtfFeatureScope {
  readonly PannerNode?: unknown;
}

export const SPATIAL_PAD_LIMIT = 1;
export const SPATIAL_ROOM_RADIUS = 4;
export const SPATIAL_DEFAULT_HEIGHT = 0;
export const STEREO_PAN_LIMIT = 1;

export const DEFAULT_SPATIAL_POSITION: SpatialAudioPosition = Object.freeze({
  x: 0,
  y: SPATIAL_DEFAULT_HEIGHT,
  z: 0,
});

export const DEFAULT_LISTENER_ORIENTATION: ListenerOrientation = Object.freeze({
  forwardX: 0,
  forwardY: 0,
  forwardZ: -1,
  upX: 0,
  upY: 1,
  upZ: 0,
});

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function padToPosition(point: SpatialPadPoint, opts: PadToPositionOptions = {}): SpatialAudioPosition {
  const radius = Math.max(0, finiteOr(opts.roomRadius, SPATIAL_ROOM_RADIUS));
  const localX = clamp(finiteOr(point.x, 0), SPATIAL_PAD_LIMIT) * radius;
  const localZ = clamp(finiteOr(point.y, 0), SPATIAL_PAD_LIMIT) * radius;
  const yaw = finiteOr(opts.listenerYawRadians, 0);

  if (yaw === 0) {
    return {
      x: localX,
      y: finiteOr(opts.height, SPATIAL_DEFAULT_HEIGHT),
      z: localZ,
    };
  }

  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: localX * cos - localZ * sin,
    y: finiteOr(opts.height, SPATIAL_DEFAULT_HEIGHT),
    z: localX * sin + localZ * cos,
  };
}

function setParam(param: AudioParamLike | undefined, value: number): boolean {
  if (!param) return false;
  param.value = value;
  return true;
}

export function applyToPanner(panner: PannerLike, pos: SpatialAudioPosition): void {
  const usedParams = [
    setParam(panner.positionX, pos.x),
    setParam(panner.positionY, pos.y),
    setParam(panner.positionZ, pos.z),
  ].every(Boolean);

  if (!usedParams) panner.setPosition?.(pos.x, pos.y, pos.z);

  setParam(panner.orientationX, DEFAULT_LISTENER_ORIENTATION.forwardX);
  setParam(panner.orientationY, DEFAULT_LISTENER_ORIENTATION.forwardY);
  setParam(panner.orientationZ, DEFAULT_LISTENER_ORIENTATION.forwardZ);
  if (!panner.orientationX || !panner.orientationY || !panner.orientationZ) {
    panner.setOrientation?.(
      DEFAULT_LISTENER_ORIENTATION.forwardX,
      DEFAULT_LISTENER_ORIENTATION.forwardY,
      DEFAULT_LISTENER_ORIENTATION.forwardZ,
    );
  }
}

export function applyListenerOrientation(
  listener: ListenerLike,
  orientation: ListenerOrientation = DEFAULT_LISTENER_ORIENTATION,
): void {
  const usedPositionParams = [
    setParam(listener.positionX, DEFAULT_SPATIAL_POSITION.x),
    setParam(listener.positionY, DEFAULT_SPATIAL_POSITION.y),
    setParam(listener.positionZ, DEFAULT_SPATIAL_POSITION.z),
  ].every(Boolean);
  if (!usedPositionParams) {
    listener.setPosition?.(DEFAULT_SPATIAL_POSITION.x, DEFAULT_SPATIAL_POSITION.y, DEFAULT_SPATIAL_POSITION.z);
  }

  const usedOrientationParams = [
    setParam(listener.forwardX, orientation.forwardX),
    setParam(listener.forwardY, orientation.forwardY),
    setParam(listener.forwardZ, orientation.forwardZ),
    setParam(listener.upX, orientation.upX),
    setParam(listener.upY, orientation.upY),
    setParam(listener.upZ, orientation.upZ),
  ].every(Boolean);
  if (!usedOrientationParams) {
    listener.setOrientation?.(
      orientation.forwardX,
      orientation.forwardY,
      orientation.forwardZ,
      orientation.upX,
      orientation.upY,
      orientation.upZ,
    );
  }
}

export function positionToStereoPan(pos: SpatialAudioPosition, roomRadius = SPATIAL_ROOM_RADIUS): number {
  const radius = Math.max(Number.EPSILON, roomRadius);
  return clamp(pos.x / radius, STEREO_PAN_LIMIT);
}

export function positionToPadPoint(pos: SpatialAudioPosition, roomRadius = SPATIAL_ROOM_RADIUS): SpatialPadPoint {
  const radius = Math.max(Number.EPSILON, roomRadius);
  return {
    x: clamp(pos.x / radius, SPATIAL_PAD_LIMIT),
    y: clamp(pos.z / radius, SPATIAL_PAD_LIMIT),
  };
}

export function supportsHrtf(scope: HrtfFeatureScope = globalThis): boolean {
  return typeof scope.PannerNode === 'function';
}
