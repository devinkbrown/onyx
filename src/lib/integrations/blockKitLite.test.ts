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

  it('rejects script/data URLs and keeps markup-looking text inert as plain strings', () => {
    const block = parseBlockKitLitePayload(JSON.stringify({
      title: '<script>alert(1)</script>',
      text: '<img src=x onerror=alert(1)>',
      buttons: [
        { label: '<b>Docs</b>', url: 'data:text/html,<script>alert(1)</script>' },
        { label: 'Relative', url: '/local/path' },
        { label: 'Secure', url: 'https://example.test/path?q=%3Cscript%3E' },
      ],
    }));

    expect(block?.title).toBe('<script>alert(1)</script>');
    expect(block?.text).toBe('<img src=x onerror=alert(1)>');
    expect(block?.buttons).toEqual([
      { label: '<b>Docs</b>', url: null, value: null, action: null },
      { label: 'Relative', url: null, value: null, action: null },
      { label: 'Secure', url: 'https://example.test/path?q=%3Cscript%3E', value: null, action: null },
    ]);
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

  it('rejects unsafe action targets and CRLF-smuggled action values', () => {
    const block = parseBlockKitLitePayload(JSON.stringify({
      buttons: [
        { label: 'Whitespace target', action: { type: 'send', target: '#ops #other', value: 'approved' } },
        { label: 'Comma target', action: { type: 'send', target: '#ops,#other', value: 'approved' } },
        { label: 'CRLF value', action: { type: 'send', target: '#ops', value: 'ok\r\nPRIVMSG #root :oops' } },
        { label: 'Nick target', action: { type: 'send', target: 'OperServ', value: 'status' } },
      ],
    }));

    expect(block?.buttons.map((button) => button.action)).toEqual([
      null,
      null,
      null,
      { type: 'send', target: 'OperServ', value: 'status' },
    ]);
  });

  it('routes select-option values through the action-value guard (CRLF/leading-slash rejected)', () => {
    const block = parseBlockKitLitePayload(JSON.stringify({
      selects: [{
        label: 'Environment',
        action: { type: 'select-notify', target: '#ops', value: null },
        options: [
          { label: 'Clean', value: 'clean' },
          { label: 'CRLF', value: 'ok\r\nPRIVMSG #root :pwn' },
          { label: 'Slash', value: '/oper root' },
          { label: 'FallbackLabel' },
        ],
      }],
    }));

    const options = block?.selects[0]?.options ?? [];
    // A clean value passes through unchanged.
    expect(options.find((o) => o.label === 'Clean')?.value).toBe('clean');
    // A CRLF-smuggled option value is rejected; it falls back to the (guarded) label.
    expect(options.find((o) => o.label === 'CRLF')?.value).toBe('CRLF');
    // A leading-slash command value is rejected; it falls back to the guarded label.
    expect(options.find((o) => o.label === 'Slash')?.value).toBe('Slash');
    // No value supplied → the label is used, still through the value guard.
    expect(options.find((o) => o.label === 'FallbackLabel')?.value).toBe('FallbackLabel');
  });

  it('drops a select option whose value AND label are both unsafe', () => {
    const block = parseBlockKitLitePayload(JSON.stringify({
      selects: [{
        label: 'Environment',
        action: { type: 'select-notify', target: '#ops', value: null },
        options: [
          { label: '/bad', value: '/worse' },
          { label: 'Good', value: 'good' },
        ],
      }],
    }));

    expect(block?.selects[0]?.options).toEqual([{ label: 'Good', value: 'good' }]);
  });

  it('bounds repeated controls and options before returning renderable blocks', () => {
    const block = parseBlockKitLitePayload(JSON.stringify({
      buttons: Array.from({ length: 6 }, (_, i) => ({ label: `Button ${i + 1}`, value: `b${i + 1}` })),
      selects: Array.from({ length: 3 }, (_, i) => ({
        label: `Select ${i + 1}`,
        options: Array.from({ length: 10 }, (_unused, j) => ({ label: `Option ${i + 1}.${j + 1}` })),
      })),
      fields: Array.from({ length: 8 }, (_, i) => ({ label: `Field ${i + 1}`, value: `Value ${i + 1}` })),
    }));

    expect(block?.buttons.map((button) => button.label)).toEqual(['Button 1', 'Button 2', 'Button 3', 'Button 4']);
    expect(block?.selects).toHaveLength(2);
    expect(block?.selects[0]?.options).toHaveLength(8);
    expect(block?.selects[0]?.options[0]).toEqual({ label: 'Option 1.1', value: 'Option 1.1' });
    expect(block?.fields.map((field) => field.label)).toEqual([
      'Field 1',
      'Field 2',
      'Field 3',
      'Field 4',
      'Field 5',
      'Field 6',
    ]);
  });

  it('returns null for empty, array, and content-free payloads', () => {
    expect(parseBlockKitLitePayload('null')).toBeNull();
    expect(parseBlockKitLitePayload('[]')).toBeNull();
    expect(parseBlockKitLitePayload('{"buttons":[{"url":"https://example.test"}],"fields":[{"value":"missing label"}]}')).toBeNull();
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

  it('falls back modal titles and snake_case trigger labels safely', () => {
    const block = parseBlockKitLitePayload(JSON.stringify({
      type: 'modal',
      text: 'No title was supplied.',
      trigger_label: 'Open fallback',
    }));

    expect(block).toMatchObject({
      type: 'modal',
      title: 'Details',
      triggerLabel: 'Open fallback',
      text: 'No title was supplied.',
    });
  });
});
