// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractBlockKitLite, parseBlockKitLitePayload, prepareBlockKitAction } from './blockKitLite';

const blockKitLiteSourcePath = join(dirname(fileURLToPath(import.meta.url)), 'blockKitLite.ts');

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

  it('keeps malformed block lines as fallback text while extracting later valid blocks', () => {
    const result = extractBlockKitLite([
      'Incident update',
      '[onyx:block] {"title":"unterminated"',
      '[onyx:block] {"type":"message","text":"still parse the next block"}',
      '[onyx:block] true',
      'Tail note',
    ].join('\n'));

    expect(result.text).toBe([
      'Incident update',
      '[onyx:block] {"title":"unterminated"',
      '[onyx:block] true',
      'Tail note',
    ].join('\n'));
    expect(result.blocks).toEqual([{
      type: 'message',
      title: null,
      text: 'still parse the next block',
      buttons: [],
      selects: [],
      fields: [],
    }]);
  });

  it('ignores unknown explicit block types instead of rendering them as messages', () => {
    expect(parseBlockKitLitePayload(JSON.stringify({
      type: 'section',
      title: 'Slack-style section',
      text: 'This schema is not supported by Block Kit Lite.',
    }))).toBeNull();

    const result = extractBlockKitLite([
      'Before',
      '[onyx:block] {"type":"context","text":"unsupported context"}',
      '[onyx:block] {"type":"message","text":"supported message"}',
    ].join('\n'));

    expect(result.text).toBe('Before\n[onyx:block] {"type":"context","text":"unsupported context"}');
    expect(result.blocks.map((block) => block.text)).toEqual(['supported message']);
  });

  it('ignores unknown nested action/control shapes without dropping safe siblings', () => {
    const block = parseBlockKitLitePayload(JSON.stringify({
      type: 'message',
      title: 'Mixed controls',
      buttons: [
        { label: 'Unknown action', action: { type: 'open-url', target: '#ops', value: 'https://example.test' } },
        { type: 'image', label: 'Unknown control type', url: 'https://example.test/image.png' },
        { label: 'Valid action', action: { type: 'send', target: '#ops', value: 'ack' } },
      ],
      selects: [
        {
          label: 'Bad options',
          options: [
            { type: 'divider' },
            { label: '', value: 'empty label' },
            { label: 'Safe', value: 'safe' },
          ],
          action: { type: 'modal-open', target: '#ops', value: 'details' },
        },
      ],
      fields: [
        { type: 'mrkdwn', value: 'missing label' },
        { label: 'Safe field', value: 'plain text' },
      ],
    }));

    expect(block?.buttons).toEqual([
      { label: 'Unknown action', url: null, value: null, action: null },
      { label: 'Unknown control type', url: 'https://example.test/image.png', value: null, action: null },
      { label: 'Valid action', url: null, value: null, action: { type: 'send', target: '#ops', value: 'ack' } },
    ]);
    expect(block?.selects).toEqual([{
      label: 'Bad options',
      options: [{ label: 'Safe', value: 'safe' }],
      action: null,
    }]);
    expect(block?.fields).toEqual([{ label: 'Safe field', value: 'plain text' }]);
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

  it('does not introduce HTML sink APIs in the parser module', () => {
    const source = readFileSync(blockKitLiteSourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:innerHTML|dangerouslySetInnerHTML|__html)\b/);
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

  it('prepares only same-origin normalized plaintext and revalidates raw action fields', () => {
    expect(prepareBlockKitAction(
      { type: 'send', target: '#ops', value: '  approved  ' },
      '#ops',
    )).toEqual({ target: '#ops', text: 'approved' });

    expect(prepareBlockKitAction(
      { type: 'select-notify', target: '#ops', value: 'environment' },
      '#ops',
      '  prod  ',
    )).toEqual({ target: '#ops', text: 'environment: prod' });

    expect(prepareBlockKitAction(
      { type: 'send', target: '#other', value: 'approved' },
      '#ops',
    )).toBeNull();
    expect(prepareBlockKitAction(
      { type: 'send', target: '#ops', value: '/oper root' },
      '#ops',
    )).toBeNull();
    expect(prepareBlockKitAction(
      { type: 'select-notify', target: '#ops', value: null },
      '#ops',
      'ok\r\nPRIVMSG #root :oops',
    )).toBeNull();
  });

  it('rejects a smuggled CTCP control byte in an action value (forged remote EDIT/DELETE/STAGE/POLL_VOTE)', () => {
    // \x01 (SOH) is not ECMAScript whitespace, so `.trim()` alone would leave
    // it standing, and the wire-layer `stripWireControl` only strips
    // [\r\n\x00] — letting the byte survive into `PRIVMSG :\x01EDIT <id>
    // <text>\x01` and forge an edit against the *sender's own* prior message
    // (store.ts matches `m.from === sender`) for every channel viewer.
    expect(prepareBlockKitAction(
      { type: 'send', target: '#ops', value: '\x01EDIT abc123 I confess to everything\x01' },
      '#ops',
    )).toBeNull();
    expect(prepareBlockKitAction(
      { type: 'send', target: '#ops', value: '\x01DELETE abc123\x01' },
      '#ops',
    )).toBeNull();
    expect(prepareBlockKitAction(
      { type: 'send', target: '#ops', value: '\x01STAGE anything\x01' },
      '#ops',
    )).toBeNull();
    expect(prepareBlockKitAction(
      { type: 'send', target: '#ops', value: '\x01POLL_VOTE abc123 0\x01' },
      '#ops',
    )).toBeNull();

    const block = parseBlockKitLitePayload(JSON.stringify({
      buttons: [{ label: 'Confirm', action: { type: 'send', target: '#ops', value: '\x01EDIT m1 pwned\x01' } }],
    }));
    expect(block?.buttons[0]?.action).toBeNull();
  });

  it('rejects bidi-override and invisible Unicode formatting characters in every text field', () => {
    // U+202E (RIGHT-TO-LEFT OVERRIDE) can visually reorder rendered text; U+200B
    // (ZERO WIDTH SPACE) is non-printing. Both must be rejected everywhere a
    // block can carry attacker text, not just the action value that reaches the
    // confirmation dialog.
    expect(prepareBlockKitAction(
      { type: 'send', target: '#ops', value: 'approve\u202e signature' },
      '#ops',
    )).toBeNull();
    expect(prepareBlockKitAction(
      { type: 'send', target: '#ops', value: 'zero\u200bwidth' },
      '#ops',
    )).toBeNull();

    // A safe sibling field (`safeTitle`) keeps the block itself non-null so
    // each unsafe field's individual rejection is observable rather than
    // masked by the "no content at all" empty-block short-circuit.
    const block = parseBlockKitLitePayload(JSON.stringify({
      title: 'Deploy\u202egnippihs',
      text: 'Body with\u200bzwsp',
      buttons: [
        { label: 'Ok\u202e', value: 'v' },
        { label: 'safeTitle', value: 'safe' },
      ],
      fields: [{ label: 'Field', value: 'val\u202eue' }],
    }));
    expect(block?.title).toBeNull();
    expect(block?.text).toBeNull();
    expect(block?.buttons).toEqual([{ label: 'safeTitle', url: null, value: 'safe', action: null }]);
    // The field itself is kept (label is safe) but its unsafe value is
    // dropped to empty — never smuggled through as text, matching the
    // existing missing-value fallback (`trimText(...) ?? ''`).
    expect(block?.fields).toEqual([{ label: 'Field', value: '' }]);
  });

  it('rejects the wider invisible/bidi-formatting set flagged in review (ALM, word joiner, soft hyphen, tag chars)', () => {
    // U+061C ARABIC LETTER MARK is a real bidi formatting control that the
    // narrower ZWSP..RLM/embed-override ranges alone do not cover; U+2060
    // WORD JOINER and U+00AD SOFT HYPHEN are invisible; U+E0001 sits in the
    // deprecated language-tag plane, the classic invisible-text-smuggling
    // block.
    for (const codePoint of [0x061c, 0x2060, 0x00ad, 0x180e, 0xe0001]) {
      const payload = `hidden${String.fromCodePoint(codePoint)}payload`;
      expect(prepareBlockKitAction(
        { type: 'send', target: '#ops', value: payload },
        '#ops',
      )).toBeNull();
    }
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
