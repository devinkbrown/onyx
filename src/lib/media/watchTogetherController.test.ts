// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  normalizeWatchTogetherActivity,
  parseWatchTogetherProp,
  WATCH_NICK_MAX_LENGTH,
  WATCH_PARTICIPANT_MAX_COUNT,
  WATCH_PROP_MAX_LENGTH,
  WATCH_SECONDS_MAX,
  WATCH_TITLE_MAX_LENGTH,
  WATCH_URL_MAX_LENGTH,
  type WatchTogetherActivity,
} from './watchTogether';
import {
  acceptHandoff,
  cancelHandoff,
  createWatchSession,
  handoff,
  isWatchHost,
  join,
  leave,
  pause,
  play,
  seek,
  serializeWatchTogetherProp,
  sessionFromActivity,
  tick,
  type WatchSession,
} from './watchTogetherController';

const T0 = 1_700_000_000_000;

function host(over: Partial<WatchTogetherActivity> = {}): WatchSession {
  return createWatchSessionWith({ host: 'alice', title: 'Demo', durationSeconds: 300, ...over });
}

function createWatchSessionWith(over: Partial<WatchTogetherActivity>): WatchSession {
  const base = createWatchSession({
    host: over.host ?? 'alice',
    title: over.title ?? 'Demo',
    url: over.url,
    durationSeconds: over.durationSeconds ?? null,
    nowMs: T0,
  });
  // Allow overriding activity fields for targeted tests.
  return { ...base, activity: { ...base.activity, ...over } };
}

describe('createWatchSession', () => {
  it('starts paused at 0 with the host as sole participant', () => {
    const s = createWatchSession({ host: 'alice', title: 'Demo Night', url: 'https://x.test/v', durationSeconds: 300, nowMs: T0 });
    expect(s.activity).toEqual({
      title: 'Demo Night',
      url: 'https://x.test/v',
      host: 'alice',
      state: 'paused',
      positionSeconds: 0,
      durationSeconds: 300,
      participants: ['alice'],
      handoffTo: null,
    });
    expect(s.anchorMs).toBe(T0);
  });

  it('falls back to a default title and null url/duration', () => {
    const s = createWatchSession({ host: 'alice', title: '   ', nowMs: T0 });
    expect(s.activity.title).toBe('Watch together');
    expect(s.activity.url).toBeNull();
    expect(s.activity.durationSeconds).toBeNull();
  });

  it('rejects negative / non-finite durations', () => {
    expect(createWatchSession({ host: 'a', title: 't', durationSeconds: -5, nowMs: T0 }).activity.durationSeconds).toBeNull();
    expect(createWatchSession({ host: 'a', title: 't', durationSeconds: Number.NaN, nowMs: T0 }).activity.durationSeconds).toBeNull();
    expect(createWatchSession({ host: 'a', title: 't', durationSeconds: 12.9, nowMs: T0 }).activity.durationSeconds).toBe(12);
  });

  it('accepts exact local field boundaries and rejects or bounds one-over values', () => {
    const urlPrefix = 'https://example.test/';
    const exactUrl = `${urlPrefix}${'u'.repeat(WATCH_URL_MAX_LENGTH - urlPrefix.length)}`;
    const exactHost = 'h'.repeat(WATCH_NICK_MAX_LENGTH);
    const exact = createWatchSession({
      host: exactHost,
      title: 't'.repeat(WATCH_TITLE_MAX_LENGTH),
      url: exactUrl,
      durationSeconds: WATCH_SECONDS_MAX,
      nowMs: T0,
    });

    expect(exact.activity).toMatchObject({
      host: exactHost,
      title: 't'.repeat(WATCH_TITLE_MAX_LENGTH),
      url: exactUrl,
      durationSeconds: WATCH_SECONDS_MAX,
      participants: [exactHost],
    });

    const oneOver = createWatchSession({
      host: 'h'.repeat(WATCH_NICK_MAX_LENGTH + 1),
      title: 't'.repeat(WATCH_TITLE_MAX_LENGTH + 1),
      url: `${exactUrl}x`,
      durationSeconds: WATCH_SECONDS_MAX + 1,
      nowMs: T0,
    });
    expect(oneOver.activity.title).toHaveLength(WATCH_TITLE_MAX_LENGTH);
    expect(oneOver.activity.host).toBeNull();
    expect(oneOver.activity.participants).toEqual([]);
    expect(oneOver.activity.url).toBeNull();
    expect(oneOver.activity.durationSeconds).toBeNull();
  });

  it.each(['javascript:alert(1)', 'data:text/html,bad', 'file:///etc/passwd'])(
    'does not publish an unsafe local URL scheme: %s',
    (url) => {
      const session = createWatchSession({ host: 'alice', title: 'Unsafe', url, nowMs: T0 });
      expect(session.activity.url).toBeNull();
      expect(parseWatchTogetherProp(serializeWatchTogetherProp(session.activity))?.url).toBeNull();
    },
  );
});

