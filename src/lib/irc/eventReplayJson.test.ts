// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  applyEventReplayNotice,
  emptyEventReplayFeed,
  eventReplayJsonParams,
  formatEventReplayEvent,
  parseEventReplayNotice,
} from './eventReplayJson';

const SAMPLE_TS = 1_720_000_000_000;

describe('parseEventReplayNotice', () => {
  it('parses header, event, and end objects', () => {
    expect(parseEventReplayNotice(
      '{"type":"event-replay","count":2,"severity_floor":"warn"}',
    )).toEqual({ kind: 'start', count: 2, severityFloor: 'warn' });

    expect(parseEventReplayNotice(
      `{"type":"event","ts":${SAMPLE_TS},"category":"kill","category_code":"KILL","severity":"warn","origin":"node-a","message":"killed badactor"}`,
    )).toEqual({
      kind: 'event',
      event: {
        ts: SAMPLE_TS,
        category: 'kill',
        categoryCode: 'KILL',
        severity: 'warn',
        origin: 'node-a',
        message: 'killed badactor',
      },
    });

    expect(parseEventReplayNotice(
      '{"type":"event-replay-end","count":2}',
    )).toEqual({ kind: 'end', count: 2 });
  });

  it('rejects hostile or malformed payloads', () => {
    expect(parseEventReplayNotice('')).toBeNull();
    expect(parseEventReplayNotice('Event replay: 2 event(s)')).toBeNull();
    expect(parseEventReplayNotice('{not json')).toBeNull();
    expect(parseEventReplayNotice('{"type":"event-stats"}')).toBeNull();
    expect(parseEventReplayNotice('{"type":"event","ts":"nope"}')).toBeNull();
    // JSON unicode escape so parse yields a control char inside the message
    // value; cleanMessage then collapses it to a single space.
    expect(parseEventReplayNotice(
      `{"type":"event","ts":${SAMPLE_TS},"category":"kill","severity":"warn","origin":"x","message":"y\\u0000z"}`,
    )).toEqual({
      kind: 'event',
      event: expect.objectContaining({ message: 'y z' }),
    });
    // Control-only message after strip → fail closed
    expect(parseEventReplayNotice(
      `{"type":"event","ts":${SAMPLE_TS},"category":"kill","severity":"warn","origin":"x","message":"\\u0000\\u0001"}`,
    )).toBeNull();
    // Pre-2000 timestamp
    expect(parseEventReplayNotice(
      '{"type":"event","ts":1,"category":"kill","severity":"warn","origin":"x","message":"y"}',
    )).toBeNull();
    // Oversize notice body (above MAX_NOTICE)
    expect(parseEventReplayNotice(`{"type":"event-replay","count":1,"severity_floor":"${'x'.repeat(1200)}"}`)).toBeNull();
  });

  it('derives category_code when omitted', () => {
    expect(parseEventReplayNotice(
      `{"type":"event","ts":${SAMPLE_TS},"category":"flood","severity":"info","origin":"n1","message":"burst"}`,
    )).toEqual({
      kind: 'event',
      event: expect.objectContaining({ category: 'flood', categoryCode: 'FLOOD' }),
    });
  });
});

describe('applyEventReplayNotice', () => {
  it('folds a full stream into a completed feed', () => {
    let feed = emptyEventReplayFeed();
    feed = applyEventReplayNotice(feed, '{"type":"event-replay","count":1,"severity_floor":"debug"}', SAMPLE_TS);
    expect(feed.pending).toBe(true);
    expect(feed.expectedCount).toBe(1);
    feed = applyEventReplayNotice(
      feed,
      `{"type":"event","ts":${SAMPLE_TS},"category":"security","category_code":"SECURITY","severity":"error","origin":"edge","message":"throttle"}`,
      SAMPLE_TS,
    );
    feed = applyEventReplayNotice(feed, '{"type":"event-replay-end","count":1}', SAMPLE_TS);
    expect(feed.complete).toBe(true);
    expect(feed.pending).toBe(false);
    expect(feed.events).toHaveLength(1);
    expect(feed.events[0]?.categoryCode).toBe('SECURITY');
  });

  it('leaves unrelated text as a no-op (same reference)', () => {
    const feed = emptyEventReplayFeed();
    expect(applyEventReplayNotice(feed, 'hello')).toBe(feed);
  });
});

describe('eventReplayJsonParams + format', () => {
  it('builds clamped EVENT REPLAY JSON ALL params', () => {
    expect(eventReplayJsonParams(50)).toEqual(['REPLAY', 'JSON', 'ALL', '50']);
    expect(eventReplayJsonParams(0)).toEqual(['REPLAY', 'JSON', 'ALL', '1']);
    expect(eventReplayJsonParams(999)).toEqual(['REPLAY', 'JSON', 'ALL', '200']);
  });

  it('formats a compact row label', () => {
    const label = formatEventReplayEvent({
      ts: SAMPLE_TS - 5 * 60_000,
      category: 'kill',
      categoryCode: 'KILL',
      severity: 'warn',
      origin: 'node-a',
      message: 'killed badactor',
    }, SAMPLE_TS);
    expect(label).toBe('[5m ago] KILL/warn <node-a> killed badactor');
  });
});
