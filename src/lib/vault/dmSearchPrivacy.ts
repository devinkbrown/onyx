// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Synchronous, target-scoped privacy state for server-side DM search.
 *
 * `unknown` is deliberately fail-closed: IndexedDB classification is async, but
 * SEARCH transmits its query immediately. A target becomes `plain` only after a
 * complete vault scan proves it contains no encrypted rows. Mutations invalidate
 * that proof before writing so a racing search can never reuse stale `plain`.
 */

export type VaultDmSearchPrivacy = 'unknown' | 'plain' | 'encrypted';

export type VaultDmPrivacyEpoch = Readonly<{
  target: string;
  global: number;
  targetGeneration: number;
}>;

type PrivacyListener = (target: string | null) => void;

const privacyByTarget = new Map<string, VaultDmSearchPrivacy>();
const targetGenerations = new Map<string, number>();
const listeners = new Set<PrivacyListener>();
let globalGeneration = 0;
let vaultKnownEmpty = false;

function keyFor(target: string): string {
  return target.toLowerCase();
}

function notify(target: string | null): void {
  for (const listener of listeners) listener(target);
}

/** Current synchronous classification. Missing state is unsafe until scanned. */
export function getVaultDmSearchPrivacy(target: string): VaultDmSearchPrivacy {
  const key = keyFor(target);
  return privacyByTarget.get(key) ?? (vaultKnownEmpty ? 'plain' : 'unknown');
}

/** Whether writes to this target need to refresh an existing proof. */
export function isVaultDmSearchPrivacyTracked(target: string): boolean {
  return privacyByTarget.has(keyFor(target));
}

/** Capture the generations an asynchronous read must still match at commit. */
export function captureVaultDmPrivacyEpoch(target: string): VaultDmPrivacyEpoch {
  const key = keyFor(target);
  return {
    target: key,
    global: globalGeneration,
    targetGeneration: targetGenerations.get(key) ?? 0,
  };
}

/**
 * Invalidate a target before a vault write. The returned epoch belongs to work
 * started after the invalidation; older scans can no longer commit `plain`.
 */
export function invalidateVaultDmSearchPrivacy(target: string): VaultDmPrivacyEpoch {
  const key = keyFor(target);
  const nextGeneration = (targetGenerations.get(key) ?? 0) + 1;
  targetGenerations.set(key, nextGeneration);
  privacyByTarget.set(key, 'unknown');
  notify(key);
  return { target: key, global: globalGeneration, targetGeneration: nextGeneration };
}

/** Commit an async classification only if no target/global mutation superseded it. */
export function commitVaultDmSearchPrivacy(
  epoch: VaultDmPrivacyEpoch,
  privacy: VaultDmSearchPrivacy,
): boolean {
  if (
    epoch.global !== globalGeneration
    || epoch.targetGeneration !== (targetGenerations.get(epoch.target) ?? 0)
  ) return false;
  if (privacyByTarget.get(epoch.target) === privacy) return true;
  privacyByTarget.set(epoch.target, privacy);
  notify(epoch.target);
  return true;
}

/** Invalidate every proof before clearing the physical vault. */
export function beginVaultDmPrivacyClear(): number {
  globalGeneration += 1;
  vaultKnownEmpty = false;
  privacyByTarget.clear();
  targetGenerations.clear();
  notify(null);
  return globalGeneration;
}

/** A verified clear proves every untracked target plain; a failed clear stays unknown. */
export function finishVaultDmPrivacyClear(generation: number, cleared: boolean): void {
  if (generation !== globalGeneration) return;
  vaultKnownEmpty = cleared;
  notify(null);
}

export function subscribeVaultDmSearchPrivacy(listener: PrivacyListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test hook: model a fresh page without altering the physical fake IndexedDB. */
export function _resetVaultDmSearchPrivacyForTests(): void {
  privacyByTarget.clear();
  targetGenerations.clear();
  listeners.clear();
  globalGeneration = 0;
  vaultKnownEmpty = false;
}
