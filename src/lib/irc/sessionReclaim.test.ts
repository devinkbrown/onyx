// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  RECLAIM_EXPIRY_SKEW_MS,
  planSessionReclaim,
  reclaimOffered,
} from './sessionReclaim';

const NOW = Date.UTC(2026, 6, 12, 12, 0, 0);
const MESH = 'mesh-token-abcdef0123456789';
const LOCAL = '0123456789abcdef0123456789abcdef';

/** Authenticated caller with no held bearer — the base of every case below. */
function held(tokens: Parameters<typeof planSessionReclaim>[0] = {}) {
  return planSessionReclaim(tokens, { now: NOW, authenticated: true });
}

describe('planSessionReclaim — token preference', () => {
  it('prefers the mesh bearer when both are held', () => {
    // A reconnect can land on a different mesh node, where the node-local
    // token is meaningless but the sealed mesh token still reclaims.
    const plan = held({ sessionToken: LOCAL, meshToken: MESH });
    expect(plan).toEqual({ attempt: true, token: MESH, kind: 'mesh', meshExpired: false });
  });

  it('uses the local bearer when no mesh token is held', () => {
    expect(held({ sessionToken: LOCAL })).toEqual({
      attempt: true, token: LOCAL, kind: 'local', meshExpired: false,
    });
  });

  it('uses the mesh bearer when no local token is held', () => {
    expect(held({ meshToken: MESH })).toEqual({
      attempt: true, token: MESH, kind: 'mesh', meshExpired: false,
    });
  });

  it('treats an absent expiry as a live mesh bearer', () => {
    // Legacy MTOKEN notes carry no `expires=`; the server still enforces its
    // own lifetime, so a locally-unbounded token is offered rather than dropped.
    expect(held({ meshToken: MESH, meshTokenExpiresAt: undefined }).attempt).toBe(true);
  });
});

describe('planSessionReclaim — expiry falls through instead of torching', () => {
  it('falls back to a valid local token when the mesh bearer has lapsed', () => {
    // Regression: replaying a dead mesh token draws FAIL SESSION INVALID_TOKEN,
    // whose terminal handler wipes BOTH bearers — destroying a local token that
    // would have reclaimed the session on the same node.
    const plan = held({
      sessionToken: LOCAL,
      meshToken: MESH,
      meshTokenExpiresAt: NOW - 1,
    });
    expect(plan).toEqual({ attempt: true, token: LOCAL, kind: 'local', meshExpired: true });
  });

  it('refuses a mesh bearer expiring inside the safety skew', () => {
    // Still nominally valid, but likely dead by the time the server reads it.
    const plan = held({ meshToken: MESH, meshTokenExpiresAt: NOW + RECLAIM_EXPIRY_SKEW_MS - 1 });
    expect(plan).toEqual({ attempt: false, reason: 'expired', meshExpired: true });
  });

  it('offers a mesh bearer that outlives the safety skew', () => {
    const plan = held({ meshToken: MESH, meshTokenExpiresAt: NOW + RECLAIM_EXPIRY_SKEW_MS + 1 });
    expect(plan).toEqual({ attempt: true, token: MESH, kind: 'mesh', meshExpired: false });
  });

  it('fails closed on a non-finite expiry rather than replaying the bearer', () => {
    for (const expiry of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const plan = held({ meshToken: MESH, meshTokenExpiresAt: expiry });
      expect(plan).toEqual({ attempt: false, reason: 'expired', meshExpired: true });
    }
  });

  it('reports expired — not none-held — when a lapsed mesh token was the only bearer', () => {
    // The distinction drives the UI copy: "your saved session expired, sign in
    // again" reads very differently from an ordinary first-time connect.
    expect(held({ meshToken: MESH, meshTokenExpiresAt: NOW - 1 })).toEqual({
      attempt: false, reason: 'expired', meshExpired: true,
    });
  });
});

describe('planSessionReclaim — fail-closed gates', () => {
  it('never offers a bearer before the socket has account proof', () => {
    const plan = planSessionReclaim(
      { sessionToken: LOCAL, meshToken: MESH },
      { now: NOW, authenticated: false },
    );
    expect(plan).toEqual({ attempt: false, reason: 'unauthenticated', meshExpired: false });
  });

  it('reports none-held for a guest with no saved bearer', () => {
    expect(held()).toEqual({ attempt: false, reason: 'none-held', meshExpired: false });
  });

  it('refuses structurally invalid bearers that would break wire framing', () => {
    // formatIRCLine only strips CR/LF; a spaced or control-bearing atom would
    // become a multi-word SESSION RESUME or inject a second command.
    for (const bad of ['', '   ', 'two words', 'tab\there', 'nl\nhere', 'cr\rhere', '\u0000nul']) {
      expect(held({ sessionToken: bad }).attempt).toBe(false);
      expect(held({ meshToken: bad }).attempt).toBe(false);
    }
  });

  it('falls through to a valid local token when the mesh token is malformed', () => {
    expect(held({ sessionToken: LOCAL, meshToken: 'bad token' })).toEqual({
      attempt: true, token: LOCAL, kind: 'local', meshExpired: false,
    });
  });

  it('never returns a token on a skipped plan', () => {
    const plan = held();
    expect(plan.attempt).toBe(false);
    expect('token' in plan).toBe(false);
  });
});

describe('reclaimOffered', () => {
  it('is true only when a bearer is actually held and live', () => {
    expect(reclaimOffered({ sessionToken: LOCAL }, NOW)).toBe(true);
    expect(reclaimOffered({ meshToken: MESH }, NOW)).toBe(true);
    expect(reclaimOffered({}, NOW)).toBe(false);
  });

  it('is false once the only mesh bearer has lapsed', () => {
    expect(reclaimOffered({ meshToken: MESH, meshTokenExpiresAt: NOW - 1 }, NOW)).toBe(false);
  });

  it('ignores the authentication gate so a pre-login UI can still offer resume', () => {
    // The sign-in surface asks "can this identity resume?" before any socket
    // exists; the authenticated gate belongs to the 001 send path, not here.
    expect(reclaimOffered({ meshToken: MESH }, NOW)).toBe(true);
  });
});
