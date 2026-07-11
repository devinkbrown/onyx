// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  SPATIAL_ROOM_RADIUS,
  padToPosition,
  positionToPadPoint,
  positionToStereoPan,
  type SpatialAudioPosition,
} from './spatialAudio';

const CLOSE_DIGITS = 12;

function expectPositionClose(
  actual: SpatialAudioPosition,
  expected: SpatialAudioPosition,
  digits = CLOSE_DIGITS,
): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
}

describe('spatialAudio pure geometry', () => {
  it('maps pad center and cardinal edges into listener-relative x/z space', () => {
    expectPositionClose(padToPosition({ x: 0, y: 0 }), { x: 0, y: 0, z: 0 });
    expectPositionClose(padToPosition({ x: 1, y: 0 }), { x: SPATIAL_ROOM_RADIUS, y: 0, z: 0 });
    expectPositionClose(padToPosition({ x: -1, y: 0 }), { x: -SPATIAL_ROOM_RADIUS, y: 0, z: 0 });
    expectPositionClose(padToPosition({ x: 0, y: -1 }), { x: 0, y: 0, z: -SPATIAL_ROOM_RADIUS });
    expectPositionClose(padToPosition({ x: 0, y: 1 }), { x: 0, y: 0, z: SPATIAL_ROOM_RADIUS });
  });

  it('maps pad corners to the expected quadrants at full room radius', () => {
    const frontLeft = padToPosition({ x: -1, y: -1 });
    const frontRight = padToPosition({ x: 1, y: -1 });
    const rearLeft = padToPosition({ x: -1, y: 1 });
    const rearRight = padToPosition({ x: 1, y: 1 });

    expectPositionClose(frontLeft, { x: -SPATIAL_ROOM_RADIUS, y: 0, z: -SPATIAL_ROOM_RADIUS });
    expectPositionClose(frontRight, { x: SPATIAL_ROOM_RADIUS, y: 0, z: -SPATIAL_ROOM_RADIUS });
    expectPositionClose(rearLeft, { x: -SPATIAL_ROOM_RADIUS, y: 0, z: SPATIAL_ROOM_RADIUS });
    expectPositionClose(rearRight, { x: SPATIAL_ROOM_RADIUS, y: 0, z: SPATIAL_ROOM_RADIUS });
  });

  it('rotates listener-relative positions by positive yaw without inverting pan', () => {
    const rightAfterQuarterTurn = padToPosition(
      { x: 1, y: 0 },
      { listenerYawRadians: Math.PI / 2 },
    );
    const frontAfterQuarterTurn = padToPosition(
      { x: 0, y: -1 },
      { listenerYawRadians: Math.PI / 2 },
    );

    expectPositionClose(rightAfterQuarterTurn, { x: 0, y: 0, z: SPATIAL_ROOM_RADIUS });
    expectPositionClose(frontAfterQuarterTurn, { x: SPATIAL_ROOM_RADIUS, y: 0, z: 0 });
  });

  it('keeps zero yaw and a full turn equivalent to identity', () => {
    const point = { x: 0.375, y: -0.625 };
    const identity = padToPosition(point);

    expectPositionClose(padToPosition(point, { listenerYawRadians: 0 }), identity);
    expectPositionClose(padToPosition(point, { listenerYawRadians: Math.PI * 2 }), identity);
  });

  it('clamps out-of-range pad coordinates before scaling to room space', () => {
    expectPositionClose(
      padToPosition({ x: 4, y: -3 }),
      { x: SPATIAL_ROOM_RADIUS, y: 0, z: -SPATIAL_ROOM_RADIUS },
    );
    expectPositionClose(
      padToPosition({ x: -2, y: 6 }),
      { x: -SPATIAL_ROOM_RADIUS, y: 0, z: SPATIAL_ROOM_RADIUS },
    );
  });

  it('degenerates safely when a peer is at the listener position', () => {
    const listenerPosition = padToPosition({ x: 0, y: 0 }, { listenerYawRadians: Math.PI / 2 });

    expectPositionClose(listenerPosition, { x: 0, y: 0, z: 0 });
    expect(positionToStereoPan(listenerPosition)).toBe(0);
    expect(positionToPadPoint(listenerPosition)).toEqual({ x: 0, y: 0 });
  });
});
