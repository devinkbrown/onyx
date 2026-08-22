// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'person-safety-sheet.css'), 'utf8');

describe('person safety sheet chrome', () => {
  it('stays quiet: Fraunces once, no glass, no uppercase kicker, no purple', () => {
    expect(css).toMatch(/\.person-safety__title \{[\s\S]*font-family:\s*var\(--font-serif\)/);
    expect(css).toMatch(/\.person-safety__body \{[\s\S]*font-family:\s*var\(--font-sans\)/);
    expect(css).toMatch(/min-height:\s*44px/);
    expect(css).toMatch(/var\(--shu\)/);
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
    expect(css).not.toMatch(/Inter|blurple|purple|#5865f2/i);
    expect(css).not.toMatch(/__kicker/);
  });
});
