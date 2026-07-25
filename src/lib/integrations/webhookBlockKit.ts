// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * webhookBlockKit.ts — render Discord-ish webhook payloads as plain IRC-safe text.
 *
 * Server-side webhooks already flatten at ingress. This client module is the
 * parity path for NOTICE (or imported) bodies that still carry raw Discord
 * webhook JSON — fail closed on non-JSON / non-webhook shapes and scrub C0.
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
/** Bound hostile JSON parse work (vault text is already capped separately). */
const MAX_JSON_CHARS = 12_000;

function clean(text: string | undefined, max = MAX_LINE): string {
  if (!text) return '';
  return text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/** Discord Block Kit often nests `text: { type, text }` — accept either form. */
function coerceTextField(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const obj = asRecord(value);
  if (obj && typeof obj.text === 'string') return obj.text;
  return undefined;
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function parseBlock(raw: unknown): WebhookBlock | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const type = readString(obj, 'type');
  if (!type) return null;
  switch (type) {
    case 'divider':
      return { type: 'divider' };
    case 'header':
      return { type: 'header', text: coerceTextField(obj.text) };
    case 'section':
      return { type: 'section', text: coerceTextField(obj.text) };
    case 'context': {
      const elementsRaw = obj.elements;
      const elements: Array<{ text?: string }> = [];
      if (Array.isArray(elementsRaw)) {
        for (const el of elementsRaw) {
          const text = coerceTextField(el);
          if (text !== undefined) elements.push({ text });
        }
      }
      return { type: 'context', elements };
    }
    default: {
      const text = coerceTextField(obj.text);
      return text !== undefined ? { type: 'unknown', text } : { type: 'unknown' };
    }
  }
}

type WebhookEmbed = NonNullable<WebhookPayload['embeds']>[number];

function parseEmbed(raw: unknown): WebhookEmbed | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const fieldsRaw = obj.fields;
  const fields: Array<{ name?: string; value?: string }> = [];
  if (Array.isArray(fieldsRaw)) {
    for (const f of fieldsRaw) {
      const fo = asRecord(f);
      if (!fo) continue;
      fields.push({
        name: readString(fo, 'name'),
        value: readString(fo, 'value'),
      });
    }
  }
  return {
    title: readString(obj, 'title'),
    description: readString(obj, 'description'),
    url: readString(obj, 'url'),
    ...(fields.length > 0 ? { fields } : {}),
  };
}

/**
 * Parse a raw NOTICE/message body as Discord-compatible webhook JSON.
 * Returns null when the body is not JSON or not webhook-shaped (fail closed).
 */
export function parseWebhookPayloadJson(raw: string): WebhookPayload | null {
  const trimmed = raw.trim();
  if (trimmed.length < 2 || trimmed.length > MAX_JSON_CHARS) return null;
  if (trimmed[0] !== '{' || trimmed[trimmed.length - 1] !== '}') return null;

  let value: unknown;
  try {
    value = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }

  const obj = asRecord(value);
  if (!obj) return null;

  const content = readString(obj, 'content');
  const username = readString(obj, 'username');

  const embeds: NonNullable<WebhookPayload['embeds']> = [];
  if (Array.isArray(obj.embeds)) {
    for (const item of obj.embeds) {
      const embed = parseEmbed(item);
      if (embed) embeds.push(embed);
    }
  }

  const blocks: WebhookBlock[] = [];
  if (Array.isArray(obj.blocks)) {
    for (const item of obj.blocks) {
      const block = parseBlock(item);
      if (block) blocks.push(block);
    }
  }

  const hasContent = typeof content === 'string' && content.length > 0;
  const hasEmbeds = embeds.length > 0;
  const hasBlocks = blocks.length > 0;
  // Require a usable Discord webhook surface — bare `{}` / unrelated objects
  // must stay as the original message body.
  if (!hasContent && !hasEmbeds && !hasBlocks) return null;

  const payload: WebhookPayload = {};
  if (username !== undefined) payload.username = username;
  if (content !== undefined) payload.content = content;
  if (hasEmbeds) payload.embeds = embeds;
  if (hasBlocks) payload.blocks = blocks;
  return payload;
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

/**
 * Format a NOTICE body: when it is Discord webhook JSON, flatten to IRC-safe
 * multiline text; otherwise return the original body unchanged.
 */
export function formatWebhookNoticeBody(text: string): string {
  const payload = parseWebhookPayloadJson(text);
  if (!payload) return text;
  const flat = webhookPayloadToMessage(payload);
  return flat.length > 0 ? flat : text;
}
