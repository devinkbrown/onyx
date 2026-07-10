/**
 * historyVault.ts — local-first scrollback (Roadmap Phase 1.1).
 *
 * Persists channel/DM messages to IndexedDB so conversations open INSTANTLY
 * from local memory (before the network answers), survive reloads, and are
 * readable offline. No cloud, no bouncer — the device remembers.
 *
 * Design constraints:
 *  - NEVER block or break the UI: every call feature-detects and swallows
 *    failures (private windows, quota, corrupted DBs).
 *  - Bounded: at most VAULT_KEEP messages per target, oldest pruned.
 *  - Dumb storage: messages serialize flat (Dates → epoch ms); reactions and
 *    reply metadata survive; functions/Sets never enter a ChatMessage.
 */
import type { ChatMessage } from '@/lib/irc/types';

const DB_NAME = 'onyx-vault';
const DB_VERSION = 2;
const STORE = 'messages';
const OUTBOX = 'outbox';
export const VAULT_KEEP = 400;
/** Queued sends older than this are dropped, not fired into a stale room. */
export const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type StoredMessage = Omit<ChatMessage, 'time'> & { time: number; target_key: string };

export interface VaultExportTarget {
  /** Lowercase conversation key stored in this device vault. */
  target: string;
  /** Chronological, vault-safe messages for the target. */
  messages: ChatMessage[];
}

export interface VaultExportSnapshot {
  kind: 'onyx-vault';
  version: 1;
  exportedAt: string;
  targets: VaultExportTarget[];
}

export interface OutboxEntry {
  /** Stable id; the buffer's pending placeholder reuses it as `outbox:<id>`. */
  id: string;
  /** Conversation key ('#channel' or DM nick, lowercased). */
  target_key: string;
  /** Original-case target for the eventual PRIVMSG. */
  target: string;
  text: string;
  queued_at: number;
  /** Same-millisecond ordering tiebreaker (monotonic within a session). */
  seq: number;
}

let _outboxSeq = 0;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openVault(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: ['target_key', 'id'] });
          store.createIndex('by_target_time', ['target_key', 'time']);
        }
        if (!db.objectStoreNames.contains(OUTBOX)) {
          db.createObjectStore(OUTBOX, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export function serializeMessage(target: string, msg: ChatMessage): StoredMessage {
  // `plaintext` is the decrypted body of an E2EE DM — view-only, never at
  // rest. Drop it so the vault stores only the ciphertext envelope (`text`).
  const { plaintext: _plaintext, ...rest } = msg;
  return {
    ...rest,
    time: msg.time instanceof Date ? msg.time.getTime() : Number(msg.time) || 0,
    target_key: target.toLowerCase(),
  };
}

export function deserializeMessage(row: StoredMessage): ChatMessage {
  const { target_key: _key, time, ...rest } = row;
  return { ...rest, time: new Date(time) } as ChatMessage;
}

/** Persist a batch for a target (bulk put; last VAULT_KEEP retained). */
export async function saveMessages(target: string, msgs: readonly ChatMessage[]): Promise<void> {
  if (msgs.length === 0) return;
  const db = await openVault();
  if (!db) return;
  try {
    const tail = msgs.slice(-VAULT_KEEP);
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const m of tail) store.put(serializeMessage(target, m));
    await txDone(tx);
    void pruneTarget(db, target.toLowerCase());
  } catch {
    /* quota / private mode — the vault is best-effort */
  }
}

/** Load the most recent messages for a target, chronological. */
export async function loadRecent(target: string, limit = VAULT_KEEP): Promise<ChatMessage[]> {
  const db = await openVault();
  if (!db) return [];
  try {
    const key = target.toLowerCase();
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('by_target_time');
    const range = IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]);
    return await new Promise<ChatMessage[]>((resolve) => {
      const out: ChatMessage[] = [];
      // Walk newest-first, stop at limit, reverse to chronological.
      const cursorReq = idx.openCursor(range, 'prev');
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || out.length >= limit) {
          resolve(out.reverse());
          return;
        }
        out.push(deserializeMessage(cursor.value as StoredMessage));
        cursor.continue();
      };
      cursorReq.onerror = () => resolve(out.reverse());
    });
  } catch {
    return [];
  }
}

/** Load the local messages nearest a timestamp, returned chronological. */
export async function loadAround(target: string, at: Date, limit = 50): Promise<ChatMessage[]> {
  const db = await openVault();
  if (!db) return [];
  try {
    const key = target.toLowerCase();
    const anchor = at.getTime();
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('by_target_time');
    const range = IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]);
    const rows = await new Promise<StoredMessage[]>((resolve) => {
      const out: StoredMessage[] = [];
      const cursorReq = idx.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        out.push(cursor.value as StoredMessage);
        cursor.continue();
      };
      cursorReq.onerror = () => resolve(out);
    });
    return rows
      .filter((r) => !r.deleted && !r.redacted)
      .sort((a, b) => Math.abs(a.time - anchor) - Math.abs(b.time - anchor) || a.time - b.time)
      .slice(0, limit)
      .sort((a, b) => a.time - b.time)
      .map(deserializeMessage);
  } catch {
    return [];
  }
}

