// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  applyRetentionPolicy,
  clearVault,
  exportVault,
  getRetentionPolicy,
  importVault,
  parseVaultExport,
  type VaultExportSnapshot,
} from './historyVault';
import {
  mergeReviewHistory,
  parseReviewHistoryEntries,
  readReviewHistory,
  type ReviewHistoryEntry,
} from '@/lib/notifications/reviewHistory';
import {
  exportFollowedKeys,
  mergeFollowedKeys,
  parseFollowedKeys,
} from '@/lib/notifications/followed';
import {
  loadComposerDrafts,
  sanitizeComposerDrafts,
  saveComposerDrafts,
  type ComposerDrafts,
} from '@/lib/composer/drafts';
import {
  loadChannelTopicDrafts,
  sanitizeChannelTopicDrafts,
  saveChannelTopicDrafts,
  type ChannelTopicDrafts,
} from '@/lib/channel/topicDrafts';
import {
  exportAccountHandoffs,
  importAccountHandoffs,
  parseAccountHandoffs,
  type AccountHandoff,
} from '@/lib/credentials';
import {
  applyPreferencesSnapshot,
  parsePreferencesSnapshot,
  preferences,
  type Preferences,
} from '@/lib/prefs/preferences';
import {
  parseSceneMotion,
  sceneMotion,
  setSceneMotion,
  type SceneMotion,
} from '@/lib/prefs/sceneMotion';
import {
  exportSavedSearches,
  importSavedSearches,
  parseSavedSearchExport,
  type SavedSearch,
} from './savedSearches';
import {
  readRetentionPolicy,
  sanitizeRetentionPolicy,
  writeRetentionPolicy,
  type RetentionPolicy,
} from './retentionPolicy';
import {
  mergeTopicReadLedger,
  parseTopicReadLedger,
  readTopicReadLedger,
  type TopicReadMarker,
} from '@/lib/topics/topicReadLedger';
import type { DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export interface PortablePreferenceHandoff {
  preferences: Preferences;
  sceneMotion: SceneMotion;
  /** Optional for compatibility with snapshots written before retention controls shipped. */
  retentionPolicy: RetentionPolicy | null;
}

export interface PortableTransferSnapshot extends VaultExportSnapshot {
  /** Home catch-up checkpoints the user explicitly reviewed on this device. */
  reviewHistory: ReviewHistoryEntry[];
  /** Channel/room composer drafts only. DM draft plaintext stays on this device. */
  composerDrafts: ComposerDrafts;
  /** Channel topic moderation drafts only. */
  channelTopicDrafts: ChannelTopicDrafts;
  /** Saved sign-in targets only; passwords and session tokens are never exported. */
  accountHandoffs: AccountHandoff[];
  /** Device preference switches and scene motion, with no account or message secrets. */
  preferenceHandoff: PortablePreferenceHandoff | null;
  /** Followed room/topic keys that drive calm notifications and catch-up ranking. */
  followedConversations: string[];
  /** Bounded room/topic read cursor metadata; never message bodies or account data. */
  topicReadCursors: TopicReadMarker[];
  /** Bounded device-local query metadata only; never message bodies or decrypted text. */
  savedSearches: SavedSearch[];
}

export interface PortableTransferImportResult {
  targets: number;
  messages: number;
  reviews: number;
  drafts: number;
  topicDrafts: number;
  accountHandoffs: number;
  preferenceHandoffs: number;
  followedConversations: number;
  topicReadCursors: number;
  savedSearches: number;
}

export interface PortableTransferImportOptions {
  /**
   * Live ownership guard supplied by mounted UI. Portable imports cross
   * awaited IndexedDB work and must not resume device-wide writes after the
   * reviewed account/session has been replaced.
   */
  isCurrent?: () => boolean;
}

export class PortableTransferOwnerChangedError extends Error {
  constructor() {
    super('Portable transfer owner changed during import');
    this.name = 'PortableTransferOwnerChangedError';
  }
}

function assertPortableTransferCurrent(options?: PortableTransferImportOptions): void {
  if (options?.isCurrent?.() === false) throw new PortableTransferOwnerChangedError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function portableComposerDrafts(value: ComposerDrafts): ComposerDrafts {
  const drafts: ComposerDrafts = {};
  for (const [target, draft] of Object.entries(value)) {
    if (target.startsWith('#') || target.startsWith('&')) drafts[target] = draft;
  }
  return drafts;
}

function parsePreferenceHandoff(value: unknown): PortablePreferenceHandoff | null {
  if (!isRecord(value)) return null;
  const parsedPreferences = parsePreferencesSnapshot(value.preferences);
  const parsedSceneMotion = parseSceneMotion(value.sceneMotion);
  if (!parsedPreferences || !parsedSceneMotion) return null;
  const retentionPolicy = isRecord(value.retentionPolicy)
    ? sanitizeRetentionPolicy(value.retentionPolicy as unknown as RetentionPolicy)
    : null;
  return {
    preferences: parsedPreferences,
    sceneMotion: parsedSceneMotion,
    retentionPolicy,
  };
}

export async function exportPortableTransfer(
  owner?: DeviceMemoryOwner,
): Promise<PortableTransferSnapshot> {
  const savedSearches = await exportSavedSearches(owner);
  // Pinned DMs deliberately remain device-only: an E2EE pin retains only its
  // ciphertext envelope, while the destination receives no device key material
  // that could safely rehydrate it. Never add the live pin map to this snapshot.
  return {
    ...(await exportVault(owner)),
    reviewHistory: readReviewHistory(owner),
    composerDrafts: portableComposerDrafts(loadComposerDrafts(undefined, owner)),
    channelTopicDrafts: sanitizeChannelTopicDrafts(loadChannelTopicDrafts(undefined, owner)),
    accountHandoffs: exportAccountHandoffs(),
    preferenceHandoff: {
      preferences: preferences(),
      sceneMotion: sceneMotion(),
      retentionPolicy: getRetentionPolicy() ?? readRetentionPolicy(),
    },
    followedConversations: exportFollowedKeys(owner),
    topicReadCursors: readTopicReadLedger(owner),
    savedSearches: savedSearches.searches,
  };
}

export function parsePortableTransfer(raw: unknown): PortableTransferSnapshot | null {
  const vault = parseVaultExport(raw);
  if (!vault) return null;
  const reviewHistory = isRecord(raw)
    ? parseReviewHistoryEntries(raw.reviewHistory ?? [])
    : [];
  const composerDrafts = isRecord(raw)
    ? portableComposerDrafts(sanitizeComposerDrafts(raw.composerDrafts ?? {}))
    : {};
  const channelTopicDrafts = isRecord(raw)
    ? sanitizeChannelTopicDrafts(raw.channelTopicDrafts ?? {})
    : {};
  const accountHandoffs = isRecord(raw)
    ? parseAccountHandoffs(raw.accountHandoffs ?? [])
    : [];
  const preferenceHandoff = isRecord(raw)
    ? parsePreferenceHandoff(raw.preferenceHandoff)
    : null;
  const followedConversations = isRecord(raw)
    ? parseFollowedKeys(raw.followedConversations ?? [])
    : [];
  const topicReadCursors = isRecord(raw)
    ? parseTopicReadLedger(raw.topicReadCursors ?? [])
    : [];
  const savedSearches = isRecord(raw)
    ? parseSavedSearchExport({
        kind: 'onyx-saved-searches',
        version: 1,
        exportedAt: raw.exportedAt,
        searches: raw.savedSearches ?? [],
      })?.searches ?? []
    : [];
  return {
    ...vault,
    reviewHistory,
    composerDrafts,
    channelTopicDrafts,
    accountHandoffs,
    preferenceHandoff,
    followedConversations,
    topicReadCursors,
    savedSearches,
  };
}

export async function importPortableTransfer(
  snapshot: PortableTransferSnapshot,
  owner?: DeviceMemoryOwner,
  options?: PortableTransferImportOptions,
): Promise<PortableTransferImportResult> {
  assertPortableTransferCurrent(options);
  const preferenceHandoff = snapshot.preferenceHandoff;
  if (preferenceHandoff) {
    assertPortableTransferCurrent(options);
    applyPreferencesSnapshot(preferenceHandoff.preferences);
    setSceneMotion(preferenceHandoff.sceneMotion);
  }

  // Apply an imported retention policy before writing vault rows so the import
  // itself obeys the destination policy. Applying it afterwards could leave up
  // to the old/default bound resident until that conversation next received a
  // message and triggered pruning.
  const importedRetentionPolicy = preferenceHandoff?.retentionPolicy;
  if (importedRetentionPolicy) {
    assertPortableTransferCurrent(options);
    writeRetentionPolicy(importedRetentionPolicy);
    await applyRetentionPolicy(importedRetentionPolicy);
    assertPortableTransferCurrent(options);
  }
  // A transferred or already-active localHistory=false preference is a hard
  // privacy boundary: clear existing rows and do not persist imported history.
  let vault: { targets: number; messages: number };
  assertPortableTransferCurrent(options);
  if (preferences().localHistory) {
    vault = await importVault(snapshot, owner, { isCurrent: options?.isCurrent });
    assertPortableTransferCurrent(options);
  } else {
    const cleared = await clearVault();
    assertPortableTransferCurrent(options);
    if (!cleared) {
      // `localHistory=false` is a privacy boundary, not a best-effort hint. Do
      // not continue merging the rest of a portable snapshot while old vault
      // rows may still be resident: the caller must report the failed import
      // instead of claiming a successful, partially-applied handoff.
      throw new Error('Could not clear device-local history for portable import');
    }
    vault = { targets: 0, messages: 0 };
  }
  assertPortableTransferCurrent(options);
  // Topic cursors are device-local transcript memory. Preserve the same
  // localHistory privacy boundary as the vault: a disabled handoff clears and
  // leaves them absent; otherwise merge through the ledger's canonical parser,
  // bounds, persistence verification, and same-tab publication path.
  const topicReadCursors = preferences().localHistory
    ? mergeTopicReadLedger(snapshot.topicReadCursors ?? [], owner)
    : { imported: 0, total: 0 };
  const reviews = mergeReviewHistory(snapshot.reviewHistory, owner);
  const drafts = portableComposerDrafts(snapshot.composerDrafts);
  saveComposerDrafts({
    ...loadComposerDrafts(undefined, owner),
    ...drafts,
  }, undefined, owner);
  const topicDrafts = sanitizeChannelTopicDrafts(snapshot.channelTopicDrafts);
  saveChannelTopicDrafts({
    ...loadChannelTopicDrafts(undefined, owner),
    ...topicDrafts,
  }, undefined, owner);
  const accountHandoffs = importAccountHandoffs(snapshot.accountHandoffs);
  const followedConversations = mergeFollowedKeys(snapshot.followedConversations, owner);
  assertPortableTransferCurrent(options);
  const savedSearches = await importSavedSearches({
    kind: 'onyx-saved-searches',
    version: 1,
    exportedAt: new Date().toISOString(),
    searches: snapshot.savedSearches,
  }, owner);
  assertPortableTransferCurrent(options);
  return {
    targets: vault.targets,
    messages: vault.messages,
    reviews: reviews.imported,
    drafts: Object.keys(drafts).length,
    topicDrafts: Object.keys(topicDrafts).length,
    accountHandoffs: accountHandoffs.imported,
    preferenceHandoffs: preferenceHandoff ? 1 : 0,
    followedConversations: followedConversations.imported,
    topicReadCursors: topicReadCursors.imported,
    savedSearches: savedSearches.imported,
  };
}
