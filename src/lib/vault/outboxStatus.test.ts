// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { OUTBOX_MAX_AGE_MS } from './historyVault';
import {
  outboxComposerChrome,
  outboxEntryStatusLabel,
  outboxEntryTiming,
  outboxHomeChrome,
} from './outboxStatus';

describe('outboxComposerChrome', () => {
  it('hides chrome when online and the queue is empty', () => {
    expect(outboxComposerChrome({ connected: true, queuedCount: 0 })).toBeNull();
  });

  it('shows empty-offline honesty when disconnected with nothing queued', () => {
    const chrome = outboxComposerChrome({ connected: false, queuedCount: 0 });
    expect(chrome).toMatchObject({
      kind: 'empty-offline',
      count: 0,
      canRetry: false,
      tone: 'offline',
    });
    expect(chrome!.label).toMatch(/Offline/i);
    expect(chrome!.label).toMatch(/Saved on this device/i);
    expect(chrome!.announcement).toMatch(/saved on this device/i);
  });

  it('labels offline queues as will-send-on-reconnect', () => {
    const chrome = outboxComposerChrome({ connected: false, queuedCount: 2 });
    expect(chrome).toEqual({
      kind: 'queued-offline',
      count: 2,
      label: 'Saved (2) · Sends when you reconnect',
      announcement: '2 messages saved on this device. Sends when you reconnect.',
      tone: 'queued',
      canRetry: false,
    });
  });

  it('uses singular phrasing for one queued message', () => {
    const chrome = outboxComposerChrome({ connected: false, queuedCount: 1 });
    expect(chrome!.announcement).toBe('1 message saved on this device. Sends when you reconnect.');
    expect(chrome!.label).toBe('Saved (1) · Sends when you reconnect');
  });

  it('surfaces a waiting state while connected with remaining queue', () => {
    const chrome = outboxComposerChrome({ connected: true, queuedCount: 3 });
    expect(chrome).toMatchObject({
      kind: 'queued-online',
      count: 3,
      canRetry: true,
      tone: 'warning',
    });
    expect(chrome!.label).toMatch(/Awaiting send/i);
  });

  it('surfaces delivery failure with retry when auto-retries are exhausted', () => {
    const chrome = outboxComposerChrome({
      connected: true,
      queuedCount: 1,
      deliveryFailed: true,
    });
    expect(chrome).toMatchObject({
      kind: 'failed-online',
      count: 1,
      canRetry: true,
      tone: 'error',
    });
    expect(chrome!.label).toMatch(/Retryable/i);
    expect(chrome!.announcement).toMatch(/Retry/i);
  });

  it('clamps negative counts and ignores failed flag when empty + online', () => {
    expect(outboxComposerChrome({
      connected: true,
      queuedCount: -4,
      deliveryFailed: true,
    })).toBeNull();
  });

  it('floors fractional counts so chip text never shows decimals', () => {
    const chrome = outboxComposerChrome({ connected: false, queuedCount: 2.9 });
    expect(chrome).toMatchObject({
      kind: 'queued-offline',
      count: 2,
      label: 'Saved (2) · Sends when you reconnect',
    });
  });

  it('keeps offline reconnect labels even when deliveryFailed is sticky', () => {
    // deliveryFailed is only meaningful while connected; offline chrome must
    // not claim "Couldn't send — retry" with a dead socket.
    const chrome = outboxComposerChrome({
      connected: false,
      queuedCount: 2,
      deliveryFailed: true,
    });
    expect(chrome).toEqual({
      kind: 'queued-offline',
      count: 2,
      label: 'Saved (2) · Sends when you reconnect',
      announcement: '2 messages saved on this device. Sends when you reconnect.',
      tone: 'queued',
      canRetry: false,
    });
  });

  it('uses exact singular/plural labels for the online waiting path', () => {
    expect(outboxComposerChrome({ connected: true, queuedCount: 1 })).toEqual({
      kind: 'queued-online',
      count: 1,
      label: 'Awaiting send (1) · Still waiting',
      announcement: '1 message still queued. Waiting to send.',
      tone: 'warning',
      canRetry: true,
    });
    expect(outboxComposerChrome({ connected: true, queuedCount: 4 })!.label)
      .toBe('Awaiting send (4) · Still waiting');
  });
});