/** Export every locally remembered target as a portable, device-safe JSON shape. */
export async function exportVault(): Promise<VaultExportSnapshot> {
  const db = await openVault();
  const snapshot: VaultExportSnapshot = {
    kind: 'onyx-vault',
    version: 1,
    exportedAt: new Date().toISOString(),
    targets: [],
  };
  if (!db) return snapshot;

  try {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const rows = await new Promise<StoredMessage[]>((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result ?? []) as StoredMessage[]);
      req.onerror = () => resolve([]);
    });
    const grouped = new Map<string, StoredMessage[]>();
    for (const row of rows) {
      const target = row.target_key || row.target.toLowerCase();
      const group = grouped.get(target) ?? [];
      group.push(row);
      grouped.set(target, group);
    }
    snapshot.targets = [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([target, messages]) => ({
        target,
        messages: messages
          .slice()
          .sort((a, b) => a.time - b.time)
          .map(deserializeMessage),
      }));
    return snapshot;
  } catch {
    return snapshot;
  }
}

/** Merge a validated portable vault snapshot into the local IndexedDB vault. */
export async function importVault(snapshot: VaultExportSnapshot): Promise<{ targets: number; messages: number }> {
  let targetCount = 0;
  let messageCount = 0;
  for (const entry of snapshot.targets) {
    if (entry.messages.length === 0) continue;
    await saveMessages(entry.target, entry.messages);
    targetCount += 1;
    messageCount += entry.messages.length;
  }
  return { targets: targetCount, messages: messageCount };
}

const MESSAGE_TYPES = new Set([
  'msg',
  'action',
  'notice',
  'join',
  'part',
  'quit',
  'kick',
  'mode',
  'topic',
  'nick',
  'system',
  'error',
  'whisper',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reviveExportMessage(raw: unknown, fallbackTarget: string): ChatMessage | null {
  if (!isRecord(raw)) return null;
  const id = raw.id;
  const from = raw.from;
  const text = raw.text;
  const type = raw.type;
  const target = typeof raw.target === 'string' && raw.target.trim() ? raw.target : fallbackTarget;
  if (
    typeof id !== 'string' ||
    typeof from !== 'string' ||
    typeof text !== 'string' ||
    typeof type !== 'string' ||
    !MESSAGE_TYPES.has(type) ||
    !target.trim()
  ) {
    return null;
  }

  const rawTime = raw.time;
  const time = rawTime instanceof Date ? rawTime : new Date(typeof rawTime === 'number' || typeof rawTime === 'string' ? rawTime : NaN);
  if (Number.isNaN(time.getTime())) return null;

  const message: ChatMessage = {
    id,
    time,
    from,
    text,
    type: type as ChatMessage['type'],
    target,
  };
  if (typeof raw.highlight === 'boolean') message.highlight = raw.highlight;
  if (typeof raw.topic === 'string' || raw.topic === null) message.topic = raw.topic;
  if (typeof raw.edited === 'boolean') message.edited = raw.edited;
  if (typeof raw.deleted === 'boolean') message.deleted = raw.deleted;
  if (typeof raw.redacted === 'boolean') message.redacted = raw.redacted;
  if (typeof raw.pending === 'boolean') message.pending = raw.pending;
  if (typeof raw.encrypted === 'boolean') message.encrypted = raw.encrypted;
  if (Array.isArray(raw.reactions)) {
    message.reactions = raw.reactions
      .filter(isRecord)
      .map((reaction) => ({
        emoji: typeof reaction.emoji === 'string' ? reaction.emoji : '',
        users: Array.isArray(reaction.users) ? reaction.users.filter((user): user is string => typeof user === 'string') : [],
      }))
      .filter((reaction) => reaction.emoji.length > 0);
  }
  if (isRecord(raw.replyTo) && typeof raw.replyTo.id === 'string' && typeof raw.replyTo.from === 'string' && typeof raw.replyTo.text === 'string') {
    message.replyTo = { id: raw.replyTo.id, from: raw.replyTo.from, text: raw.replyTo.text };
  }
  return message;
}

/** Validate and normalize unknown JSON before it can be imported into the vault. */
export function parseVaultExport(raw: unknown): VaultExportSnapshot | null {
  if (!isRecord(raw) || raw.kind !== 'onyx-vault' || raw.version !== 1 || !Array.isArray(raw.targets)) {
    return null;
  }
  const exportedAt = typeof raw.exportedAt === 'string' && !Number.isNaN(Date.parse(raw.exportedAt))
    ? raw.exportedAt
    : new Date().toISOString();
  const targets: VaultExportTarget[] = [];
  for (const targetRaw of raw.targets) {
    if (!isRecord(targetRaw) || typeof targetRaw.target !== 'string' || !targetRaw.target.trim() || !Array.isArray(targetRaw.messages)) {
      continue;
    }
    const target = targetRaw.target.toLowerCase();
    const messages = targetRaw.messages
      .map((message) => reviveExportMessage(message, target))
      .filter((message): message is ChatMessage => message !== null);
    targets.push({ target, messages });
  }
  return {
    kind: 'onyx-vault',
    version: 1,
    exportedAt,
    targets,
  };
}

async function pruneTarget(db: IDBDatabase, key: string): Promise<void> {
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const idx = tx.objectStore(STORE).index('by_target_time');
    const range = IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]);
    let seen = 0;
    await new Promise<void>((resolve) => {
      const cursorReq = idx.openCursor(range, 'prev');
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        seen += 1;
        if (seen > VAULT_KEEP) cursor.delete();
        cursor.continue();
      };
      cursorReq.onerror = () => resolve();
    });
  } catch {
    /* best-effort */
  }
}

