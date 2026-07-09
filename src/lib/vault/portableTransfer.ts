import {
  exportVault,
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

export interface PortablePreferenceHandoff {
  preferences: Preferences;
  sceneMotion: SceneMotion;
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
  return {
    preferences: parsedPreferences,
    sceneMotion: parsedSceneMotion,
  };
}

export async function exportPortableTransfer(): Promise<PortableTransferSnapshot> {
  return {
    ...(await exportVault()),
    reviewHistory: readReviewHistory(),
    composerDrafts: portableComposerDrafts(loadComposerDrafts()),
    channelTopicDrafts: sanitizeChannelTopicDrafts(loadChannelTopicDrafts()),
    accountHandoffs: exportAccountHandoffs(),
    preferenceHandoff: {
      preferences: preferences(),
      sceneMotion: sceneMotion(),
    },
    followedConversations: exportFollowedKeys(),
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
  return {
    ...vault,
    reviewHistory,
    composerDrafts,
    channelTopicDrafts,
    accountHandoffs,
    preferenceHandoff,
    followedConversations,
  };
}

export async function importPortableTransfer(
  snapshot: PortableTransferSnapshot,
): Promise<PortableTransferImportResult> {
  const vault = await importVault(snapshot);
  const reviews = mergeReviewHistory(snapshot.reviewHistory);
  const drafts = portableComposerDrafts(snapshot.composerDrafts);
  saveComposerDrafts({
    ...loadComposerDrafts(),
    ...drafts,
  });
  const topicDrafts = sanitizeChannelTopicDrafts(snapshot.channelTopicDrafts);
  saveChannelTopicDrafts({
    ...loadChannelTopicDrafts(),
    ...topicDrafts,
  });
  const accountHandoffs = importAccountHandoffs(snapshot.accountHandoffs);
  if (snapshot.preferenceHandoff) {
    applyPreferencesSnapshot(snapshot.preferenceHandoff.preferences);
    setSceneMotion(snapshot.preferenceHandoff.sceneMotion);
  }
  const followedConversations = mergeFollowedKeys(snapshot.followedConversations);
  return {
    targets: vault.targets,
    messages: vault.messages,
    reviews: reviews.imported,
    drafts: Object.keys(drafts).length,
    topicDrafts: Object.keys(topicDrafts).length,
    accountHandoffs: accountHandoffs.imported,
    preferenceHandoffs: snapshot.preferenceHandoff ? 1 : 0,
    followedConversations: followedConversations.imported,
  };
}
