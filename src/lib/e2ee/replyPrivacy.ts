// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ChatMessage } from '@/lib/irc/types';
import { isEnvelope, LOCKED_PLACEHOLDER } from './dmCipher';

type ReplyPreviewSource = Pick<ChatMessage, 'text' | 'plaintext' | 'encrypted'>;

/** Treat a real envelope as encrypted even when legacy state omitted the flag. */
export function hasEncryptedMessageBoundary(message: ReplyPreviewSource): boolean {
  return message.encrypted === true || isEnvelope(message.text);
}

/** Active composer previews may use decrypted memory, but never the envelope. */
export function activeReplyPreviewText(message: ReplyPreviewSource): string {
  if (!hasEncryptedMessageBoundary(message)) return message.text;
  return message.plaintext ?? LOCKED_PLACEHOLDER;
}

/** Durable reply snapshots never duplicate decrypted text or ciphertext. */
export function persistedReplyPreviewText(message: ReplyPreviewSource): string {
  return hasEncryptedMessageBoundary(message) ? LOCKED_PLACEHOLDER : message.text;
}

/** Fail closed when an old wire/vault snapshot already contains an envelope. */
export function sanitizePersistedReplyPreviewText(text: string): string {
  return isEnvelope(text) ? LOCKED_PLACEHOLDER : text;
}
