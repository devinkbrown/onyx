// SPDX-License-Identifier: AGPL-3.0-or-later
export type DesktopNotificationPermission = NotificationPermission | 'unsupported';

export type NotifyKind = 'mention' | 'dm' | 'follow' | 'call' | 'system' | 'error';

export interface NotifyDecisionInput {
  kind: NotifyKind;
  isSelf: boolean;
  muted?: boolean;
  pushEnabled: boolean;
  soundEnabled: boolean;
  dnd: boolean;
  permission: DesktopNotificationPermission;
  pageVisible: boolean;
  appFocused: boolean;
  nowMs: number;
  lastDesktopAtMs?: number;
  lastSoundAtMs?: number;
  desktopThrottleMs?: number;
  soundThrottleMs?: number;
}

export interface NotifyDecision {
  desktop: boolean;
  sound: boolean;
  desktopReason:
    | 'ok'
    | 'not-message-alert'
    | 'self'
    | 'muted'
    | 'focused'
    | 'dnd'
    | 'disabled'
    | 'unsupported'
    | 'permission'
    | 'throttled';
  soundReason:
    | 'ok'
    | 'not-message-alert'
    | 'self'
    | 'muted'
    | 'focused'
    | 'dnd'
    | 'disabled'
    | 'throttled';
}

export function isAlertKind(kind: NotifyKind): boolean {
  return kind === 'mention' || kind === 'dm' || kind === 'follow' || kind === 'call';
}

export function isAppInactive(pageVisible: boolean, appFocused: boolean): boolean {
  return !pageVisible || !appFocused;
}

export function shouldNotify(input: NotifyDecisionInput): NotifyDecision {
  const inactive = isAppInactive(input.pageVisible, input.appFocused);
  const desktopThrottle = input.desktopThrottleMs ?? 6000;
  const soundThrottle = input.soundThrottleMs ?? 1500;
  const lastDesktop = input.lastDesktopAtMs ?? Number.NEGATIVE_INFINITY;
  const lastSound = input.lastSoundAtMs ?? Number.NEGATIVE_INFINITY;

  const baseBlock =
    !isAlertKind(input.kind) ? 'not-message-alert'
    : input.isSelf ? 'self'
    : input.muted ? 'muted'
    : !inactive ? 'focused'
    : input.dnd ? 'dnd'
    : null;

  let desktopReason: NotifyDecision['desktopReason'] = 'ok';
  if (baseBlock) desktopReason = baseBlock;
  else if (!input.pushEnabled) desktopReason = 'disabled';
  else if (input.permission === 'unsupported') desktopReason = 'unsupported';
  else if (input.permission !== 'granted') desktopReason = 'permission';
  else if (input.nowMs - lastDesktop < desktopThrottle) desktopReason = 'throttled';

  let soundReason: NotifyDecision['soundReason'] = 'ok';
  if (baseBlock) soundReason = baseBlock;
  else if (!input.soundEnabled) soundReason = 'disabled';
  else if (input.nowMs - lastSound < soundThrottle) soundReason = 'throttled';

  return {
    desktop: desktopReason === 'ok',
    sound: soundReason === 'ok',
    desktopReason,
    soundReason,
  };
}
