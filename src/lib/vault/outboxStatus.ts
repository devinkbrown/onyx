// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * outboxStatus.ts — pure labels for offline / outbox status chrome.
 *
 * Substrate lives in historyVault (queue/load/flush) and the store (delivery).
 * This module only formats honest UI copy so composer + Home never leave a
 * queued or failed send invisible.
 */

import { OUTBOX_MAX_AGE_MS } from './historyVault';

/** Visual tone for status chips (maps to CSS modifiers). */
export type OutboxChromeTone = 'offline' | 'queued' | 'warning' | 'error';

export type OutboxComposerChrome = {
  kind: 'empty-offline' | 'queued-offline' | 'queued-online' | 'failed-online';
  count: number;
  /** Short visible chip text. */
  label: string;
  /** Stable polite announcement (no second-by-second churn). */
  announcement: string;
  tone: OutboxChromeTone;
  /** Offer an explicit flush control (connected + still queued). */
  canRetry: boolean;
};

export type OutboxHomeChrome = {
  title: string;
  detail: string;
  tone: OutboxChromeTone;
  showRetry: boolean;
};

/**
 * Composer status chrome for device-local outbox state.
 * Returns null only when online and the queue is empty (nothing to show).
 */
export function outboxComposerChrome(input: {
  connected: boolean;
  queuedCount: number;
  /** True after auto-retry budget exhausted while rows remain. */
  deliveryFailed?: boolean;
}): OutboxComposerChrome | null {
  const queuedCount = Math.max(0, Math.floor(input.queuedCount));
  const deliveryFailed = input.deliveryFailed === true;
  const connected = input.connected;

  if (queuedCount <= 0) {
    if (!connected) {
      return {
        kind: 'empty-offline',
        count: 0,
        label: 'Offline · Messages queue on this device',
        announcement: 'Offline. Messages you send will queue on this device.',
        tone: 'offline',
        canRetry: false,
      };
    }
    return null;
  }

  const countPhrase = queuedCount === 1 ? '1 message' : `${queuedCount} messages`;

  if (!connected) {
    return {
      kind: 'queued-offline',
      count: queuedCount,
      label: `Queued (${queuedCount}) · Will send on reconnect`,
      announcement: `${countPhrase} queued. Will send on reconnect.`,
      tone: 'queued',
      canRetry: false,
    };
  }

  if (deliveryFailed) {
    return {
      kind: 'failed-online',
      count: queuedCount,
      label: `Queued (${queuedCount}) · Couldn't send — retry`,
      announcement: `${countPhrase} still queued. Sending failed. Retry available.`,
      tone: 'error',
      canRetry: true,
    };
  }

  return {
    kind: 'queued-online',
    count: queuedCount,
    label: `Queued (${queuedCount}) · Waiting to send`,
    announcement: `${countPhrase} still queued. Waiting to send.`,
    tone: 'warning',
    canRetry: true,
  };
}

/** Home outbox journal header copy. */
export function outboxHomeChrome(input: {
  connected: boolean;
  queuedCount: number;
  deliveryFailed?: boolean;
}): OutboxHomeChrome | null {
  const queuedCount = Math.max(0, Math.floor(input.queuedCount));
  if (queuedCount <= 0) return null;

  const countPhrase = queuedCount === 1 ? '1 queued send' : `${queuedCount} queued sends`;
  const deliveryFailed = input.deliveryFailed === true;

  if (!input.connected) {
    return {
      title: 'Queued on this device',
      detail: `${countPhrase} will send when you reconnect.`,
      tone: 'queued',
      showRetry: false,
    };
  }

  if (deliveryFailed) {
    return {
      title: 'Queued on this device',
      detail: `${countPhrase} could not be delivered. Try sending now, or open a conversation to review.`,
      tone: 'error',
      showRetry: true,
    };
  }

  return {
    title: 'Queued on this device',
    detail: `${countPhrase} still waiting. Try sending now if the room is ready.`,
    tone: 'warning',
    showRetry: true,
  };
}

/** Age / expiry metadata for a single outbox row (no body text). */
export function outboxEntryTiming(
  queuedAt: number,
  nowMs: number,
  maxAgeMs: number = OUTBOX_MAX_AGE_MS,
): {
  ageMs: number;
  expiresInMs: number;
  expiringSoon: boolean;
  expired: boolean;
} {
  const ageMs = Math.max(0, nowMs - queuedAt);
  const expiresInMs = maxAgeMs - ageMs;
  const expired = expiresInMs <= 0;
  // Surface "expiring soon" in the last 10% of TTL (≈2.4h of 24h).
  const expiringSoon = !expired && expiresInMs <= maxAgeMs * 0.1;
  return { ageMs, expiresInMs, expiringSoon, expired };
}

/** Compact row subtitle for Home — destination-safe, never includes body text. */
export function outboxEntryStatusLabel(
  queuedAt: number,
  nowMs: number,
  maxAgeMs: number = OUTBOX_MAX_AGE_MS,
): string {
  const timing = outboxEntryTiming(queuedAt, nowMs, maxAgeMs);
  if (timing.expired) return 'expired — will be dropped';
  if (timing.expiringSoon) return 'queued · expires soon';
  return 'queued';
}
