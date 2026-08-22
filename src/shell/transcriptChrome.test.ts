// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Source locks for the commercial transcript + composer surface.
 * Fail closed if grouping chrome, unread type, or the 5-line composer cap regress.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const shellCss = readFileSync(join(here, 'shell.css'), 'utf8');
const menuCss = readFileSync(join(here, 'message/message-menu.css'), 'utf8');

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('Transcript and composer commercial chrome', () => {
  const css = stripComments(shellCss);

  it('caps the composer at five lines then scrolls internally', () => {
    expect(css).toMatch(/--composer-max-lines:\s*5/);
    expect(css).toMatch(
      /\.shell-composer-textarea\s*\{[^}]*max-height:\s*calc\(\s*var\(--composer-line-box\)\s*\*\s*var\(--composer-max-lines\)/s,
    );
    expect(css).toMatch(/\.shell-composer-textarea\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).not.toMatch(/\.shell-composer-textarea\s*\{[^}]*max-height:\s*200px/s);
  });

  it('uses Instrument Sans for unread and day markers, mono only for timestamps', () => {
    expect(css).toMatch(/\.shell-unread-divider\s*\{[^}]*font-family:\s*var\(--font-sans\)/s);
    expect(css).toMatch(/\.shell-unread-divider\s*\{[^}]*text-transform:\s*none/s);
    expect(css).toMatch(/\.shell-day-divider-label\s*\{[^}]*font-family:\s*var\(--font-sans\)/s);
    expect(css).toMatch(/\.shell-day-divider-label\s*\{[^}]*text-transform:\s*none/s);
    expect(css).toMatch(/\.shell-msg-ts\s*\{[^}]*font-family:\s*var\(--font-mono\)/s);
    expect(css).toMatch(/\.shell-jump-latest\s*\{[^}]*font-family:\s*var\(--font-sans\)/s);
    expect(css).toMatch(/\.shell-jump-latest\s*\{[^}]*border-radius:\s*var\(--r-pill\)/s);
  });

  it('keeps people circular in the transcript and the composer as a calm vessel', () => {
    expect(css).toMatch(/\.shell-msg-avatar\s+\.onyx-avatar\s*\{[^}]*border-radius:\s*var\(--r-pill\)/s);
    expect(css).toMatch(/\.shell-composer-inner\s*\{[^}]*border-radius:\s*var\(--r-lg\)/s);
    expect(css).toMatch(/\.shell-composer-context\s*\{[^}]*border-left:\s*3px\s+solid\s+var\(--lapis\)/s);
    expect(css).toMatch(/\.shell-msg-pending-mark\s*\{/s);
  });

  it('keeps phone composer primaries at 44px and above the virtual keyboard', () => {
    const mobileStart = shellCss.indexOf('/* ── Mobile layout ── */');
    expect(mobileStart).toBeGreaterThanOrEqual(0);
    const mobile = shellCss.slice(mobileStart);
    expect(mobile).toMatch(/\.shell-composer-tool\s*\{[^}]*min-height:\s*44px/s);
    expect(mobile).toMatch(/\.shell-composer-send\s*\{[^}]*min-height:\s*44px/s);
    expect(mobile).toMatch(/--shell-virtual-keyboard-inset/);
  });

  it('does not dump a 12-item operator toolbar onto every row', () => {
    const menu = stripComments(menuCss);
    expect(menu).toMatch(/\.msg-menu-bar\s*\{/s);
    expect(menu).toMatch(/\.msg-menu-btn--danger/s);
    expect(menu).toMatch(/width:\s*32px/);
  });
});
