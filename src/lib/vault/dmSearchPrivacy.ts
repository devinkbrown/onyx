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

/**
 * A long-lived tab can visit many owners and DM targets. Retain only a working
 * set of privacy proofs so server URLs, account identities, and peer names do
 * not accumulate without limit. Eviction is safe because missing means unknown.
 */
export const VAULT_DM_PRIVACY_CACHE_CAP = 512;

interface TargetPrivacyState {
  privacy: VaultDmSearchPrivacy;
  generation: number;
}

const stateByTarget = new Map<string, TargetPrivacyState>();
const listeners = new Set<PrivacyListener>();
let globalGeneration = 0;
let vaultKnownEmpty = false;

function keyFor(target: string): string {
  return target.toLowerCase();
}

function notify(target: string | null): void {
  for (const listener of listeners) listener(target);
}

/** Refresh LRU order and invalidate older async scans if an entry is evicted. */
function rememberTarget(key: string, state: TargetPrivacyState): string | null {
  stateByTarget.delete(key);
  stateByTarget.set(key, state);
  if (stateByTarget.size <= VAULT_DM_PRIVACY_CACHE_CAP) return null;
  const oldest = stateByTarget.keys().next().value;
  if (oldest === undefined) return null;
  stateByTarget.delete(oldest);
  // A scan for an absent/zero-generation target must not be able to repopulate
  // an entry after eviction. Bumping the global epoch invalidates every scan
  // captured before this cache transition; callers will retry fail-closed.
  globalGeneration += 1;
  return oldest;
}

/** Current synchronous classification. Missing state is unsafe until scanned. */
export function getVaultDmSearchPrivacy(target: string): VaultDmSearchPrivacy {
  const key = keyFor(target);
  const state = stateByTarget.get(key);
  if (!state) return vaultKnownEmpty ? 'plain' : 'unknown';
  rememberTarget(key, state);
  return state.privacy;
}

/** Whether writes to this target need to refresh an existing proof. */
export function isVaultDmSearchPrivacyTracked(target: string): boolean {
  return stateByTarget.has(keyFor(target));
}

/** Capture the generations an asynchronous read must still match at commit. */
export function captureVaultDmPrivacyEpoch(target: string): VaultDmPrivacyEpoch {
  const key = keyFor(target);
  return {
    target: key,
    global: globalGeneration,
    targetGeneration: stateByTarget.get(key)?.generation ?? 0,
  };
}

/**
 * Invalidate a target before a vault write. The returned epoch belongs to work
 * started after the invalidation; older scans can no longer commit `plain`.
 */
export function invalidateVaultDmSearchPrivacy(target: string): VaultDmPrivacyEpoch {
  const key = keyFor(target);
  const nextGeneration = (stateByTarget.get(key)?.generation ?? 0) + 1;
  const evicted = rememberTarget(key, { privacy: 'unknown', generation: nextGeneration });
  // A verified-empty shortcut is no longer a safe fallback once a tracked write
  // begins. Explicit per-target proofs can restore plain after the write settles.
  vaultKnownEmpty = false;
  notify(key);
  if (evicted !== null) notify(evicted);
  return { target: key, global: globalGeneration, targetGeneration: nextGeneration };
}

/** Commit an async classification only if no target/global mutation superseded it. */
export function commitVaultDmSearchPrivacy(
  epoch: VaultDmPrivacyEpoch,
  privacy: VaultDmSearchPrivacy,
): boolean {
  if (
    epoch.global !== globalGeneration
    || epoch.targetGeneration !== (stateByTarget.get(epoch.target)?.generation ?? 0)
  ) return false;
  const current = stateByTarget.get(epoch.target);
  if (current?.privacy === privacy) {
    rememberTarget(epoch.target, current);
    return true;
  }
  const evicted = rememberTarget(epoch.target, {
    privacy,
    generation: epoch.targetGeneration,
  });
  notify(epoch.target);
  if (evicted !== null) notify(evicted);
  return true;
}

/** Invalidate every proof before clearing the physical vault. */
export function beginVaultDmPrivacyClear(): number {
  globalGeneration += 1;
  vaultKnownEmpty = false;
  stateByTarget.clear();
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
  stateByTarget.clear();
  listeners.clear();
  globalGeneration = 0;
  vaultKnownEmpty = false;
}

/** Test hook: inspect the bound without exposing retained owner/target keys. */
export function _vaultDmPrivacyCacheSizeForTests(): number {
  return stateByTarget.size;
}
