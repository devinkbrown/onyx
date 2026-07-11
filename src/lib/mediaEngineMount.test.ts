// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getMountedSuimyakuMediaEngine,
  setMountedSuimyakuMediaEngine,
} from './mediaEngineMount';

type MountedEngine = NonNullable<Parameters<typeof setMountedSuimyakuMediaEngine>[0]>;

function makeEngine(id: string): MountedEngine {
  return { id } as unknown as MountedEngine;
}

beforeEach(() => {
  setMountedSuimyakuMediaEngine(null);
});

afterEach(() => {
  setMountedSuimyakuMediaEngine(null);
});

describe('mounted Suimyaku media engine accessor', () => {
  it('returns null before an engine has been mounted', () => {
    // Arrange / Act
    const mounted = getMountedSuimyakuMediaEngine();

    // Assert
    expect(mounted).toBeNull();
  });

  it('returns the exact mounted engine reference', () => {
    // Arrange
    const engine = makeEngine('primary');

    // Act
    setMountedSuimyakuMediaEngine(engine);

    // Assert
    expect(getMountedSuimyakuMediaEngine()).toBe(engine);
  });

  it('replaces an existing engine and clears back to null', () => {
    // Arrange
    const firstEngine = makeEngine('first');
    const secondEngine = makeEngine('second');

    // Act
    setMountedSuimyakuMediaEngine(firstEngine);
    setMountedSuimyakuMediaEngine(secondEngine);

    // Assert
    expect(getMountedSuimyakuMediaEngine()).toBe(secondEngine);

    // Act
    setMountedSuimyakuMediaEngine(null);

    // Assert
    expect(getMountedSuimyakuMediaEngine()).toBeNull();
  });
});
