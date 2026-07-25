// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  formatWebhookNoticeBody,
  parseWebhookPayloadJson,
  webhookPayloadToMessage,
} from './webhookBlockKit';

describe('webhookBlockKit', () => {
  it('flattens blocks and embeds to IRC-safe text', () => {
    const text = webhookPayloadToMessage({
      username: 'Deploy Bot',
      content: 'Ship it',
      blocks: [
        { type: 'header', text: 'Release' },
        { type: 'divider' },
        { type: 'section', text: 'v1.2.3' },
      ],
      embeds: [{ title: 'Notes', description: 'fast path', fields: [{ name: 'sha', value: 'abc' }] }],
    });
    expect(text).toContain('Deploy Bot');
    expect(text).toContain('## Release');
    expect(text).toContain('sha: abc');
    // Newlines join lines; reject other C0 controls.
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f]/);
  });

  it('parses Discord-shaped webhook JSON including nested block text objects', () => {
    const payload = parseWebhookPayloadJson(JSON.stringify({
      username: 'CI',
      content: 'build ok',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: 'Pipeline' } },
        { type: 'section', text: { type: 'mrkdwn', text: 'main green' } },
        { type: 'divider' },
      ],
      embeds: [{
        title: 'Artifacts',
        description: 'ready',
        fields: [{ name: 'job', value: 'deploy' }],
      }],
    }));
    expect(payload).not.toBeNull();
    expect(payload?.username).toBe('CI');
    expect(payload?.blocks?.[0]).toEqual({ type: 'header', text: 'Pipeline' });
    expect(payload?.blocks?.[1]).toEqual({ type: 'section', text: 'main green' });
    const flat = webhookPayloadToMessage(payload!);
    expect(flat).toContain('build ok');
    expect(flat).toContain('## Pipeline');
    expect(flat).toContain('job: deploy');
  });

  it('formatWebhookNoticeBody flattens JSON and leaves plain text alone', () => {
    const json = JSON.stringify({
      content: 'hello from webhook',
      embeds: [{ title: 't', description: 'd' }],
    });
    const formatted = formatWebhookNoticeBody(json);
    expect(formatted).toContain('hello from webhook');
    expect(formatted).toContain('t');
    expect(formatted).not.toContain('{');

    expect(formatWebhookNoticeBody('just a normal notice')).toBe('just a normal notice');
    expect(formatWebhookNoticeBody('{not json')).toBe('{not json');
    expect(formatWebhookNoticeBody('{"unrelated":true}')).toBe('{"unrelated":true}');
    expect(formatWebhookNoticeBody('{}')).toBe('{}');
  });

  it('rejects oversized or non-object JSON without throwing', () => {
    expect(parseWebhookPayloadJson(`[${'1,'.repeat(100)}0]`)).toBeNull();
    expect(parseWebhookPayloadJson(`{"content":"${'x'.repeat(13_000)}"}`)).toBeNull();
    expect(formatWebhookNoticeBody(`{"content":"${'x'.repeat(13_000)}"}`)).toContain('content');
  });

  it('scrubs control characters from flattened JSON notice bodies', () => {
    const body = JSON.stringify({
      content: 'line\u0001one',
      blocks: [{ type: 'section', text: 'two\u0007three' }],
    });
    const flat = formatWebhookNoticeBody(body);
    expect(flat).not.toMatch(/[\u0000-\u0009\u000b-\u001f]/);
    expect(flat).toContain('line one');
    expect(flat).toContain('two three');
  });
});
