// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * dispatch.ts — pure decision for the scheduled-message ("send later") queue.
 *
 * The store models a queue of `{ id, channel, text, sendAt }` entries. This
 * module answers the one question the dispatcher needs, with no clock and no
 * side effects, so it is exhaustively unit-testable: given the queue, the
 * current time, and whether we can reach the server right now, which entries
 * are DUE (send + drop) and which stay PENDING?
 *
 * Invariants encoded here:
 *  - Offline ⇒ NOTHING is due. Past-due entries stay pending until reconnect,
 *    so a message written while offline is never dropped.
 *  - `now` is injected — the caller passes Date.now() (or a fixed test clock).
 *  - Inputs are never mutated; both output arrays are fresh.
 */

export interface ScheduledMessageOwner {
  /** Exact WebSocket endpoint that owned the composing session. */
  readonly serverUrl: string;
  /** Lowercased account name, or guest nick when no account was authenticated. */
  readonly identity: string;
}

export interface ScheduledMessage {
  readonly id: string;
  readonly channel: string;
  readonly text: string;
  /** Epoch milliseconds at which the message should be sent. */
  readonly sendAt: number;
  /** Legacy rows have no owner and are preserved but never auto-dispatched. */
  readonly owner: ScheduledMessageOwner | null;
  /** Durable dispatcher claim; present only while async admission is pending. */
  readonly claim?: { readonly token: string; readonly claimedAt: number };
  /** Owner retirement generation captured when this row was created. */
  readonly generation?: number;
  readonly clearEpoch?: number;
}

export const MAX_SCHEDULED_MESSAGES = 256;
export const MAX_SCHEDULED_ID_LENGTH = 128;
export const MAX_SCHEDULED_CHANNEL_LENGTH = 256;
export const MAX_SCHEDULED_TEXT_LENGTH = 65_536;
const MAX_SCHEDULED_STORAGE_LENGTH = 2 * 1024 * 1024;
const MAX_SCHEDULED_SERVER_LENGTH = 2_048;
const MAX_SCHEDULED_IDENTITY_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOwner(value: unknown): ScheduledMessageOwner | null {
  if (!isRecord(value)) return null;
  const { serverUrl, identity } = value;
  if (
    typeof serverUrl !== 'string'
    || serverUrl.length === 0
    || serverUrl.length > MAX_SCHEDULED_SERVER_LENGTH
    || serverUrl !== serverUrl.trim()
    || typeof identity !== 'string'
    || identity.length === 0
    || identity.length > MAX_SCHEDULED_IDENTITY_LENGTH
    || identity !== identity.trim()
  ) return null;
  return { serverUrl, identity: identity.toLowerCase() };
}

/** Parse the local scheduled-message queue as untrusted, version-drifting data. */
export function parseScheduledMessages(raw: string | null): ScheduledMessage[] {
  if (!raw || raw.length > MAX_SCHEDULED_STORAGE_LENGTH) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const messages: ScheduledMessage[] = [];
  const ids = new Set<string>();
  for (const value of parsed) {
    if (messages.length >= MAX_SCHEDULED_MESSAGES) break;
    if (!isRecord(value)) continue;
    const { id, channel, text, sendAt, generation, clearEpoch } = value;
    if (
      typeof id !== 'string'
      || id.length === 0
      || id.length > MAX_SCHEDULED_ID_LENGTH
      || ids.has(id)
      || typeof channel !== 'string'
      || channel.length === 0
      || channel.length > MAX_SCHEDULED_CHANNEL_LENGTH
      || typeof text !== 'string'
      || text.trim().length === 0
      || text.length > MAX_SCHEDULED_TEXT_LENGTH
      || typeof sendAt !== 'number'
      || !Number.isSafeInteger(sendAt)
      || sendAt <= 0
    ) continue;
    const parsedGeneration = typeof generation === 'number' ? generation : undefined;
    if (generation !== undefined && (parsedGeneration === undefined || !Number.isSafeInteger(parsedGeneration) || parsedGeneration < 0)) continue;
    const parsedClearEpoch = typeof clearEpoch === 'number' ? clearEpoch : undefined;
    if (clearEpoch !== undefined && (parsedClearEpoch === undefined || !Number.isSafeInteger(parsedClearEpoch) || parsedClearEpoch < 0)) continue;
    ids.add(id);
    const claimValue = value.claim;
    const claim = isRecord(claimValue)
      && typeof claimValue.token === 'string' && claimValue.token.length > 0
      && claimValue.token.length <= MAX_SCHEDULED_ID_LENGTH
      && typeof claimValue.claimedAt === 'number' && Number.isSafeInteger(claimValue.claimedAt)
      && claimValue.claimedAt > 0
      ? { token: claimValue.token, claimedAt: claimValue.claimedAt }
      : undefined;
    messages.push({ id, channel, text, sendAt, owner: parseOwner(value.owner), ...(claim ? { claim } : {}), ...(parsedGeneration !== undefined ? { generation: parsedGeneration } : {}), ...(parsedClearEpoch !== undefined ? { clearEpoch: parsedClearEpoch } : {}) });
  }
  return messages.sort((a, b) => a.sendAt - b.sendAt || a.id.localeCompare(b.id));
}

export interface DispatchDecision {
  /** Entries whose time has come — send now, then remove from the queue. */
  readonly due: ScheduledMessage[];
  /** Entries to keep queued (future, or all of them while offline). */
  readonly pending: ScheduledMessage[];
}

/**
 * Split the queue into due-now vs still-pending.
 *
 * @param messages  the current queue (never mutated)
 * @param now       epoch ms to compare `sendAt` against (inject Date.now())
 * @param connected whether the client is connected AND ready to send
 */
export function selectDueMessages(
  messages: readonly ScheduledMessage[],
  now: number,
  connected: boolean,
): DispatchDecision {
  // Offline: hold everything. Never let a past-due entry be dropped just
  // because we happened to tick while disconnected.
  if (!connected) return { due: [], pending: [...messages] };

  const due: ScheduledMessage[] = [];
  const pending: ScheduledMessage[] = [];
  for (const m of messages) {
    if (m.sendAt <= now) due.push(m);
    else pending.push(m);
  }
  return { due, pending };
}
