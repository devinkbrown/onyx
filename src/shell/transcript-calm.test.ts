// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Transcript calm-reading contract (overhaul W5 slice 1).
 * The reading plane stays comfortable and quiet: capped measure, humanist
 * body text, tabular timestamps, sentence-case dividers, reachable jump
 * pill — matte surfaces only.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'transcript-calm.css'), 'utf8');
const messageView = readFileSync(join(here, 'MessageView.tsx'), 'utf8');

describe('transcript calm layer', () => {
  it('is wired into the message view', () => {
    expect(messageView).toMatch(/import '\.\/transcript-calm\.css'/);
  });

  it('caps the reading measure and airs out groups', () => {
    expect(css).toMatch(/\.shell-msg-group\s*\{[^}]*max-width:\s*68ch/);
    expect(css).toMatch(/\.shell-msg-text\s*\{[^}]*line-height:\s*1\.55/);
  });

  it('quiets timestamps to tabular sans', () => {
    expect(css).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(css).toMatch(/letter-spacing:\s*0/);
  });

  it('keeps dividers sentence case with a reachable jump pill', () => {
    expect(css).toMatch(/text-transform:\s*none/);
    expect(css).toMatch(/\.shell-jump-latest\s*\{[^}]*min-height:\s*var\(--target-min,\s*44px\)/);
    expect(css).toMatch(/:focus-visible/);
  });

  it('uses matte surfaces — no gradients, no glow', () => {
    expect(css).not.toMatch(/linear-gradient/);
    expect(css).not.toMatch(/box-shadow/);
  });

  it('honors reduced motion and forced colors', () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/forced-colors:\s*active/);
  });
});
