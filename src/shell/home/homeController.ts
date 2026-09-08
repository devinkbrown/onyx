// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * createHomeController — Solid accessors, resources, clock, and current
 * handlers for Home. Classifiers run once per memo; handlers reread getState()
 * at activation. No presentation markup lives here.
 */
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { buildCatchUp, type CatchUpItem } from '@/lib/notifications/catchUp';
import { buildAwayDigest, type AwayDigest } from '@/lib/notifications/awayDigest';
import { isCatchUpHardSilenced } from '@/lib/notifications/channelNotifyMode';
import { calmPreset } from '@/lib/notifications/calmMode';
import { buildResumePoints, type ResumePoint } from '@/lib/catchup/resumePoints';
import {
  parseInviteNotification,
  type HomeInboxInvite,
  type HomeInboxRow,
} from '@/lib/catchup/homeInbox';
import { planCatchUpAll, type CaughtUpPlan } from '@/lib/catchup/markCaughtUp';
import {
  buildCatchUpMemorySnapshot,
  catchUpItemFromMemory,
  firstUnreadMapFromMemory,
  readCatchUpMemory,
  subscribeCatchUpMemory,
  writeCatchUpMemory,
  type CatchUpMemoryItem,
} from '@/lib/catchup/catchUpMemory';
import { followed } from '@/lib/notifications/followed';
import { dmListPreviewText } from '@/lib/e2ee/dmPrivacyChrome';
import {
  buildHomeMemory,
  buildHomeMemoryFromVault,
  collectHomeMemoryTargets,
  type HomeMemoryItem,
} from '@/lib/notifications/homeMemory';
import { buildQuietActivity, type QuietActivityItem } from '@/lib/notifications/quietActivity';
import {
  planReviewedAnchorRecall,
  readReviewHistory,
  recordReviewHistory,
  subscribeReviewHistory,
  type ReviewHistoryEntry,
} from '@/lib/notifications/reviewHistory';
import {
  collectScheduledEvents,
  type ScheduledEventItem,
} from '@/lib/notifications/scheduledEvents';
import {
  scheduledEventsListEqual,
  quietActivityListEqual,
  awayDigestEqual,
} from '@/lib/notifications/digestStability';
import { preferences, setPreference } from '@/lib/prefs/preferences';
import { buildQuietBoostDigest, type QuietBoostDigestItem } from '@/lib/reactions/quietBoosts';
import { fetchStatsIndex, type StatsIndex } from '@/lib/stats/networkIndex';
import { loadChannelTopicDrafts } from '@/lib/channel/topicDrafts';
import {
  loadOutbox,
  loadRecent,
  exportVault,
  subscribeOutbox,
  deviceMemoryOwnerKey,
  type OutboxEntry,
} from '@/lib/vault/historyVault';
import { outboxHomeChrome, type OutboxHomeChrome } from '@/lib/vault/outboxStatus';
import type { Channel, ChatMessage } from '@/lib/irc/types';
import {
  emptyFormationMemory,
  selectFormationStrip,
  type FormationChannel,
  type FormationStrip,
} from '@/lib/formation/formationLoop';
import {
  foldFormationMemory,
  readFormationMemory,
  subscribeFormationMemory,
  writeFormationMemory,
} from '@/lib/formation/formationMemory';
import { openSpotlight } from '@/chat/spotlight/useSpotlight';
import { openMessageSearch, openMessageSearchWithQuery } from '../search/useMessageSearch';
import { openRoomInviteShare } from '../roomInviteShareState';
import {
  firstHourCoachTip,
  firstHourHandoffEpoch,
  inviteFriendsHref,
  isFirstHourSeen,
  markFirstHourSeen,
  peekFirstHourHandoff,
  shouldShowFirstHourHomeWelcome,
} from '@/lib/firstHour/firstHour';
import { requestStartRoom } from '../startRoom';
import {
  composeHomeBriefing,
  homeBriefingEqual,
  selectHomeCatchUpSource,
  type HomeBriefing,
} from './homeBriefingModel';

export const HOME_RECAP_LIMIT = 3;
export const HOME_RECAP_VOICE_LIMIT = 2;
export const HOME_RHYTHM_LIMIT = 4;
export const HOME_BOOST_LIMIT = 4;
export const HOME_MEMORY_LIMIT = 4;

const HOME_SYSTEM_TYPES = new Set(['join', 'part', 'quit', 'kick', 'mode', 'topic', 'nick', 'system', 'error']);

export type HomeCatchUpRecap = {
  item: CatchUpItem;
  firstMessage: ChatMessage;
  voices: string[];
  overflowVoices: number;
  preview: string;
  messageCount: number;
  mentionCount: number;
};

export type HomeRhythmItem = {
  channel: string;
  topic: string;
  spark: number[];
  total: number;
  peak: number;
  activeUsers: number;
  lastActive: number;
  event: ScheduledEventItem | null;
};

