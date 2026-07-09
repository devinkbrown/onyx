/**
 * HomeView — the connected-but-idle surface (no active channel).
 *
 * A real community home rather than a placeholder: a live network pulse fed
 * by the same stats JSON the website uses (same-origin `/stats/data/index.json`),
 * a joinable channel directory with sparklines, quick actions, and the
 * recently-visited rooms strip.
 *
 * Solid notes: the stats fetch is a createResource behind a graceful
 * fallback (dev servers 404 it — the view must never look broken); one
 * shared 30s clock signal drives every relative-time label; sorted/joined
 * derivations are memos.
 */
import './home-view.css';
import {
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX,
} from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { buildCatchUp, catchUpSummary, type CatchUpItem } from '@/lib/notifications/catchUp';
import { followed } from '@/lib/notifications/followed';
import { buildHomeMemory, type HomeMemoryItem } from '@/lib/notifications/homeMemory';
import { buildQuietActivity, type QuietActivityItem } from '@/lib/notifications/quietActivity';
import {
  readReviewHistory,
  recordReviewHistory,
  type ReviewHistoryEntry,
} from '@/lib/notifications/reviewHistory';
import {
  collectScheduledEvents,
  eventCountdown,
  type ScheduledEventItem,
} from '@/lib/notifications/scheduledEvents';
import { preferences } from '@/lib/prefs/preferences';
import { fetchStatsIndex, relTime } from '@/lib/stats/networkIndex';
import { loadRecent } from '@/lib/vault/historyVault';
import type { ChatMessage } from '@/lib/irc/types';
import { openSpotlight } from '@/chat/spotlight/useSpotlight';
import { openMessageSearchWithQuery } from './search/useMessageSearch';

export { relTime };

const HOME_RECAP_LIMIT = 3;
const HOME_RECAP_VOICE_LIMIT = 2;
const HOME_SYSTEM_TYPES = new Set(['join', 'part', 'quit', 'kick', 'mode', 'topic', 'nick', 'system', 'error']);
const HOME_RHYTHM_LIMIT = 4;

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

