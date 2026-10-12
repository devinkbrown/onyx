// SPDX-License-Identifier: AGPL-3.0-or-later
// Generation fence for async write-backs across a call teardown boundary.
//
// The media engine schedules crypto continuations (media E2EE handshake/session
// establishment, group-key import/creation) that resolve on a later microtask.
// If the user hangs up (setIdle) — or hangs up and rejoins — between scheduling
// and resolution, a stale continuation must NOT resurrect E2EE key material into
// the (now-idle, or now-different) call. Resurrecting a previous call's group key
// into a new call would encrypt the new call's media under a key that departed
// participants still hold.
//
// Usage: capture() at the synchronous entry of the async chain, bump() on
// teardown, and gate the write-back on isCurrent(token).
export class TeardownGuard {
  // Monotonically increasing call generation. Bounded in practice by the number
  // of hangups in a session; a JS number handles this without overflow concern.
  private generation = 0;

  /** Snapshot the current generation before an async continuation is scheduled. */
  capture(): number {
    return this.generation;
  }

  /** True while no teardown has occurred since `token` was captured. */
  isCurrent(token: number): boolean {
    return token === this.generation;
  }

  /** Advance the generation — invalidates every previously captured token. */
  bump(): void {
    this.generation++;
  }
}