export type HomeQueuedSend = {
  id: string;
  target: string;
  queued_at: number;
  wire_admitted?: true;
  claimed?: true;
};

export type HomeMoreActivityView = {
  hasContent: boolean;
  reviewHistory: readonly ReviewHistoryEntry[];
  reviewHistorySummary: string;
  stats: StatsIndex | null;
  totalMessages: number;
  roomRhythm: readonly HomeRhythmItem[];
  rememberedRooms: readonly HomeMemoryItem[];
  quietActivity: readonly QuietActivityItem[];
  quietBoosts: readonly QuietBoostDigestItem[];
  localHistory: boolean;
  connected: boolean;
};

export type HomeBriefingActions = {
  openBrowseRooms: () => void;
  openCreateRoom: () => void;
  openSearchMessages: () => void;
  startRoom: () => void;
  inviteFriends: () => void;
  dismissFirstHourTip: () => void;
  openAppearance: () => void;
  openShortcuts: () => void;
  openCatchUp: (item: CatchUpItem) => void;
  openInboxRow: (row: HomeInboxRow) => void;
  openInboxInvite: (invite: HomeInboxInvite) => void;
  resumeAt: (point: ResumePoint) => void;
  reviewCatchUpFromStart: (recap: HomeCatchUpRecap) => void;
  openCatchUpSpotlight: (item: CatchUpItem) => void;
  openEvent: (event: ScheduledEventItem) => void;
  openLiveCall: () => void;
  openOrJoinActiveRoom: (channel: string) => void;
  joinRecentRoom: (room: string) => void;
  openQueuedSend: (entry: HomeQueuedSend) => void;
  discardQueuedSend: (entry: HomeQueuedSend) => void;
  retryOutbox: () => void;
  reopenReview: (entry: ReviewHistoryEntry) => void;
  openReviewSpotlight: (entry: ReviewHistoryEntry) => void;
  searchReviewText: (entry: ReviewHistoryEntry) => void;
  openMemory: (item: HomeMemoryItem) => void;
  openColdMemory: (item: HomeMemoryItem) => void;
  openQuietActivity: (item: QuietActivityItem) => void;
  openQuietBoost: (item: QuietBoostDigestItem) => void;
  markAllCaughtUp: () => void;
  openInviteFriends: () => void;
  openFormationRoom: (channel: string) => void;
  reshareFormation: (channel: string) => void;
};

export type HomeController = {
  nowMs: () => number;
  welcomeName: () => string | null;
  connectionStatus: () => string;
  localMemoryStatus: () => string;
  briefing: () => HomeBriefing;
  outboxChrome: () => OutboxHomeChrome | null;
  queuedSends: () => readonly HomeQueuedSend[];
  confirmDiscardId: () => string | null;
  recaps: () => readonly HomeCatchUpRecap[];
  more: () => HomeMoreActivityView;
  showFirstRoomPrompt: () => boolean;
  showInviteFriends: () => boolean;
  showFirstHourWelcome: () => boolean;
  firstHourTip: () => ReturnType<typeof firstHourCoachTip>;
  formationStrip: () => FormationStrip | null;
  isJoined: (name: string) => boolean;
  joinedRooms: () => readonly string[];
  caughtUpPlan: () => CaughtUpPlan;
  actions: HomeBriefingActions;
};

function formationChannelsFromStore(
  rooms: Iterable<Channel>,
  readable: (message: ChatMessage) => boolean,
): FormationChannel[] {
  const observed: FormationChannel[] = [];
  for (const channel of rooms) {
    const chatters = new Set<string>();
    for (const message of channel.messages) {
      if (readable(message) && message.from.trim()) {
        chatters.add(message.from.trim().toLowerCase());
      }
    }
    observed.push({
      name: channel.name,
      createdAtMs: channel.createdAt?.getTime() ?? null,
      members: [...channel.users.values()].map((user) => ({
        nick: user.nick,
        modes: [...user.modes],
        hasChat: chatters.has(user.nick.toLowerCase()),
      })),
    });
  }
  return observed;
}

