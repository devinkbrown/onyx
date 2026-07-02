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
