// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * retentionPolicy.ts — configurable per-room retention over the vault bound.
 *
 * A pure, DOM-free, IndexedDB-free layer that decides *how much* scrollback a
 * device keeps per conversation. It generalises the single `VAULT_KEEP` cap
 * into a policy object:
 *
 *   - `keep`         — default per-target message count cap.
 *   - `perChannel`   — optional per-conversation overrides (lowercased keys).
 *   - `maxAgeDays`   — optional age cutoff; messages older than this are
 *                      dropped even if the count cap would keep them.
 *
 * The two constraints compose by *stricter-wins*: a message is pruned if the
 * count cap would drop it OR the age cutoff would drop it (set union).
 *
 * `historyVault.ts` consumes this policy in its save/prune path. The selection
 * logic stays pure and IndexedDB-free; the only browser boundary here is the
 * small best-effort localStorage reader/writer used by Preferences.
 */
import { VAULT_KEEP } from './historyVault';

/** Hard ceiling on any keep-count, so a bad config can't request unbounded storage. */
export const RETENTION_MAX_KEEP = 5000;
/** Hard ceiling on the age cutoff (~10 years); larger values clamp down. */
export const RETENTION_MAX_AGE_DAYS = 3650;
/** Browser-local persistence key for the device vault policy. */
export const RETENTION_POLICY_STORAGE_KEY = 'onyx:vault-retention-policy';

const DAY_MS = 24 * 60 * 60 * 1000;
const policyListeners = new Set<(policy: RetentionPolicy) => void>();

/** A configurable retention policy. All fields are validated before use. */
export interface RetentionPolicy {
  /** Default per-target message count cap. */
  keep: number;
  /** Per-conversation keep overrides, keyed by lowercased conversation key. */
  perChannel?: Record<string, number>;
  /** Optional age cutoff in days; messages older than this are pruned. */
  maxAgeDays?: number;
}

/** The minimal shape `selectMessagesToPrune` needs from a stored message. */
export interface RetentionCandidate {
  id: string;
  /** Epoch milliseconds, or a `Date` (as ChatMessage carries in memory). */
  time: number | Date;
}

/** Coerce a count to a finite, non-negative, floored, clamped keep value. */
function sanitizeKeep(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return Math.min(Math.floor(value), RETENTION_MAX_KEEP);
}

/** Coerce an age cutoff; non-positive / non-finite drops the cutoff entirely. */
function sanitizeMaxAgeDays(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(value, RETENTION_MAX_AGE_DAYS);
}

/**
 * Validate and normalise an untrusted policy object:
 *  - `keep` falls back to VAULT_KEEP when negative / non-finite, then clamps.
 *  - `maxAgeDays` is dropped when non-positive / non-finite, else clamps.
 *  - invalid per-channel overrides are dropped; keys are lowercased.
 *
 * Pure and idempotent: `sanitize(sanitize(p))` deep-equals `sanitize(p)`.
 */
export function sanitizeRetentionPolicy(policy: RetentionPolicy): RetentionPolicy {
  const keep = sanitizeKeep(policy.keep, VAULT_KEEP);
  const out: RetentionPolicy = { keep };

  const overrides = policy.perChannel;
  if (overrides) {
    const perChannel: Record<string, number> = {};
    for (const [rawKey, rawValue] of Object.entries(overrides)) {
      if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue < 0) continue;
      perChannel[rawKey.toLowerCase()] = Math.min(Math.floor(rawValue), RETENTION_MAX_KEEP);
    }
    if (Object.keys(perChannel).length > 0) out.perChannel = perChannel;
  }

  const maxAgeDays = sanitizeMaxAgeDays(policy.maxAgeDays);
  if (maxAgeDays !== undefined) out.maxAgeDays = maxAgeDays;

  return out;
}

