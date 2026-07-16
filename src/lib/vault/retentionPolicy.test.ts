// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * retentionPolicy.test.ts — pure, DOM-free tests for the retention layer.
 *
 * No IndexedDB is touched: these functions are math over plain objects, so
 * `fake-indexeddb` is deliberately NOT imported.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  RETENTION_MAX_AGE_DAYS,
  RETENTION_MAX_KEEP,
  RETENTION_POLICY_STORAGE_KEY,
  effectiveKeep,
  readRetentionPolicy,
  resolvePolicyForChannel,
  sanitizeRetentionPolicy,
  selectMessagesToPrune,
  writeRetentionPolicy,
  type RetentionCandidate,
  type RetentionPolicy,
} from './retentionPolicy';
import { VAULT_KEEP } from './historyVault';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

afterEach(() => {
  localStorage.removeItem(RETENTION_POLICY_STORAGE_KEY);
});

/** Build `n` candidates, one per day going back from `now`, newest = id `m0`. */
function timeline(n: number, now = NOW): RetentionCandidate[] {
  const out: RetentionCandidate[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: `m${i}`, time: now - i * DAY_MS });
  }
  return out;
}

describe('sanitizeRetentionPolicy', () => {
  it('passes through a valid policy, lowercasing per-channel keys', () => {
    const p: RetentionPolicy = { keep: 200, perChannel: { '#Foo': 50 }, maxAgeDays: 30 };
    expect(sanitizeRetentionPolicy(p)).toEqual({
      keep: 200,
      perChannel: { '#foo': 50 },
      maxAgeDays: 30,
    });
  });

  it('falls back to VAULT_KEEP on negative or non-finite keep', () => {
    expect(sanitizeRetentionPolicy({ keep: -5 }).keep).toBe(VAULT_KEEP);
    expect(sanitizeRetentionPolicy({ keep: Number.NaN }).keep).toBe(VAULT_KEEP);
    expect(sanitizeRetentionPolicy({ keep: Number.POSITIVE_INFINITY }).keep).toBe(VAULT_KEEP);
  });

  it('clamps keep to the sane max and floors fractional counts', () => {
    expect(sanitizeRetentionPolicy({ keep: 10_000_000 }).keep).toBe(RETENTION_MAX_KEEP);
    expect(sanitizeRetentionPolicy({ keep: 12.9 }).keep).toBe(12);
  });

  it('drops maxAgeDays when non-positive or non-finite, clamps to the max', () => {
    expect(sanitizeRetentionPolicy({ keep: 10, maxAgeDays: 0 }).maxAgeDays).toBeUndefined();
    expect(sanitizeRetentionPolicy({ keep: 10, maxAgeDays: -1 }).maxAgeDays).toBeUndefined();
    expect(sanitizeRetentionPolicy({ keep: 10, maxAgeDays: Number.NaN }).maxAgeDays).toBeUndefined();
    expect(sanitizeRetentionPolicy({ keep: 10, maxAgeDays: 1e9 }).maxAgeDays).toBe(
      RETENTION_MAX_AGE_DAYS,
    );
  });

  it('drops invalid per-channel overrides but keeps the valid ones', () => {
    const p = sanitizeRetentionPolicy({
      keep: 100,
      perChannel: { '#good': 10, '#bad': -1, '#nan': Number.NaN, '#big': 10_000_000 },
    });
    expect(p.perChannel).toEqual({ '#good': 10, '#big': RETENTION_MAX_KEEP });
  });

  it('is idempotent (sanitize of a sanitized policy is unchanged)', () => {
    const once = sanitizeRetentionPolicy({ keep: 12.9, perChannel: { '#A': 3.7 }, maxAgeDays: 5 });
    expect(sanitizeRetentionPolicy(once)).toEqual(once);
  });
});

describe('retention policy persistence', () => {
  it('defaults to the existing vault bound when no preference is stored', () => {
    expect(readRetentionPolicy()).toEqual({ keep: VAULT_KEEP });
  });

  it('round-trips a sanitized device policy', () => {
    expect(writeRetentionPolicy({ keep: 1000, maxAgeDays: 90 })).toBe(true);

    expect(readRetentionPolicy()).toEqual({ keep: 1000, maxAgeDays: 90 });
    expect(JSON.parse(localStorage.getItem(RETENTION_POLICY_STORAGE_KEY) ?? '')).toEqual({
      keep: 1000,
      maxAgeDays: 90,
    });
  });

  it('fails closed to the default for malformed or non-object storage', () => {
    localStorage.setItem(RETENTION_POLICY_STORAGE_KEY, '{broken');
    expect(readRetentionPolicy()).toEqual({ keep: VAULT_KEEP });

    localStorage.setItem(RETENTION_POLICY_STORAGE_KEY, '[]');
    expect(readRetentionPolicy()).toEqual({ keep: VAULT_KEEP });
  });
});

