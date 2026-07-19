// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getMountedCadenceMediaEngine,
  setMountedCadenceMediaEngine,
} from './mediaEngineMount';

type MountedEngine = NonNullable<Parameters<typeof setMountedCadenceMediaEngine>[0]>;

function makeEngine(id: string): MountedEngine {
  return { id } as unknown as MountedEngine;
}

beforeEach(() => {
  setMountedCadenceMediaEngine(null);
});

afterEach(() => {
  setMountedCadenceMediaEngine(null);
});

describe('mounted Cadence media engine accessor', () => {
  it('returns null before an engine has been mounted', () => {
    // Arrange / Act
    const mounted = getMountedCadenceMediaEngine();

    // Assert
    expect(mounted).toBeNull();
  });

  it('returns the exact mounted engine reference', () => {
    // Arrange
    const engine = makeEngine('primary');

    // Act
    setMountedCadenceMediaEngine(engine);

    // Assert
    expect(getMountedCadenceMediaEngine()).toBe(engine);
  });

  it('replaces an existing engine and clears back to null', () => {
    // Arrange
    const firstEngine = makeEngine('first');
    const secondEngine = makeEngine('second');

    // Act
    setMountedCadenceMediaEngine(firstEngine);
    setMountedCadenceMediaEngine(secondEngine);

    // Assert
    expect(getMountedCadenceMediaEngine()).toBe(secondEngine);

    // Act
    setMountedCadenceMediaEngine(null);

    // Assert
    expect(getMountedCadenceMediaEngine()).toBeNull();
  });
});
