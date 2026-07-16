// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Device-local read cursors for Orochi named conversations.
 *
 * Privacy invariant: the persisted and published shape contains only a
 * normalized channel/topic pair plus the last-read message id and timestamp.
 * Message bodies, authors, previews, and account data are never accepted into
 * the stored shape.
 */

import { isValidTopicLabel } from './topics';

export const TOPIC_READ_LEDGER_KEY = 'onyx:topic-read-ledger';
export const MAX_TOPIC_READ_ENTRIES = 256;
export const MAX_TOPIC_READ_MESSAGES = 4_096;
/** Maximum untrusted rows inspected before dedupe/sort during storage/import parsing. */
export const MAX_TOPIC_READ_PARSE_ENTRIES = 4_096;

const MAX_CHANNEL_LENGTH = 128;
const MAX_MESSAGE_ID_LENGTH = 512;
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;
const CHANNEL_INVALID_PATTERN = /[\s,\x00-\x1f\x7f]/u;
const MESSAGE_ID_CONTROL_PATTERN = /[\x00-\x1f\x7f]/u;

export interface TopicReadMarker {
  channel: string;
  topic: string;
  lastReadMessageId: string;
  lastReadAt: number;
}

/** The only message fields the ledger needs or accepts. */
export interface TopicReadMessage {
  id: string;
  time: Date | number;
  topic?: string | null;
}

export interface TopicUnreadOptions<T extends TopicReadMessage> {
  /**
   * Channel-wide first-unread array index for topics with no device marker.
   * Invalid indices fail closed to `messages.length` (no inferred unread).
   */
  fallbackBoundaryIndex: number;
  /** Caller-owned classification keeps protocol-specific system types out. */
  isSystemMessage: (message: T) => boolean;
}

export interface TopicUnreadProjectionOptions<T extends TopicReadMessage> {
  /**
   * Room-wide first-unread array index. Untagged rows and named topics without
   * a device marker inherit this boundary. Invalid indices fail closed to the
   * end of the message list.
   */
  fallbackBoundaryIndex: number;
  /** Caller-owned eligibility check (self, system, replay, and similar rows). */
  isExcludedMessage: (message: T) => boolean;
  /** Caller-owned highlight classification; exceptions fail closed to false. */
  isHighlightMessage: (message: T) => boolean;
}

/** Aggregate unread state after applying room and device-topic boundaries. */
export interface TopicUnreadProjection {
  unreadByTopic: ReadonlyMap<string, number>;
  untaggedUnread: number;
  totalUnread: number;
  highlightCount: number;
  earliestUnreadMessageId: string | null;
}

export type TopicReadLedgerListener = (markers: readonly TopicReadMarker[]) => void;

interface ValidMessage {
  id: string;
  topic: string;
  time: number;
  index: number;
}

interface ValidRoomMessage {
  id: string;
  topic: string | null;
  time: number;
  index: number;
}

const listeners = new Set<TopicReadLedgerListener>();
let listeningForStorage = false;

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareNewest(left: TopicReadMarker, right: TopicReadMarker): number {
  if (left.lastReadAt !== right.lastReadAt) return right.lastReadAt - left.lastReadAt;
  return compareText(left.channel, right.channel)
    || compareText(left.topic, right.topic)
    || compareText(left.lastReadMessageId, right.lastReadMessageId);
}

function normalizeChannel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const channel = value.trim().toLowerCase();
  if (
    channel.length === 0
    || channel.length > MAX_CHANNEL_LENGTH
    || (channel[0] !== '#' && channel[0] !== '&')
    || CHANNEL_INVALID_PATTERN.test(channel)
  ) return null;
  return channel;
}

function normalizeTopic(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const topic = value.trim().toLowerCase();
  return isValidTopicLabel(topic) ? topic : null;
}

function normalizeMessageId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (
    value.length === 0
    || value.length > MAX_MESSAGE_ID_LENGTH
    || value !== value.trim()
    || MESSAGE_ID_CONTROL_PATTERN.test(value)
  ) return null;
  return value;
}

function normalizeTime(value: unknown): number | null {
  const milliseconds = value instanceof Date ? value.getTime() : value;
  if (
    typeof milliseconds !== 'number'
    || !Number.isSafeInteger(milliseconds)
    || milliseconds < 0
    || milliseconds > MAX_DATE_MILLISECONDS
  ) return null;
  return milliseconds;
}