describe('effectiveKeep / resolvePolicyForChannel', () => {
  const policy: RetentionPolicy = { keep: 400, perChannel: { '#small': 20 }, maxAgeDays: 90 };

  it('returns the default keep for a channel without an override', () => {
    expect(effectiveKeep(policy, '#general')).toBe(400);
  });

  it('returns the per-channel override, case-insensitively', () => {
    expect(effectiveKeep(policy, '#SMALL')).toBe(20);
  });

  it('flattens the override into keep while preserving maxAgeDays', () => {
    expect(resolvePolicyForChannel(policy, '#small')).toEqual({ keep: 20, maxAgeDays: 90 });
    expect(resolvePolicyForChannel(policy, '#general')).toEqual({ keep: 400, maxAgeDays: 90 });
  });
});

describe('per-channel retention pruning', () => {
  it('uses the default keep bound when a channel has no override', () => {
    const msgs = timeline(VAULT_KEEP + 2);
    const policy: RetentionPolicy = { keep: VAULT_KEEP, perChannel: { '#tiny': 1 } };

    expect(effectiveKeep(policy, '#general')).toBe(VAULT_KEEP);
    expect(selectMessagesToPrune(msgs, resolvePolicyForChannel(policy, '#general'), NOW)).toEqual([
      `m${VAULT_KEEP + 1}`,
      `m${VAULT_KEEP}`,
    ]);
  });

  it('uses a per-channel override case-insensitively before selecting prunes', () => {
    const msgs = timeline(5);
    const policy: RetentionPolicy = { keep: 5, perChannel: { '#ops': 2 } };

    expect(effectiveKeep(policy, '#OPS')).toBe(2);
    expect(selectMessagesToPrune(msgs, resolvePolicyForChannel(policy, '#OPS'), NOW)).toEqual([
      'm4',
      'm3',
      'm2',
    ]);
  });

  it('selects the oldest messages even when input order is adversarial', () => {
    const msgs = [
      { id: 'newest', time: NOW },
      { id: 'oldest', time: NOW - 4 * DAY_MS },
      { id: 'middle', time: NOW - 2 * DAY_MS },
      { id: 'second-oldest', time: NOW - 3 * DAY_MS },
      { id: 'second-newest', time: NOW - DAY_MS },
    ] satisfies RetentionCandidate[];

    expect(selectMessagesToPrune(msgs, { keep: 2 }, NOW)).toEqual([
      'oldest',
      'second-oldest',
      'middle',
    ]);
  });

  it('returns no prunes for an empty channel regardless of override', () => {
    const policy: RetentionPolicy = { keep: 100, perChannel: { '#empty': 0 } };

    expect(effectiveKeep(policy, '#empty')).toBe(0);
    expect(selectMessagesToPrune([], resolvePolicyForChannel(policy, '#empty'), NOW)).toEqual([]);
  });
});

describe('selectMessagesToPrune — count-only', () => {
  it('drops nothing when at or below the bound', () => {
    const msgs = timeline(10);
    expect(selectMessagesToPrune(msgs, { keep: 10 }, NOW)).toEqual([]);
    expect(selectMessagesToPrune(msgs, { keep: 25 }, NOW)).toEqual([]);
  });

  it('drops the oldest beyond the bound, keeping the newest keep', () => {
    const msgs = timeline(5); // m0 newest ... m4 oldest
    // keep newest 2 -> drop m2, m3, m4 (returned oldest-first)
    expect(selectMessagesToPrune(msgs, { keep: 2 }, NOW)).toEqual(['m4', 'm3', 'm2']);
  });

  it('drops everything when keep is 0', () => {
    const msgs = timeline(3);
    expect(selectMessagesToPrune(msgs, { keep: 0 }, NOW)).toEqual(['m2', 'm1', 'm0']);
  });
});

