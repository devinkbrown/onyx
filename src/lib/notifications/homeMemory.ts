// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ChatMessage } from '@/lib/irc/types';
import { isEncryptedWireText } from '@/lib/e2ee/replyPrivacy';

export interface HomeMemoryItem {
  target: string;
  count: number;
  participants: readonly string[];
  lastAt: Date;
  /** Exact retained row opened by a device-memory catch-up card. */
  lastMessageId: string;
  lastFrom: string;
  preview: string;
}

export interface HomeMemoryVaultTarget {
  target: string;
  messages: readonly ChatMessage[];
}

const SYSTEM_TYPES = new Set(['join', 'part', 'quit', 'kick', 'mode', 'topic', 'nick', 'system', 'error']);

export function summarizeHomeMemory(target: string, messages: readonly ChatMessage[]): HomeMemoryItem | null {
  const readable = messages.filter((message) => {
    if (message.deleted || message.redacted || message.pending) return false;
    return !SYSTEM_TYPES.has(message.type);
  });

  if (readable.length === 0) return null;

  const participants: string[] = [];
  const seen = new Set<string>();
  for (const message of readable) {
    if (!seen.has(message.from)) {
      seen.add(message.from);
      participants.push(message.from);
    }
  }

  const last = readable.reduce((latest, message) =>
    message.time.getTime() > latest.time.getTime() ? message : latest,
  );

  return {
    target,
    count: readable.length,
    participants,
    lastAt: last.time,
    lastMessageId: last.id,
    lastFrom: last.from,
    preview: previewText(last),
  };
}

/**
 * Pick vault-backed Home memory targets without inventing server membership.
 *
 * Order: recently-left rooms first (session join history), then persisted
 * auto-join rooms not currently in the live map. Auto-join is the cold-return
 * source — after a reload join history is empty, but auto-join still names the
 * rooms this device expects, so Device memory can paint from the vault before
 * JOIN replies land. Cap keeps IDB loadRecent fan-out bounded.
 */
export function collectHomeMemoryTargets(
  joinHistory: readonly string[],
  autoJoin: readonly string[],
  joinedKeys: Iterable<string>,
  limit = 6,
): string[] {
  const joined = new Set<string>();
  for (const key of joinedKeys) joined.add(key.toLowerCase());
  const out: string[] = [];
  const seen = new Set<string>();
  for (const target of [...joinHistory, ...autoJoin]) {
    const key = target.trim().toLowerCase();
    if (!key || joined.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(target.trim());
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Summarize an owner-scoped vault enumeration without inferring membership,
 * unread state, or mentions that only the live server can establish.
 */
export function buildHomeMemoryFromVault(
  targets: readonly HomeMemoryVaultTarget[],
  limit = 4,
): HomeMemoryItem[] {
  return targets
    .map(({ target, messages }) => summarizeHomeMemory(target, messages))
    .filter((item): item is HomeMemoryItem => item !== null)
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime() || a.target.localeCompare(b.target))
    .slice(0, Math.max(0, limit));
}

export async function buildHomeMemory(
  targets: readonly string[],
  loadRecent: (target: string) => Promise<readonly ChatMessage[]>,
  limit = 4,
): Promise<HomeMemoryItem[]> {
  const vaultedTargets = await Promise.all(
    targets.map(async (target) => ({ target, messages: await loadRecent(target) })),
  );
  return buildHomeMemoryFromVault(vaultedTargets, limit);
}

function previewText(message: ChatMessage): string {
  // Fail closed on ciphertext: honor the encrypted flag and detect legacy vault
  // rows that stored an ONYXDM1/ONYXROOM1 envelope without setting `encrypted`.
  if ((message.encrypted || isEncryptedWireText(message.text)) && !message.plaintext) {
    return 'Encrypted message';
  }

  const text = (message.plaintext ?? message.text).replace(/\s+/g, ' ').trim();
  if (!text) return message.type === 'action' ? 'Action message' : 'Message';
  if (text.length <= 96) return text;
  return `${text.slice(0, 95)}…`;
}
