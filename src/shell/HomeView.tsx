// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HomeView — the connected-but-idle surface (no active channel).
 *
 * Commercial public default answers one question: "what needs me, and where
 * do I continue?" Hierarchy (reading flow, not admin dashboard):
 *   1. Calm welcome + Search / Browse rooms
 *   2. Conditional connection + outbox strip
 *   3. Needs you — failed delivery context, unread DMs, direct mentions
 *   4. Continue — exact first-unread resume + followed activity
 *   5. Live now — real scheduled / live / call state only (never invented;
 *      never auto-join media)
 *   6. Explore — directory + recent rooms
 *   7. Caught-up empty state when nothing needs attention
 * Technical/power surfaces (pulse, room rhythm, quiet activity/boosts,
 * review history, remembered rooms) live in a collapsed "More activity"
 * disclosure — capability preserved, not primary.
 *
 * Strata (A9): data-home-stratum markers remain (attention / followed / quiet /
 * resume / memory). Visual weight lives in home-view.css via
 * home-catchup-tier--* and home-current-rail.
 *
 * Cold / vault-first paint: catch-up + resume prefer live store buffers and
 * stay visible while reconnecting (not only when `connected`) — unreads already
 * on-device are local truth. When the live map is empty (true cold return before
 * JOINs land), Home paints the last ranked catch-up snapshot
 * (`catchUpMemory`) and enriches recaps from the vault. Before the network is
 * connected, an owner-scoped vault enumeration (`exportVault`) also paints
 * "Catch up from this device" cards that open exact retained rows — never
 * inventing unreads/membership the live server alone can establish.
 *
 * Reader handoff (A13): catch-up review paths (open / review-from-start /
 * resume-at-unread / reopen-reviewed) enable readerMode so the Time-Native
 * venue is the default reading experience. Mirrors Connect deep-link
 * `?reader=1` via setPreference — sticky until the user toggles off.
 *
 * SOLID IDIOMS: components run once; never destructure props; useStore for
 * reactive reads; getState() only in handlers; createMemo for derived lists;
 * For/Show for lists/conditionals; onCleanup for the shared clock.
 */
import './home-view.css';
import {
  createMemo,
  createResource,
  createSignal,
  createEffect,
  For,
  onCleanup,
  Show,
  type JSX,
} from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { buildCatchUp, catchUpSummary, type CatchUpItem } from '@/lib/notifications/catchUp';
import { buildAwayDigest, type AwayDigest } from '@/lib/notifications/awayDigest';
import { calmPreset } from '@/lib/notifications/calmMode';
import { buildResumePoints, type ResumePoint } from '@/lib/catchup/resumePoints';
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
  eventCountdown,
  type ScheduledEventItem,
} from '@/lib/notifications/scheduledEvents';
import {
  scheduledEventsListEqual,
  quietActivityListEqual,
  awayDigestEqual,
} from '@/lib/notifications/digestStability';
import { preferences, setPreference } from '@/lib/prefs/preferences';
import { buildQuietBoostDigest, type QuietBoostDigestItem } from '@/lib/reactions/quietBoosts';
import { fetchStatsIndex, relTime } from '@/lib/stats/networkIndex';
import { loadChannelTopicDrafts } from '@/lib/channel/topicDrafts';
import {
  loadOutbox,
  loadRecent,
  exportVault,
  subscribeOutbox,
  deviceMemoryOwnerKey,
  type OutboxEntry,
} from '@/lib/vault/historyVault';
import {
  outboxEntryStatusLabel,
  outboxHomeChrome,
} from '@/lib/vault/outboxStatus';
import type { ChatMessage } from '@/lib/irc/types';
import { openSpotlight } from '@/chat/spotlight/useSpotlight';
import { openMessageSearch, openMessageSearchWithQuery } from './search/useMessageSearch';
import { MarkAllCaughtUp } from './MarkAllCaughtUp';

export { relTime };

const HOME_RECAP_LIMIT = 3;
const HOME_RECAP_VOICE_LIMIT = 2;
const HOME_SYSTEM_TYPES = new Set(['join', 'part', 'quit', 'kick', 'mode', 'topic', 'nick', 'system', 'error']);
const HOME_RHYTHM_LIMIT = 4;
const HOME_BOOST_LIMIT = 4;
/** Cap on owner-scoped vault enumeration cards during cold return. */
const HOME_MEMORY_LIMIT = 4;

type HomeCatchUpRecap = {
  item: CatchUpItem;
  firstMessage: ChatMessage;
  voices: string[];
  overflowVoices: number;
  preview: string;
  messageCount: number;
  mentionCount: number;
};

type HomeRhythmItem = {
  channel: string;
  topic: string;
  spark: number[];
  total: number;
  peak: number;
  activeUsers: number;
  lastActive: number;
  event: ScheduledEventItem | null;
};

function Sparkline(props: { values: number[] }): JSX.Element {
  const points = createMemo(() => {
    const vals = props.values;
    if (vals.length < 2) return null;
    const w = 240;
    const h = 32;
    const pad = 3;
    const max = Math.max(...vals, 1);
    const step = (w - pad * 2) / (vals.length - 1);
    const xy = vals.map(
      (v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)] as const,
    );
    return {
      line: xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '),
      area:
        `${pad},${h - pad} ` +
        xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
        ` ${(pad + (vals.length - 1) * step).toFixed(1)},${h - pad}`,
    };
  });
  return (
    <Show when={points()}>
      {(p) => (
        <svg class="home-spark" viewBox="0 0 240 32" preserveAspectRatio="none" aria-hidden="true">
          <polygon class="home-spark-fill" points={p().area} />
          <polyline class="home-spark-line" points={p().line} />
        </svg>
      )}
    </Show>
  );
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

function voiceSummary(recap: HomeCatchUpRecap): string {
  if (recap.voices.length === 0) return 'room activity';
  const names = recap.voices.join(', ');
  return recap.overflowVoices > 0 ? `${names} +${recap.overflowVoices}` : names;
}

function recapSummary(recap: HomeCatchUpRecap): string {
  return reviewCountSummary(recap.messageCount, recap.mentionCount);
}