export interface VaultSearchHit {
  /** Conversation key the message lives in ('#channel' or a DM nick, lowercased). */
  target: string;
  message: ChatMessage;
}

/**
 * Search EVERY remembered conversation on this device (Roadmap Phase 1.3).
 * Case-insensitive substring match on message text and sender, newest first.
 * A full-store scan is fine at vault scale (≤ VAULT_KEEP rows per target).
 */
export async function searchVault(query: string, limit = 80): Promise<VaultSearchHit[]> {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  const db = await openVault();
  if (!db) return [];
  try {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const rows = await new Promise<StoredMessage[]>((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result ?? []) as StoredMessage[]);
      req.onerror = () => resolve([]);
    });
    return rows
      .filter((r) => {
        if (r.deleted || r.redacted) return false;
        return (
          r.text.toLocaleLowerCase().includes(q) ||
          r.from.toLocaleLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.time - a.time)
      .slice(0, limit)
      .map((r) => ({ target: r.target_key, message: deserializeMessage(r) }));
  } catch {
    return [];
  }
}

/**
 * Read EVERY remembered, non-tombstoned message on this device as
 * VaultSearchHits (Roadmap v3.0 — semantic search reuses this scan). A full
 * getAll is fine at vault scale (≤ VAULT_KEEP rows per target). Deleted and
 * redacted rows are excluded, matching {@link searchVault}.
 */
export async function readAllVaultHits(): Promise<VaultSearchHit[]> {
  const db = await openVault();
  if (!db) return [];
  try {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const rows = await new Promise<StoredMessage[]>((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result ?? []) as StoredMessage[]);
      req.onerror = () => resolve([]);
    });
    return rows
      .filter((r) => !r.deleted && !r.redacted)
      .map((r) => ({ target: r.target_key, message: deserializeMessage(r) }));
  } catch {
    return [];
  }
}

// ── Offline outbox (Roadmap Phase 2.5) ───────────────────────────────────────

/** Queue a message composed while offline; it sends on reconnect. */
export async function queueOutbox(target: string, text: string): Promise<OutboxEntry | null> {
  const db = await openVault();
  if (!db) return null;
  const entry: OutboxEntry = {
    id: `ob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    target_key: target.toLowerCase(),
    target,
    text,
    queued_at: Date.now(),
    seq: ++_outboxSeq,
  };
  try {
    const tx = db.transaction(OUTBOX, 'readwrite');
    tx.objectStore(OUTBOX).put(entry);
    await txDone(tx);
    return entry;
  } catch {
    return null;
  }
}

/** All queued sends, oldest first. */
export async function loadOutbox(): Promise<OutboxEntry[]> {
  const db = await openVault();
  if (!db) return [];
  try {
    const tx = db.transaction(OUTBOX, 'readonly');
    const store = tx.objectStore(OUTBOX);
    const rows = await new Promise<OutboxEntry[]>((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result ?? []) as OutboxEntry[]);
      req.onerror = () => resolve([]);
    });
    return rows.sort((a, b) => a.queued_at - b.queued_at || a.seq - b.seq);
  } catch {
    return [];
  }
}

/** Remove one queued send (after it was fired, or expired). */
export async function deleteOutboxEntry(id: string): Promise<void> {
  const db = await openVault();
  if (!db) return;
  try {
    const tx = db.transaction(OUTBOX, 'readwrite');
    tx.objectStore(OUTBOX).delete(id);
    await txDone(tx);
  } catch {
    /* best-effort */
  }
}

/** Wipe the whole vault (preferences "forget this device"). */
export async function clearVault(): Promise<void> {
  const db = await openVault();
  if (!db) return;
  try {
    const tx = db.transaction([STORE, OUTBOX], 'readwrite');
    tx.objectStore(STORE).clear();
    tx.objectStore(OUTBOX).clear();
    await txDone(tx);
  } catch {
    /* best-effort */
  }
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

/** Test hook — reset the module's cached connection. */
export function _resetVaultForTests(): void {
  dbPromise = null;
}
