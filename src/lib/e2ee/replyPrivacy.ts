// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ChatMessage } from '@/lib/irc/types';
import { isEnvelope, LOCKED_PLACEHOLDER } from './dmCipher';
import { GROUP_LOCKED_PLACEHOLDER, isGroupEnvelope } from './groupEnvelope';

type ReplyPreviewSource = Pick<ChatMessage, 'text' | 'plaintext' | 'encrypted'>;

/** True for any on-wire E2EE body (DM or room) that must never paint as plaintext. */
export function isEncryptedWireText(text: string): boolean {
  return isEnvelope(text) || isGroupEnvelope(text);
}

/** Locked placeholder matching the envelope family (DM vs room). */
export function lockedPlaceholderForText(text: string): string {
  return isGroupEnvelope(text) ? GROUP_LOCKED_PLACEHOLDER : LOCKED_PLACEHOLDER;
}

/** Treat a real envelope as encrypted even when legacy state omitted the flag. */
export function hasEncryptedMessageBoundary(message: ReplyPreviewSource): boolean {
  return message.encrypted === true || isEncryptedWireText(message.text);
}

/** Active composer previews may use decrypted memory, but never the envelope. */
export function activeReplyPreviewText(message: ReplyPreviewSource): string {
  if (!hasEncryptedMessageBoundary(message)) return message.text;
  return message.plaintext ?? lockedPlaceholderForText(message.text);
}

/** Durable reply snapshots never duplicate decrypted text or ciphertext. */
export function persistedReplyPreviewText(message: ReplyPreviewSource): string {
  return hasEncryptedMessageBoundary(message)
    ? lockedPlaceholderForText(message.text)
    : message.text;
}

/** Fail closed when an old wire/vault snapshot already contains an envelope. */
export function sanitizePersistedReplyPreviewText(text: string): string {
  return isEncryptedWireText(text) ? lockedPlaceholderForText(text) : text;
}
