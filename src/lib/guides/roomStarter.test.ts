// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  buildRoomStarterExport,
  buildRoomStarterRoute,
  ROOM_STARTER_SAFETY_NOTES,
} from './roomStarter';

const STEPS = [
  { id: 'join', title: 'Join a room' },
  { id: 'invite', title: 'Invite a friend' },
  { id: 'messages', title: 'Messages and private DMs' },
] as const;

describe('buildRoomStarterRoute', () => {
  it('keeps the source order and marks one unfinished step as the start', () => {
    expect(buildRoomStarterRoute(STEPS, new Set(['join']))).toEqual([
      { ...STEPS[0], number: 1, state: 'done', stateLabel: 'Done' },
      { ...STEPS[1], number: 2, state: 'current', stateLabel: 'Start here' },
      { ...STEPS[2], number: 3, state: 'later', stateLabel: 'Then' },
    ]);
  });

  it('marks every supplied step done without inventing another current step', () => {
    const route = buildRoomStarterRoute(STEPS, new Set(STEPS.map((step) => step.id)));

    expect(route.map((step) => step.state)).toEqual(['done', 'done', 'done']);
    expect(route.filter((step) => step.state === 'current')).toHaveLength(0);
  });
});

describe('buildRoomStarterExport', () => {
  it('creates a deterministic local-only text handoff from route and safety facts', () => {
    const text = buildRoomStarterExport(STEPS, new Set(['join']));

    expect(text).toContain('Onyx first-room plan');
    expect(text).toContain('Made in this browser. This plan is not sent anywhere.');
    expect(text).toContain('1. Join a room — Done');
    expect(text).toContain('2. Invite a friend — Start here');
    expect(text).toContain(`- ${ROOM_STARTER_SAFETY_NOTES[2]}`);
    expect(text).not.toMatch(/https?:\/\//i);
    expect(buildRoomStarterExport(STEPS, new Set(['join']))).toBe(text);
  });
});
