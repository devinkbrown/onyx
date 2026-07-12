// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { parseMessage, type InlineToken, type Token } from './parseMessage';

const B = '\x02';
const C = '\x03';
const H = '\x04';

const TAG_BREAKOUT = '</span><img src=x onerror=alert(1)>';

function flattenTypes(tokens: readonly Token[] | readonly InlineToken[]): string[] {
  const types: string[] = [];
  for (const token of tokens) {
    types.push(token.type);
    if ('children' in token) types.push(...flattenTypes(token.children));
  }
  return types;
}

function flattenText(tokens: readonly Token[] | readonly InlineToken[]): string {
  let text = '';
  for (const token of tokens) {
    if (token.type === 'text') text += token.text;
    if ('children' in token) text += flattenText(token.children);
  }
  return text;
}

describe('parseMessage adversarial IRC formatting to typed tokens', () => {
  it('keeps an exact tag-breakout image payload as one inert text token', () => {
    const tokens = parseMessage(TAG_BREAKOUT);

    expect(tokens).toEqual([{ type: 'text', text: TAG_BREAKOUT }]);
    expect(flattenTypes(tokens)).toEqual(['text']);
    expect(flattenTypes(tokens)).not.toContain('link');
    expect(flattenTypes(tokens)).not.toContain('image');
    expect(flattenTypes(tokens)).not.toContain('html');
  });

  it('keeps malformed decimal colour tails visible while hostile markup remains text data', () => {
    const tokens = parseMessage(`${C},not-bg ${C}04,${TAG_BREAKOUT}${C}`);

    expect(tokens).toEqual([
      { type: 'text', text: ',not-bg ' },
      {
        type: 'styled',
        style: { fg: '#ff0000' },
        children: [{ type: 'text', text: `,${TAG_BREAKOUT}` }],
      },
    ]);
    expect(flattenText(tokens)).toBe(`,not-bg ,${TAG_BREAKOUT}`);
    expect(flattenTypes(tokens)).not.toContain('link');
    expect(flattenTypes(tokens)).not.toContain('image');
    expect(flattenTypes(tokens)).not.toContain('html');
  });

  it('strips unterminated IRC toggles but leaves nested unterminated markup literal', () => {
    const visible = `**_~~||\`${TAG_BREAKOUT}`;
    const tokens = parseMessage(`${B}${H}12${visible}`);

    expect(tokens).toEqual([
      {
        type: 'styled',
        style: { bold: true, fg: undefined, bg: undefined },
        children: [{ type: 'text', text: visible }],
      },
    ]);
    expect(flattenText(tokens)).toBe(visible);
    expect(flattenTypes(tokens)).toEqual(['styled', 'text']);
    expect(JSON.stringify(tokens)).not.toMatch(/[\x02\x03\x04\x0f\x16\x1d\x1e\x1f]/);
  });
});
