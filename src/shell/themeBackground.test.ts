// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { AUTO_BACKGROUND_ID, resolveBackgroundId } from './themeBackground';

describe('theme background resolution', () => {
  it('keeps a valid pinned background', () => {
    expect(resolveBackgroundId('starfield', 'pearl')).toBe('starfield');
  });

  it('uses the active theme signature for Auto', () => {
    expect(resolveBackgroundId(AUTO_BACKGROUND_ID, 'pearl')).toBe('paper-grain');
  });

  it('recovers corrupted stored ids through the active theme signature', () => {
    expect(resolveBackgroundId('removed-scene', 'pearl')).toBe('paper-grain');
  });

  it('recovers an invalid theme through the default signature', () => {
    expect(resolveBackgroundId(AUTO_BACKGROUND_ID, 'removed-theme')).toBe('deep-current');
  });
});