function isReadableHomeMessage(message: ChatMessage): boolean {
  const text = message.plaintext ?? message.text;
  return !HOME_SYSTEM_TYPES.has(message.type)
    && !message.deleted
    && !message.redacted
    && text.trim().length > 0;
}
function clipped(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function channelDraftCount(drafts: Record<string, string>): number {
  return Object.keys(drafts).filter((target) => target.startsWith('#') || target.startsWith('&')).length;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function spotlightQueryFor(item: CatchUpItem): string {
  return item.kind === 'channel' ? `goto ${item.target}` : `dm ${item.target}`;
}

function enableCatchUpReaderMode(): void {
  if (!preferences().readerMode) setPreference('readerMode', true);
}

export function createHomeController(): HomeController {
  const joinHistory = useStore((s) => s.joinHistory);
  const autoJoinChannels = useStore((s) => s.autoJoinChannels);
  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);
  const channelLastActivity = useStore((s) => s.channelLastActivity);
  const channelNotify = useStore((s) => s.channelNotify);
  const mutedDMs = useStore((s) => s.mutedDMs);
  const firstUnreadId = useStore((s) => s.firstUnreadId);
  const notifications = useStore((s) => s.notifications);
  const channelProps = useStore((s) => s.channelProps);
  const composerDrafts = useStore((s) => s.composerDrafts);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const outboxDeliveryFailed = useStore((s) => s.outboxDeliveryFailed);
  const ourNick = useStore((s) => s.ourNick);
  const pendingDeepLinkJoin = useStore((s) => s.pendingDeepLinkJoin);
  const serverUrl = useStore((s) => s.server?.url.trim() ?? '');
  const accountIdentity = useStore((s) =>
    (s.server?.account ?? s.ourNick).trim().toLowerCase(),
  );
  const memoryOwner = createMemo(() => {
    const owner = { serverUrl: serverUrl(), identity: accountIdentity() };
    return owner.serverUrl && owner.identity ? owner : null;
  });
  const currentOwnerKey = createMemo(() => {
    const owner = memoryOwner();
    return owner ? deviceMemoryOwnerKey(owner) : null;
  });

  const [stats] = createResource(fetchStatsIndex, { initialValue: null });
  const [reviewHistory, setReviewHistory] = createSignal<ReviewHistoryEntry[]>([]);
  createEffect(() => {
    const owner = memoryOwner();
    if (!owner) {
      setReviewHistory([]);
      return;
    }
    setReviewHistory(readReviewHistory(owner));
    onCleanup(subscribeReviewHistory((entries) => setReviewHistory([...entries]), owner));
  });
  const reviewHistorySummary = createMemo(() =>
    connectionStatus() === 'connected' ? 'catch-up ranges' : 'offline recall',
  );
  const [outboxEntries, { refetch: refetchOutbox }] = createResource(
    connectionStatus,
    () => loadOutbox(),
    { initialValue: [] as OutboxEntry[] },
  );
  const [confirmDiscardId, setConfirmDiscardId] = createSignal<string | null>(null);
  onCleanup(subscribeOutbox(() => {
    setConfirmDiscardId(null);
    void refetchOutbox();
  }));
  const [topicDrafts] = createResource(
    memoryOwner,
    (owner) => ({
      ownerKey: deviceMemoryOwnerKey(owner) ?? '',
      drafts: loadChannelTopicDrafts(undefined, owner),
    }),
    { initialValue: null },
  );
  const queuedEntries = createMemo<OutboxEntry[]>(() => {
    const owner = memoryOwner();
    if (!owner) return [];
    return (outboxEntries.latest ?? []).filter((entry) =>
      entry.owner?.serverUrl === owner.serverUrl && entry.owner.identity === owner.identity,
    );
  });
  const queuedSends = createMemo<HomeQueuedSend[]>(() =>
    queuedEntries().map((entry) => ({
      id: entry.id,
      target: entry.target,
      queued_at: entry.queued_at,
      wire_admitted: entry.wire_admitted,
      claimed: entry.claim ? true : undefined,
    })),
  );
  const queuedSendCount = createMemo(() => queuedEntries().length);
  const prunePendingCount = createMemo(() => queuedEntries().filter((entry) => entry.wire_admitted).length);
  const uncertainCount = createMemo(() => queuedEntries().filter((entry) => Boolean(entry.claim) && !entry.wire_admitted).length);
  const roomDraftCount = createMemo(() => channelDraftCount(composerDrafts()));
  const ownedTopicDrafts = createMemo(() => {
    const owner = memoryOwner();
    const ownerKey = owner ? deviceMemoryOwnerKey(owner) : null;
    return topicDrafts.latest?.ownerKey === ownerKey ? topicDrafts.latest.drafts : {};
  });
  const topicDraftCount = createMemo(() => Object.keys(ownedTopicDrafts()).length);
  const homeOutboxChrome = createMemo(() => outboxHomeChrome({
    connected: connectionStatus() === 'connected',
    queuedCount: queuedSendCount(),
    prunePendingCount: prunePendingCount(),
    uncertainCount: uncertainCount(),
    deliveryFailed: outboxDeliveryFailed(),
  }));
  const localMemoryStatus = createMemo(() => {
    const waiting = [
      queuedSendCount() > 0 ? countLabel(queuedSendCount(), 'queued send') : null,
      roomDraftCount() > 0 ? countLabel(roomDraftCount(), 'room draft') : null,
      topicDraftCount() > 0 ? countLabel(topicDraftCount(), 'topic draft') : null,
    ].filter(Boolean);
    if (waiting.length > 0) {
      return `On this device: ${waiting.join(', ')} waiting. Rooms and recent reviews stay available until you reconnect.`;
    }
    return 'On this device: remembered rooms, recent reviews, drafts, and queued sends stay available until you reconnect.';
  });

  const hasRooms = createMemo(() => channels().size > 0 || dms().size > 0);

  const [catchUpMemory, setCatchUpMemory] = createSignal<CatchUpMemoryItem[]>([]);
  createEffect(() => {
    const owner = memoryOwner();
    if (!owner || !preferences().localHistory) {
      setCatchUpMemory([]);
      return;
    }
    setCatchUpMemory(readCatchUpMemory(owner));
    onCleanup(subscribeCatchUpMemory((items) => setCatchUpMemory([...items]), owner));
  });

  const liveCatchUp = createMemo<CatchUpItem[]>(() => {
    const owner = memoryOwner();
    return buildCatchUp(channels().values(), dms().values(), channelLastActivity(), {
      followedKeys: owner ? followed(owner) : new Set<string>(),
      limit: 24,
      notifyLevels: channelNotify(),
      mutedDMs: mutedDMs(),
    });
  });
  const memoryCatchUp = createMemo<CatchUpItem[]>(() => {
    const levels = channelNotify();
    const muted = mutedDMs();
    return catchUpMemory()
      .map(catchUpItemFromMemory)
      .filter((item) => !isCatchUpHardSilenced(item.kind, item.target, levels, muted));
  });
  const hasLiveTranscript = createMemo(() => {
    for (const channel of channels().values()) {
      if (channel.messages.length > 0) return true;
    }
    for (const dm of dms().values()) {
      if (dm.messages.length > 0) return true;
    }
    return false;
  });
  const catchUpSource = createMemo(() => selectHomeCatchUpSource({
    connectionStatus: connectionStatus(),
    localHistory: preferences().localHistory,
    hasRooms: hasRooms(),
    hasLiveTranscript: hasLiveTranscript(),
    liveCatchUp: liveCatchUp(),
    memoryCatchUp: memoryCatchUp(),
  }));
  const catchUp = createMemo<CatchUpItem[]>(() => {
    const source = catchUpSource();
    return source.fromMemory ? source.items.slice() : liveCatchUp();
  });
  const catchUpFromMemory = createMemo(() => catchUpSource().fromMemory);

  const awayDigest = createMemo<AwayDigest>(
    () => buildAwayDigest(catchUp(), {
      notifyLevels: channelNotify(),
      mutedDMs: mutedDMs(),
      preset: calmPreset(),
    }),
    buildAwayDigest([], { notifyLevels: new Map(), mutedDMs: new Set(), preset: 'regular' }),
    { equals: awayDigestEqual },
  );

  const callState = useStore((s) => s.voice.callState);
  const callChannel = useStore((s) => s.voice.callChannel);
  const callWith = useStore((s) => s.voice.callWith);
  const liveCallPresent = createMemo(() => callState() !== 'idle');
  const liveCallLabel = createMemo(() => {
    const state = callState();
    const place = callChannel() || (callWith().trim() ? `@${callWith().trim()}` : 'call');
    if (state === 'in_call') return `In a call · ${place}`;
    if (state === 'ringing_in') return `Incoming call · ${place}`;
    if (state === 'ringing_out') return `Calling · ${place}`;
    return `Call · ${place}`;
  });

  const resumePoints = createMemo<ResumePoint[]>(() =>
    buildResumePoints(
      catchUp(),
      catchUpFromMemory() ? firstUnreadMapFromMemory(catchUpMemory()) : firstUnreadId(),
      -1,
    ),
  );

  const [nowMs, setNowMs] = createSignal(Date.now());
  const clock = setInterval(() => setNowMs(Date.now()), 30_000);
  onCleanup(() => clearInterval(clock));

  const scheduledEvents = createMemo<ScheduledEventItem[]>(
    () => collectScheduledEvents(channels().values(), channelProps(), nowMs(), 16),
    [],
    { equals: scheduledEventsListEqual },
  );
  const scheduledEventsByChannel = createMemo(() => {
    const byChannel = new Map<string, ScheduledEventItem>();
    for (const event of scheduledEvents()) byChannel.set(event.channel.toLowerCase(), event);
    return byChannel;
  });

  const recentRooms = createMemo(() =>
    joinHistory().filter((c) => !channels().has(c.toLowerCase())),
  );
  const memoryTargets = createMemo(() =>
    collectHomeMemoryTargets(joinHistory(), autoJoinChannels(), channels().keys(), 6),
  );
  const memorySource = createMemo(() => {
    const owner = memoryOwner();
    const targets = memoryTargets();
    return preferences().localHistory && owner && targets.length > 0
      ? { owner, targets }
      : null;
  });
  const [homeMemory] = createResource(memorySource, async (source) => {
    const items = await buildHomeMemory(
      source.targets,
      (target) => loadRecent(target, 24, source.owner),
      HOME_MEMORY_LIMIT,
    );
    return { ownerKey: deviceMemoryOwnerKey(source.owner) ?? '', items };
  }, { initialValue: null });
  const rememberedRooms = createMemo<HomeMemoryItem[]>(() => {
    const ownerKey = currentOwnerKey();
    return homeMemory.latest?.ownerKey === ownerKey ? homeMemory.latest.items : [];
  });
  const coldMemorySource = createMemo(() => {
    const owner = memoryOwner();
    const ownerKey = currentOwnerKey();
    return preferences().localHistory
      && connectionStatus() !== 'connected'
      && owner
      && ownerKey
      ? { owner, ownerKey }
      : null;
  });
  const [coldHomeMemory] = createResource(coldMemorySource, async (source) => ({
    ownerKey: source.ownerKey,
    items: buildHomeMemoryFromVault(
      (await exportVault(source.owner)).targets,
      HOME_MEMORY_LIMIT,
    ),
  }), { initialValue: null });
  const coldRememberedRooms = createMemo<HomeMemoryItem[]>(() => {
    const source = coldMemorySource();
    return source && coldHomeMemory.latest?.ownerKey === source.ownerKey
      ? coldHomeMemory.latest.items
      : [];
  });

  const quietActivity = createMemo<QuietActivityItem[]>(
    () => buildQuietActivity(channels().values(), channelLastActivity(), nowMs()),
    [],
    { equals: quietActivityListEqual },
  );
  const quietBoosts = createMemo<QuietBoostDigestItem[]>(() =>
    buildQuietBoostDigest(
      [
        ...Array.from(channels().values(), (channel) => ({
          target: channel.name,
          messages: channel.messages,
        })),
        ...Array.from(dms().values(), (dm) => ({
          target: dm.nick,
          messages: dm.messages,
        })),
      ],
      ourNick(),
      HOME_BOOST_LIMIT,
    ),
  );

  const catchUpRecaps = createMemo<HomeCatchUpRecap[]>(() => {
    if (catchUpFromMemory()) {
      return catchUpMemory()
        .filter((row) => row.firstMessageId && row.preview)
        .slice(0, HOME_RECAP_LIMIT)
        .map((row) => {
          const firstAt = row.firstAt ? new Date(row.firstAt) : new Date(row.lastActivity || 0);
          const firstMessage: ChatMessage = {
            id: row.firstMessageId!,
            time: Number.isFinite(firstAt.getTime()) ? firstAt : new Date(0),
            from: row.voices[0] ?? row.name,
            text: row.preview,
            type: 'msg',
            target: row.target,
          };
          return {
            item: catchUpItemFromMemory(row),
            firstMessage,
            voices: row.voices.slice(0, HOME_RECAP_VOICE_LIMIT),
            overflowVoices: Math.max(0, row.voices.length - HOME_RECAP_VOICE_LIMIT),
            preview: row.preview,
            messageCount: Math.max(row.messageCount, 1),
            mentionCount: row.mentionCount,
          } satisfies HomeCatchUpRecap;
        });
    }

    return catchUp()
      .map((item) => {
        const targetMessages =
          item.kind === 'channel'
            ? channels().get(item.target.toLowerCase())?.messages ?? []
            : dms().get(item.target.toLowerCase())?.messages ?? [];
        const readable = targetMessages.filter(isReadableHomeMessage);
        const unreadWindow = readable.slice(-Math.max(item.unread, item.highlights, 1));
        if (unreadWindow.length === 0) return null;

        const voices: string[] = [];
        const seenVoices = new Set<string>();
        for (const message of unreadWindow) {
          const key = message.from.toLowerCase();
          if (seenVoices.has(key)) continue;
          seenVoices.add(key);
          voices.push(message.from);
        }

        const latest = unreadWindow[unreadWindow.length - 1];
        if (!latest) return null;

        return {
          item,
          firstMessage: unreadWindow[0]!,
          voices: voices.slice(0, HOME_RECAP_VOICE_LIMIT),
          overflowVoices: Math.max(0, voices.length - HOME_RECAP_VOICE_LIMIT),
          preview: dmListPreviewText(latest) ?? clipped(latest.plaintext ?? latest.text, 92),
          messageCount: unreadWindow.length,
          mentionCount: Math.min(item.highlights, unreadWindow.filter((message) => message.highlight).length),
        } satisfies HomeCatchUpRecap;
      })
      .filter((recap): recap is HomeCatchUpRecap => recap !== null)
      .slice(0, HOME_RECAP_LIMIT);
  });

  createEffect(() => {
    const owner = memoryOwner();
    if (!owner || !preferences().localHistory || !hasRooms()) return;
    const live = liveCatchUp();
    if (live.length > 0) {
      const recaps = new Map<string, {
        preview: string;
        messageCount: number;
        mentionCount: number;
        firstMessageId: string | null;
        firstAt: string;
        voices: readonly string[];
      }>();
      for (const recap of catchUpRecaps()) {
        recaps.set(recap.item.target.toLowerCase(), {
          preview: recap.preview,
          messageCount: recap.messageCount,
          mentionCount: recap.mentionCount,
          firstMessageId: recap.firstMessage.id,
          firstAt: recap.firstMessage.time.toISOString(),
          voices: recap.voices,
        });
      }
      writeCatchUpMemory(
        buildCatchUpMemorySnapshot(live, {
          firstUnreadId: firstUnreadId(),
          recaps,
        }),
        owner,
      );
      return;
    }
    if (connectionStatus() === 'connected' && hasLiveTranscript()) {
      writeCatchUpMemory([], owner);
    }
  });

  const directoryAll = createMemo(() => {
    const data = stats.latest;
    if (!data || data.channels.length === 0) return [];
    return [...data.channels].sort((a, b) => b.messages - a.messages);
  });
  const totalMessages = createMemo(() =>
    (stats.latest?.channels ?? []).reduce((sum, c) => sum + c.messages, 0),
  );
  const isJoined = (name: string) => channels().has(name.toLowerCase());
  const joinedRooms = createMemo<readonly string[]>(() =>
    [...channels().values()]
      .map((channel) => channel.name)
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
      .slice(0, 12),
  );

  const roomRhythm = createMemo<HomeRhythmItem[]>(() => {
    const data = stats.latest;
    if (!data) return [];
    const joined = channels();
    const events = scheduledEventsByChannel();
    return data.channels
      .filter((channel) => joined.has(channel.channel.toLowerCase()) && channel.spark.some((value) => value > 0))
      .map((channel) => ({
        channel: channel.channel,
        topic: channel.topic,
        spark: channel.spark.slice(-14),
        total: channel.messages,
        peak: Math.max(1, ...channel.spark),
        activeUsers: channel.present,
        lastActive: channel.last_active,
        event: events.get(channel.channel.toLowerCase()) ?? null,
      }))
      .sort((a, b) =>
        Number(!!b.event?.live) - Number(!!a.event?.live) ||
        Number(!!b.event) - Number(!!a.event) ||
        b.activeUsers - a.activeUsers ||
        b.lastActive - a.lastActive ||
        a.channel.localeCompare(b.channel),
      )
      .slice(0, HOME_RHYTHM_LIMIT);
  });

  const briefing = createMemo<HomeBriefing>(
    () => composeHomeBriefing({
      nowMs: nowMs(),
      connectionStatus: connectionStatus(),
      localHistory: preferences().localHistory,
      currentOwnerKey: currentOwnerKey(),
      vaultOwnerKey: coldHomeMemory.latest?.ownerKey ?? currentOwnerKey(),
      hasRooms: hasRooms(),
      hasLiveTranscript: hasLiveTranscript(),
      liveCatchUp: liveCatchUp(),
      memoryCatchUp: memoryCatchUp(),
      awayDigest: awayDigest(),
      resumePoints: resumePoints(),
      scheduledEvents: scheduledEvents(),
      liveCall: liveCallPresent() ? { present: true, label: liveCallLabel() } : null,
      directory: directoryAll(),
      recentRooms: recentRooms(),
      coldVaultRooms: coldRememberedRooms(),
      firstUnreadId: catchUpFromMemory()
        ? firstUnreadMapFromMemory(catchUpMemory())
        : firstUnreadId(),
      invites: notifications()
        .map(parseInviteNotification)
        .filter((invite): invite is HomeInboxInvite => invite !== null),
    }),
    composeHomeBriefing({
      nowMs: Date.now(),
      connectionStatus: 'disconnected',
      localHistory: false,
      currentOwnerKey: null,
      vaultOwnerKey: null,
      hasRooms: false,
      hasLiveTranscript: false,
      liveCatchUp: [],
      memoryCatchUp: [],
      awayDigest: buildAwayDigest([], { notifyLevels: new Map(), mutedDMs: new Set(), preset: 'regular' }),
      resumePoints: [],
      scheduledEvents: [],
      liveCall: null,
      directory: [],
      recentRooms: [],
      coldVaultRooms: [],
      firstUnreadId: new Map(),
      invites: [],
    }),
    { equals: homeBriefingEqual },
  );

  const showFirstHourWelcome = createMemo(() =>
    shouldShowFirstHourHomeWelcome({
      connected: connectionStatus() === 'connected',
      hasRooms: hasRooms(),
      directoryCount: directoryAll().length,
      recentCount: recentRooms().length,
    }),
  );
  const showFirstRoomPrompt = createMemo(
    () =>
      connectionStatus() === 'connected'
      && !hasRooms()
      && directoryAll().length === 0
      && recentRooms().length === 0,
  );
  const showInviteFriends = createMemo(() =>
    connectionStatus() === 'connected'
    && (channels().size === 0 || dms().size === 0),
  );
  const inviteShareChannel = createMemo(() => {
    for (const room of channels().values()) return room.name;
    return '';
  });
  const firstHourTip = createMemo(() => {
    firstHourHandoffEpoch();
    isFirstHourSeen();
    return firstHourCoachTip('home');
  });
  const [formationMemory, setFormationMemory] = createSignal(emptyFormationMemory());
  createEffect(() => {
    const owner = memoryOwner();
    if (!owner) {
      setFormationMemory(emptyFormationMemory());
      return;
    }
    setFormationMemory(readFormationMemory(owner, nowMs()));
    onCleanup(subscribeFormationMemory((snapshot) => setFormationMemory(snapshot), owner));
  });
  const observedFormation = createMemo(() =>
    formationChannelsFromStore(channels().values(), isReadableHomeMessage),
  );
  createEffect(() => {
    const owner = memoryOwner();
    if (!owner || connectionStatus() !== 'connected') return;
    const next = foldFormationMemory({
      nowMs: nowMs(),
      ourNick: ourNick(),
      channels: observedFormation(),
      pendingJoin: pendingDeepLinkJoin(),
      locationSearch: typeof window === 'undefined' ? '' : window.location.search,
      memory: formationMemory(),
    });
    if (JSON.stringify(next) === JSON.stringify(formationMemory())) return;
    setFormationMemory(writeFormationMemory(next, owner, nowMs()));
  });
  const formationStrip = createMemo(() =>
    selectFormationStrip({
      nowMs: nowMs(),
      connected: connectionStatus() === 'connected',
      ourNick: ourNick(),
      channels: observedFormation(),
      pendingJoin: pendingDeepLinkJoin(),
      memory: formationMemory(),
    }),
  );
  const moreActivityHasContent = createMemo(() =>
    !!stats.latest
    || (connectionStatus() === 'connected' && roomRhythm().length > 0)
    || (preferences().localHistory && rememberedRooms().length > 0)
    || (connectionStatus() === 'connected' && quietActivity().length > 0)
    || (connectionStatus() === 'connected' && quietBoosts().length > 0)
    || reviewHistory().length > 0,
  );
  const more = createMemo<HomeMoreActivityView>(() => ({
    hasContent: moreActivityHasContent(),
    reviewHistory: reviewHistory(),
    reviewHistorySummary: reviewHistorySummary(),
    stats: stats.latest ?? null,
    totalMessages: totalMessages(),
    roomRhythm: roomRhythm(),
    rememberedRooms: rememberedRooms(),
    quietActivity: quietActivity(),
    quietBoosts: quietBoosts(),
    localHistory: preferences().localHistory,
    connected: connectionStatus() === 'connected',
  }));
  const welcomeName = createMemo(() => {
    const nick = ourNick().trim();
    return nick || null;
  });
  const emptyCaughtUpPlan: CaughtUpPlan = {
    targets: [],
    rooms: 0,
    unread: 0,
    mentions: 0,
  };
  const caughtUpPlan = createMemo<CaughtUpPlan>(() => {
    if (catchUpFromMemory()) return emptyCaughtUpPlan;
    return planCatchUpAll(channels().values(), dms().values());
  });

  const actions: HomeBriefingActions = {
    openBrowseRooms: () => {
      markFirstHourSeen();
      getState().openChannelBrowser();
    },
    openCreateRoom: () => {
      markFirstHourSeen();
      getState().openCreateRoom();
    },
    openSearchMessages: () => openMessageSearch(),
    startRoom: () => {
      markFirstHourSeen();
      requestStartRoom();
    },
    inviteFriends: () => {
      markFirstHourSeen();
      const handoff = peekFirstHourHandoff();
      const joined = [...getState().channels.values()][0]?.name ?? null;
      const href = inviteFriendsHref(handoff?.channel ?? joined);
      if (typeof window !== 'undefined') window.location.assign(href);
    },
    dismissFirstHourTip: () => {
      markFirstHourSeen();
    },
    openAppearance: () => getState().openAppearance(),
    openShortcuts: () => getState().openKeyboardShortcuts(),
    openCatchUp: (item) => {
      enableCatchUpReaderMode();
      if (catchUpFromMemory()) {
        const boundary = catchUpMemory().find(
          (row) => row.target.toLowerCase() === item.target.toLowerCase(),
        );
        const messageId = boundary?.firstUnreadId ?? boundary?.firstMessageId;
        if (messageId) {
          getState().openVaultResult(item.target, messageId);
          return;
        }
        if (item.kind === 'channel') void getState().joinChannel(item.target);
        else getState().navigate({ kind: 'dm', nick: item.target });
        return;
      }
      if (item.kind === 'channel') getState().navigate({ kind: 'channel', channel: item.target });
      else getState().navigate({ kind: 'dm', nick: item.target });
    },
    openInboxRow: (row) => {
      if (row.boundaryId) {
        actions.resumeAt({
          key: row.key,
          kind: row.kind,
          name: row.name,
          target: row.target,
          boundaryId: row.boundaryId,
          unread: row.unread,
          highlights: row.highlights,
          followed: row.followed,
          tier: row.highlights > 0 ? 'mention' : row.kind === 'dm' ? 'dm' : 'active',
          lastActivity: row.lastActivity,
        });
        return;
      }
      actions.openCatchUp(row);
    },
    openInboxInvite: (invite) => {
      getState().joinChannel(invite.channel);
    },
    resumeAt: (point) => {
      enableCatchUpReaderMode();
      const state = getState();
      if (catchUpFromMemory()) {
        state.openVaultResult(point.target, point.boundaryId);
        return;
      }
      if (point.kind === 'channel') state.navigate({ kind: 'channel', channel: point.target });
      else state.navigate({ kind: 'dm', nick: point.target });
      state.focusMessage(point.boundaryId);
    },
    reviewCatchUpFromStart: (recap) => {
      const state = getState();
      const owner = memoryOwner();
      if (!owner) return;
      enableCatchUpReaderMode();
      setReviewHistory(recordReviewHistory({
        target: recap.item.target,
        name: recap.item.name,
        kind: recap.item.kind,
        firstMessageId: recap.firstMessage.id,
        firstAt: recap.firstMessage.time.toISOString(),
        reviewedAt: new Date().toISOString(),
        messageCount: recap.messageCount,
        mentionCount: recap.mentionCount,
        preview: recap.preview,
      }, owner));
      actions.openCatchUp(recap.item);
      state.focusMessage(recap.firstMessage.id);
      if (recap.item.kind === 'channel') state.travelTo(recap.item.target, recap.firstMessage.time);
    },
    openCatchUpSpotlight: (item) => openSpotlight(spotlightQueryFor(item)),
    openEvent: (event) => {
      const state = getState();
      state.navigate({ kind: 'channel', channel: event.channel });
      state.travelTo(event.channel, new Date(event.at * 1000));
    },
    openLiveCall: () => {
      const channel = callChannel();
      const peer = callWith().trim();
      const state = getState();
      if (channel) {
        state.navigate({ kind: 'channel', channel });
        return;
      }
      if (peer) state.navigate({ kind: 'dm', nick: peer });
    },
    openOrJoinActiveRoom: (channel) => {
      const state = getState();
      const existing = state.channels.get(channel.toLowerCase());
      if (existing) {
        state.navigate({ kind: 'channel', channel: existing.name });
        return;
      }
      void state.joinChannel(channel);
    },
    joinRecentRoom: (room) => {
      void getState().joinChannel(room);
    },
    openQueuedSend: (entry) => {
      getState().openQueuedSend(entry.id);
    },
    discardQueuedSend: (entry) => {
      if (confirmDiscardId() !== entry.id) {
        setConfirmDiscardId(entry.id);
        return;
      }
      setConfirmDiscardId(null);
      getState().discardQueuedSend(entry.id);
    },
    retryOutbox: () => getState().flushOutbox(),
    reopenReview: (entry) => {
      const plan = planReviewedAnchorRecall(entry);
      if (!plan) return;
      enableCatchUpReaderMode();
      const state = getState();
      state.openVaultResult(plan.target, plan.messageId);
      if (plan.at) state.travelTo(plan.target, plan.at, plan.messageId);
    },
    openReviewSpotlight: (entry) => openSpotlight(`review ${entry.target}`),
    searchReviewText: (entry) => {
      const state = getState();
      if (entry.kind === 'channel') state.navigate({ kind: 'channel', channel: entry.target });
      else state.navigate({ kind: 'dm', nick: entry.target });
      openMessageSearchWithQuery(entry.preview);
    },
    openMemory: (item) => {
      void getState().joinChannel(item.target);
    },
    openColdMemory: (item) => {
      getState().openVaultResult(item.target, item.lastMessageId);
    },
    openQuietActivity: (item) => {
      getState().navigate({ kind: 'channel', channel: item.name });
    },
    openQuietBoost: (item) => {
      const state = getState();
      const isRoom = item.target.startsWith('#') || item.target.startsWith('&');
      if (isRoom) {
        state.navigate({ kind: 'channel', channel: item.target });
        state.travelTo(item.target, item.at);
      } else {
        state.navigate({ kind: 'dm', nick: item.target });
      }
      state.focusMessage(item.messageId);
    },
    markAllCaughtUp: () => {
      const state = getState();
      const current = planCatchUpAll(state.channels.values(), state.dms.values());
      if (current.rooms === 0) return;
      for (const target of current.targets) state.markRead(target.target);
    },
    openInviteFriends: () => openRoomInviteShare(inviteShareChannel()),
    openFormationRoom: (channel) => {
      getState().navigate({ kind: 'channel', channel });
    },
    reshareFormation: (channel) => {
      openRoomInviteShare(channel);
    },
  };

  return {
    nowMs,
    welcomeName,
    connectionStatus,
    localMemoryStatus,
    briefing,
    outboxChrome: homeOutboxChrome,
    queuedSends,
    confirmDiscardId,
    recaps: catchUpRecaps,
    more,
    showFirstRoomPrompt,
    showInviteFriends,
    showFirstHourWelcome,
    firstHourTip,
    formationStrip,
    isJoined,
    joinedRooms,
    caughtUpPlan,
    actions,
  };
}
