// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Safe projections for the group-control lifecycle.
 *
 * These selectors intentionally accept only the runtime's public snapshot.
 * The runtime snapshot contains routing/status metadata and bounded counters;
 * it never contains OGC bodies, signer bytes, commit identifiers, or keys.
 */

import type {
  GroupControlRoomProjection,
  GroupControlRoomStatus,
  GroupControlRuntimeLifecycle,
  GroupControlRuntimeState,
} from './groupControlRuntime';
import { normalizeGroupRoom } from './groupKeyring';

export type GroupControlProjection = GroupControlRuntimeState | null | undefined;

/** A null-safe runtime snapshot selector for store bridges. */
export function selectGroupControlRuntime(
  projection: GroupControlProjection,
): GroupControlRuntimeState | null {
  return projection ?? null;
}

export function selectGroupControlLifecycle(
  projection: GroupControlProjection,
): GroupControlRuntimeLifecycle {
  return projection?.lifecycle ?? 'inactive';
}

export function selectGroupControlRooms(
  projection: GroupControlProjection,
): readonly GroupControlRoomProjection[] {
  return projection?.rooms ?? [];
}

export function selectGroupControlRoom(
  projection: GroupControlProjection,
  room: string,
): GroupControlRoomProjection | null {
  const normalized = normalizeGroupRoom(room);
  if (!normalized) return null;
  return projection?.rooms.find((entry) => entry.room === normalized) ?? null;
}

export function selectGroupControlRoomStatus(
  projection: GroupControlProjection,
  room: string,
): GroupControlRoomStatus | null {
  return selectGroupControlRoom(projection, room)?.status ?? null;
}

/** Group message encryption remains held for this packet. */
export function selectGroupControlActivation(
  projection: GroupControlProjection,
): 'hold' {
  // Keep the literal explicit even when no runtime has been provisioned.
  return projection?.activation ?? 'hold';
}

export function selectGroupControlActivationHeld(
  projection: GroupControlProjection,
): true {
  // The runtime contract is activation-held by construction. This selector is
  // intentionally not a readiness/encryption predicate.
  void projection;
  return true;
}

export function selectGroupControlQueueDepth(
  projection: GroupControlProjection,
): number {
  return projection?.queueDepth ?? 0;
}

export function selectGroupControlSessionCount(
  projection: GroupControlProjection,
): number {
  return projection?.sessionCount ?? 0;
}
