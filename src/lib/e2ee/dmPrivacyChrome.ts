// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Honest DM privacy chrome — copy and presentation gates only.
 *
 * E2EE DMs exist and fail closed. Group E2EE is not live. History is this
 * device. These helpers never invent a padlock, passkey, cloud sync, or a
 * "Private" claim that Slack-style chrome would make without saying who can
 * read the conversation.
 */

import type { ChatMessage } from '@/lib/irc/types';
import { LOCKED_PLACEHOLDER, normalizePeerDeviceKeys } from './dmCipher';
import { hasEncryptedMessageBoundary, isEncryptedWireText } from './replyPrivacy';

export const DM_EMPTY_TITLE = 'A private conversation';
export const DM_EMPTY_BODY =
  'Only the two of you can read these messages. They stay on this device.';

export const DM_SEALED_LIST_PREVIEW = 'Encrypted message';

export const DM_PRIVATE_CHIP = 'Private';
export const DM_PRIVATE_CHIP_LABEL =
  'Private — only the two of you can read these messages. They stay on this device.';
export const DM_VERIFY_ACTION = 'Verify';

export const DM_KEY_CHANGE_BODY =
  'This usually means they reinstalled Onyx or added a device. Messages stay locked until you review it.';

const SYSTEM_TYPES = new Set([
  'join', 'part', 'quit', 'kick', 'mode', 'topic', 'nick', 'system', 'error',
]);

export type DmPrivacyChromeState = {
  peerDmKeys: ReadonlyMap<string, string>;
  peerDmDeviceKeys: ReadonlyMap<string, readonly string[]>;
  peerKeyChanges: ReadonlyMap<string, unknown>;
};

function peerKey(peer: string): string | null {
  const key = peer.trim().toLowerCase();
  return key.length > 0 ? key : null;
}

export function dmKeyChangeAlert(name: string): string {
  return `${name}'s device key changed. Compare the new safety number before you continue.`;
}

export function dmKeyChangeTitle(name: string): string {
  return `${name}'s device key changed`;
}

/** Published peer key or a nonempty advertised device directory. */
export function dmPeerKeyPresent(state: DmPrivacyChromeState, peer: string): boolean {
  const key = peerKey(peer);
  if (key === null) return false;
  if (state.peerDmKeys.has(key)) return true;
  const devices = state.peerDmDeviceKeys.get(key);
  return Boolean(devices && devices.length > 0);
}

/**
 * True when this DM can be sealed right now: a structurally valid peer key
 * is present and no pending key-change is holding the conversation locked.
 */
export function dmSealReady(state: DmPrivacyChromeState, peer: string): boolean {
  const key = peerKey(peer);
  if (key === null) return false;
  if (state.peerKeyChanges.has(key)) return false;
  const published = state.peerDmKeys.get(key);
  const devices = state.peerDmDeviceKeys.get(key) ?? [];
  return normalizePeerDeviceKeys([
    ...devices,
    ...(published ? [published] : []),
  ]).length > 0;
}

/** Header chip only — never a list padlock, never a room claim. */
export function showDmPrivateChip(state: DmPrivacyChromeState, peer: string): boolean {
  return dmPeerKeyPresent(state, peer) && dmSealReady(state, peer);
}

export function dmHasPendingKeyChange(state: DmPrivacyChromeState, peer: string): boolean {
  const key = peerKey(peer);
  return key !== null && state.peerKeyChanges.has(key);
}

type PreviewSource = Pick<
  ChatMessage,
  'text' | 'plaintext' | 'encrypted' | 'type' | 'deleted' | 'redacted' | 'pending'
>;

/**
 * Messages-list preview. Sealed bodies stay "Encrypted message" — no lock
 * emoji, no envelope leak. Opened plaintext on this device may preview.
 */
export function dmListPreviewText(message: PreviewSource): string | null {
  if (message.deleted || message.redacted || message.pending) return null;
  if (SYSTEM_TYPES.has(message.type)) return null;

  if (hasEncryptedMessageBoundary(message) && !message.plaintext) {
    return DM_SEALED_LIST_PREVIEW;
  }

  const text = (message.plaintext ?? message.text).replace(/\s+/g, ' ').trim();
  if (!text) return message.type === 'action' ? 'Action message' : 'Message';
  if (text === LOCKED_PLACEHOLDER || isEncryptedWireText(text)) {
    return DM_SEALED_LIST_PREVIEW;
  }
  if (text.length <= 96) return text;
  return `${text.slice(0, 95)}…`;
}

export function latestDmListPreview(messages: readonly PreviewSource[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    const preview = dmListPreviewText(message);
    if (preview) return preview;
  }
  return null;
}
