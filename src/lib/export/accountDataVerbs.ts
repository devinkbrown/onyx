// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * accountDataVerbs.ts — three honest You / Account jobs.
 *
 * 1. Download what we store — account metadata the client already knows.
 * 2. Save this device's history — a local vault dump, not re-importable.
 * 3. Delete account — existing DROP path (UI only; this module never deletes).
 *
 * Never a "Your data" ZIP. Never a portable vault / re-import format.
 */

import type { ChatMessage } from '@/lib/irc/types';
import { VAULT_KEEP, exportVault, type VaultExportSnapshot } from '@/lib/vault/historyVault';
import type { DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';

export const ACCOUNT_STORE_RECORD_KIND = 'onyx.account-store-record' as const;
export const DEVICE_HISTORY_COPY_KIND = 'onyx.device-history-copy' as const;
export const ACCOUNT_STORE_RECORD_VERSION = 1 as const;
export const DEVICE_HISTORY_COPY_VERSION = 1 as const;

export const ACCOUNT_DATA_VERB_COPY = {
  downloadWhatWeStore: {
    title: 'Download what we store',
    hint: 'Nick, email, and rooms you own. Not the chat.',
    historyNote: 'History lives on this device.',
    action: 'Download account record',
  },
  saveDeviceHistory: {
    title: "Save this device's history",
    hint: 'The last ~400 messages per room on this device. You cannot load this back in.',
    action: 'Save device history',
  },
  deleteAccount: {
    title: 'Delete account',
    hint: 'This removes your identity. Other people keep their own copies.',
    action: 'Delete account',
    confirmAction: 'Permanently delete',
  },
} as const;

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export type RoomOwnershipSource = {
  name: string;
  users: Map<string, { modes: Iterable<string> }>;
};

export type AccountStoreRecord = {
  kind: typeof ACCOUNT_STORE_RECORD_KIND;
  version: typeof ACCOUNT_STORE_RECORD_VERSION;
  exportedAt: string;
  nick: string;
  account: string;
  email?: string;
  registeredAt?: string;
  roomsOwned: string[];
  note: string;
  historyNote: string;
};

export type DeviceHistoryCopyMessage = {
  id: string;
  time: string;
  from: string;
  type: string;
  text: string;
};

export type DeviceHistoryCopyRoom = {
  target: string;
  messageCount: number;
  messages: DeviceHistoryCopyMessage[];
};

export type DeviceHistoryCopy = {
  kind: typeof DEVICE_HISTORY_COPY_KIND;
  version: typeof DEVICE_HISTORY_COPY_VERSION;
  exportedAt: string;
  reimportable: false;
  keepPerRoom: number;
  note: string;
  rooms: DeviceHistoryCopyRoom[];
};

function scrub(text: string, max = 8_192): string {
  return text.replace(CONTROL, '').slice(0, max);
}

function safeFilenamePart(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._+-]+/g, '_').slice(0, 64) || 'file';
}

function optionalScrubbed(value: string | null | undefined, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const next = scrub(value, max).trim();
  return next || undefined;
}

/** Rooms where this nick already holds founder (Q) or owner (q) on the client roster. */
export function roomsOwnedByNick(
  rooms: Iterable<RoomOwnershipSource>,
  nick: string,
): string[] {
  const key = nick.trim().toLowerCase();
  if (!key) return [];
  const owned: string[] = [];
  const seen = new Set<string>();
  for (const room of rooms) {
    const name = scrub(room.name, 256).trim();
    if (!name) continue;
    const me = room.users.get(key);
    if (!me) continue;
    const modes = new Set(me.modes);
    if (!modes.has('Q') && !modes.has('q')) continue;
    const id = name.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    owned.push(name);
  }
  return owned.sort((a, b) => a.localeCompare(b));
}

export function buildAccountStoreRecord(input: {
  nick?: string | null;
  account?: string | null;
  email?: string | null;
  registeredAt?: string | null;
  rooms?: Iterable<RoomOwnershipSource>;
  now?: Date;
}): AccountStoreRecord {
  const nick = optionalScrubbed(input.nick, 64) ?? '';
  const account = optionalScrubbed(input.account, 64) ?? nick;
  const email = optionalScrubbed(input.email, 256);
  const registeredAt = optionalScrubbed(input.registeredAt, 128);
  return {
    kind: ACCOUNT_STORE_RECORD_KIND,
    version: ACCOUNT_STORE_RECORD_VERSION,
    exportedAt: (input.now ?? new Date()).toISOString(),
    nick,
    account,
    ...(email ? { email } : {}),
    ...(registeredAt ? { registeredAt } : {}),
    roomsOwned: roomsOwnedByNick(input.rooms ?? [], nick || account),
    note: ACCOUNT_DATA_VERB_COPY.downloadWhatWeStore.hint,
    historyNote: ACCOUNT_DATA_VERB_COPY.downloadWhatWeStore.historyNote,
  };
}

function copyVaultMessage(message: ChatMessage): DeviceHistoryCopyMessage {
  return {
    id: scrub(message.id, 128),
    time: message.time instanceof Date ? message.time.toISOString() : new Date().toISOString(),
    from: scrub(message.from, 64),
    type: scrub(String(message.type ?? 'msg'), 32),
    // Vault rows store ciphertext for E2EE DMs. Do not prefer transient plaintext.
    text: scrub(message.text),
  };
}

export function buildDeviceHistoryCopy(
  snapshot: Pick<VaultExportSnapshot, 'targets' | 'exportedAt'>,
  options?: { now?: Date; keepPerRoom?: number },
): DeviceHistoryCopy {
  const keep = options?.keepPerRoom ?? VAULT_KEEP;
  const exportedAt = options?.now?.toISOString()
    ?? (typeof snapshot.exportedAt === 'string' ? snapshot.exportedAt : new Date().toISOString());
  return {
    kind: DEVICE_HISTORY_COPY_KIND,
    version: DEVICE_HISTORY_COPY_VERSION,
    exportedAt,
    reimportable: false,
    keepPerRoom: keep,
    note: ACCOUNT_DATA_VERB_COPY.saveDeviceHistory.hint,
    rooms: snapshot.targets.map((entry) => {
      const messages = entry.messages.slice(-keep).map(copyVaultMessage);
      return {
        target: scrub(entry.target, 256),
        messageCount: messages.length,
        messages,
      };
    }),
  };
}

/** Dump the existing local vault. Never calls DROP / dropAccount. */
export async function collectDeviceHistoryCopy(
  owner?: DeviceMemoryOwner,
): Promise<DeviceHistoryCopy> {
  const snapshot = await exportVault(owner);
  return buildDeviceHistoryCopy(snapshot);
}

export function accountStoreRecordFilename(record: AccountStoreRecord): string {
  const day = record.exportedAt.slice(0, 10) || 'export';
  const who = safeFilenamePart(record.account || record.nick || 'account');
  return `onyx-account-record-${who}-${day}.json`;
}

export function deviceHistoryCopyFilename(copy: DeviceHistoryCopy): string {
  const day = copy.exportedAt.slice(0, 10) || 'export';
  return `onyx-device-history-${day}.json`;
}

export function downloadJsonFile(filename: string, value: unknown): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

export function downloadAccountStoreRecord(record: AccountStoreRecord): boolean {
  return downloadJsonFile(accountStoreRecordFilename(record), record);
}

export function downloadDeviceHistoryCopy(copy: DeviceHistoryCopy): boolean {
  return downloadJsonFile(deviceHistoryCopyFilename(copy), copy);
}
