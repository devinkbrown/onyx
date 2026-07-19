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
    expect(chrome!.label).toMatch(/queue/i);
    expect(chrome!.announcement).toMatch(/queue/i);
  });

  it('labels offline queues as will-send-on-reconnect', () => {
    const chrome = outboxComposerChrome({ connected: false, queuedCount: 2 });
    expect(chrome).toEqual({
      kind: 'queued-offline',
      count: 2,
      label: 'Queued (2) · Will send on reconnect',
      announcement: '2 messages queued. Will send on reconnect.',
      tone: 'queued',
      canRetry: false,
    });
  });

  it('uses singular phrasing for one queued message', () => {
    const chrome = outboxComposerChrome({ connected: false, queuedCount: 1 });
    expect(chrome!.announcement).toBe('1 message queued. Will send on reconnect.');
    expect(chrome!.label).toBe('Queued (1) · Will send on reconnect');
  });

  it('surfaces a waiting state while connected with remaining queue', () => {
    const chrome = outboxComposerChrome({ connected: true, queuedCount: 3 });
    expect(chrome).toMatchObject({
      kind: 'queued-online',
      count: 3,
      canRetry: true,
      tone: 'warning',
    });
    expect(chrome!.label).toMatch(/Waiting to send/i);
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
    expect(chrome!.label).toMatch(/Couldn't send/i);
    expect(chrome!.announcement).toMatch(/Retry/i);
  });

  it('clamps negative counts and ignores failed flag when empty + online', () => {
    expect(outboxComposerChrome({
      connected: true,
      queuedCount: -4,
      deliveryFailed: true,
    })).toBeNull();
  });
});

describe('outboxHomeChrome', () => {
  it('returns null for an empty queue', () => {
    expect(outboxHomeChrome({ connected: false, queuedCount: 0 })).toBeNull();
  });

  it('describes offline queues without a retry control', () => {
    const chrome = outboxHomeChrome({ connected: false, queuedCount: 1 });
    expect(chrome).toMatchObject({
      title: 'Queued on this device',
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

  it('marks failed delivery honestly on Home', () => {
    const chrome = outboxHomeChrome({
      connected: true,
      queuedCount: 2,
      deliveryFailed: true,
    });
    expect(chrome).toMatchObject({ showRetry: true, tone: 'error' });
    expect(chrome!.detail).toMatch(/could not be delivered/i);
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

  it('keeps ordinary rows as queued', () => {
    const now = queuedAt + 60_000;
    const timing = outboxEntryTiming(queuedAt, now);
    expect(timing.ageMs).toBe(60_000);
    expect(timing.expiringSoon).toBe(false);
    expect(outboxEntryStatusLabel(queuedAt, now)).toBe('queued');
  });
});
