// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pictures · Files · Links — three quiet filters over this-device history.
 * No OpenGraph fetch, no dest unfurl, no gallery write.
 */

import type { ChatMessage } from '@/lib/irc/types';
import { hasEncryptedMessageBoundary } from '@/lib/e2ee/replyPrivacy';
import { parseMessage } from '@/lib/format/parseMessage';
import {
  classifyAttachmentKind,
  extractAttachmentPresentation,
  type AttachmentKind,
  type ParsedAttachment,
} from './attachmentMessage';

export type RoomMediaFilter = 'pictures' | 'files' | 'links';

export type RoomMediaPicture = {
  kind: 'picture';
  id: string;
  messageId: string;
  href: string;
  name: string | null;
  sizeLabel: string | null;
  from: string;
  time: Date;
};

export type RoomMediaFile = {
  kind: 'file';
  id: string;
  messageId: string;
  href: string;
  name: string | null;
  sizeLabel: string | null;
  from: string;
  time: Date;
};

export type RoomMediaLink = {
  kind: 'link';
  id: string;
  messageId: string;
  href: string;
  domain: string;
  from: string;
  time: Date;
};

export type RoomMediaIndex = {
  pictures: RoomMediaPicture[];
  files: RoomMediaFile[];
  links: RoomMediaLink[];
};

const INDEXABLE_TYPES = new Set(['msg', 'action', 'notice', 'whisper']);

export const ROOM_MEDIA_EMPTY: Record<RoomMediaFilter, string> = {
  pictures: 'No pictures from this conversation are on this device.',
  files: 'No files from this conversation are on this device.',
  links: 'No links from this conversation are on this device.',
};

export function readableMessageBody(message: ChatMessage): string | null {
  if (message.deleted || message.redacted) return null;
  if (!INDEXABLE_TYPES.has(message.type)) return null;
  if (hasEncryptedMessageBoundary(message)) return message.plaintext ?? null;
  return message.text;
}

export function linkDomain(href: string): string {
  try {
    const parsed = new URL(href, 'https://onyx.invalid');
    return parsed.hostname || href;
  } catch {
    return href;
  }
}

export function mergeRoomHistory(
  live: readonly ChatMessage[],
  vault: readonly ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of vault) byId.set(message.id, message);
  for (const message of live) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => left.time.getTime() - right.time.getTime());
}

export function indexRoomMedia(messages: readonly ChatMessage[]): RoomMediaIndex {
  const pictures: RoomMediaPicture[] = [];
  const files: RoomMediaFile[] = [];
  const links: RoomMediaLink[] = [];
  const seenHref = new Set<string>();

  for (const message of messages) {
    const body = readableMessageBody(message);
    if (!body) continue;
    const presentation = extractAttachmentPresentation(body);
    const claimed = new Set<string>();

    for (const attachment of presentation.attachments) {
      const entryId = `${message.id}:${attachment.url}`;
      if (seenHref.has(entryId)) continue;
      seenHref.add(entryId);
      claimed.add(attachment.url);
      if (attachment.kind === 'image') {
        pictures.push(toPicture(message, attachment));
      } else {
        files.push(toFile(message, attachment));
      }
    }

    for (const token of parseMessage(presentation.caption)) {
      if (token.type !== 'link') continue;
      if (claimed.has(token.href)) continue;
      const kind = classifyAttachmentKind(token.href);
      const entryId = `${message.id}:${token.href}`;
      if (seenHref.has(entryId)) continue;
      seenHref.add(entryId);
      if (kind === 'image') {
        pictures.push({
          kind: 'picture',
          id: entryId,
          messageId: message.id,
          href: token.href,
          name: null,
          sizeLabel: null,
          from: message.from,
          time: message.time,
        });
        continue;
      }
      if (kind === 'video' || kind === 'audio') {
        files.push({
          kind: 'file',
          id: entryId,
          messageId: message.id,
          href: token.href,
          name: null,
          sizeLabel: null,
          from: message.from,
          time: message.time,
        });
        continue;
      }
      links.push({
        kind: 'link',
        id: entryId,
        messageId: message.id,
        href: token.href,
        domain: linkDomain(token.href),
        from: message.from,
        time: message.time,
      });
    }
  }

  pictures.reverse();
  files.reverse();
  links.reverse();
  return { pictures, files, links };
}

function toPicture(message: ChatMessage, attachment: ParsedAttachment): RoomMediaPicture {
  return {
    kind: 'picture',
    id: `${message.id}:${attachment.url}`,
    messageId: message.id,
    href: attachment.url,
    name: attachment.name,
    sizeLabel: attachment.sizeLabel,
    from: message.from,
    time: message.time,
  };
}

function toFile(message: ChatMessage, attachment: ParsedAttachment): RoomMediaFile {
  return {
    kind: 'file',
    id: `${message.id}:${attachment.url}`,
    messageId: message.id,
    href: attachment.url,
    name: attachment.name,
    sizeLabel: attachment.sizeLabel,
    from: message.from,
    time: message.time,
  };
}

export function itemsForFilter(
  index: RoomMediaIndex,
  filter: RoomMediaFilter,
): ReadonlyArray<RoomMediaPicture | RoomMediaFile | RoomMediaLink> {
  if (filter === 'pictures') return index.pictures;
  if (filter === 'files') return index.files;
  return index.links;
}

export type { AttachmentKind };