function markerKey(marker: Pick<TopicReadMarker, 'channel' | 'topic'>): string {
  return `${marker.channel}\u0000${marker.topic}`;
}

function sanitizeMarker(value: unknown): TopicReadMarker | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const channel = normalizeChannel(record['channel']);
  const topic = normalizeTopic(record['topic']);
  const lastReadMessageId = normalizeMessageId(record['lastReadMessageId']);
  const lastReadAt = normalizeTime(record['lastReadAt']);
  if (!channel || !topic || !lastReadMessageId || lastReadAt === null) return null;
  return { channel, topic, lastReadMessageId, lastReadAt };
}

function sanitizeLedger(value: unknown): TopicReadMarker[] {
  if (!Array.isArray(value)) return [];

  const byTopic = new Map<string, TopicReadMarker>();
  const scanCount = Math.min(value.length, MAX_TOPIC_READ_PARSE_ENTRIES);
  for (let index = 0; index < scanCount; index += 1) {
    const raw = value[index];
    const marker = sanitizeMarker(raw);
    if (!marker) continue;
    const key = markerKey(marker);
    const existing = byTopic.get(key);
    if (!existing || compareNewest(marker, existing) < 0) byTopic.set(key, marker);
  }

  return [...byTopic.values()]
    .sort(compareNewest)
    .slice(0, MAX_TOPIC_READ_ENTRIES);
}

/**
 * Sanitize an untrusted portable/persisted ledger into the canonical bounded
 * metadata-only shape. This is the shared parser for storage and transfer
 * boundaries; callers never need to duplicate topic cursor validation.
 */
export function parseTopicReadLedger(value: unknown): TopicReadMarker[] {
  return sanitizeLedger(value);
}