describe('serialize / parse round-trip', () => {
  const cases: WatchTogetherActivity[] = [
    { title: 'Demo Night', url: 'https://example.test/v', host: 'alice', state: 'paused', positionSeconds: 90, durationSeconds: 300, participants: ['alice', 'bob'], handoffTo: 'bob' },
    { title: 'Playing', url: null, host: 'alice', state: 'playing', positionSeconds: 0, durationSeconds: null, participants: ['alice'], handoffTo: null },
    { title: 'Seeking Clip', url: 'https://x/y', host: 'carol', state: 'seeking', positionSeconds: 12, durationSeconds: 60, participants: [], handoffTo: null },
    { title: 'Handoff', url: null, host: 'alice', state: 'handoff', positionSeconds: null, durationSeconds: null, participants: ['alice', 'bob'], handoffTo: 'bob' },
    { title: 'Idle', url: null, host: null, state: 'idle', positionSeconds: null, durationSeconds: null, participants: [], handoffTo: null },
    { title: 'Weird & = ; chars', url: 'https://q/?a=1&b=2', host: 'zoë', state: 'playing', positionSeconds: 5, durationSeconds: 5, participants: ['zoë', 'björk'], handoffTo: null },
  ];

  it.each(cases.map((c) => [c.title, c] as const))('round-trips %s', (_title, activity) => {
    const wire = serializeWatchTogetherProp(activity);
    expect(parseWatchTogetherProp(wire)).toEqual(activity);
  });

  it('round-trips every session produced by the state machine', () => {
    let s = createWatchSession({ host: 'alice', title: 'Movie', url: 'https://m/1', durationSeconds: 120, nowMs: T0 });
    s = join(s, 'bob', T0);
    s = play(s, T0, 'alice');
    s = tick(s, T0 + 10_000);
    s = seek(s, 42, T0 + 10_000, 'alice');
    s = handoff(s, 'bob', T0 + 11_000, 'alice');
    const wire = serializeWatchTogetherProp(s.activity);
    expect(parseWatchTogetherProp(wire)).toEqual(s.activity);
  });

  it('normalizes adversarial encoded size while preserving host and handoff authority', () => {
    const participants = [
      'host',
      'target',
      ...Array.from(
        { length: WATCH_PARTICIPANT_MAX_COUNT + 20 },
        (_, index) => `${index.toString(36)}-${'😀'.repeat(28)}`,
      ),
    ];
    const activity: WatchTogetherActivity = {
      title: '🔥'.repeat(WATCH_TITLE_MAX_LENGTH),
      url: `https://example.test/${'%'.repeat(WATCH_URL_MAX_LENGTH - 21)}`,
      host: 'host',
      state: 'handoff',
      positionSeconds: WATCH_SECONDS_MAX + 1,
      durationSeconds: Number.POSITIVE_INFINITY,
      participants,
      handoffTo: 'target',
    };

    const normalized = normalizeWatchTogetherActivity(activity);
    const wire = serializeWatchTogetherProp(activity);
    const parsed = parseWatchTogetherProp(wire);

    expect(wire.length).toBeLessThanOrEqual(WATCH_PROP_MAX_LENGTH);
    expect(parsed).toEqual(normalized);
    expect(parsed?.url).toBeNull();
    expect(parsed?.positionSeconds).toBeNull();
    expect(parsed?.durationSeconds).toBeNull();
    expect(parsed?.state).toBe('handoff');
    expect(parsed?.participants.some((nick) => nick.toLowerCase() === 'host')).toBe(true);
    expect(parsed?.participants.some((nick) => nick.toLowerCase() === 'target')).toBe(true);
  });

  it('keeps a URL-derived fallback title within the title render bound', () => {
    const prefix = 'https://example.test/';
    const url = `${prefix}${'u'.repeat(WATCH_URL_MAX_LENGTH - prefix.length)}`;
    const activity: WatchTogetherActivity = {
      title: '',
      url,
      host: 'alice',
      state: 'paused',
      positionSeconds: 0,
      durationSeconds: null,
      participants: ['alice'],
      handoffTo: null,
    };

    const normalized = normalizeWatchTogetherActivity(activity);
    expect(normalized.title).toHaveLength(WATCH_TITLE_MAX_LENGTH);
    expect(normalized.title).toBe(url.slice(0, WATCH_TITLE_MAX_LENGTH));
    expect(parseWatchTogetherProp(serializeWatchTogetherProp(activity))).toEqual(normalized);
  });

  it('case-insensitively deduplicates and caps rosters while reserving late authority nicks', () => {
    const participants = [
      'alice',
      'ALICE',
      ...Array.from({ length: WATCH_PARTICIPANT_MAX_COUNT }, (_, index) => `p${index}`),
      'bob',
      'BOB',
    ];
    const activity: WatchTogetherActivity = {
      title: 'Crowded room',
      url: null,
      host: 'Alice',
      state: 'handoff',
      positionSeconds: 10,
      durationSeconds: 20,
      participants,
      handoffTo: 'Bob',
    };

    const parsed = parseWatchTogetherProp(serializeWatchTogetherProp(activity));
    expect(parsed?.participants).toHaveLength(WATCH_PARTICIPANT_MAX_COUNT);
    expect(new Set(parsed?.participants.map((nick) => nick.toLowerCase())).size)
      .toBe(WATCH_PARTICIPANT_MAX_COUNT);
    expect(parsed?.participants.some((nick) => nick.toLowerCase() === 'alice')).toBe(true);
    expect(parsed?.participants.some((nick) => nick.toLowerCase() === 'bob')).toBe(true);
    expect(parsed).toMatchObject({ host: 'Alice', state: 'handoff', handoffTo: 'Bob' });
  });

  it('fails an unpreservable handoff closed to paused with no target', () => {
    const base: WatchTogetherActivity = {
      title: 'Unsafe handoff',
      url: 'https://example.test/v',
      host: 'alice',
      state: 'handoff',
      positionSeconds: 10,
      durationSeconds: 20,
      participants: ['alice'],
      handoffTo: 'missing-target',
    };

    expect(parseWatchTogetherProp(serializeWatchTogetherProp(base))).toMatchObject({
      host: 'alice',
      state: 'paused',
      handoffTo: null,
      participants: ['alice'],
    });

    const invalidNick = {
      ...base,
      participants: ['alice', 'bad,target'],
      handoffTo: 'bad,target',
    };
    expect(parseWatchTogetherProp(serializeWatchTogetherProp(invalidNick))).toMatchObject({
      state: 'paused',
      handoffTo: null,
    });
  });
});