function reviewCountSummary(messageCount: number, mentionCount: number): string {
  const lineLabel = messageCount === 1 ? 'line' : 'lines';
  const mentionLabel = mentionCount === 1 ? 'mention' : 'mentions';
  const mentionPart = mentionCount > 0 ? `, ${mentionCount} ${mentionLabel}` : '';
  return `${messageCount} ${lineLabel}${mentionPart}`;
}

function spotlightQueryFor(item: CatchUpItem): string {
  return item.kind === 'channel' ? `goto ${item.target}` : `dm ${item.target}`;
}

function trendLabel(item: HomeRhythmItem): string {
  if (item.activeUsers > 0) {
    return `${item.activeUsers} chatting`;
  }
  return `${item.total.toLocaleString()} tracked`;
}

function channelDraftCount(drafts: Record<string, string>): number {
  return Object.keys(drafts).filter((target) => target.startsWith('#') || target.startsWith('&')).length;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Enable reader mode for Home catch-up → transcript handoffs (A13).
 *
 * Product choice: sticky via setPreference (same as Connect `?reader=1`), not
 * a one-shot session flag — preferences have no session-only channel, and the
 * reading persona should stay on until the user toggles it off. No-op when
 * already enabled so we don't thrash localStorage.
 */
function enableCatchUpReaderMode(): void {
  if (!preferences().readerMode) setPreference('readerMode', true);
}

export function HomeView(): JSX.Element {
  const joinHistory = useStore((s) => s.joinHistory);
  const autoJoinChannels = useStore((s) => s.autoJoinChannels);
  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);
  const channelLastActivity = useStore((s) => s.channelLastActivity);
  const channelNotify = useStore((s) => s.channelNotify);
  const firstUnreadId = useStore((s) => s.firstUnreadId);
  const channelProps = useStore((s) => s.channelProps);
  const composerDrafts = useStore((s) => s.composerDrafts);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const outboxDeliveryFailed = useStore((s) => s.outboxDeliveryFailed);
  const networkName = useStore((s) => s.networkName);
  const ourNick = useStore((s) => s.ourNick);
  const serverUrl = useStore((s) => s.server?.url.trim() ?? '');
  const accountIdentity = useStore((s) =>
    (s.server?.account ?? s.ourNick).trim().toLowerCase(),
  );
  const memoryOwner = createMemo(() => {
    const owner = { serverUrl: serverUrl(), identity: accountIdentity() };
    return owner.serverUrl && owner.identity ? owner : null;
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
  const queuedSendCount = createMemo(() => queuedEntries().length);
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

  function openQueuedSend(entry: OutboxEntry): void {
    getState().openQueuedSend(entry.id);
  }

  function discardQueuedSend(entry: OutboxEntry): void {
    if (confirmDiscardId() !== entry.id) {
      setConfirmDiscardId(entry.id);
      return;
    }
    setConfirmDiscardId(null);
    getState().discardQueuedSend(entry.id);
  }

  const hasRooms = createMemo(() => channels().size > 0 || dms().size > 0);

  // Cold-return catch-up snapshot (owner-scoped device memory). Loaded whenever
  // the active identity is known so Home can paint before JOINs repopulate the
  // live channel/DM maps.
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

  // Live catch-up from joined buffers. Empty on true cold return until rooms
  // rejoin — then the durable snapshot below takes over.
  const liveCatchUp = createMemo<CatchUpItem[]>(() => {
    const owner = memoryOwner();
    return buildCatchUp(channels().values(), dms().values(), channelLastActivity(), {
      followedKeys: owner ? followed(owner) : new Set<string>(),
    });
  });
  // Whether any live buffer holds transcript (set below with catch-up source).
  // Declared early via a thin memo so the cold/live handoff can prefer the
  // durable snapshot until hydrate has real messages — not just empty shells.
  const hasLiveTranscript = createMemo(() => {
    for (const channel of channels().values()) {
      if (channel.messages.length > 0) return true;
    }
    for (const dm of dms().values()) {
      if (dm.messages.length > 0) return true;
    }
    return false;
  });

  // Prefer live unreads when they exist. Fall back to the durable snapshot when
  // the live map is empty OR only empty post-JOIN shells (no transcript yet),
  // so cold return never flashes "all caught up" before hydrate lands. Once
  // connected with real transcript and zero live unreads, live wins (caught up).
  const catchUpFromMemory = createMemo(() => {
    if (!preferences().localHistory || catchUpMemory().length === 0) return false;
    if (liveCatchUp().length > 0) return false;
    if (
      hasRooms()
      && connectionStatus() === 'connected'
      && hasLiveTranscript()
    ) {
      return false;
    }
    return true;
  });
  const catchUp = createMemo<CatchUpItem[]>(() => {
    if (!catchUpFromMemory()) return liveCatchUp();
    return catchUpMemory().map(catchUpItemFromMemory);
  });
  const catchUpTotals = createMemo(() => catchUpSummary(catchUp()));
  // Tiered "since you were away" digest: mentions/DMs first, followed channels
  // next, ambient chatter collapsed into a quiet tail — honouring the calm
  // preset (followed never escalates under calm; power pulls it up top) and
  // per-channel mute (muted-room highlights stay in Needs you; only ambient
  // muted unread is quiet). Value equality keeps the tiers stable across a
  // no-op 30s clock tick.
  const awayDigest = createMemo<AwayDigest>(
    () => buildAwayDigest(catchUp(), { notifyLevels: channelNotify(), preset: calmPreset() }),
    buildAwayDigest([], { notifyLevels: new Map(), preset: 'regular' }),
    { equals: awayDigestEqual },
  );
  const showCatchUp = createMemo(
    () => hasRooms() || catchUpFromMemory(),
  );
  const catchUpSourceLabel = createMemo(() =>
    catchUpFromMemory()
      ? 'saved on this device'
      : connectionStatus() === 'connected'
        ? 'live'
        : 'on this device',
  );

  const callState = useStore((s) => s.voice.callState);
  const callChannel = useStore((s) => s.voice.callChannel);
  const callWith = useStore((s) => s.voice.callWith);
  /** Truthful live call surface only — never invent occupancy; never join. */
  const liveCallPresent = createMemo(() => callState() !== 'idle');
  const openLiveCallRoom = () => {
    const channel = callChannel();
    const peer = callWith().trim();
    const state = getState();
    // Navigate only — never joinVoiceChannel / accept from Home.
    if (channel) {
      state.navigate({ kind: 'channel', channel });
      return;
    }
    if (peer) state.navigate({ kind: 'dm', nick: peer });
  };
  const liveCallLabel = createMemo(() => {
    const state = callState();
    const place = callChannel() || (callWith().trim() ? `@${callWith().trim()}` : 'call');
    if (state === 'in_call') return `In a call · ${place}`;
    if (state === 'ringing_in') return `Incoming call · ${place}`;
    if (state === 'ringing_out') return `Calling · ${place}`;
    return `Call · ${place}`;
  });

  // "Resume where you left off" — the ranked catch-up items that have an
  // authoritative first-unread boundary, so one tap lands you at the exact
  // message you last read up to (the store's firstUnreadId, same cursor as the
  // UnreadDivider), not the start of a heuristic window. Cold paint reconstructs
  // the boundary map from the durable snapshot when live rooms are empty.
  const resumePoints = createMemo<ResumePoint[]>(() =>
    buildResumePoints(
      catchUp(),
      catchUpFromMemory() ? firstUnreadMapFromMemory(catchUpMemory()) : firstUnreadId(),
    ),
  );
  const resumeAt = (point: ResumePoint) => {
    // Resume at first-unread is a "read since you left" handoff → reader (A13).
    enableCatchUpReaderMode();
    const state = getState();
    if (catchUpFromMemory()) {
      // Cold: open the vault-backed shell (JOIN when connected) and land on id.
      state.openVaultResult(point.target, point.boundaryId);
      return;
    }
    if (point.kind === 'channel') state.navigate({ kind: 'channel', channel: point.target });
    else state.navigate({ kind: 'dm', nick: point.target });
    state.focusMessage(point.boundaryId);
  };
  const openCatchUp = (item: CatchUpItem) => {
    // Catch-up open (tier row or recap) is a since-you-left handoff → reader (A13).
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
  };
  const openCatchUpSpotlight = (item: CatchUpItem) => openSpotlight(spotlightQueryFor(item));
  // One row of the tiered away digest — reused across every tier so the markup
  // (and its a11y label) stays identical whether a room is a mention, followed,
  // or ambient. Dispatches through the existing navigate action via openCatchUp.
  const CatchUpRow = (props: { item: CatchUpItem }) => (
    <li>
      <button
        type="button"
        class={`home-catchup-item${props.item.highlights > 0 || props.item.kind === 'dm' ? ' is-priority' : ''}${props.item.followed ? ' is-followed' : ''}`}
        onClick={() => openCatchUp(props.item)}
        aria-label={`Open ${props.item.name}, ${props.item.unread} unread${props.item.highlights > 0 ? `, ${props.item.highlights} mention${props.item.highlights === 1 ? '' : 's'}` : ''}${props.item.followed ? ', followed' : ''}`}
      >
        <span class="home-catchup-name">
          <span class="home-catchup-kind" aria-hidden="true">
            {props.item.kind === 'dm' ? '@' : '#'}
          </span>
          {props.item.kind === 'dm' ? props.item.name : props.item.name.replace(/^#/, '')}
        </span>
        <span class="home-catchup-meta">
          <Show when={props.item.highlights > 0}>
            <span class="home-catchup-mention">{props.item.highlights} @you</span>
          </Show>
          <Show when={props.item.followed}>
            <span class="home-catchup-followed">followed</span>
          </Show>
          <span class="home-catchup-unread">{props.item.unread}</span>
          <Show when={props.item.lastActivity > 0}>
            <span class="home-catchup-when">
              {relTime(Math.floor(props.item.lastActivity / 1000), nowMs())}
            </span>
          </Show>
        </span>
      </button>
    </li>
  );
  const reviewCatchUpFromStart = (recap: HomeCatchUpRecap) => {
    const state = getState();
    const owner = memoryOwner();
    if (!owner) return;
    // Review-from-start is the canonical "read since you left" path → reader (A13).
    // openCatchUp also enables; explicit call keeps intent clear if that path changes.
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
    openCatchUp(recap.item);
    state.focusMessage(recap.firstMessage.id);
    if (recap.item.kind === 'channel') state.travelTo(recap.item.target, recap.firstMessage.time);
  };
  const reopenReview = (entry: ReviewHistoryEntry) => {
    const plan = planReviewedAnchorRecall(entry);
    if (!plan) return;
    // Reopening a reviewed catch-up span is still a reading handoff → reader (A13).
    enableCatchUpReaderMode();
    const state = getState();
    state.openVaultResult(plan.target, plan.messageId);
    if (plan.at) state.travelTo(plan.target, plan.at, plan.messageId);
  };
  const openReviewSpotlight = (entry: ReviewHistoryEntry) =>
    openSpotlight(`review ${entry.target}`);
  const searchReviewText = (entry: ReviewHistoryEntry) => {
    const state = getState();
    if (entry.kind === 'channel') state.navigate({ kind: 'channel', channel: entry.target });
    else state.navigate({ kind: 'dm', nick: entry.target });
    openMessageSearchWithQuery(entry.preview);
  };

  // One shared clock for all relative-time labels.
  const [nowMs, setNowMs] = createSignal(Date.now());
  const clock = setInterval(() => setNowMs(Date.now()), 30_000);
  onCleanup(() => clearInterval(clock));

  // The shared 30s clock is a dependency here only for the visibility/live
  // windows; value-equality keeps the previous array (and the whole
  // scheduledEventsByChannel → roomRhythm cascade + the Scheduled `<For>`)
  // stable on a tick that changes nothing. Countdown chips still advance
  // because they read `nowMs()` inline in JSX.
  const scheduledEvents = createMemo<ScheduledEventItem[]>(
    () => collectScheduledEvents(channels().values(), channelProps(), nowMs()),
    [],
    { equals: scheduledEventsListEqual },
  );
  const scheduledEventsByChannel = createMemo(() => {
    const byChannel = new Map<string, ScheduledEventItem>();
    for (const event of scheduledEvents()) byChannel.set(event.channel.toLowerCase(), event);
    return byChannel;
  });
  const openEvent = (event: ScheduledEventItem) => {
    const state = getState();
    state.navigate({ kind: 'channel', channel: event.channel });
    state.travelTo(event.channel, new Date(event.at * 1000));
  };
  const eventWhenLabel = (event: ScheduledEventItem) =>
    new Date(event.at * 1000).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  // Recently-visited rooms the user has since left — Recent rooms strip.
  const recentRooms = createMemo(() =>
    joinHistory().filter((c) => !channels().has(c.toLowerCase())).slice(0, 6),
  );
  // Vault-backed Device memory targets: left rooms + auto-join not yet live.
  // Cap 6 so cold Home never opens more than a handful of loadRecent cursors.
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
    const owner = memoryOwner();
    const currentOwnerKey = owner ? deviceMemoryOwnerKey(owner) : null;
    return homeMemory.latest?.ownerKey === currentOwnerKey ? homeMemory.latest.items : [];
  });
  // Before the live room map exists (and while not fully connected), enumerate
  // literal rows retained for the current owner. Device evidence only — never
  // server unread/membership. Owner-keyed so a late reply from a prior identity
  // cannot paint after the account switches.
  const coldMemorySource = createMemo(() => {
    const owner = memoryOwner();
    const ownerKey = owner ? deviceMemoryOwnerKey(owner) : null;
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
  const coldRememberedCount = createMemo(() =>
    coldRememberedRooms().reduce((total, item) => total + item.count, 0),
  );
  const openMemory = (item: HomeMemoryItem) => void getState().joinChannel(item.target);
  const openColdMemory = (item: HomeMemoryItem) =>
    getState().openVaultResult(item.target, item.lastMessageId);
  const quietActivity = createMemo<QuietActivityItem[]>(
    () => buildQuietActivity(channels().values(), channelLastActivity(), nowMs()),
    [],
    { equals: quietActivityListEqual },
  );
  const openQuietActivity = (item: QuietActivityItem) =>
    getState().navigate({ kind: 'channel', channel: item.name });
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
  const openQuietBoost = (item: QuietBoostDigestItem) => {
    const state = getState();
    // Channels may use # or & (and other CHANTYPES); only bare nicks are DMs.
    const isRoom = item.target.startsWith('#') || item.target.startsWith('&');
    if (isRoom) {
      state.navigate({ kind: 'channel', channel: item.target });
      state.travelTo(item.target, item.at);
    } else {
      state.navigate({ kind: 'dm', nick: item.target });
    }
    state.focusMessage(item.messageId);
  };
  const catchUpRecaps = createMemo<HomeCatchUpRecap[]>(() => {
    // Cold path: recap seeds were snapshotted with the ranked list so Home can
    // paint previews without waiting on live buffers or a second IDB pass.
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
          preview: clipped(latest.plaintext ?? latest.text, 92),
          messageCount: unreadWindow.length,
          mentionCount: Math.min(item.highlights, unreadWindow.filter((message) => message.highlight).length),
        } satisfies HomeCatchUpRecap;
      })
      .filter((recap): recap is HomeCatchUpRecap => recap !== null)
      .slice(0, HOME_RECAP_LIMIT);
  });

  // Persist the ranked catch-up snapshot when live unreads exist. Clear only
  // once we are connected with real transcript and a zero live catch-up — that
  // is the "you're caught up" truth, not a cold empty map.
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
      // Snapshot seeds come from live buffers only (memory path is skipped when
      // liveCatchUp is non-empty, so catchUpRecaps here is the live branch).
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

  const directory = createMemo(() => {
    const data = stats.latest;
    if (!data || data.channels.length === 0) return [];
    return [...data.channels]
      .sort((a, b) => b.messages - a.messages)
      .slice(0, 9);
  });
  const totalMessages = createMemo(() =>
    (stats.latest?.channels ?? []).reduce((sum, c) => sum + c.messages, 0),
  );
  const totalChatting = createMemo(() =>
    (stats.latest?.channels ?? []).reduce((sum, c) => sum + c.active_users, 0),
  );
  const isJoined = (name: string) => channels().has(name.toLowerCase());
  /**
   * Active-rooms directory card: open an already-joined room without re-JOIN,
   * otherwise preserve join-only behavior (JOIN does not invent a local view).
   * Reads getState() at click time so join/open is not a stale render snapshot.
   */
  const openOrJoinActiveRoom = (channel: string) => {
    const state = getState();
    const existing = state.channels.get(channel.toLowerCase());
    if (existing) {
      state.navigate({ kind: 'channel', channel: existing.name });
      return;
    }
    void state.joinChannel(channel);
  };
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
        activeUsers: channel.active_users,
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

  const liveNowVisible = createMemo(
    () =>
      (connectionStatus() === 'connected' && scheduledEvents().length > 0)
      || liveCallPresent(),
  );
  const showCaughtUpEmpty = createMemo(
    () =>
      showCatchUp()
      && awayDigest().empty
      && resumePoints().length === 0
      && !liveNowVisible()
      && coldRememberedRooms().length === 0
      && awayDigest().followed.length === 0,
  );
  const moreActivityHasContent = createMemo(() =>
    !!stats.latest
    || (connectionStatus() === 'connected' && roomRhythm().length > 0)
    || (preferences().localHistory && rememberedRooms().length > 0)
    || (connectionStatus() === 'connected' && quietActivity().length > 0)
    || (connectionStatus() === 'connected' && quietBoosts().length > 0)
    || reviewHistory().length > 0,
  );
  const continueVisible = createMemo(
    () => resumePoints().length > 0 || awayDigest().followed.length > 0,
  );
  const welcomeName = createMemo(() => {
    const nick = ourNick().trim();
    return nick || null;
  });

  return (
    <div class="home" role="main" aria-label="Network home">
      <div class="home-inner">
        {/* 1 — Calm personal welcome + Search / Browse */}
        <header class="home-masthead">
          <p class="home-kicker">{networkName() || 'Onyx'}</p>
          <h2 class="home-title">
            {welcomeName() ? `Welcome, ${welcomeName()}.` : 'Welcome.'}
          </h2>
          <p class="home-sub">
            What needs you, and where to continue. Search messages or browse rooms —
            press <b>/</b> for the palette, <b>?</b> for shortcuts.
          </p>
          <div class="home-welcome-actions" role="group" aria-label="Primary home actions">
            <button
              type="button"
              class="home-cta"
              onClick={() => getState().openChannelBrowser()}
            >
              Browse rooms
            </button>
            <button type="button" class="home-action home-action--primary" onClick={openMessageSearch}>
              Search messages
            </button>
          </div>
          <Show when={connectionStatus() !== 'connected'}>
            <p class="home-offline-note" role="status">
              {localMemoryStatus()}
            </p>
          </Show>
        </header>

        {/* 2 — Conditional connection / outbox strip */}
        <Show when={homeOutboxChrome()}>
          {(chrome) => (
            <section
              class={`home-outbox home-outbox--${chrome().tone}`}
              aria-labelledby="home-outbox-title"
              data-home-stratum="outbox"
            >
              <div class="home-outbox__head">
                <div>
                  <h3 id="home-outbox-title" class="home-section-label">{chrome().title}</h3>
                  <p class="home-outbox__detail" role="status">{chrome().detail}</p>
                  <p class="home-outbox__privacy">
                    Message bodies stay inside their conversations; Home shows only destination and age.
                  </p>
                </div>
                <Show when={chrome().showRetry}>
                  <button type="button" class="home-outbox__retry" onClick={() => getState().flushOutbox()}>
                    Try sending now
                  </button>
                </Show>
              </div>
              <ul class="home-outbox__list" aria-label="Queued messages waiting on this device">
                <For each={queuedEntries()}>
                  {(entry) => {
                    const status = () => outboxEntryStatusLabel(entry.queued_at, nowMs());
                    return (
                      <li
                        class="home-outbox__item"
                        classList={{
                          'home-outbox__item--expiring': status().includes('expires soon'),
                          'home-outbox__item--expired': status().startsWith('expired'),
                        }}
                      >
                        <span class="home-outbox__target">{entry.target}</span>
                        <time class="home-outbox__age" dateTime={new Date(entry.queued_at).toISOString()}>
                          {status()} · {relTime(Math.floor(entry.queued_at / 1000), nowMs())}
                        </time>
                        <div class="home-outbox__actions">
                          <button
                            type="button"
                            onClick={() => openQueuedSend(entry)}
                            aria-label={`Open queued message for ${entry.target}`}
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            classList={{ 'is-confirming': confirmDiscardId() === entry.id }}
                            onClick={() => discardQueuedSend(entry)}
                            aria-label={confirmDiscardId() === entry.id
                              ? `Confirm remove queued message for ${entry.target}`
                              : `Remove queued message for ${entry.target}`}
                          >
                            {confirmDiscardId() === entry.id ? 'Confirm remove' : 'Remove'}
                          </button>
                        </div>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </section>
          )}
        </Show>

        {/* Owner-scoped vault enumeration while offline/connecting — literal
            retained rows, not invented unreads. Retires once connected. */}
        <Show when={coldRememberedRooms().length > 0}>
          <section class="home-catchup home-catchup--cold" aria-label="Device-local catch-up">
            <div class="home-catchup-head">
              <h3 class="home-section-label">Catch up from this device</h3>
              <span class="home-catchup-summary">
                {coldRememberedCount()} remembered{' '}
                {coldRememberedCount() === 1 ? 'message' : 'messages'}
              </span>
            </div>
            <div class="home-memory-grid">
              <For each={coldRememberedRooms()}>
                {(item) => (
                  <button
                    type="button"
                    class="home-memory-card"
                    onClick={() => openColdMemory(item)}
                    aria-label={`Open ${item.target} from this device, ${item.count} remembered ${item.count === 1 ? 'message' : 'messages'}`}
                  >
                    <span class="home-memory-card-head">
                      <span class="home-memory-room">{item.target}</span>
                      <span class="home-memory-when">
                        {relTime(Math.floor(item.lastAt.getTime() / 1000), nowMs())}
                      </span>
                    </span>
                    <span class="home-memory-preview">
                      <b>{item.lastFrom}</b>: {item.preview}
                    </span>
                    <span class="home-memory-foot">
                      <span>
                        {item.count} remembered {item.count === 1 ? 'message' : 'messages'}
                      </span>
                      <span>
                        {item.participants.length}{' '}
                        {item.participants.length === 1 ? 'person' : 'people'}
                      </span>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </section>
        </Show>

        {/* Thesis rail: Needs you → Continue (sparse cyan current line) */}
        <div
          class="home-current-rail"
          classList={{
            'home-current-rail--active':
              (!awayDigest().empty && awayDigest().attention.length > 0) || continueVisible(),
          }}
        >
          {/* 3 — Needs you: DMs + direct mentions (+ catch-up summary shell).
              When fully caught up, the dedicated empty band owns the calm copy. */}
          <Show when={showCatchUp() && !showCaughtUpEmpty()}>
            <section
              class="home-catchup home-catchup--needs"
              data-catchup-source={catchUpFromMemory() ? 'memory' : 'live'}
              data-home-band="needs-you"
              aria-label="Catch up on what you missed"
            >
              <div class="home-catchup-head">
                <h3 class="home-section-label">Needs you</h3>
                <Show
                  when={!awayDigest().empty}
                  fallback={<span class="home-catchup-clear">You're all caught up</span>}
                >
                  <span class="home-catchup-summary">
                    {catchUpTotals().unread} unread
                    <Show when={catchUpTotals().mentions > 0}>
                      {' · '}
                      <b>
                        {catchUpTotals().mentions} mention{catchUpTotals().mentions === 1 ? '' : 's'}
                      </b>
                    </Show>
                    <Show when={catchUpTotals().followed > 0}>
                      {' · '}
                      {catchUpTotals().followed} followed
                    </Show>
                    {' · '}
                    <span class="home-catchup-source">{catchUpSourceLabel()}</span>
                  </span>
                </Show>
              </div>
              <Show when={!awayDigest().empty}>
                <Show when={!catchUpFromMemory()}>
                  <MarkAllCaughtUp />
                </Show>
                <Show when={awayDigest().attention.length > 0}>
                  <div
                    class="home-catchup-tier home-catchup-tier--attention"
                    data-home-stratum="attention"
                    role="group"
                    aria-label="Mentions and direct messages"
                  >
                    {/* Section already reads "Needs you" once — no duplicate tier label. */}
                    <ul class="home-catchup-list">
                      <For each={awayDigest().attention}>
                        {(item) => <CatchUpRow item={item} />}
                      </For>
                    </ul>
                  </div>
                </Show>
                {/* Ambient catch-up stays collapsed here (A9); power analytics go to More. */}
                <Show when={awayDigest().quiet.length > 0}>
                  <details
                    class="home-catchup-quiet home-catchup-tier--quiet"
                    data-home-stratum="quiet"
                  >
                    <summary class="home-catchup-tier-label">
                      Quiet activity ({awayDigest().quiet.length})
                    </summary>
                    <ul class="home-catchup-list">
                      <For each={awayDigest().quiet}>
                        {(item) => <CatchUpRow item={item} />}
                      </For>
                    </ul>
                  </details>
                </Show>
              </Show>
              {/* Dense since-you-left recaps stay collapsed until the consumer opens them. */}
              <Show when={catchUpRecaps().length > 0}>
                <details class="home-catchup-details home-catchup-details--recaps">
                  <summary class="home-catchup-details__summary">
                    Catch-up details ({catchUpRecaps().length})
                  </summary>
                  <div class="home-recap-strip" role="list" aria-label="Since you left recaps">
                    <For each={catchUpRecaps()}>
                      {(recap) => (
                        <article class="home-recap-card" role="listitem">
                          <div class="home-recap-card__head">
                            <span class="home-recap-card__target">
                              {recap.item.kind === 'dm' ? `@${recap.item.name}` : recap.item.name}
                            </span>
                            <span class="home-recap-card__count">{recapSummary(recap)}</span>
                          </div>
                          <p class="home-recap-card__voice">{voiceSummary(recap)}</p>
                          <p class="home-recap-card__preview">{recap.preview}</p>
                          <div class="home-recap-card__actions">
                            <button
                              type="button"
                              class="home-recap-card__open"
                              onClick={() => openCatchUp(recap.item)}
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              class="home-recap-card__review"
                              onClick={() => reviewCatchUpFromStart(recap)}
                              aria-label={`Review ${recap.item.name} from first unread line`}
                            >
                              Review from start
                            </button>
                            <button
                              type="button"
                              class="home-recap-card__spotlight"
                              onClick={() => openCatchUpSpotlight(recap.item)}
                              aria-label={`Find related actions for ${recap.item.name}`}
                            >
                              Find related
                            </button>
                          </div>
                        </article>
                      )}
                    </For>
                  </div>
                </details>
              </Show>
            </section>
          </Show>

          {/* 4 — Continue: exact resume + followed activity */}
          <Show when={continueVisible()}>
            <section
              class="home-continue"
              data-home-band="continue"
              aria-label="Continue where you left off"
            >
              <div class="home-continue-head">
                <h3 class="home-section-label">Continue</h3>
                <span class="home-continue-summary">pick up exactly</span>
              </div>

              <Show when={resumePoints().length > 0}>
                <div
                  class="home-resume"
                  data-home-stratum="resume"
                  role="region"
                  aria-label="Resume where you left off"
                >
                  <div class="home-resume-head">
                    <h4 class="home-resume-label">Pick up where you left off</h4>
                    <span class="home-resume-summary">first unread</span>
                  </div>
                  <ul class="home-resume-list">
                    <For each={resumePoints()}>
                      {(point) => (
                        <li>
                          <button
                            type="button"
                            class={`home-resume-item is-${point.tier}`}
                            onClick={() => resumeAt(point)}
                            aria-label={`Resume ${point.name} at your first unread message, ${point.unread} unread${point.highlights > 0 ? `, ${point.highlights} mention${point.highlights === 1 ? '' : 's'}` : ''}`}
                          >
                            <span class="home-resume-name">
                              <span class="home-resume-kind" aria-hidden="true">
                                {point.kind === 'dm' ? '@' : '#'}
                              </span>
                              {point.kind === 'dm' ? point.name : point.name.replace(/^#/, '')}
                            </span>
                            <span class="home-resume-meta">
                              <Show when={point.highlights > 0}>
                                <span class="home-resume-mention">{point.highlights} @you</span>
                              </Show>
                              <Show when={point.tier === 'followed'}>
                                <span class="home-resume-followed">followed</span>
                              </Show>
                              <span class="home-resume-count">{point.unread} unread</span>
                              <span class="home-resume-cue" aria-hidden="true">Resume →</span>
                            </span>
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>

              <Show when={awayDigest().followed.length > 0}>
                <div
                  class="home-catchup-tier home-catchup-tier--followed"
                  data-home-stratum="followed"
                  role="group"
                  aria-label="Followed channels"
                >
                  <h4 class="home-catchup-tier-label">Followed</h4>
                  <ul class="home-catchup-list">
                    <For each={awayDigest().followed}>
                      {(item) => <CatchUpRow item={item} />}
                    </For>
                  </ul>
                </div>
              </Show>
            </section>
          </Show>
        </div>

        {/* 5 — Live now: scheduled / live events + real call state only */}
        <Show when={liveNowVisible()}>
          <section
            class="home-events home-live-now"
            data-home-band="live-now"
            aria-label="Live now"
          >
            <div class="home-events-head">
              <h3 class="home-section-label">Live now</h3>
              <span class="home-events-summary">
                <Show
                  when={scheduledEvents().some((event) => event.live) || liveCallPresent()}
                  fallback="coming up"
                >
                  happening
                </Show>
              </span>
            </div>
            <Show when={liveCallPresent()}>
              <button
                type="button"
                class="home-event home-event--call is-live"
                onClick={openLiveCallRoom}
                aria-label={`${liveCallLabel()}. Open the room — does not join the call.`}
              >
                <span class="home-event-time">
                  <span class="home-event-state">call</span>
                  <span>already active</span>
                </span>
                <span class="home-event-main">
                  <span class="home-event-title">{liveCallLabel()}</span>
                  <span class="home-event-channel">Open the room · join stays explicit</span>
                </span>
                <span class="home-event-open" aria-hidden="true">Open →</span>
              </button>
            </Show>
            <Show when={connectionStatus() === 'connected' && scheduledEvents().length > 0}>
              <ul class="home-events-list">
                <For each={scheduledEvents()}>
                  {(event) => (
                    <li>
                      <button
                        type="button"
                        class={`home-event${event.live ? ' is-live' : ''}`}
                        onClick={() => openEvent(event)}
                        aria-label={`Open ${event.channel} for ${event.title}, ${eventCountdown(event, nowMs())}`}
                      >
                        <span class="home-event-time">
                          <span class="home-event-state">{event.live ? 'live' : eventCountdown(event, nowMs())}</span>
                          <span>{eventWhenLabel(event)}</span>
                        </span>
                        <span class="home-event-main">
                          <span class="home-event-title">{event.title}</span>
                          <span class="home-event-channel">{event.channel}</span>
                        </span>
                        <span class="home-event-open" aria-hidden="true">Open →</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </section>
        </Show>

        {/* 6 — Explore: directory + recent (primary CTAs already in masthead) */}
        <section class="home-explore" data-home-band="explore" aria-label="Explore">
          <div class="home-explore-head">
            <h3 class="home-section-label">Explore</h3>
            <div class="home-explore-actions">
              <button type="button" class="home-action home-action--quiet" onClick={() => getState().openAppearance()}>
                Appearance
              </button>
              <button type="button" class="home-action home-action--quiet" onClick={() => getState().openKeyboardShortcuts()}>
                Shortcuts
              </button>
            </div>
          </div>

          <Show when={directory().length > 0}>
            <div class="home-directory" aria-label="Active channels">
              <p class="home-explore-kicker">Active rooms</p>
              <div class="home-grid" role="list" aria-label="Active channel directory">
                <For each={directory()}>
                  {(c) => (
                    <article class="home-card" role="listitem">
                      <header class="home-card-head">
                        <h4 class="home-card-name">{c.channel}</h4>
                        <span class="home-card-when">
                          {c.active_users > 0
                            ? `${c.active_users} chatting`
                            : relTime(c.last_active, nowMs())}
                        </span>
                      </header>
                      <p class={`home-card-topic${c.topic ? '' : ' is-empty'}`}>
                        {c.topic || 'No topic yet — set the tone.'}
                      </p>
                      <Sparkline values={c.spark} />
                      <footer class="home-card-foot">
                        <span class="home-card-msgs">
                          {c.messages.toLocaleString('en-US')} msgs
                        </span>
                        <button
                          type="button"
                          class="home-card-join"
                          aria-label={isJoined(c.channel) ? `Open ${c.channel}` : `Join ${c.channel}`}
                          onClick={() => openOrJoinActiveRoom(c.channel)}
                        >
                          {isJoined(c.channel) ? 'Open →' : 'Join →'}
                        </button>
                      </footer>
                    </article>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={recentRooms().length > 0}>
            <div class="home-recent">
              <span class="home-section-label">Recent rooms</span>
              <div class="home-recent-chips">
                <For each={recentRooms()}>
                  {(room) => (
                    <button
                      type="button"
                      class="home-recent-chip"
                      onClick={() => void getState().joinChannel(room)}
                    >
                      {room}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </section>

        {/* 7 — Caught-up empty (when primary bands have nothing); after Explore */}
        <Show when={showCaughtUpEmpty()}>
          <section class="home-empty" data-home-band="caught-up" aria-label="You're caught up">
            <p class="home-empty-title">You're caught up</p>
            <p class="home-empty-copy">
              No unread messages need you right now. Use Browse rooms or Search messages above when you're ready.
            </p>
          </section>
        </Show>

        {/* Power / technical surfaces — collapsed by default */}
        <Show when={moreActivityHasContent()}>
          <details class="home-more-activity" data-home-band="more-activity">
            <summary class="home-more-activity__summary">More activity</summary>
            <div class="home-more-activity__body">
              <Show when={reviewHistory().length > 0}>
                <section class="home-review-history" aria-label="Recent catch-up reviews">
                  <div class="home-review-history__head">
                    <h3 class="home-section-label">Reviewed recently</h3>
                    <span class="home-review-history__summary">{reviewHistorySummary()}</span>
                  </div>
                  <div class="home-review-history__list" role="list" aria-label="Recent catch-up review cards">
                    <For each={reviewHistory()}>
                      {(entry) => (
                        <article class="home-review-history__item" role="listitem">
                          <div class="home-review-history__meta">
                            <span class="home-review-history__target">
                              {entry.kind === 'dm' ? `@${entry.name}` : entry.name}
                            </span>
                            <span>{reviewCountSummary(entry.messageCount, entry.mentionCount)}</span>
                            <span>{relTime(Math.floor(Date.parse(entry.reviewedAt) / 1000), nowMs())}</span>
                          </div>
                          <p class="home-review-history__preview">{entry.preview}</p>
                          <div class="home-review-history__actions">
                            <button
                              type="button"
                              onClick={() => reopenReview(entry)}
                              aria-label={`Reopen reviewed catch-up for ${entry.name}`}
                            >
                              Reopen
                            </button>
                            <button
                              type="button"
                              onClick={() => openReviewSpotlight(entry)}
                              aria-label={`Find related actions for reviewed ${entry.name}`}
                            >
                              Find related
                            </button>
                            <button
                              type="button"
                              onClick={() => searchReviewText(entry)}
                              aria-label={`Search reviewed text for ${entry.name}`}
                            >
                              Search text
                            </button>
                          </div>
                        </article>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <Show when={stats.latest}>
                {(data) => (
                  <div class="home-pulse" aria-label="Live network figures">
                    <div class="home-pulse-tile">
                      <span class="home-pulse-num">{data().channels.length}</span>
                      <span class="home-pulse-label">channels</span>
                    </div>
                    <div class="home-pulse-tile">
                      <span class="home-pulse-num">{totalMessages().toLocaleString('en-US')}</span>
                      <span class="home-pulse-label">messages tracked</span>
                    </div>
                    <div class="home-pulse-tile">
                      <span class="home-pulse-num">{totalChatting().toLocaleString('en-US')}</span>
                      <span class="home-pulse-label">chatting now</span>
                    </div>
                    <div class="home-pulse-tile">
                      <span class="home-pulse-num">{relTime(data().generated_at, nowMs())}</span>
                      <span class="home-pulse-label">stats updated</span>
                    </div>
                  </div>
                )}
              </Show>

              <Show when={connectionStatus() === 'connected' && roomRhythm().length > 0}>
                <section class="home-rhythm" aria-label="Room rhythm">
                  <div class="home-rhythm-head">
                    <h3 class="home-section-label">Room rhythm</h3>
                    <span class="home-rhythm-summary">joined rooms</span>
                  </div>
                  <div class="home-rhythm-list">
                    <For each={roomRhythm()}>
                      {(item) => (
                        <button
                          type="button"
                          class={`home-rhythm-item${item.event?.live ? ' is-live' : ''}`}
                          onClick={() => item.event ? openEvent(item.event) : getState().navigate({ kind: 'channel', channel: item.channel })}
                          aria-label={`Open ${item.channel}, ${trendLabel(item)}${item.event ? `, ${item.event.title} ${eventCountdown(item.event, nowMs())}` : ''}`}
                        >
                          <span class="home-rhythm-main">
                            <span class="home-rhythm-title">
                              <span>{item.channel}</span>
                              <span>{trendLabel(item)}</span>
                            </span>
                            <span class={`home-rhythm-topic${item.topic ? '' : ' is-empty'}`}>
                              {item.topic || 'No topic set'}
                            </span>
                          </span>
                          <span class="home-rhythm-heat" aria-hidden="true">
                            <For each={item.spark}>
                              {(value) => (
                                <span
                                  class={`home-rhythm-bar${value > 0 ? ' is-active' : ''}`}
                                  style={{ '--heat': (value / item.peak).toFixed(3) }}
                                />
                              )}
                            </For>
                          </span>
                          <span class="home-rhythm-event">
                            <Show
                              when={item.event}
                              fallback={<span>{relTime(item.lastActive, nowMs())}</span>}
                            >
                              {(event) => (
                                <>
                                  <b>{event().live ? 'live' : eventCountdown(event(), nowMs())}</b>
                                  <span>{event().title}</span>
                                </>
                              )}
                            </Show>
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <Show when={preferences().localHistory && rememberedRooms().length > 0}>
                <section
                  class="home-memory"
                  data-home-stratum="memory"
                  aria-label="Remembered rooms on this device"
                >
                  <div class="home-memory-head">
                    <h3 class="home-section-label">On this device</h3>
                    <span class="home-memory-summary">remembered rooms</span>
                  </div>
                  <div class="home-memory-grid">
                    <For each={rememberedRooms()}>
                      {(item) => (
                        <button
                          type="button"
                          class="home-memory-card"
                          onClick={() => openMemory(item)}
                          aria-label={`Rejoin ${item.target}, last remembered ${relTime(Math.floor(item.lastAt.getTime() / 1000), nowMs())}`}
                        >
                          <span class="home-memory-card-head">
                            <span class="home-memory-room">{item.target}</span>
                            <span class="home-memory-when">
                              {relTime(Math.floor(item.lastAt.getTime() / 1000), nowMs())}
                            </span>
                          </span>
                          <span class="home-memory-preview">
                            <b>{item.lastFrom}</b>: {item.preview}
                          </span>
                          <span class="home-memory-foot">
                            <span>
                              {item.count} remembered {item.count === 1 ? 'message' : 'messages'}
                            </span>
                            <span>
                              {item.participants.length} {item.participants.length === 1 ? 'person' : 'people'}
                            </span>
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <Show when={connectionStatus() === 'connected' && quietActivity().length > 0}>
                <section class="home-quiet" aria-label="Quiet room activity">
                  <div class="home-quiet-head">
                    <h3 class="home-section-label">Quiet rooms</h3>
                    <span class="home-quiet-summary">already read</span>
                  </div>
                  <div class="home-quiet-list">
                    <For each={quietActivity()}>
                      {(item) => (
                        <button
                          type="button"
                          class="home-quiet-item"
                          onClick={() => openQuietActivity(item)}
                          aria-label={`Open ${item.name}, active ${relTime(Math.floor(item.lastActivity / 1000), nowMs())}`}
                        >
                          <span class="home-quiet-main">
                            <span class="home-quiet-room">{item.name}</span>
                            <span class={`home-quiet-topic${item.topic ? '' : ' is-empty'}`}>
                              {item.topic || 'No topic set'}
                            </span>
                          </span>
                          <span class="home-quiet-when">
                            {relTime(Math.floor(item.lastActivity / 1000), nowMs())}
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <Show when={connectionStatus() === 'connected' && quietBoosts().length > 0}>
                <section class="home-boosts" aria-label="Quiet boosts">
                  <div class="home-boosts-head">
                    <h3 class="home-section-label">Quiet boosts</h3>
                    <span class="home-boosts-summary">reactions</span>
                  </div>
                  <div class="home-boosts-list" role="list" aria-label="Quiet boost cards">
                    <For each={quietBoosts()}>
                      {(item) => (
                        <article class="home-boost-card" role="listitem">
                          <button
                            type="button"
                            class="home-boost-card__open"
                            onClick={() => openQuietBoost(item)}
                            aria-label={`Open boosted message in ${item.target}`}
                          >
                            <span class="home-boost-card__target">
                              {item.target.startsWith('#') || item.target.startsWith('&')
                                ? item.target
                                : `@${item.target}`}
                            </span>
                            <span class="home-boost-card__badges" aria-label={`${item.total} quiet boosts`}>
                              <For each={item.groups.slice(0, 3)}>
                                {(group) => (
                                  <span class={`home-boost-card__badge${group.youBoosted ? ' is-you' : ''}`}>
                                    <span aria-hidden="true">{group.emoji}</span>
                                    <span>{group.count}</span>
                                  </span>
                                )}
                              </For>
                            </span>
                            <span class="home-boost-card__preview">
                              <b>{item.from}</b>: {clipped(item.text, 96)}
                            </span>
                            <span class="home-boost-card__when">
                              {relTime(Math.floor(item.at.getTime() / 1000), nowMs())}
                            </span>
                          </button>
                        </article>
                      )}
                    </For>
                  </div>
                </section>
              </Show>
            </div>
          </details>
        </Show>
      </div>
    </div>
  );
}
