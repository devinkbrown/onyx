// SPDX-License-Identifier: AGPL-3.0-or-later
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
    expect(result.blocks[0]?.type).toBe('message');
    expect(result.blocks[0]?.title).toBe('Review');
    expect(result.blocks[0]?.buttons[0]?.url).toBe('https://example.test/build');
  });

  it('keeps malformed payload text and strips unsafe urls', () => {
    expect(extractBlockKitLite('[onyx:block] nope').text).toBe('[onyx:block] nope');

    const block = parseBlockKitLitePayload('{"buttons":[{"label":"Run","url":"javascript:alert(1)"}]}');
    expect(block?.buttons[0]).toEqual({ label: 'Run', url: null, value: null, action: null });
  });

  it('parses only allowlisted client-local actions', () => {
    const block = parseBlockKitLitePayload(JSON.stringify({
      buttons: [
        { label: 'Approve', action: { type: 'send', target: '#ops', value: 'approved' } },
        { label: 'Bad command', action: { type: 'send', target: '#ops', value: '/oper root' } },
        { label: 'Bad type', action: { type: 'shell', target: '#ops', value: 'rm -rf' } },
      ],
      selects: [
        {
          label: 'Environment',
          action: { type: 'select-notify', target: '#ops', value: 'environment' },
          options: [{ label: 'Production', value: 'prod' }],
        },
      ],
    }));

    expect(block?.buttons[0]?.action).toEqual({ type: 'send', target: '#ops', value: 'approved' });
    expect(block?.buttons[1]?.action).toBeNull();
    expect(block?.buttons[2]?.action).toBeNull();
    expect(block?.selects[0]?.action).toEqual({ type: 'select-notify', target: '#ops', value: 'environment' });
  });

  it('parses modal blocks with bounded content and a trigger label', () => {
    const block = parseBlockKitLitePayload(JSON.stringify({
      type: 'modal',
      title: 'Release details',
      triggerLabel: 'Review release',
      text: 'Check the rollout notes.',
      fields: [{ label: 'Service', value: 'Onyx' }],
    }));

    expect(block).toMatchObject({
      type: 'modal',
      title: 'Release details',
      triggerLabel: 'Review release',
      text: 'Check the rollout notes.',
      fields: [{ label: 'Service', value: 'Onyx' }],
    });
  });
});