describe('tick', () => {
  it('advances whole seconds while playing and carries the remainder', () => {
    const s = play(host(), T0, 'alice');
    const t1 = tick(s, T0 + 2_400);
    expect(t1.activity.positionSeconds).toBe(2);
    // Remainder (400ms) carried in the anchor, not lost.
    const t2 = tick(t1, T0 + 3_100);
    expect(t2.activity.positionSeconds).toBe(3); // 2 + floor((3100-2000)/1000)
  });

  it('returns the same reference when paused', () => {
    const s = host();
    expect(tick(s, T0 + 60_000)).toBe(s);
  });

  it('returns the same reference when under a second elapsed while playing', () => {
    const s = play(host(), T0, 'alice');
    expect(tick(s, T0 + 999)).toBe(s);
  });

  it('does not go backwards for a stale clock', () => {
    const s = play(host(), T0, 'alice');
    expect(tick(s, T0 - 5_000)).toBe(s);
  });

  it('clamps to duration and auto-pauses at the end', () => {
    const s = play(createWatchSessionWith({ durationSeconds: 5, positionSeconds: 0 }), T0, 'alice');
    const ended = tick(s, T0 + 10_000);
    expect(ended.activity.positionSeconds).toBe(5);
    expect(ended.activity.state).toBe('paused');
  });
});

