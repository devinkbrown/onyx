// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Local report receipts. There is no server inbox — this is a copy the user
 * already drafted, kept on this device so they can send it again.
 */

import { deviceMemoryStorageKey, type DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';
import { sanitizePersonMultiline, sanitizePersonToken } from './personSafety';

export const PERSON_REPORT_RECEIPTS_KEY = 'onyx:person-report-receipts';
export const MAX_PERSON_REPORT_RECEIPTS = 20;
export const MAX_PERSON_REPORT_RECEIPTS_CHARS = 64 * 1024;

export type PersonReportReceipt = {
  id: string;
  at: number;
  nick: string;
  reason: string;
  draft: string;
};

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function storageKey(owner?: DeviceMemoryOwner): string | null {
  if (!owner) return null;
  return deviceMemoryStorageKey(PERSON_REPORT_RECEIPTS_KEY, owner);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePersonReportReceipts(value: unknown): PersonReportReceipt[] {
  if (!Array.isArray(value)) return [];
  const receipts: PersonReportReceipt[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    if (typeof raw.id !== 'string' || typeof raw.at !== 'number' || !Number.isFinite(raw.at)) continue;
    if (typeof raw.nick !== 'string' || typeof raw.reason !== 'string' || typeof raw.draft !== 'string') continue;
    const draft = sanitizePersonMultiline(raw.draft, 2_000);
    if (!draft) continue;
    receipts.push({
      id: sanitizePersonToken(raw.id, 64),
      at: raw.at,
      nick: sanitizePersonToken(raw.nick, 128),
      reason: sanitizePersonToken(raw.reason, 32),
      draft,
    });
    if (receipts.length >= MAX_PERSON_REPORT_RECEIPTS) break;
  }
  return receipts;
}

export function loadPersonReportReceipts(owner?: DeviceMemoryOwner): PersonReportReceipt[] {
  const store = storage();
  const key = storageKey(owner);
  if (!store || !key) return [];
  try {
    const raw = store.getItem(key);
    if (!raw || raw.length > MAX_PERSON_REPORT_RECEIPTS_CHARS) return [];
    return parsePersonReportReceipts(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function savePersonReportReceipt(
  receipt: Omit<PersonReportReceipt, 'id' | 'at'> & { at?: number },
  owner?: DeviceMemoryOwner,
): PersonReportReceipt | null {
  const store = storage();
  const key = storageKey(owner);
  if (!store || !key) return null;
  const next: PersonReportReceipt = {
    id: `report-${Date.now().toString(36)}`,
    at: receipt.at ?? Date.now(),
    nick: sanitizePersonToken(receipt.nick, 128),
    reason: sanitizePersonToken(receipt.reason, 32),
    draft: sanitizePersonMultiline(receipt.draft, 2_000),
  };
  if (!next.nick || !next.draft) return null;
  const receipts = [next, ...loadPersonReportReceipts(owner)].slice(0, MAX_PERSON_REPORT_RECEIPTS);
  try {
    store.setItem(key, JSON.stringify(receipts));
    return loadPersonReportReceipts(owner)[0] ?? next;
  } catch {
    return null;
  }
}
