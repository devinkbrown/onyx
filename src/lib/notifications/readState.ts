// SPDX-License-Identifier: AGPL-3.0-or-later
export interface UnreadCounters {
  unread: number;
  mentions: number;
  firstUnreadId: string | null;
}

export interface IncomingUnreadInput extends UnreadCounters {
  messageId: string;
  isMention: boolean;
  isActive: boolean;
  skipUnread?: boolean;
}

export interface ViewedReadState extends UnreadCounters {
  dividerId: string | null;
  lastReadAtMs: number;
}

export function normalizeTargetKey(target: string): string {
  return target.toLowerCase();
}

export function applyIncomingUnread(input: IncomingUnreadInput): UnreadCounters {
  if (input.isActive || input.skipUnread) {
    return {
      unread: input.isActive ? 0 : input.unread,
      mentions: input.isActive ? 0 : input.mentions,
      firstUnreadId: input.isActive ? null : input.firstUnreadId,
    };
  }

  return {
    unread: input.unread + 1,
    mentions: input.mentions + (input.isMention ? 1 : 0),
    firstUnreadId: input.firstUnreadId ?? input.messageId,
  };
}

export function markViewedRead(input: UnreadCounters, nowMs: number): ViewedReadState {
  return {
    unread: 0,
    mentions: 0,
    firstUnreadId: null,
    dividerId: input.firstUnreadId,
    lastReadAtMs: nowMs,
  };
}

export function totalMentions(mentionsByTarget: Record<string, number>): number {
  return Object.values(mentionsByTarget).reduce((sum, count) => sum + count, 0);
}