function parseSerializedLedger(raw: string | null): TopicReadMarker[] {
  if (raw === null) return [];
  try {
    return sanitizeLedger(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

/** Read and sanitize the complete device-local marker ledger. */
export function readTopicReadLedger(): TopicReadMarker[] {
  const store = storage();
  if (!store) return [];
  try {
    return parseSerializedLedger(store.getItem(TOPIC_READ_LEDGER_KEY));
  } catch {
    return [];
  }
}

/** Case-insensitive lookup for one channel/topic marker. */
export function readTopicReadMarker(channel: string, topic: string): TopicReadMarker | null {
  const normalizedChannel = normalizeChannel(channel);
  const normalizedTopic = normalizeTopic(topic);
  if (!normalizedChannel || !normalizedTopic) return null;
  return readTopicReadLedger().find((marker) =>
    marker.channel === normalizedChannel && marker.topic === normalizedTopic,
  ) ?? null;
}

function publish(markers: readonly TopicReadMarker[]): void {
  for (const listener of [...listeners]) {
    try {
      // Give every consumer its own structural snapshot. A hostile listener
      // cannot mutate what a later listener observes or add message-like data.
      listener(markers.map((marker) => ({ ...marker })));
    } catch {
      // One consumer must not prevent later consumers from observing metadata.
    }
  }
}

function persist(markers: readonly TopicReadMarker[]): TopicReadMarker[] {
  const next = sanitizeLedger(markers);
  const store = storage();
  if (!store) {
    publish([]);
    return [];
  }
  try {
    if (next.length === 0) store.removeItem(TOPIC_READ_LEDGER_KEY);
    else store.setItem(TOPIC_READ_LEDGER_KEY, JSON.stringify(next));
    // Read back the authoritative device state. Storage wrappers can fail or
    // silently decline writes; publishing an uncommitted optimistic snapshot
    // would make topic chips disagree with store/sidebar counters.
    const committed = parseSerializedLedger(store.getItem(TOPIC_READ_LEDGER_KEY));
    publish(committed);
    return committed;
  } catch {
    const retained = readTopicReadLedger();
    publish(retained);
    return retained;
  }
}

function sameMarker(left: TopicReadMarker, right: TopicReadMarker): boolean {
  return left.channel === right.channel
    && left.topic === right.topic
    && left.lastReadMessageId === right.lastReadMessageId
    && left.lastReadAt === right.lastReadAt;
}

/**
 * Merge untrusted portable markers into this device's ledger.
 *
 * A strictly newer timestamp advances an existing cursor. Equal timestamps
 * keep the destination device's exact id because timestamp alone cannot prove
 * the imported row came later in transcript order. On a device with no marker,
 * the imported exact id is retained. `persist` publishes the committed ledger,
 * so the existing same-tab reconciliation subscriber observes every change.
 */
export function mergeTopicReadLedger(
  value: unknown,
): { imported: number; total: number } {
  const imported = parseTopicReadLedger(value);
  if (imported.length === 0) {
    return { imported: 0, total: readTopicReadLedger().length };
  }

  const merged = new Map(
    readTopicReadLedger().map((marker) => [markerKey(marker), marker]),
  );
  for (const candidate of imported) {
    const key = markerKey(candidate);
    const existing = merged.get(key);
    if (!existing || candidate.lastReadAt > existing.lastReadAt) {
      merged.set(key, candidate);
    }
  }

  const committed = persist([...merged.values()]);
  const committedByKey = new Map(committed.map((marker) => [markerKey(marker), marker]));
  return {
    imported: imported.filter((marker) => {
      const retained = committedByKey.get(markerKey(marker));
      return retained ? sameMarker(retained, marker) : false;
    }).length,
    total: committed.length,
  };
}

/**
 * Advance one topic to an explicit message boundary.
 *
 * Older timestamps never regress a cursor. At an equal timestamp, the caller's
 * explicit message id wins; array order later disambiguates same-time messages.
 */
export function markTopicRead<T extends Pick<TopicReadMessage, 'id' | 'time'>>(
  channel: string,
  topic: string,
  message: T,
): TopicReadMarker | null {
  const normalizedChannel = normalizeChannel(channel);
  const normalizedTopic = normalizeTopic(topic);
  const lastReadMessageId = normalizeMessageId(message.id);
  const lastReadAt = normalizeTime(message.time);
  if (!normalizedChannel || !normalizedTopic || !lastReadMessageId || lastReadAt === null) return null;

  const candidate: TopicReadMarker = {
    channel: normalizedChannel,
    topic: normalizedTopic,
    lastReadMessageId,
    lastReadAt,
  };
  const ledger = readTopicReadLedger();
  const key = markerKey(candidate);
  const current = ledger.find((marker) => markerKey(marker) === key);
  if (current && current.lastReadAt > candidate.lastReadAt) return current;
  if (current && current.lastReadAt === candidate.lastReadAt
    && current.lastReadMessageId === candidate.lastReadMessageId) return current;

  const next = persist([candidate, ...ledger.filter((marker) => markerKey(marker) !== key)]);
  return next.find((marker) => markerKey(marker) === key) ?? null;
}

function isExcluded<T extends TopicReadMessage>(
  message: T,
  isSystemMessage: (message: T) => boolean,
): boolean {
  try {
    return isSystemMessage(message);
  } catch {
    return true;
  }
}

/**
 * Mark the latest non-system message for every named topic in a bounded suffix.
 * The list's order is authoritative, including when timestamps are equal.
 */
export function markAllTopicsRead<T extends TopicReadMessage>(
  channel: string,
  messages: readonly T[],
  isSystemMessage: (message: T) => boolean,
): TopicReadMarker[] {
  const normalizedChannel = normalizeChannel(channel);
  if (!normalizedChannel) return readTopicReadLedger();

  const start = Math.max(0, messages.length - MAX_TOPIC_READ_MESSAGES);
  const latestByTopic = new Map<string, TopicReadMarker>();
  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || isExcluded(message, isSystemMessage)) continue;
    const topic = normalizeTopic(message.topic);
    const lastReadMessageId = normalizeMessageId(message.id);
    const lastReadAt = normalizeTime(message.time);
    if (!topic || !lastReadMessageId || lastReadAt === null) continue;
    latestByTopic.set(topic, {
      channel: normalizedChannel,
      topic,
      lastReadMessageId,
      lastReadAt,
    });
  }
  if (latestByTopic.size === 0) return readTopicReadLedger();

  const ledger = readTopicReadLedger();
  const merged = new Map(ledger.map((marker) => [markerKey(marker), marker]));
  for (const candidate of latestByTopic.values()) {
    const key = markerKey(candidate);
    const existing = merged.get(key);
    if (!existing || existing.lastReadAt <= candidate.lastReadAt) merged.set(key, candidate);
  }
  return persist([...merged.values()]);
}

/** Remove all topic markers for one channel. Returns the number removed. */
export function clearChannelTopicReads(channel: string): number {
  const normalizedChannel = normalizeChannel(channel);
  if (!normalizedChannel) return 0;
  const ledger = readTopicReadLedger();
  const next = ledger.filter((marker) => marker.channel !== normalizedChannel);
  const removed = ledger.length - next.length;
  if (removed === 0) return 0;
  const committed = persist(next);
  const remaining = committed.filter((marker) => marker.channel === normalizedChannel).length;
  return Math.max(0, ledger.filter((marker) => marker.channel === normalizedChannel).length - remaining);
}

/** Remove every device-local topic marker and report verified device state. */
export function clearAllTopicReads(): boolean {
  const store = storage();
  if (!store) {
    publish([]);
    return false;
  }
  try {
    store.removeItem(TOPIC_READ_LEDGER_KEY);
    const keyRemoved = store.getItem(TOPIC_READ_LEDGER_KEY) === null;
    const retained = readTopicReadLedger();
    publish(retained);
    return keyRemoved && retained.length === 0;
  } catch {
    const retained = readTopicReadLedger();
    publish(retained);
    return false;
  }
}

function onStorage(event: StorageEvent): void {
  if (event.key !== TOPIC_READ_LEDGER_KEY) return;
  publish(parseSerializedLedger(event.newValue));
}

function addStorageListener(): void {
  if (listeningForStorage || typeof window === 'undefined') return;
  window.addEventListener('storage', onStorage);
  listeningForStorage = true;
}

function removeStorageListener(): void {
  if (!listeningForStorage || listeners.size > 0 || typeof window === 'undefined') return;
  window.removeEventListener('storage', onStorage);
  listeningForStorage = false;
}

/** Subscribe to sanitized metadata-only local and cross-tab changes. */
export function subscribeTopicReadLedger(listener: TopicReadLedgerListener): () => void {
  listeners.add(listener);
  addStorageListener();
  return () => {
    listeners.delete(listener);
    removeStorageListener();
  };
}

function validMessage(message: TopicReadMessage | undefined, index: number): ValidMessage | null {
  if (!message) return null;
  const id = normalizeMessageId(message.id);
  const topic = normalizeTopic(message.topic);
  const time = normalizeTime(message.time);
  return id && topic && time !== null ? { id, topic, time, index } : null;
}

function validRoomMessage(message: TopicReadMessage | undefined, index: number): ValidRoomMessage | null {
  if (!message) return null;
  const id = normalizeMessageId(message.id);
  const time = normalizeTime(message.time);
  if (!id || time === null) return null;

  if (message.topic === null || message.topic === undefined) return { id, topic: null, time, index };
  if (typeof message.topic !== 'string') return null;
  const topic = normalizeTopic(message.topic);
  return topic ? { id, topic, time, index } : null;
}

function safeFallbackIndex(value: number, length: number): number {
  return Number.isSafeInteger(value) && value >= 0 && value <= length ? value : length;
}

/**
 * Pure per-topic unread counting over structural message metadata.
 *
 * Exact marker ids use array order, so interleaved topics and equal timestamps
 * remain correct. If an exact marker has left the bounded window, messages at
 * the same timestamp remain unread: only a strictly older message is proven to
 * precede it. Topics without a marker use the caller's safe channel boundary.
 */
export function countUnreadByTopic<T extends TopicReadMessage>(
  channel: string,
  messages: readonly T[],
  markers: readonly unknown[],
  options: TopicUnreadOptions<T>,
): Map<string, number> {
  const normalizedChannel = normalizeChannel(channel);
  if (!normalizedChannel) return new Map<string, number>();

  const windowStart = Math.max(0, messages.length - MAX_TOPIC_READ_MESSAGES);
  const fallbackBoundary = safeFallbackIndex(options.fallbackBoundaryIndex, messages.length);
  const channelMarkers = new Map(
    sanitizeLedger(markers)
      .filter((marker) => marker.channel === normalizedChannel)
      .map((marker) => [marker.topic, marker]),
  );

  const rows: Array<{ source: T; value: ValidMessage }> = [];
  for (let index = windowStart; index < messages.length; index += 1) {
    const source = messages[index];
    const value = validMessage(source, index);
    if (source && value) rows.push({ source, value });
  }

  const exactBoundaryByTopic = new Map<string, number>();
  for (const { value } of rows) {
    if (exactBoundaryByTopic.has(value.topic)) continue;
    const marker = channelMarkers.get(value.topic);
    if (
      marker
      && value.id === marker.lastReadMessageId
      && value.time === marker.lastReadAt
    ) exactBoundaryByTopic.set(value.topic, value.index);
  }

  const counts = new Map<string, number>();
  for (const { source, value } of rows) {
    if (isExcluded(source, options.isSystemMessage)) continue;
    const marker = channelMarkers.get(value.topic);
    let unread: boolean;
    if (!marker) {
      unread = value.index >= fallbackBoundary;
    } else {
      const exactBoundary = exactBoundaryByTopic.get(value.topic);
      unread = exactBoundary === undefined
        ? value.time >= marker.lastReadAt
        : value.index > exactBoundary;
    }
    if (unread) counts.set(value.topic, (counts.get(value.topic) ?? 0) + 1);
  }
  return counts;
}


function isHighlighted<T extends TopicReadMessage>(
  message: T,
  isHighlightMessage: (message: T) => boolean,
): boolean {
  try {
    return isHighlightMessage(message);
  } catch {
    return false;
  }
}

/**
 * Pure room unread projection after applying device-local topic markers.
 *
 * Named topics use an exact marker id when it remains in the bounded window,
 * preserving source-array order for equal timestamps. When that id has left
 * the window, only rows strictly older than its timestamp are proven read.
 * The room boundary is a universal lower bound: a topic marker may advance
 * beyond it, but can never make an older room-read row unread again. Untagged
 * rows and topics without a marker use that room boundary directly. The
 * result includes only the newest bounded message suffix.
 */
export function projectRoomTopicUnread<T extends TopicReadMessage>(
  channel: string,
  messages: readonly T[],
  markers: readonly unknown[],
  options: TopicUnreadProjectionOptions<T>,
): TopicUnreadProjection {
  const empty = (): TopicUnreadProjection => ({
    unreadByTopic: new Map<string, number>(),
    untaggedUnread: 0,
    totalUnread: 0,
    highlightCount: 0,
    earliestUnreadMessageId: null,
  });
  const normalizedChannel = normalizeChannel(channel);
  if (!normalizedChannel) return empty();

  const windowStart = Math.max(0, messages.length - MAX_TOPIC_READ_MESSAGES);
  const fallbackBoundary = safeFallbackIndex(options.fallbackBoundaryIndex, messages.length);
  const channelMarkers = new Map(
    sanitizeLedger(markers)
      .filter((marker) => marker.channel === normalizedChannel)
      .map((marker) => [marker.topic, marker]),
  );

  const rows: Array<{ source: T; value: ValidRoomMessage }> = [];
  for (let index = windowStart; index < messages.length; index += 1) {
    const source = messages[index];
    const value = validRoomMessage(source, index);
    if (source && value) rows.push({ source, value });
  }

  const exactBoundaryByTopic = new Map<string, number>();
  for (const { value } of rows) {
    if (!value.topic || exactBoundaryByTopic.has(value.topic)) continue;
    const marker = channelMarkers.get(value.topic);
    if (
      marker
      && value.id === marker.lastReadMessageId
      && value.time === marker.lastReadAt
    ) exactBoundaryByTopic.set(value.topic, value.index);
  }

  const unreadByTopic = new Map<string, number>();
  let untaggedUnread = 0;
  let totalUnread = 0;
  let highlightCount = 0;
  let earliestUnreadMessageId: string | null = null;

  for (const { source, value } of rows) {
    if (isExcluded(source, options.isExcludedMessage)) continue;

    if (value.index < fallbackBoundary) continue;

    const marker = value.topic ? channelMarkers.get(value.topic) : undefined;
    let unread = true;
    if (marker) {
      const exactBoundary = exactBoundaryByTopic.get(value.topic!);
      unread = exactBoundary === undefined
        ? value.time >= marker.lastReadAt
        : value.index > exactBoundary;
    }
    if (!unread) continue;

    if (earliestUnreadMessageId === null) earliestUnreadMessageId = value.id;
    totalUnread += 1;
    if (isHighlighted(source, options.isHighlightMessage)) highlightCount += 1;
    if (value.topic) {
      unreadByTopic.set(value.topic, (unreadByTopic.get(value.topic) ?? 0) + 1);
    } else {
      untaggedUnread += 1;
    }
  }

  return {
    unreadByTopic,
    untaggedUnread,
    totalUnread,
    highlightCount,
    earliestUnreadMessageId,
  };
}
