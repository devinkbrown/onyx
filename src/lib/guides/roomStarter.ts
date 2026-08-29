// SPDX-License-Identifier: AGPL-3.0-or-later

export type RoomStarterStep = {
  id: string;
  title: string;
};

export type RoomStarterStepState = 'done' | 'current' | 'later';

export type RoomStarterRouteStep = RoomStarterStep & {
  number: number;
  state: RoomStarterStepState;
  stateLabel: 'Done' | 'Start here' | 'Then';
};

export const ROOM_STARTER_EXPORT_FILENAME = 'onyx-first-room-plan.txt';

/**
 * A short, evidence-backed boundary for a first room. Keep these facts in one
 * local-only export/render source so the visible guide and saved handoff agree.
 */
export const ROOM_STARTER_SAFETY_NOTES = [
  'Guests can choose a name; an account is optional.',
  'Room messages are shared with everyone in the room. Group rooms are not end-to-end encrypted.',
  'Direct messages are one-to-one. If a private message cannot open, it stays locked instead of turning into plain text.',
  'Calls are opt-in and are not recorded.',
  'Your history and sign-in stay on this device in this browser.',
] as const;

function routeState(
  id: string,
  completed: ReadonlySet<string>,
  hasCurrent: boolean,
): RoomStarterStepState {
  if (completed.has(id)) return 'done';
  if (!hasCurrent) return 'current';
  return 'later';
}

function routeStateLabel(state: RoomStarterStepState): RoomStarterRouteStep['stateLabel'] {
  switch (state) {
    case 'done': return 'Done';
    case 'current': return 'Start here';
    case 'later': return 'Then';
  }
}

/**
 * Turn the existing ordered newcomer sequence into one deterministic route.
 * Only recognised guide ids can appear as complete because callers provide
 * the ordered step list rather than iterating stored browser data.
 */
export function buildRoomStarterRoute(
  steps: readonly RoomStarterStep[],
  completed: ReadonlySet<string>,
): RoomStarterRouteStep[] {
  let hasCurrent = false;

  return steps.map((step, index) => {
    const state = routeState(step.id, completed, hasCurrent);
    if (state === 'current') hasCurrent = true;
    return {
      ...step,
      number: index + 1,
      state,
      stateLabel: routeStateLabel(state),
    };
  });
}

/**
 * Produce an explicit local handoff, suitable for the Clipboard API or a
 * downloadable text data URL. It contains no endpoint, account, or room data.
 */
export function buildRoomStarterExport(
  steps: readonly RoomStarterStep[],
  completed: ReadonlySet<string>,
): string {
  const route = buildRoomStarterRoute(steps, completed);

  return [
    'Onyx first-room plan',
    'Made in this browser. This plan is not sent anywhere.',
    '',
    'Route',
    ...route.map((step) => `${step.number}. ${step.title} — ${step.stateLabel}`),
    '',
    'Privacy and safety',
    ...ROOM_STARTER_SAFETY_NOTES.map((note) => `- ${note}`),
  ].join('\n');
}
