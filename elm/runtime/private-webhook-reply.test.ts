import { describe, expect, it } from 'vitest';
import { isWebhookCreationReply, parseWebhookCreationReply } from './private-webhook-reply';

describe('private webhook creation reply boundary', () => {
  it('parses the actual server one-time URL notice', () => {
    const body = 'WEBHOOK: created for #room — POST Discord webhook JSON to https://discord.com/api/webhooks/123/secret-token';
    expect(isWebhookCreationReply(body)).toBe(true);
    expect(parseWebhookCreationReply(body)).toEqual({
      room: '#room', url: 'https://discord.com/api/webhooks/123/secret-token',
    });
  });

  it('keeps malformed and unsolicited secret-shaped replies consumable without exposing a URL', () => {
    const malformed = 'WEBHOOK: created for #room — POST Discord webhook JSON to javascript:alert(1)';
    const truncated = 'WEBHOOK: created for #room — POST Discord webhook JSON to https://discord.com/api/webhooks/123';
    expect(isWebhookCreationReply(malformed)).toBe(true);
    expect(parseWebhookCreationReply(malformed)).toBeNull();
    expect(isWebhookCreationReply(truncated)).toBe(true);
    expect(parseWebhookCreationReply(truncated)).toEqual({ room: '#room', url: 'https://discord.com/api/webhooks/123' });
    expect(isWebhookCreationReply('WEBHOOK: created for')).toBe(true);
  });
});