describe('outboxHomeChrome', () => {
  it('returns null for an empty queue', () => {
    expect(outboxHomeChrome({ connected: false, queuedCount: 0 })).toBeNull();
  });

  it('describes offline queues without a retry control', () => {
    const chrome = outboxHomeChrome({ connected: false, queuedCount: 1 });
    expect(chrome).toMatchObject({
      title: 'Saved on this device',
      showRetry: false,
      tone: 'queued',
    });
    expect(chrome!.detail).toMatch(/will send when you reconnect/i);
  });

  it('offers retry while connected and waiting', () => {
    const chrome = outboxHomeChrome({ connected: true, queuedCount: 2 });
    expect(chrome).toMatchObject({ showRetry: true, tone: 'warning' });
    expect(chrome!.detail).toMatch(/still waiting/i);
  });

  it('marks failed local admission honestly on Home', () => {
    const chrome = outboxHomeChrome({
      connected: true,
      queuedCount: 2,
      deliveryFailed: true,
    });
    expect(chrome).toMatchObject({ showRetry: true, tone: 'error' });
    expect(chrome!.detail).toBe('2 saved messages could not be sent yet. Try again only after reviewing the conversation.');
  });

  it('uses singular phrasing and keeps offline detail when deliveryFailed sticks', () => {
    const singular = outboxHomeChrome({ connected: true, queuedCount: 1 });
    expect(singular!.detail).toMatch(/^1 saved message /);

    const offlineFailed = outboxHomeChrome({
      connected: false,
      queuedCount: 3,
      deliveryFailed: true,
    });
    expect(offlineFailed).toMatchObject({
      showRetry: false,
      tone: 'queued',
    });
    expect(offlineFailed!.detail).toMatch(/will send when you reconnect/i);
  });
});

describe('outboxEntryTiming / outboxEntryStatusLabel', () => {
  const queuedAt = 1_000_000;

  it('flags expired rows past the max age', () => {
    const now = queuedAt + OUTBOX_MAX_AGE_MS + 1;
    const timing = outboxEntryTiming(queuedAt, now);
    expect(timing.expired).toBe(true);
    expect(timing.expiringSoon).toBe(false);
    expect(outboxEntryStatusLabel(queuedAt, now)).toBe('expired — will be dropped');
  });

  it('flags the last 10% of TTL as expiring soon', () => {
    const now = queuedAt + OUTBOX_MAX_AGE_MS * 0.95;
    const timing = outboxEntryTiming(queuedAt, now);
    expect(timing.expired).toBe(false);
    expect(timing.expiringSoon).toBe(true);
    expect(outboxEntryStatusLabel(queuedAt, now)).toBe('queued · expires soon');
  });

  it('treats the exact 10% remaining boundary as expiring soon', () => {
    // expiresInMs === maxAge * 0.1 → still "soon" (inclusive bound).
    const now = queuedAt + OUTBOX_MAX_AGE_MS * 0.9;
    const timing = outboxEntryTiming(queuedAt, now);
    expect(timing.expired).toBe(false);
    expect(timing.expiringSoon).toBe(true);
    expect(timing.expiresInMs).toBe(OUTBOX_MAX_AGE_MS * 0.1);
    expect(outboxEntryStatusLabel(queuedAt, now)).toBe('queued · expires soon');
  });

  it('stays ordinary queued just outside the last 10% window', () => {
    const now = queuedAt + OUTBOX_MAX_AGE_MS * 0.9 - 1;
    const timing = outboxEntryTiming(queuedAt, now);
    expect(timing.expired).toBe(false);
    expect(timing.expiringSoon).toBe(false);
    expect(outboxEntryStatusLabel(queuedAt, now)).toBe('queued');
  });

  it('keeps ordinary rows as queued', () => {
    const now = queuedAt + 60_000;
    const timing = outboxEntryTiming(queuedAt, now);
    expect(timing.ageMs).toBe(60_000);
    expect(timing.expiringSoon).toBe(false);
    expect(outboxEntryStatusLabel(queuedAt, now)).toBe('queued');
  });

  it('clamps future queuedAt clocks so age never goes negative', () => {
    const now = queuedAt - 5_000;
    const timing = outboxEntryTiming(queuedAt, now);
    expect(timing.ageMs).toBe(0);
    expect(timing.expired).toBe(false);
    expect(outboxEntryStatusLabel(queuedAt, now)).toBe('queued');
  });
});
