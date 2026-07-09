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

export interface PortableTransferSnapshot extends VaultExportSnapshot {
  /** Home catch-up checkpoints the user explicitly reviewed on this device. */
  reviewHistory: ReviewHistoryEntry[];
}

export interface PortableTransferImportResult {
  targets: number;
  messages: number;
  reviews: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function exportPortableTransfer(): Promise<PortableTransferSnapshot> {
  return {
    ...(await exportVault()),
    reviewHistory: readReviewHistory(),
  };
}

export function parsePortableTransfer(raw: unknown): PortableTransferSnapshot | null {
  const vault = parseVaultExport(raw);
  if (!vault) return null;
  const reviewHistory = isRecord(raw)
    ? parseReviewHistoryEntries(raw.reviewHistory ?? [])
    : [];
  return {
    ...vault,
    reviewHistory,
  };
}

export async function importPortableTransfer(
  snapshot: PortableTransferSnapshot,
): Promise<PortableTransferImportResult> {
  const vault = await importVault(snapshot);
  const reviews = mergeReviewHistory(snapshot.reviewHistory);
  return {
    targets: vault.targets,
    messages: vault.messages,
    reviews: reviews.imported,
  };
}
