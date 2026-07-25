// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * capabilityMatrix.ts — user-facing capability matrix for the connected session.
 */

export type CapStatus = 'active' | 'available' | 'missing' | 'unknown';

export type CapRow = {
  id: string;
  label: string;
  status: CapStatus;
  hint: string;
};

/** Product-relevant caps we surface in Account / Connect diagnostics. */
export const PRODUCT_CAPS: readonly { id: string; label: string; hint: string }[] = [
  { id: 'sasl', label: 'SASL login', hint: 'Account authentication' },
  { id: 'batch', label: 'Batches', hint: 'Multiline + history batches' },
  { id: 'message-tags', label: 'Message tags', hint: 'msgid, replies, labels' },
  { id: 'server-time', label: 'Server time', hint: 'Authoritative timestamps' },
  { id: 'echo-message', label: 'Echo message', hint: 'Server echoes your sends' },
  { id: 'draft/chathistory', label: 'Chat history', hint: 'CHATHISTORY / history sync' },
  { id: 'draft/read-marker', label: 'Read markers', hint: 'Multi-device read position' },
  { id: 'draft/multiline', label: 'Multiline', hint: 'Long messages as batches' },
  { id: 'onyx/e2ee', label: 'Onyx E2EE', hint: 'Encrypted DM tags' },
  { id: 'onyx/media', label: 'Onyx media', hint: 'Voice/video plane' },
  { id: 'draft/webpush', label: 'Web Push', hint: 'Closed-tab notifications' },
];

export function buildCapabilityMatrix(input: {
  negotiated?: Iterable<string> | null;
  available?: Iterable<string> | null;
}): CapRow[] {
  const negotiated = new Set(
    [...(input.negotiated ?? [])].map((c) => c.toLowerCase()),
  );
  const available = new Set(
    [...(input.available ?? [])].map((c) => c.toLowerCase()),
  );

  return PRODUCT_CAPS.map((cap) => {
    const id = cap.id.toLowerCase();
    let status: CapStatus = 'missing';
    if (negotiated.has(id)) status = 'active';
    else if (available.has(id)) status = 'available';
    else if (available.size === 0 && negotiated.size === 0) status = 'unknown';
    return { id: cap.id, label: cap.label, status, hint: cap.hint };
  });
}

export function capabilitySummary(rows: readonly CapRow[]): string {
  const active = rows.filter((r) => r.status === 'active').length;
  return `${active}/${rows.length} product capabilities active`;
}