describe('play / pause (host-only)', () => {
  it('play begins playback and anchors at now', () => {
    const s = play(host(), T0 + 500, 'alice');
    expect(s.activity.state).toBe('playing');
    expect(s.anchorMs).toBe(T0 + 500);
  });

  it('play is a no-op for a non-host', () => {
    const s = host();
    expect(play(s, T0, 'bob')).toBe(s);
  });

  it('play is a no-op when already playing', () => {
    const s = play(host(), T0, 'alice');
    expect(play(s, T0 + 100, 'alice')).toBe(s);
  });

  it('pause freezes at the ticked position', () => {
    const s = play(host(), T0, 'alice');
    const paused = pause(s, T0 + 7_500, 'alice');
    expect(paused.activity.state).toBe('paused');
    expect(paused.activity.positionSeconds).toBe(7);
  });

  it('pause is a no-op for a non-host', () => {
    const s = play(host(), T0, 'alice');
    expect(pause(s, T0 + 1_000, 'bob')).toBe(s);
  });

  it('pause on an already-paused session is a no-op', () => {
    const s = host();
    expect(pause(s, T0 + 1_000, 'alice')).toBe(s);
  });

  it('host match is case-insensitive', () => {
    const s = createWatchSessionWith({ host: 'Alice' });
    expect(isWatchHost(s, 'alice')).toBe(true);
    expect(play(s, T0, 'ALICE').activity.state).toBe('playing');
  });
});

describe('seek (host-only)', () => {
  it('jumps to a clamped integer position preserving state', () => {
    const s = play(host(), T0, 'alice');
    const seeked = seek(s, 42.9, T0 + 1_000, 'alice');
    expect(seeked.activity.positionSeconds).toBe(42);
    expect(seeked.activity.state).toBe('playing');
    expect(seeked.anchorMs).toBe(T0 + 1_000);
  });

  it('clamps beyond duration and below zero', () => {
    const s = host(); // duration 300
    expect(seek(s, 9_999, T0, 'alice').activity.positionSeconds).toBe(300);
    expect(seek(s, -50, T0, 'alice').activity.positionSeconds).toBe(0);
  });

  it('caps positions at the exact exported seconds boundary', () => {
    const s = createWatchSession({ host: 'alice', title: 'Long-running', nowMs: T0 });
    expect(seek(s, WATCH_SECONDS_MAX, T0, 'alice').activity.positionSeconds).toBe(WATCH_SECONDS_MAX);
    expect(seek(s, WATCH_SECONDS_MAX + 1, T0, 'alice').activity.positionSeconds).toBe(WATCH_SECONDS_MAX);
  });

  it('is a no-op for a non-host or an unchanged position', () => {
    const s = host();
    expect(seek(s, 100, T0, 'bob')).toBe(s);
    expect(seek(s, 0, T0, 'alice')).toBe(s);
  });
});

describe('join / leave', () => {
  it('join adds a participant once (case-insensitive), immutably', () => {
    const s = host();
    const withBob = join(s, 'bob', T0);
    expect(withBob.activity.participants).toEqual(['alice', 'bob']);
    expect(withBob).not.toBe(s);
    expect(s.activity.participants).toEqual(['alice']); // original untouched
    expect(join(withBob, 'BOB', T0)).toBe(withBob); // duplicate no-op
    expect(join(withBob, '   ', T0)).toBe(withBob); // blank no-op
  });

  it('allows the exact final roster slot and fails closed once the cap is full', () => {
    const almostFull = createWatchSessionWith({
      participants: Array.from(
        { length: WATCH_PARTICIPANT_MAX_COUNT - 1 },
        (_, index) => index === 0 ? 'alice' : `p${index}`,
      ),
    });
    const full = join(almostFull, 'last', T0);
    expect(full.activity.participants).toHaveLength(WATCH_PARTICIPANT_MAX_COUNT);
    expect(full.activity.participants.at(-1)).toBe('last');
    expect(join(full, 'overflow', T0)).toBe(full);
  });

  it('rejects local participant nicks that would split or truncate on the wire', () => {
    const s = host();
    expect(join(s, 'bad,nick', T0)).toBe(s);
    expect(join(s, 'n'.repeat(WATCH_NICK_MAX_LENGTH + 1), T0)).toBe(s);
  });

  it('leave removes a non-host participant case-insensitively without touching playback', () => {
    const s = join(play(host(), T0, 'alice'), 'bob', T0);
    const left = leave(s, 'BOB', T0 + 5_000);
    expect(left.activity.participants).toEqual(['alice']);
    expect(left.activity.state).toBe('playing');
  });

  it('leave clears a pending handoff aimed at the leaver', () => {
    let s = join(host(), 'bob', T0);
    s = handoff(s, 'bob', T0, 'alice');
    const left = leave(s, 'bob', T0 + 1_000);
    expect(left.activity).toMatchObject({
      host: 'alice',
      state: 'paused',
      participants: ['alice'],
      handoffTo: null,
    });
  });

  it('fails a host leave closed until ownership is handed off', () => {
    const s = play(join(host(), 'bob', T0), T0, 'alice');
    expect(leave(s, 'ALICE', T0 + 4_000)).toBe(s);
  });

  it('leave is a no-op for an absent participant', () => {
    const s = host();
    expect(leave(s, 'nobody', T0)).toBe(s);
  });
});

