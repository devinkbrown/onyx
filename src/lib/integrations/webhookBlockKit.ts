// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * webhookBlockKit.ts — render Discord-ish webhook payloads as plain IRC-safe text.
 */

export type WebhookBlock =
  | { type: 'section'; text?: string }
  | { type: 'header'; text?: string }
  | { type: 'divider' }
  | { type: 'context'; elements?: Array<{ text?: string }> }
  | { type: 'unknown'; text?: string };

export type WebhookPayload = {
  content?: string;
  username?: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    url?: string;
    fields?: Array<{ name?: string; value?: string }>;
  }>;
  blocks?: WebhookBlock[];
};

const CONTROL = /[\u0000-\u001f\u007f]/gu;
const MAX_LINE = 400;
const MAX_LINES = 24;

function clean(text: string | undefined, max = MAX_LINE): string {
  if (!text) return '';
  return text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function webhookPayloadToLines(payload: WebhookPayload): string[] {
  const lines: string[] = [];
  const push = (line: string) => {
    const c = clean(line);
    if (c) lines.push(c);
  };

  if (payload.username) push(`• ${payload.username}`);
  if (payload.content) push(payload.content);

  for (const block of payload.blocks ?? []) {
    if (lines.length >= MAX_LINES) break;
    switch (block.type) {
      case 'divider':
        push('———');
        break;
      case 'header':
        push(`## ${block.text ?? ''}`);
        break;
      case 'section':
        push(block.text ?? '');
        break;
      case 'context':
        for (const el of block.elements ?? []) push(el.text ?? '');
        break;
      case 'unknown':
        if (block.text) push(block.text);
        break;
      default:
        break;
    }
  }

  for (const embed of payload.embeds ?? []) {
    if (lines.length >= MAX_LINES) break;
    if (embed.title) push(embed.title);
    if (embed.description) push(embed.description);
    if (embed.url) push(embed.url);
    for (const field of embed.fields ?? []) {
      if (lines.length >= MAX_LINES) break;
      const name = clean(field.name, 80);
      const value = clean(field.value, 200);
      if (name && value) push(`${name}: ${value}`);
      else if (name) push(name);
      else if (value) push(value);
    }
  }

  return lines.slice(0, MAX_LINES);
}

export function webhookPayloadToMessage(payload: WebhookPayload): string {
  return webhookPayloadToLines(payload).join('\n');
}
