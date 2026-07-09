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

export interface PortableTransferSnapshot extends VaultExportSnapshot {
  /** Home catch-up checkpoints the user explicitly reviewed on this device. */
  reviewHistory: ReviewHistoryEntry[];
  /** Channel/room composer drafts only. DM draft plaintext stays on this device. */
  composerDrafts: ComposerDrafts;
  /** Channel topic moderation drafts only. */
  channelTopicDrafts: ChannelTopicDrafts;
}

export interface PortableTransferImportResult {
  targets: number;
  messages: number;
  reviews: number;
  drafts: number;
  topicDrafts: number;
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

export async function exportPortableTransfer(): Promise<PortableTransferSnapshot> {
  return {
    ...(await exportVault()),
    reviewHistory: readReviewHistory(),
    composerDrafts: portableComposerDrafts(loadComposerDrafts()),
    channelTopicDrafts: sanitizeChannelTopicDrafts(loadChannelTopicDrafts()),
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
  return {
    ...vault,
    reviewHistory,
    composerDrafts,
    channelTopicDrafts,
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
  return {
    targets: vault.targets,
    messages: vault.messages,
    reviews: reviews.imported,
    drafts: Object.keys(drafts).length,
    topicDrafts: Object.keys(topicDrafts).length,
  };
}