describe('handoff / acceptHandoff', () => {
  it('host offers the role to a participant and freezes playback', () => {
    const s = play(join(host(), 'bob', T0), T0, 'alice');
    const offered = handoff(s, 'bob', T0 + 6_000, 'alice');
    expect(offered.activity.state).toBe('handoff');
    expect(offered.activity.handoffTo).toBe('bob');
    expect(offered.activity.host).toBe('alice'); // still host until accepted
    expect(offered.activity.positionSeconds).toBe(6); // frozen at ticked position
  });

  it('handoff is a no-op for a non-host, self-target, or non-participant', () => {
    const s = join(host(), 'bob', T0);
    expect(handoff(s, 'bob', T0, 'mallory')).toBe(s); // not host
    expect(handoff(s, 'alice', T0, 'alice')).toBe(s); // self
    expect(handoff(s, 'carol', T0, 'alice')).toBe(s); // not a participant
  });

  it('target accepts and becomes the new host, paused', () => {
    let s = join(host(), 'bob', T0);
    s = handoff(s, 'bob', T0, 'alice');
    const accepted = acceptHandoff(s, T0 + 100, 'bob');
    expect(accepted.activity.host).toBe('bob');
    expect(accepted.activity.handoffTo).toBeNull();
    expect(accepted.activity.state).toBe('paused');
    // The new host now holds the controls.
    expect(isWatchHost(accepted, 'bob')).toBe(true);
    expect(play(accepted, T0 + 200, 'bob').activity.state).toBe('playing');
    expect(play(accepted, T0 + 200, 'alice')).toBe(accepted); // old host no longer controls
  });

  it('acceptHandoff rejects the wrong nick or a non-handoff state', () => {
    let s = join(host(), 'bob', T0);
    s = handoff(s, 'bob', T0, 'alice');
    expect(acceptHandoff(s, T0, 'carol')).toBe(s); // wrong nick
    const notHandoff = host();
    expect(acceptHandoff(notHandoff, T0, 'bob')).toBe(notHandoff); // not in handoff
  });

  it('acceptHandoff adds the accepter to the roster if missing', () => {
    const s: WatchSession = createWatchSessionWith({ host: 'alice', state: 'handoff', handoffTo: 'bob', participants: ['alice'] });
    const accepted = acceptHandoff(s, T0, 'bob');
    expect(accepted.activity.participants).toContain('bob');
  });

  it('lets only the current host cancel a pending handoff into a paused session', () => {
    let pending = join(host(), 'bob', T0);
    pending = handoff(pending, 'bob', T0, 'alice');

    expect(cancelHandoff(pending, T0 + 100, 'mallory')).toBe(pending);
    const cancelled = cancelHandoff(pending, T0 + 200, 'ALICE');
    expect(cancelled.activity).toMatchObject({ state: 'paused', handoffTo: null, host: 'alice' });
    expect(cancelled.anchorMs).toBe(T0 + 200);
    expect(cancelHandoff(cancelled, T0 + 300, 'alice')).toBe(cancelled);
  });
});

describe('sessionFromActivity', () => {
  it('anchors a parsed remote activity for local ticking', () => {
    const activity = parseWatchTogetherProp('title=Clip;host=alice;state=playing;position=10;duration=100;participants=alice')!;
    const s = sessionFromActivity(activity, T0);
    expect(s.anchorMs).toBe(T0);
    expect(tick(s, T0 + 3_000).activity.positionSeconds).toBe(13);
  });
});
