// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * lib/irc/sessionReclaim.ts
 * Onyx — which reclaim bearer (if any) a reconnect should replay.
 *
 * Onyx Server issues two reclaim credentials after account authentication:
 *   NOTE   SESSION TOKEN  :<hex>                      — node-local, no expiry
 *   NOTICE SESSION MTOKEN <hex> expires=<unix-seconds> — mesh-sealed, portable
 *
 * `SESSION RESUME <token>` reattaches a detached session. The mesh bearer is
 * preferred because a reconnect can land on a different mesh node, where the
 * node-local token is meaningless but the sealed one still reclaims or
 * redirects (server.zig handleMeshReclaim).
 *
 * Why this is a module and not a ternary at the send site: the live IRCClient
 * outlives the mesh bearer. `updateResumeTokens` refreshes tokens in place on a
 * long-lived tab, but the credential store's `purgeExpiredTokens` only runs on
 * a *read* — so a tab open past the portable lifetime still holds a lapsed mesh
 * token in memory. Replaying it draws `FAIL SESSION INVALID_TOKEN`, whose
 * terminal handler wipes BOTH bearers, destroying a node-local token that would
 * have reclaimed the session on the same node. Expiry therefore has to steer
 * the choice, and a lapsed mesh bearer must fall THROUGH to the local one
 * rather than being offered and torching it.
 *
 * Pure and clock-injected: every decision is a function of the caller's `now`.
 */
import { isValidSessionCredential } from './parser';

/**
 * Refuse a bearer this close to its deadline. The token still has to survive
 * the 001 round trip, and a reclaim that races expiry is indistinguishable
 * from a stolen one on the wire — it costs both bearers.
 */
export const RECLAIM_EXPIRY_SKEW_MS = 30_000;

export type ReclaimTokenKind = 'mesh' | 'local';

/**
 * Why no bearer was offered.
 *   `unauthenticated` — socket has no account proof yet (not a user-facing failure)
 *   `expired`         — a bearer was held but has lapsed; the user must sign in
 *   `none-held`       — guest or first connect; nothing to reclaim
 */
export type ReclaimSkipReason = 'unauthenticated' | 'expired' | 'none-held';

export interface ReclaimTokens {
  /** Node-local `SESSION TOKEN`. Governed by the server, not by a local deadline. */
  sessionToken?: string | undefined;
  /** Mesh-sealed `SESSION MTOKEN`, usable from any node. */
  meshToken?: string | undefined;
  /** Absolute epoch-ms deadline for `meshToken`; absent when the note carried no `expires=`. */
  meshTokenExpiresAt?: number | undefined;
}

export interface ReclaimClock {
  now: number;
  /** True once this socket has account proof (SASL 903 / post-registration 900). */
  authenticated: boolean;
}

export type SessionReclaimPlan =
  | { attempt: true; token: string; kind: ReclaimTokenKind; meshExpired: boolean }
  | { attempt: false; reason: ReclaimSkipReason; meshExpired: boolean };

type MeshStatus = 'usable' | 'expired' | 'absent';

function meshStatus(tokens: ReclaimTokens, now: number): MeshStatus {
  if (!isValidSessionCredential(tokens.meshToken)) return 'absent';
  const expiresAt = tokens.meshTokenExpiresAt;
  // A legacy note without `expires=` has no local deadline; the server still
  // enforces its own, so offer it rather than discarding a working bearer.
  if (expiresAt === undefined) return 'usable';
  // Garbage in the deadline is not evidence of freshness — fail closed.
  if (!Number.isFinite(expiresAt)) return 'expired';
  return now < expiresAt - RECLAIM_EXPIRY_SKEW_MS ? 'usable' : 'expired';
}

/**
 * Decide which bearer — if any — the next `SESSION RESUME` should carry.
 *
 * Order: live mesh bearer, then node-local bearer, then nothing. A lapsed or
 * malformed mesh token never blocks the local fallback.
 */
export function planSessionReclaim(
  tokens: ReclaimTokens,
  clock: ReclaimClock,
): SessionReclaimPlan {
  const mesh = meshStatus(tokens, clock.now);
  const meshExpired = mesh === 'expired';

  // Account proof gates the bearer, not the other way round: a reclaim token
  // selects one session within an account, it does not authenticate the account.
  if (!clock.authenticated) return { attempt: false, reason: 'unauthenticated', meshExpired };

  if (mesh === 'usable' && isValidSessionCredential(tokens.meshToken)) {
    return { attempt: true, token: tokens.meshToken, kind: 'mesh', meshExpired: false };
  }
  if (isValidSessionCredential(tokens.sessionToken)) {
    return { attempt: true, token: tokens.sessionToken, kind: 'local', meshExpired };
  }
  return { attempt: false, reason: meshExpired ? 'expired' : 'none-held', meshExpired };
}

/**
 * Whether a saved identity can still offer one-tap resume, ignoring socket
 * state. Sign-in surfaces call this before any connection exists, so unlike
 * `planSessionReclaim` it deliberately has no authentication gate.
 */
export function reclaimOffered(tokens: ReclaimTokens, now: number): boolean {
  return meshStatus(tokens, now) === 'usable' || isValidSessionCredential(tokens.sessionToken);
}
