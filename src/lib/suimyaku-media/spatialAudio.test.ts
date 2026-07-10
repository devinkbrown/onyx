import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LISTENER_ORIENTATION,
  SPATIAL_ROOM_RADIUS,
  applyListenerOrientation,
  applyToPanner,
  padToPosition,
  positionToStereoPan,
  supportsHrtf,
  type AudioParamLike,
  type HrtfFeatureScope,
} from './spatialAudio';

function param(value = Number.NaN): AudioParamLike {
  return { value };
}

describe('spatialAudio helpers', () => {
  it('maps the pad center to the listener origin', () => {
    expect(padToPosition({ x: 0, y: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('maps pad corners to expected left-right and front-back signs', () => {
    const frontLeft = padToPosition({ x: -1, y: -1 });
    const rearRight = padToPosition({ x: 1, y: 1 });

    expect(frontLeft.x).toBeLessThan(0);
    expect(frontLeft.z).toBeLessThan(0);
    expect(rearRight.x).toBeGreaterThan(0);
    expect(rearRight.z).toBeGreaterThan(0);
  });

  it('rotates pad coordinates by listener yaw before applying them', () => {
    const front = padToPosition({ x: 0, y: -1 }, { listenerYawRadians: Math.PI / 2 });

    expect(front.x).toBeCloseTo(SPATIAL_ROOM_RADIUS);
    expect(front.z).toBeCloseTo(0);
  });

  it('applies source position and listener orientation through panner-like params', () => {
    const panner = {
      positionX: param(),
      positionY: param(),
      positionZ: param(),
      orientationX: param(),
      orientationY: param(),
      orientationZ: param(),
    };
    const listener = {
      positionX: param(),
      positionY: param(),
      positionZ: param(),
      forwardX: param(),
      forwardY: param(),
      forwardZ: param(),
      upX: param(),
      upY: param(),
      upZ: param(),
    };

    applyToPanner(panner, { x: 1, y: 2, z: -3 });
    applyListenerOrientation(listener);

    expect(panner.positionX.value).toBe(1);
    expect(panner.positionY.value).toBe(2);
    expect(panner.positionZ.value).toBe(-3);
    expect(panner.orientationZ.value).toBe(DEFAULT_LISTENER_ORIENTATION.forwardZ);
    expect(listener.forwardZ.value).toBe(DEFAULT_LISTENER_ORIENTATION.forwardZ);
    expect(listener.upY.value).toBe(DEFAULT_LISTENER_ORIENTATION.upY);
  });

  it('uses stereo pan fallback math when HRTF is unavailable', () => {
    const unsupported: HrtfFeatureScope = { PannerNode: undefined };

    expect(supportsHrtf(unsupported)).toBe(false);
    expect(positionToStereoPan(padToPosition({ x: 1, y: 0 }))).toBe(1);
    expect(positionToStereoPan(padToPosition({ x: -1, y: 0 }))).toBe(-1);
  });
});