export function HomeView(): JSX.Element {
  const joinHistory = useStore((s) => s.joinHistory);
  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);
  const channelLastActivity = useStore((s) => s.channelLastActivity);
  const channelProps = useStore((s) => s.channelProps);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const networkName = useStore((s) => s.networkName);

  const [stats] = createResource(fetchStatsIndex);
  const [reviewHistory, setReviewHistory] = createSignal<ReviewHistoryEntry[]>(readReviewHistory());

  // "Catch up" — what you missed across every joined room + DM, ranked so
  // mentions and DMs surface and ambient chatter accumulates quietly below.
  const catchUp = createMemo<CatchUpItem[]>(() =>
    buildCatchUp(channels().values(), dms().values(), channelLastActivity(), {
      followedKeys: followed(),
    }),
  );
  const catchUpTotals = createMemo(() => catchUpSummary(catchUp()));
  const hasRooms = createMemo(() => channels().size > 0 || dms().size > 0);
  const openCatchUp = (item: CatchUpItem) =>
    item.kind === 'channel'
      ? getState().navigate({ kind: 'channel', channel: item.target })
      : getState().navigate({ kind: 'dm', nick: item.target });
  const openCatchUpSpotlight = (item: CatchUpItem) => openSpotlight(spotlightQueryFor(item));
  const reviewCatchUpFromStart = (recap: HomeCatchUpRecap) => {
    const state = getState();
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
    }));
    openCatchUp(recap.item);
    state.focusMessage(recap.firstMessage.id);
    if (recap.item.kind === 'channel') state.travelTo(recap.item.target, recap.firstMessage.time);
  };
  const reopenReview = (entry: ReviewHistoryEntry) => {
    const state = getState();
    if (entry.kind === 'channel') state.navigate({ kind: 'channel', channel: entry.target });
    else state.navigate({ kind: 'dm', nick: entry.target });
    state.focusMessage(entry.firstMessageId);
    if (entry.kind === 'channel') state.travelTo(entry.target, new Date(entry.firstAt));
  };
  const openReviewSpotlight = (entry: ReviewHistoryEntry) =>
    openSpotlight(entry.kind === 'channel' ? `goto ${entry.target}` : `dm ${entry.target}`);
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

  const scheduledEvents = createMemo<ScheduledEventItem[]>(() =>
    collectScheduledEvents(channels().values(), channelProps(), nowMs()),
  );
  const scheduledEventsByChannel = createMemo(() => {
    const byChannel = new Map<string, ScheduledEventItem>();
    for (const event of scheduledEvents()) byChannel.set(event.channel.toLowerCase(), event);
    return byChannel;
  });
  const openEvent = (event: ScheduledEventItem) =>
    getState().navigate({ kind: 'channel', channel: event.channel });
  const eventWhenLabel = (event: ScheduledEventItem) =>
    new Date(event.at * 1000).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  // Recently-visited rooms the user has since left — one tap to rejoin.
  const recentRooms = createMemo(() =>
    joinHistory().filter((c) => !channels().has(c.toLowerCase())).slice(0, 6),
  );
  const memoryKey = createMemo(() =>
    preferences().localHistory ? recentRooms().join('\n') : '',
  );
  const [homeMemory] = createResource(memoryKey, async (key) => {
    const targets = key.split('\n').filter(Boolean);
    if (targets.length === 0) return [];
    return buildHomeMemory(targets, (target) => loadRecent(target, 24), 4);
  });
  const rememberedRooms = createMemo<HomeMemoryItem[]>(() => homeMemory() ?? []);
  const openMemory = (item: HomeMemoryItem) => void getState().joinChannel(item.target);
  const quietActivity = createMemo<QuietActivityItem[]>(() =>
    buildQuietActivity(channels().values(), channelLastActivity(), nowMs()),
  );
  const openQuietActivity = (item: QuietActivityItem) =>
    getState().navigate({ kind: 'channel', channel: item.name });
  const catchUpRecaps = createMemo<HomeCatchUpRecap[]>(() =>
    catchUp()
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
      .slice(0, HOME_RECAP_LIMIT),
  );

  const directory = createMemo(() => {
    const data = stats();
    if (!data || data.channels.length === 0) return [];
    return [...data.channels]
      .sort((a, b) => b.messages - a.messages)
      .slice(0, 9);
  });
  const totalMessages = createMemo(() =>
    (stats()?.channels ?? []).reduce((sum, c) => sum + c.messages, 0),
  );
  const totalChatting = createMemo(() =>
    (stats()?.channels ?? []).reduce((sum, c) => sum + c.active_users, 0),
  );
  const isJoined = (name: string) => channels().has(name.toLowerCase());
  const roomRhythm = createMemo<HomeRhythmItem[]>(() => {
    const data = stats();
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

  return (
    <div class="home" role="main" aria-label="Network home">
      <div class="home-inner">
        <header class="home-masthead">
          <p class="home-kicker">{networkName() || 'IRCXNet'}</p>
          <h2 class="home-title">You're in the current.</h2>
          <p class="home-sub">
            Pick a hall below, or press <b>/</b> to search rooms, people and commands —{' '}
            <b>⌘K</b> opens the palette, <b>?</b> shows every shortcut.
          </p>
        </header>

        <Show when={connectionStatus() === 'connected' && hasRooms()}>
          <section class="home-catchup" aria-label="Catch up on what you missed">
            <div class="home-catchup-head">
              <h3 class="home-section-label">Catch up</h3>
              <Show
                when={catchUp().length > 0}
                fallback={<span class="home-catchup-clear">You're all caught up ✓</span>}
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
                </span>
              </Show>
            </div>
            <Show when={catchUp().length > 0}>
              <ul class="home-catchup-list">
                <For each={catchUp()}>
                  {(item) => (
                    <li>
                      <button
                        type="button"
                        class={`home-catchup-item${item.highlights > 0 || item.kind === 'dm' ? ' is-priority' : ''}${item.followed ? ' is-followed' : ''}`}
                        onClick={() => openCatchUp(item)}
                        aria-label={`Open ${item.name}, ${item.unread} unread${item.highlights > 0 ? `, ${item.highlights} mention${item.highlights === 1 ? '' : 's'}` : ''}${item.followed ? ', followed' : ''}`}
                      >
                        <span class="home-catchup-name">
                          <span class="home-catchup-kind" aria-hidden="true">
                            {item.kind === 'dm' ? '@' : '#'}
                          </span>
                          {item.kind === 'dm' ? item.name : item.name.replace(/^#/, '')}
                        </span>
                        <span class="home-catchup-meta">
                          <Show when={item.highlights > 0}>
                            <span class="home-catchup-mention">{item.highlights} @you</span>
                          </Show>
                          <Show when={item.followed}>
                            <span class="home-catchup-followed">followed</span>
                          </Show>
                          <span class="home-catchup-unread">{item.unread}</span>
                          <Show when={item.lastActivity > 0}>
                            <span class="home-catchup-when">
                              {relTime(Math.floor(item.lastActivity / 1000), nowMs())}
                            </span>
                          </Show>
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={catchUpRecaps().length > 0}>
              <div class="home-recap-strip" aria-label="Since you left recaps">
                <For each={catchUpRecaps()}>
                  {(recap) => (
                    <article class="home-recap-card">
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
            </Show>
          </section>
        </Show>

        <Show when={connectionStatus() === 'connected' && reviewHistory().length > 0}>
          <section class="home-review-history" aria-label="Recent catch-up reviews">
            <div class="home-review-history__head">
              <h3 class="home-section-label">Reviewed recently</h3>
              <span class="home-review-history__summary">catch-up ranges</span>
            </div>
            <div class="home-review-history__list">
              <For each={reviewHistory()}>
                {(entry) => (
                  <article class="home-review-history__item">
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

        <Show when={connectionStatus() === 'connected' && scheduledEvents().length > 0}>
          <section class="home-events" aria-label="Upcoming room events">
            <div class="home-events-head">
              <h3 class="home-section-label">Scheduled</h3>
              <span class="home-events-summary">
                {scheduledEvents().filter((event) => event.live).length > 0 ? 'live now' : 'coming up'}
              </span>
            </div>
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
          </section>
        </Show>

        <Show when={stats()}>
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

        <div class="home-actions">
          <button
            type="button"
            class="home-cta"
            onClick={() => {
              getState().refreshChannelList();
              getState().openChannelBrowser();
            }}
          >
            Browse all channels
          </button>
          <button type="button" class="home-action" onClick={() => void getState().joinChannel('#root')}>
            Join #root →
          </button>
          <button type="button" class="home-action" onClick={() => getState().openAppearance()}>
            Appearance
          </button>
          <button type="button" class="home-action" onClick={() => getState().openKeyboardShortcuts()}>
            Shortcuts
          </button>
        </div>

        <Show when={connectionStatus() === 'connected' && roomRhythm().length > 0}>
          <section class="home-rhythm" aria-label="Room rhythm">
            <div class="home-rhythm-head">
              <h3 class="home-section-label">Room rhythm</h3>
              <span class="home-rhythm-summary">chanstats heatlines</span>
            </div>
            <div class="home-rhythm-list">
              <For each={roomRhythm()}>
                {(item) => (
                  <button
                    type="button"
                    class={`home-rhythm-item${item.event?.live ? ' is-live' : ''}`}
                    onClick={() => getState().navigate({ kind: 'channel', channel: item.channel })}
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
          <section class="home-memory" aria-label="Remembered rooms on this device">
            <div class="home-memory-head">
              <h3 class="home-section-label">Device memory</h3>
              <span class="home-memory-summary">local history</span>
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
                        {item.participants.length} {item.participants.length === 1 ? 'voice' : 'voices'}
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
              <h3 class="home-section-label">Quiet activity</h3>
              <span class="home-quiet-summary">read rooms</span>
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

        <Show when={directory().length > 0}>
          <section class="home-directory" aria-label="Active channels">
            <h3 class="home-section-label">The halls</h3>
            <div class="home-grid">
              <For each={directory()}>
                {(c) => (
                  <article class="home-card">
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
                        onClick={() => void getState().joinChannel(c.channel)}
                      >
                        {isJoined(c.channel) ? 'Open →' : 'Join →'}
                      </button>
                    </footer>
                  </article>
                )}
              </For>
            </div>
          </section>
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
      </div>
    </div>
  );
}
