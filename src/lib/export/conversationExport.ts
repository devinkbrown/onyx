// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * conversationExport.ts — portable local transcript export (this device only).
 *
 * Never claims server-complete history. Strips control characters from bodies
 * for safe download filenames and plain-text transcripts.
 */

import type { ChatMessage } from '@/lib/irc/types';

export const CONVERSATION_EXPORT_KIND = 'onyx.conversation-export' as const;
export const CONVERSATION_EXPORT_VERSION = 1 as const;
export const MAX_EXPORT_MESSAGES = 5_000;

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export type ConversationExport = {
  kind: typeof CONVERSATION_EXPORT_KIND;
  version: typeof CONVERSATION_EXPORT_VERSION;
  exportedAt: string;
  target: string;
  network?: string;
  ourNick?: string;
  messageCount: number;
  messages: Array<{
    id: string;
    time: string;
    from: string;
    type: string;
    text: string;
    edited?: boolean;
  }>;
};

function scrub(text: string, max = 8_192): string {
  return text.replace(CONTROL, '').slice(0, max);
}

function safeFilenamePart(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._#+-]+/g, '_').slice(0, 64) || 'conversation';
}

export function buildConversationExport(input: {
  target: string;
  messages: readonly ChatMessage[];
  network?: string;
  ourNick?: string;
  now?: Date;
}): ConversationExport {
  const target = scrub(input.target, 256) || 'unknown';
  const slice = input.messages.slice(-MAX_EXPORT_MESSAGES);
  return {
    kind: CONVERSATION_EXPORT_KIND,
    version: CONVERSATION_EXPORT_VERSION,
    exportedAt: (input.now ?? new Date()).toISOString(),
    target,
    ...(input.network ? { network: scrub(input.network, 64) } : {}),
    ...(input.ourNick ? { ourNick: scrub(input.ourNick, 64) } : {}),
    messageCount: slice.length,
    messages: slice.map((m) => ({
      id: scrub(m.id, 128),
      time: m.time instanceof Date ? m.time.toISOString() : new Date().toISOString(),
      from: scrub(m.from, 64),
      type: scrub(String(m.type ?? 'msg'), 32),
      text: scrub(typeof m.plaintext === 'string' ? m.plaintext : m.text),
      ...(m.edited ? { edited: true } : {}),
    })),
  };
}

export function conversationExportToText(doc: ConversationExport): string {
  const lines = [
    `# ${doc.target} — local export`,
    `# network: ${doc.network ?? 'unknown'}`,
    `# exported: ${doc.exportedAt}`,
    `# messages: ${doc.messageCount} (this device only — not complete server history)`,
    '',
  ];
  for (const m of doc.messages) {
    lines.push(`[${m.time}] <${m.from}> ${m.text}${m.edited ? ' (edited)' : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

export function downloadConversationExport(doc: ConversationExport, format: 'json' | 'txt' = 'txt'): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const body = format === 'json'
      ? `${JSON.stringify(doc, null, 2)}\n`
      : conversationExportToText(doc);
    const mime = format === 'json' ? 'application/json' : 'text/plain';
    const blob = new Blob([body], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `onyx-${safeFilenamePart(doc.target)}-${doc.exportedAt.slice(0, 10)}.${format}`;
    a.rel = 'noopener';
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
