// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseWatchTogetherProp, type WatchTogetherActivity } from './watchTogether';
import {
  acceptHandoff,
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

  it('leave removes a non-host participant without touching playback', () => {
    const s = join(play(host(), T0, 'alice'), 'bob', T0);
    const left = leave(s, 'bob', T0 + 5_000);
    expect(left.activity.participants).toEqual(['alice']);
    expect(left.activity.state).toBe('playing');
  });

  it('leave clears a pending handoff aimed at the leaver', () => {
    let s = join(host(), 'bob', T0);
    s = handoff(s, 'bob', T0, 'alice');
    const left = leave(s, 'bob', T0 + 1_000);
    expect(left.activity.handoffTo).toBeNull();
  });

  it('host leaving vacates the host slot and freezes playback', () => {
    const s = play(join(host(), 'bob', T0), T0, 'alice');
    const left = leave(s, 'alice', T0 + 4_000);
    expect(left.activity.host).toBeNull();
    expect(left.activity.state).toBe('paused');
    expect(left.activity.positionSeconds).toBe(4);
    expect(left.activity.participants).toEqual(['bob']);
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
});

describe('sessionFromActivity', () => {
  it('anchors a parsed remote activity for local ticking', () => {
    const activity = parseWatchTogetherProp('title=Clip;host=alice;state=playing;position=10;duration=100;participants=alice')!;
    const s = sessionFromActivity(activity, T0);
    expect(s.anchorMs).toBe(T0);
    expect(tick(s, T0 + 3_000).activity.positionSeconds).toBe(13);
  });
});