/** Read the device's persisted policy, falling back safely when storage is unavailable or invalid. */
export function readRetentionPolicy(): RetentionPolicy {
  const fallback: RetentionPolicy = { keep: VAULT_KEEP };
  try {
    const raw = globalThis.localStorage?.getItem(RETENTION_POLICY_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fallback;
    return sanitizeRetentionPolicy(parsed as RetentionPolicy);
  } catch {
    return fallback;
  }
}

/** Observe policy writes made by Preferences or portable import. */
export function subscribeRetentionPolicy(
  listener: (policy: RetentionPolicy) => void,
): () => void {
  policyListeners.add(listener);
  return () => policyListeners.delete(listener);
}

/** Persist a sanitized policy. Returns false when browser storage rejects the write. */
export function writeRetentionPolicy(policy: RetentionPolicy): boolean {
  const safe = sanitizeRetentionPolicy(policy);
  for (const listener of policyListeners) {
    try {
      listener(safe);
    } catch {
      // One mounted consumer must not prevent policy persistence.
    }
  }
  try {
    globalThis.localStorage?.setItem(RETENTION_POLICY_STORAGE_KEY, JSON.stringify(safe));
    return globalThis.localStorage !== undefined;
  } catch {
    return false;
  }
}

/** The effective keep-count for a channel: its override, else the default. */
export function effectiveKeep(policy: RetentionPolicy, channel: string): number {
  const safe = sanitizeRetentionPolicy(policy);
  const override = safe.perChannel?.[channel.toLowerCase()];
  return override ?? safe.keep;
}

/**
 * Flatten a policy for a single channel: resolve the per-channel override into
 * `keep` and preserve the age cutoff. Lets callers use the exact 3-arg
 * `selectMessagesToPrune` signature while still honouring overrides.
 */
export function resolvePolicyForChannel(policy: RetentionPolicy, channel: string): RetentionPolicy {
  const safe = sanitizeRetentionPolicy(policy);
  const resolved: RetentionPolicy = { keep: effectiveKeep(safe, channel) };
  if (safe.maxAgeDays !== undefined) resolved.maxAgeDays = safe.maxAgeDays;
  return resolved;
}

/** Epoch ms from a candidate; non-finite / invalid coerces to the oldest bucket (0). */
function toEpochMs(time: number | Date): number {
  const ms = time instanceof Date ? time.getTime() : time;
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Deterministically select the ids to prune for one target.
 *
 * A message is dropped when EITHER constraint would drop it (stricter wins):
 *   - count cap: keep only the newest `keep` messages by time.
 *   - age cutoff: drop messages strictly older than `nowMs - maxAgeDays` (the
 *     boundary is inclusive-keep). Skipped when `nowMs` is non-finite.
 *
 * The input is never mutated. Returned ids are chronological, oldest-first,
 * with ties broken by id for repeatable output regardless of input order.
 */
export function selectMessagesToPrune(
  messages: readonly RetentionCandidate[],
  policy: RetentionPolicy,
  nowMs: number,
): string[] {
  if (messages.length === 0) return [];
  const safe = sanitizeRetentionPolicy(policy);

  // Stable ascending order (oldest-first), tie-broken by id.
  const ordered = messages
    .map((m) => ({ id: m.id, ms: toEpochMs(m.time) }))
    .sort((a, b) => a.ms - b.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const drop = new Set<string>();

  // Count cap: everything before the newest `keep` entries is dropped.
  const dropByCount = Math.max(0, ordered.length - safe.keep);
  for (let i = 0; i < dropByCount; i++) drop.add(ordered[i]!.id);

  // Age cutoff: drop anything strictly older than the cutoff timestamp.
  if (safe.maxAgeDays !== undefined && Number.isFinite(nowMs)) {
    const cutoff = nowMs - safe.maxAgeDays * DAY_MS;
    for (const entry of ordered) {
      if (entry.ms < cutoff) drop.add(entry.id);
    }
  }

  // Emit in the same stable oldest-first order.
  return ordered.filter((entry) => drop.has(entry.id)).map((entry) => entry.id);
}
