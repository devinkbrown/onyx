// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Passive, room-local projection of the group-control plane.
 *
 * This intentionally reports only the public, metadata-only runtime snapshot.
 * Readiness is derived from the safe activation + room projection; keys and
 * mutable runtime handles never enter this component.
 */

import type { JSX } from 'solid-js';

import {
  selectGroupControlLifecycle,
  selectGroupControlActivation,
  selectGroupControlRoomStatus,
  type GroupControlProjection,
} from '@/lib/e2ee/groupControlSelectors';

import './group-control-room-indicator.css';

export type GroupControlRoomIndicatorProps = {
  /** The active channel. This component deliberately does not render for DMs. */
  room: string | null | undefined;
  /** Account truth supplied by the authenticated shell/store bridge. */
  authenticated: boolean;
  /** Public safe runtime snapshot only; never a runtime instance or payload. */
  projection?: GroupControlProjection;
};

export type GroupControlIndicatorState =
  | 'signed-out'
  | 'unavailable'
  | 'identity-pending'
  | 'locked'
  | 'pending'
  | 'applied'
  | 'active'
  | 'recovery-required';

type IndicatorPresentation = {
  state: GroupControlIndicatorState;
  detail: string;
};

function isChannel(room: string | null | undefined): room is string {
  return typeof room === 'string' && /^[#&]/u.test(room);
}

/** Pure copy mapping, deliberately isolated from runtime internals and counters. */
export function groupControlIndicatorPresentation(
  room: string | null | undefined,
  authenticated: boolean,
  projection: GroupControlProjection,
): IndicatorPresentation | null {
  if (!isChannel(room)) return null;
  if (!authenticated) {
    return { state: 'signed-out', detail: 'Sign in to inspect room controls' };
  }

  const lifecycle = selectGroupControlLifecycle(projection);
  if (lifecycle === 'inactive') {
    return { state: 'unavailable', detail: 'Room controls unavailable' };
  }
  if (lifecycle === 'identity-pending') {
    return { state: 'identity-pending', detail: 'Checking account identity…' };
  }
  if (lifecycle === 'recovery-required') {
    return { state: 'recovery-required', detail: 'Room controls need recovery' };
  }

  switch (selectGroupControlRoomStatus(projection, room)) {
    case 'locked':
      return { state: 'locked', detail: 'Room controls locked' };
    case 'directory-pending':
    case 'pair-pending':
      return { state: 'pending', detail: 'Room controls pending' };
    case 'control-applied':
      if (selectGroupControlActivation(projection) === 'active') {
        return {
          state: 'active',
          detail: 'Protection session ready on this device; room policy is reported separately',
        };
      }
      return {
        state: 'applied',
        detail: 'Room controls applied; message protection remains inactive',
      };
    case 'recovery-required':
    case 'rejected':
      return { state: 'recovery-required', detail: 'Room controls need recovery' };
    default:
      return { state: 'unavailable', detail: 'Room controls unavailable' };
  }
}

export function GroupControlRoomIndicator(props: GroupControlRoomIndicatorProps): JSX.Element | null {
  const presentation = () => groupControlIndicatorPresentation(
    props.room,
    props.authenticated,
    props.projection,
  );
  const protectionLabel = () => presentation()?.state === 'active'
    ? 'Message protection: available'
    : 'Message protection: not active';

  return (
    <>{presentation() && (
      <div
        class="shell-group-control-indicator"
        data-testid="group-control-room-indicator"
        data-state={presentation()!.state}
        aria-label={`${protectionLabel()}. ${presentation()!.detail}.`}
      >
        <span class="shell-group-control-indicator-mark" aria-hidden="true">◇</span>
        <span class="shell-group-control-indicator-label">{protectionLabel()}</span>
        <span class="shell-group-control-indicator-detail" aria-live="polite" aria-atomic="true">
          {presentation()!.detail}
        </span>
      </div>
    )}</>
  );
}
