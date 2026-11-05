// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Calm-density sidebar contract (overhaul W4 slice 1).
 * The collection layer keeps consumer floors while quieting chrome:
 * 44px rows survive, no gradients/glow, visible focus, reduced-motion
 * and forced-colors paths exist.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'collection-density.css'), 'utf8');
const sidebar = readFileSync(join(here, 'ChannelSidebar.tsx'), 'utf8');

describe('collection calm-density layer', () => {
  it('is wired into the collection sidebar', () => {
    expect(sidebar).toMatch(/import '\.\/collection-density\.css'/);
  });

  it('keeps the 44px consumer floors', () => {
    expect(css).toMatch(/\.shell-channel-item\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/min-height:\s*var\(--target-min,\s*44px\)/);
  });

  it('keeps section labels quiet sans, never uppercase posters', () => {
    expect(css).toMatch(/font-family:\s*var\(--font-sans\)/);
    expect(css).toMatch(/text-transform:\s*none/);
  });

  it('uses matte surfaces — no gradients, no glow', () => {
    expect(css).not.toMatch(/linear-gradient/);
    expect(css).not.toMatch(/box-shadow/);
    expect(css).not.toMatch(/#8b5cf6|#7c3aed|violet|purple/i);
  });

  it('owns one visible focus language', () => {
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/outline:\s*2px solid/);
  });

  it('honors reduced motion and forced colors', () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/forced-colors:\s*active/);
  });
});