describe('selectMessagesToPrune — age-only', () => {
  it('drops messages strictly older than the cutoff', () => {
    const msgs = timeline(10); // m_i is i days old
    // maxAgeDays 3 => cutoff = NOW - 3d; anything with time < cutoff drops => m4..m9
    const dropped = selectMessagesToPrune(msgs, { keep: 1000, maxAgeDays: 3 }, NOW);
    expect(dropped).toEqual(['m9', 'm8', 'm7', 'm6', 'm5', 'm4']);
  });

  it('keeps a message exactly at the cutoff (boundary is inclusive-keep)', () => {
    const cutoffDays = 2;
    const msgs = timeline(5);
    const dropped = selectMessagesToPrune(msgs, { keep: 1000, maxAgeDays: cutoffDays }, NOW);
    // m2 sits exactly at NOW-2d == cutoff, so it is kept; m3, m4 drop.
    expect(dropped).toEqual(['m4', 'm3']);
  });

  it('ignores the age cutoff when nowMs is non-finite (count-only fallback)', () => {
    const msgs = timeline(5);
    expect(selectMessagesToPrune(msgs, { keep: 1000, maxAgeDays: 1 }, Number.NaN)).toEqual([]);
  });
});

describe('selectMessagesToPrune — combined (stricter wins)', () => {
  it('takes the union of count-drops and age-drops', () => {
    const msgs = timeline(10);
    // count keep 8 -> would drop m8, m9
    // age 4 days -> would drop m5..m9
    // union (stricter) -> m5..m9
    const dropped = selectMessagesToPrune(msgs, { keep: 8, maxAgeDays: 4 }, NOW);
    expect(dropped).toEqual(['m9', 'm8', 'm7', 'm6', 'm5']);
  });

  it('count cap dominates when it is the stricter constraint', () => {
    const msgs = timeline(10);
    // count keep 3 -> drop m3..m9 ; age 100d -> drops nothing ; union = count set
    const dropped = selectMessagesToPrune(msgs, { keep: 3, maxAgeDays: 100 }, NOW);
    expect(dropped).toEqual(['m9', 'm8', 'm7', 'm6', 'm5', 'm4', 'm3']);
  });
});

describe('selectMessagesToPrune — degenerate & determinism', () => {
  it('returns [] for empty input', () => {
    expect(selectMessagesToPrune([], { keep: 10 }, NOW)).toEqual([]);
  });

  it('accepts Date-typed times as well as epoch numbers', () => {
    const msgs: RetentionCandidate[] = [
      { id: 'a', time: new Date(NOW) },
      { id: 'b', time: new Date(NOW - DAY_MS) },
      { id: 'c', time: new Date(NOW - 2 * DAY_MS) },
    ];
    expect(selectMessagesToPrune(msgs, { keep: 1 }, NOW)).toEqual(['c', 'b']);
  });

  it('coerces non-finite message times to the oldest bucket', () => {
    const msgs: RetentionCandidate[] = [
      { id: 'new', time: NOW },
      { id: 'bad', time: Number.NaN },
    ];
    // 'bad' coerces to epoch 0 -> oldest -> pruned first under keep 1
    expect(selectMessagesToPrune(msgs, { keep: 1 }, NOW)).toEqual(['bad']);
  });

  it('breaks time ties deterministically by id', () => {
    const t = NOW - 5 * DAY_MS;
    const msgs: RetentionCandidate[] = [
      { id: 'zeta', time: t },
      { id: 'alpha', time: t },
      { id: 'mid', time: t },
    ];
    // all same time; keep 1 keeps the "largest" by our stable order and drops
    // the rest in a stable, repeatable sequence.
    const a = selectMessagesToPrune(msgs, { keep: 1 }, NOW);
    const b = selectMessagesToPrune([...msgs].reverse(), { keep: 1 }, NOW);
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
  });

  it('does not mutate the input array or its candidates', () => {
    const msgs = timeline(4);
    const snapshot = JSON.parse(JSON.stringify(msgs.map((m) => ({ ...m }))));
    selectMessagesToPrune(msgs, { keep: 1, maxAgeDays: 1 }, NOW);
    expect(msgs.map((m) => ({ id: m.id, time: m.time }))).toEqual(snapshot);
  });

  it('sanitizes an unsafe policy before pruning (negative keep -> VAULT_KEEP)', () => {
    const msgs = timeline(VAULT_KEEP + 3);
    const dropped = selectMessagesToPrune(msgs, { keep: -1 }, NOW);
    expect(dropped).toHaveLength(3);
  });
});
