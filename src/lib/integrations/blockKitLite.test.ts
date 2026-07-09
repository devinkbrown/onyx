import { describe, expect, it } from 'vitest';
import { extractBlockKitLite, parseBlockKitLitePayload } from './blockKitLite';

describe('blockKitLite', () => {
  it('extracts valid protocol-tagged blocks and leaves readable fallback text', () => {
    const result = extractBlockKitLite([
      'Deploy update',
      '[onyx:block] {"title":"Review","buttons":[{"label":"Open","url":"https://example.test/build"}]}',
    ].join('\n'));

    expect(result.text).toBe('Deploy update');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.title).toBe('Review');
    expect(result.blocks[0]?.buttons[0]?.url).toBe('https://example.test/build');
  });

  it('keeps malformed payload text and strips unsafe urls', () => {
    expect(extractBlockKitLite('[onyx:block] nope').text).toBe('[onyx:block] nope');

    const block = parseBlockKitLitePayload('{"buttons":[{"label":"Run","url":"javascript:alert(1)"}]}');
    expect(block?.buttons[0]).toEqual({ label: 'Run', url: null, value: null });
  });
});
