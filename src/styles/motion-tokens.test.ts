// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * motion-tokens.test.ts — pure source checks for Era 1 A6 motion ladder.
 *
 * Asserts the chat-productive duration tokens exist, reduced-motion zeros the
 * full ladder (not only --dur), heatline animates scaleY (not height), and
 * optimistic send has a one-shot enter animation with a reduce freeze.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../..');
const tokensCss = readFileSync(join(root, 'src/styles/tokens.css'), 'utf8');
const shellCss = readFileSync(join(root, 'src/shell/shell.css'), 'utf8');

/** Strip CSS comments so string checks ignore prose that mentions banned tokens. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('motion duration tokens (Era 1 A6)', () => {
  const css = stripComments(tokensCss);

  it('declares --dur-micro, --dur-fast, --dur-base and aliases --dur to --dur-base', () => {
    expect(css).toMatch(/--dur-micro:\s*100ms/);
    expect(css).toMatch(/--dur-fast:\s*160ms/);
    expect(css).toMatch(/--dur-base:\s*220ms/);
    expect(css).toMatch(/--dur:\s*var\(--dur-base\)/);
  });

  it('zeros the full duration ladder under prefers-reduced-motion', () => {
    const reduceBlock = css.match(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(reduceBlock).not.toBeNull();
    const body = reduceBlock![1]!;
    expect(body).toMatch(/--dur-micro:\s*0ms\s*!important/);
    expect(body).toMatch(/--dur-fast:\s*0ms\s*!important/);
    expect(body).toMatch(/--dur-base:\s*0ms\s*!important/);
    expect(body).toMatch(/--dur:\s*0ms\s*!important/);
  });
});

describe('presence heatline motion (Era 1 A6)', () => {
  const css = stripComments(shellCss);

  it('animates heat bars via scaleY from a fixed track, not layout height', () => {
    const barRule = css.match(/\.shell-heat-bar\s*\{([^}]+)\}/);
    expect(barRule).not.toBeNull();
    const body = barRule![1]!;
    expect(body).toMatch(/transform:\s*scaleY\(/);
    expect(body).toMatch(/transform-origin:\s*bottom/);
    expect(body).toMatch(/height:\s*16px/);
    // Must not reintroduce layout-property transitions on heat updates.
    expect(body).not.toMatch(/transition:[^;]*\bheight\b/);
    expect(body).toMatch(/transition:[^;]*\btransform\b/);
  });
});

describe('optimistic send micro-motion (Era 1 A6)', () => {
  const css = stripComments(shellCss);

  it('gives pending local echoes a one-shot enter animation on compositor props', () => {
    expect(css).toMatch(
      /\.shell-msg-pending\s*\{[^}]*animation:\s*shell-msg-echo-in\s+var\(--dur-fast/,
    );
    const keyframes = css.match(/@keyframes\s+shell-msg-echo-in\s*\{([\s\S]*?)\n\}/);
    expect(keyframes).not.toBeNull();
    const body = keyframes![1]!;
    expect(body).toMatch(/opacity/);
    expect(body).toMatch(/translateY\(6px\)/);
  });

  it('freezes the enter animation under reduced-motion', () => {
    expect(css).toMatch(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[^}]*\.shell-msg-pending\s*\{[^}]*animation:\s*none/,
    );
  });

  it('transitions message-row opacity for pending → ACK using --dur-micro', () => {
    expect(css).toMatch(
      /\.shell-msg-group\s*\{[^}]*opacity\s+var\(--dur-micro/,
    );
    expect(css).toMatch(
      /\.shell-msg-cont\s*\{[^}]*opacity\s+var\(--dur-micro/,
    );
  });
});
