// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { useStore, getState } from '@/lib/store';
import {
  formatWatchClock,
  normalizeWatchNick,
  parseWatchTogetherProp,
  WATCH_PARTICIPANT_MAX_COUNT,
  WATCH_SECONDS_MAX,
  WATCH_TITLE_MAX_LENGTH,
  WATCH_URL_MAX_LENGTH,
  watchTogetherStateLabel,
  type WatchTogetherActivity,
} from '@/lib/media/watchTogether';
import {
  acceptHandoff,
  cancelHandoff,
  createWatchSession,
  handoff,
  isWatchHost,
  join,
  leave,
  pause,
  play,
  seek,
  sessionFromActivity,
  tick,
  type WatchSession,
} from '@/lib/media/watchTogetherController';
import { ModalShell } from '@/primitives';

const WATCH_PROP = 'ocean.watch';
const TICK_MS = 1000;

interface EndConfirmation {
  channel: string;
  raw: string;
  title: string;
  participantCount: number;
}

interface StartReview {
  channel: string;
  activity: WatchTogetherActivity;
}

interface StartFeedback {
  kind: 'error' | 'status';
  message: string;
}

interface ParticipantRosterEntry {
  nick: string;
  labels: string[];
}

interface WatchActionRevision {
  id: string;
  channel: string;
  raw: string;
  nick: string;
  anchorMs: number;
}

interface WatchMutationSpec {
  action: string;
  authorize: (session: WatchSession, nick: string) => boolean;
  mutate: (session: WatchSession, nowMs: number, nick: string) => WatchSession;
}

/** Only ever render an `ocean.watch` URL as a link when it is http(s) — a
 *  peer-published PROP must never yield a `javascript:`/`data:` href. */
function safeHttpUrl(u: string | null | undefined): string {
  const s = (u ?? '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

export function WatchTogetherActivity(): JSX.Element {
  const activeView = useStore((s) => s.activeView);
  const channelProps = useStore((s) => s.channelProps);
  const ourNick = useStore((s) => s.ourNick);
  const client = useStore((s) => s.client);

  // Reactive local clock: drives the smooth position advance between wire pushes.
  const [tickNow, setTickNow] = createSignal(Date.now());
  const [chosenHandoffTarget, setChosenHandoffTarget] = createSignal('');
  const [publishNotice, setPublishNotice] = createSignal<string | null>(null);
  const [endConfirmation, setEndConfirmation] = createSignal<EndConfirmation | null>(null);
  const [startTitle, setStartTitle] = createSignal('');
  const [startUrl, setStartUrl] = createSignal('');
  const [startDuration, setStartDuration] = createSignal('');
  const [startEditorOpen, setStartEditorOpen] = createSignal(false);
  const [startReview, setStartReview] = createSignal<StartReview | null>(null);
  const [startFeedback, setStartFeedback] = createSignal<StartFeedback | null>(null);
  const [rosterOpen, setRosterOpen] = createSignal(false);
  let endActivityTrigger: HTMLButtonElement | undefined;
  let confirmEndButton: HTMLButtonElement | undefined;
  let reviewStartButton: HTMLButtonElement | undefined;
  let confirmStartButton: HTMLButtonElement | undefined;
  let startActivityTrigger: HTMLButtonElement | undefined;
  let startTitleInput: HTMLInputElement | undefined;
  let participationStatusElement: HTMLSpanElement | undefined;
  let watchRevisionSequence = 0;
  const watchActionRevisions = new Map<string, WatchActionRevision>();
  onCleanup(() => watchActionRevisions.clear());

  const channel = createMemo(() => {
    const view = activeView();
    return view.kind === 'channel' ? view.channel : null;
  });

  // Memoize on the RAW prop string (a primitive). `channelProps` is a single
  // top-level Map that the store rebuilds on ANY prop write for any channel, and
  // `parseWatchTogetherProp` allocates a fresh object each call — so parsing
  // directly would re-emit `activity` on unrelated prop churn and spuriously
  // re-anchor the local tick (snapping the clock backward). Keying on the
  // primitive string lets `createMemo`'s `===` equality suppress that churn.
  const rawWatch = createMemo(() => {
    const ch = channel();
    if (!ch) return null;
    return channelProps().get(ch.toLowerCase())?.[WATCH_PROP] ?? null;
  });

  const activity = createMemo(() => parseWatchTogetherProp(rawWatch()));

  let observedChannelKey: string | null | undefined;
  createEffect(() => {
    const currentChannelKey = channel()?.toLowerCase() ?? null;
    rawWatch();
    const channelChanged = observedChannelKey !== undefined
      && observedChannelKey !== currentChannelKey;
    observedChannelKey = currentChannelKey;

    // Reviews and end confirmations are snapshots of one exact room + PROP.
    // Never let those snapshots cross a channel boundary or cover a newer
    // authoritative activity. Ordinary editor inputs may survive same-room PROP
    // churn, but are room-scoped and cleared when the channel itself changes so
    // an old title or media URL cannot leak into the next buffer.
    setStartReview(null);
    setEndConfirmation(null);
    if (channelChanged) {
      setStartTitle('');
      setStartUrl('');
      setStartDuration('');
    }
    setPublishNotice(null);
    setStartFeedback(null);
    setStartEditorOpen(false);
    setRosterOpen(false);
  });

  // Re-anchor a session whenever the wire activity changes; `live` then ticks it
  // against the reactive clock so playback advances locally without PROP chatter.
  const anchored = createMemo<WatchSession | null>(() => {
    const a = activity();
    return a ? sessionFromActivity(a, Date.now()) : null;
  });

  // Controls carry only this opaque revision id in the DOM. While mounted, the
  // id tracks the exact channel/PROP/identity they represent. If a control is
  // removed by authority or activity drift, its frozen id still resolves to the
  // old snapshot and the action-time comparison fails closed without exposing
  // raw metadata in a data attribute.
  const watchActionRevision = createMemo<WatchActionRevision | null>((previous) => {
    const currentChannel = channel();
    const currentRaw = rawWatch();
    const currentNick = normalizeWatchNick(ourNick());
    const currentAnchor = anchored();
    if (!currentChannel || !currentRaw || !currentNick || !currentAnchor) return null;
    if (
      previous
      && previous.channel.toLowerCase() === currentChannel.toLowerCase()
      && previous.raw === currentRaw
      && previous.nick.toLowerCase() === currentNick.toLowerCase()
    ) {
      return previous;
    }
    const revision: WatchActionRevision = {
      id: String(++watchRevisionSequence),
      channel: currentChannel,
      raw: currentRaw,
      nick: currentNick,
      anchorMs: currentAnchor.anchorMs,
    };
    watchActionRevisions.set(revision.id, revision);
    while (watchActionRevisions.size > 16) {
      const oldest = watchActionRevisions.keys().next().value as string | undefined;
      if (!oldest) break;
      watchActionRevisions.delete(oldest);
    }
    return revision;
  }, null);

  const live = createMemo<WatchSession | null>(() => {
    const s = anchored();
    return s ? tick(s, tickNow()) : null;
  });

  const liveActivity = createMemo(() => live()?.activity ?? null);
  const displayPosition = createMemo(() => liveActivity()?.positionSeconds ?? null);
  const isPlaying = createMemo(() => liveActivity()?.state === 'playing');

  // Keep one clock only for the exact room activity that can advance. Returning
  // the same primitive revision while its local position changes prevents the
  // effect from tearing down and recreating the interval on every tick. Channel
  // or wire revisions still restart ownership, and a local duration boundary
  // flips `isPlaying` to false so the interval is cleared without another push.
  const tickingRevision = createMemo(() => {
    if (!isPlaying()) return null;
    const currentChannel = channel();
    const currentRaw = rawWatch();
    return currentChannel && currentRaw
      ? `${currentChannel.toLowerCase()}\u0000${currentRaw}`
      : null;
  });
  createEffect(() => {
    if (!tickingRevision()) return;
    const timer = setInterval(() => setTickNow(Date.now()), TICK_MS);
    onCleanup(() => clearInterval(timer));
  });

  const isHost = createMemo(() => {
    const s = live();
    return s ? isWatchHost(s, ourNick()) : false;
  });

  const isParticipant = createMemo(() => {
    const a = liveActivity();
    const me = ourNick();
    if (!a || !me) return false;
    return a.participants.some((p) => p.toLowerCase() === me.toLowerCase());
  });

  const participantCount = createMemo(() => liveActivity()?.participants.length ?? 0);
  const participantRoster = createMemo<ParticipantRosterEntry[]>(() => {
    const currentActivity = activity();
    if (!currentActivity) return [];
    const host = currentActivity.host?.toLowerCase() ?? null;
    const pendingHost = currentActivity.state === 'handoff'
      ? currentActivity.handoffTo?.toLowerCase() ?? null
      : null;
    const self = normalizeWatchNick(ourNick())?.toLowerCase() ?? null;
    return currentActivity.participants.map((nick) => {
      const key = nick.toLowerCase();
      const labels: string[] = [];
      if (key === host) labels.push('Host');
      if (key === pendingHost) labels.push('Pending host');
      if (key === self) labels.push('You');
      return { nick, labels };
    });
  });
  const rosterFull = createMemo(() => participantCount() >= WATCH_PARTICIPANT_MAX_COUNT);
  const publishingAvailable = createMemo(() =>
    Boolean(channel() && typeof client()?.publishWatchTogether === 'function')
  );
  const canStartActivity = createMemo(() =>
    Boolean(
      channel()
      && !activity()
      && normalizeWatchNick(ourNick())
      && publishingAvailable()
    )
  );
  const displayedActivity = createMemo(() => startReview() ? null : liveActivity());

  const handoffPending = createMemo(() => liveActivity()?.state === 'handoff');

  // `parseWatchTogetherProp` already caps and case-insensitively deduplicates
  // this metadata roster. Keep its bounded order and remove only the local host
  // identity before presenting possible handoff targets.
  const handoffTargets = createMemo(() => {
    const a = liveActivity();
    const me = ourNick()?.trim().toLowerCase();
    if (!a || !me) return [];
    return a.participants.filter(participant => participant.toLowerCase() !== me);
  });

  const selectedHandoffTarget = createMemo(() => {
    const targets = handoffTargets();
    const chosen = chosenHandoffTarget();
    return targets.find(target => target.toLowerCase() === chosen.toLowerCase()) ?? targets[0] ?? '';
  });

  const canAcceptHandoff = createMemo(() => {
    const a = liveActivity();
    const me = ourNick()?.trim();
    if (!a || a.state !== 'handoff' || !a.handoffTo || !me) return false;
    return a.handoffTo.toLowerCase() === me.toLowerCase();
  });

  const participantLabel = createMemo(() => {
    return `${participantCount()} watching`;
  });

  const rosterButtonLabel = createMemo(() => {
    return `${rosterOpen() ? 'Hide' : 'Show'} participants (${participantCount()})`;
  });

  const participationStatus = createMemo(() => {
    const me = ourNick()?.trim();
    const role = !me
      ? 'Sign in to join'
      : isHost()
        ? 'You are hosting'
        : isParticipant()
          ? 'You joined'
          : 'Not joined';
    const parts = [
      role,
      `${participantCount()} of ${WATCH_PARTICIPANT_MAX_COUNT} participant spots used`,
    ];
    if (rosterFull() && !isParticipant()) parts.push('Activity full');
    if (!publishingAvailable()) parts.push('Updates unavailable');
    const notice = publishNotice();
    if (notice) parts.push(notice);
    return parts.join('. ');
  });

  const joinLabel = createMemo(() => {
    if (rosterFull()) return `Join activity unavailable: activity full (${WATCH_PARTICIPANT_MAX_COUNT} participants)`;
    if (!publishingAvailable()) return 'Join activity unavailable: updates unavailable';
    return `Join activity: ${liveActivity()?.title ?? 'Watch together'}`;
  });

  const leaveLabel = createMemo(() => {
    if (!publishingAvailable()) return 'Leave activity unavailable: updates unavailable';
    return `Leave activity: ${liveActivity()?.title ?? 'Watch together'}`;
  });

  const progressLabel = createMemo(() => {
    const a = liveActivity();
    if (!a) return '';
    const position = formatWatchClock(displayPosition());
    const duration = formatWatchClock(a.durationSeconds);
    return a.durationSeconds === null ? position : `${position} / ${duration}`;
  });

  const stateLabel = createMemo(() => {
    const a = liveActivity();
    return a ? watchTogetherStateLabel(a) : '';
  });

  const ariaLabel = createMemo(() => {
    const a = liveActivity();
    if (!a) return 'Watch together';
    const parts = [`Watch together: ${a.title}`, stateLabel()];
    if (a.host) parts.push(`host ${a.host}`);
    parts.push(participantLabel());
    return parts.join(', ');
  });

  // ── Host / participant actions (publish the same ocean.watch PROP) ──────────
  function sameIdentity(a: string | null | undefined, b: string | null | undefined): boolean {
    return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
  }

  function hasCurrentParticipant(session: WatchSession, nick: string): boolean {
    return session.activity.participants.some((participant) => sameIdentity(participant, nick));
  }

  function announceMutationFailure(message: string): void {
    setPublishNotice(message);
    setStartFeedback({ kind: 'error', message });
  }

  function revisionFor(element: HTMLElement): WatchActionRevision | null {
    const id = element.dataset.watchRevision;
    return id ? watchActionRevisions.get(id) ?? null : null;
  }

  function runWatchMutation(revision: WatchActionRevision | null, spec: WatchMutationSpec): void {
    if (!revision) {
      announceMutationFailure(`Could not ${spec.action} because the activity changed`);
      return;
    }

    const current = getState();
    const view = current.activeView;
    if (view.kind !== 'channel' || view.channel.toLowerCase() !== revision.channel.toLowerCase()) {
      announceMutationFailure(`Could not ${spec.action} because the active channel changed`);
      return;
    }

    const currentRaw = current.channelProps.get(view.channel.toLowerCase())?.[WATCH_PROP] ?? null;
    if (currentRaw !== revision.raw) {
      announceMutationFailure(`Could not ${spec.action} because the watch activity changed`);
      return;
    }

    const currentNick = normalizeWatchNick(current.ourNick);
    if (!currentNick || currentNick.toLowerCase() !== revision.nick.toLowerCase()) {
      announceMutationFailure(`Could not ${spec.action} because your signed-in identity changed`);
      return;
    }

    const currentActivity = parseWatchTogetherProp(currentRaw);
    if (!currentActivity) {
      announceMutationFailure(`Could not ${spec.action} because the activity is unavailable`);
      return;
    }

    if (typeof current.client?.publishWatchTogether !== 'function') {
      announceMutationFailure('Your role is unchanged because activity updates are unavailable');
      return;
    }

    const nowMs = Date.now();
    const authoritative = tick(
      { activity: currentActivity, anchorMs: revision.anchorMs },
      nowMs,
    );
    if (!spec.authorize(authoritative, currentNick)) {
      announceMutationFailure(
        `Could not ${spec.action} because your role or the current activity no longer permits it`,
      );
      return;
    }

    const next = spec.mutate(authoritative, nowMs, currentNick);
    if (next === authoritative) {
      announceMutationFailure(`Could not ${spec.action} because the activity no longer needs that change`);
      return;
    }

    try {
      current.client.publishWatchTogether(view.channel, next.activity);
      setPublishNotice(null);
      setStartFeedback(null);
    } catch {
      announceMutationFailure('Could not update the activity. Your role is unchanged');
    }
  }

  function onPlay(element: HTMLButtonElement): void {
    runWatchMutation(revisionFor(element), {
      action: 'start playback',
      authorize: (session, nick) => isWatchHost(session, nick),
      mutate: (session, nowMs, nick) => play(session, nowMs, nick),
    });
  }

  function onPause(element: HTMLButtonElement): void {
    runWatchMutation(revisionFor(element), {
      action: 'pause playback',
      authorize: (session, nick) => isWatchHost(session, nick),
      mutate: (session, nowMs, nick) => pause(session, nowMs, nick),
    });
  }

  function onSeek(seconds: number, element: HTMLInputElement): void {
    if (!Number.isFinite(seconds)) return;
    runWatchMutation(revisionFor(element), {
      action: 'seek',
      authorize: (session, nick) => isWatchHost(session, nick),
      mutate: (session, nowMs, nick) => seek(session, seconds, nowMs, nick),
    });
  }

  function onJoin(element: HTMLButtonElement): void {
    runWatchMutation(revisionFor(element), {
      action: 'join the activity',
      authorize: (session, nick) => (
        !hasCurrentParticipant(session, nick)
        && session.activity.participants.length < WATCH_PARTICIPANT_MAX_COUNT
      ),
      mutate: (session, nowMs, nick) => join(session, nick, nowMs),
    });
  }

  function onLeave(element: HTMLButtonElement): void {
    runWatchMutation(revisionFor(element), {
      action: 'leave the activity',
      authorize: (session, nick) => (
        hasCurrentParticipant(session, nick)
        && !sameIdentity(session.activity.host, nick)
      ),
      mutate: (session, nowMs, nick) => leave(session, nick, nowMs),
    });
  }

  function onOfferHandoff(element: HTMLButtonElement): void {
    const target = normalizeWatchNick(selectedHandoffTarget());
    runWatchMutation(revisionFor(element), {
      action: 'offer host',
      authorize: (session, nick) => Boolean(
        target
        && isWatchHost(session, nick)
        && session.activity.state !== 'handoff'
        && !sameIdentity(target, session.activity.host)
        && hasCurrentParticipant(session, target)
      ),
      mutate: (session, nowMs, nick) => handoff(session, target ?? '', nowMs, nick),
    });
  }

  function onAcceptHandoff(element: HTMLButtonElement): void {
    runWatchMutation(revisionFor(element), {
      action: 'accept host',
      authorize: (session, nick) => (
        session.activity.state === 'handoff'
        && sameIdentity(session.activity.handoffTo, nick)
      ),
      mutate: (session, nowMs, nick) => acceptHandoff(session, nowMs, nick),
    });
  }

  function onCancelHandoff(element: HTMLButtonElement): void {
    runWatchMutation(revisionFor(element), {
      action: 'cancel the handoff',
      authorize: (session, nick) => (
        session.activity.state === 'handoff'
        && isWatchHost(session, nick)
      ),
      mutate: (session, nowMs, nick) => cancelHandoff(session, nowMs, nick),
    });
  }

  function onStageEndActivity(): void {
    const currentChannel = channel();
    const currentRaw = rawWatch();
    const currentActivity = liveActivity();
    if (!isHost() || !currentChannel || !currentRaw || !currentActivity) return;
    setPublishNotice(null);
    setEndConfirmation({
      channel: currentChannel,
      raw: currentRaw,
      title: currentActivity.title,
      participantCount: currentActivity.participants.length,
    });
    queueMicrotask(() => confirmEndButton?.focus());
  }

  function focusFirstConnected(...targets: Array<() => HTMLElement | undefined>): void {
    queueMicrotask(() => {
      for (const target of targets) {
        const element = target();
        if (!element?.isConnected) continue;
        element.focus();
        return;
      }
    });
  }

  function focusAfterClosedReview(preferredTrigger: () => HTMLElement | undefined): void {
    focusFirstConnected(
      preferredTrigger,
      () => participationStatusElement,
      () => reviewStartButton,
    );
  }

  function onCancelEndActivity(): void {
    setEndConfirmation(null);
    focusAfterClosedReview(() => endActivityTrigger);
  }

  function onConfirmEndActivity(): void {
    const staged = endConfirmation();
    if (!staged) return;

    const current = getState();
    const view = current.activeView;
    if (view.kind !== 'channel' || view.channel.toLowerCase() !== staged.channel.toLowerCase()) {
      setEndConfirmation(null);
      setPublishNotice('The activity was not ended because the active channel changed');
      focusAfterClosedReview(() => endActivityTrigger);
      return;
    }

    const currentRaw = current.channelProps.get(view.channel.toLowerCase())?.[WATCH_PROP] ?? null;
    const currentActivity = parseWatchTogetherProp(currentRaw);
    if (!currentActivity) {
      setEndConfirmation(null);
      setPublishNotice('The activity was not ended because it is no longer available');
      focusAfterClosedReview(() => endActivityTrigger);
      return;
    }

    const currentSession = sessionFromActivity(currentActivity, Date.now());
    if (!isWatchHost(currentSession, current.ourNick)) {
      setEndConfirmation(null);
      setPublishNotice('The activity was not ended because you are no longer the current host');
      focusAfterClosedReview(() => endActivityTrigger);
      return;
    }

    if (currentRaw !== staged.raw) {
      setEndConfirmation(null);
      setPublishNotice('The activity was not ended because it changed. Review it and try again');
      focusAfterClosedReview(() => endActivityTrigger);
      return;
    }

    if (typeof current.client?.publishWatchTogether !== 'function') {
      setPublishNotice('Could not end the activity because activity updates are unavailable');
      return;
    }

    try {
      current.client.publishWatchTogether(view.channel, null);
      setEndConfirmation(null);
      setPublishNotice(
        `End requested for ${staged.title}. The activity remains visible until the server confirms removal`,
      );
      focusAfterClosedReview(() => endActivityTrigger);
    } catch {
      setPublishNotice('Could not end the activity. It remains active');
    }
  }

  function validateStartSession(): WatchSession | null {
    const title = startTitle().trim();
    if (!title) {
      setStartFeedback({ kind: 'error', message: 'Enter an activity title' });
      return null;
    }
    if (title.length > WATCH_TITLE_MAX_LENGTH) {
      setStartFeedback({
        kind: 'error',
        message: `Activity titles must be ${WATCH_TITLE_MAX_LENGTH} characters or fewer`,
      });
      return null;
    }

    const url = startUrl().trim();
    if (url.length > WATCH_URL_MAX_LENGTH) {
      setStartFeedback({
        kind: 'error',
        message: `Activity URLs must be ${WATCH_URL_MAX_LENGTH} characters or fewer`,
      });
      return null;
    }

    const durationText = startDuration().trim();
    const duration = durationText ? Number(durationText) : null;
    if (
      duration !== null
      && (!Number.isInteger(duration) || duration < 0 || duration > WATCH_SECONDS_MAX)
    ) {
      setStartFeedback({
        kind: 'error',
        message: `Duration must be a whole number from 0 to ${WATCH_SECONDS_MAX} seconds`,
      });
      return null;
    }

    const host = normalizeWatchNick(ourNick());
    if (!host) {
      setStartFeedback({ kind: 'error', message: 'Sign in before starting an activity' });
      return null;
    }

    const session = createWatchSession({
      host,
      title,
      url: url || null,
      durationSeconds: duration,
      nowMs: Date.now(),
    });
    if (session.activity.title !== title) {
      setStartFeedback({ kind: 'error', message: 'Enter a valid bounded activity title' });
      return null;
    }
    if (url && session.activity.url !== url) {
      setStartFeedback({
        kind: 'error',
        message: 'Activity URL must be a valid http:// or https:// address',
      });
      return null;
    }
    if (duration !== null && session.activity.durationSeconds !== duration) {
      setStartFeedback({ kind: 'error', message: 'Enter a valid bounded duration' });
      return null;
    }
    return session;
  }

  function onStageStartActivity(event: SubmitEvent): void {
    event.preventDefault();
    const currentChannel = channel();
    if (!currentChannel || activity() || !publishingAvailable()) {
      setStartFeedback({
        kind: 'error',
        message: 'This channel is not currently available for a new watch activity',
      });
      return;
    }
    const session = validateStartSession();
    if (!session) return;
    setStartFeedback(null);
    setStartReview({ channel: currentChannel, activity: session.activity });
    queueMicrotask(() => queueMicrotask(() => confirmStartButton?.focus()));
  }

  function onOpenStartEditor(): void {
    setStartFeedback(null);
    setStartEditorOpen(true);
    // ModalShell first moves focus into the dialog. Run after that lifecycle
    // microtask so the title field is the deterministic editing target.
    queueMicrotask(() => queueMicrotask(() => startTitleInput?.focus()));
  }

  function onCloseStartEditor(): void {
    setStartReview(null);
    setStartFeedback(null);
    setStartEditorOpen(false);
    focusFirstConnected(() => startActivityTrigger);
  }

  function onCancelStartActivity(): void {
    setStartReview(null);
    setStartFeedback(null);
    focusAfterClosedReview(() => reviewStartButton);
  }

  function onConfirmStartActivity(): void {
    const staged = startReview();
    if (!staged) return;

    const current = getState();
    const view = current.activeView;
    if (view.kind !== 'channel' || view.channel.toLowerCase() !== staged.channel.toLowerCase()) {
      setStartReview(null);
      setStartFeedback({
        kind: 'error',
        message: 'The activity was not started because the active channel changed',
      });
      focusAfterClosedReview(() => reviewStartButton);
      return;
    }

    const currentRaw = current.channelProps.get(view.channel.toLowerCase())?.[WATCH_PROP] ?? null;
    if (parseWatchTogetherProp(currentRaw)) {
      setStartReview(null);
      setPublishNotice('A watch activity arrived before this one was confirmed, so nothing was replaced');
      focusAfterClosedReview(() => reviewStartButton);
      return;
    }

    const currentHost = normalizeWatchNick(current.ourNick);
    if (!currentHost || currentHost.toLowerCase() !== staged.activity.host?.toLowerCase()) {
      setStartReview(null);
      setStartFeedback({
        kind: 'error',
        message: 'The activity was not started because your signed-in identity changed',
      });
      focusAfterClosedReview(() => reviewStartButton);
      return;
    }

    if (typeof current.client?.publishWatchTogether !== 'function') {
      setStartFeedback({
        kind: 'error',
        message: 'Could not start the activity because activity updates are unavailable',
      });
      return;
    }

    try {
      current.client.publishWatchTogether(view.channel, staged.activity);
      setStartReview(null);
      setStartTitle('');
      setStartUrl('');
      setStartDuration('');
      setStartFeedback({
        kind: 'status',
        message: `Start requested for ${staged.activity.title}. Waiting for the room to confirm it`,
      });
      setStartEditorOpen(false);
      focusFirstConnected(() => startActivityTrigger);
    } catch {
      setStartFeedback({
        kind: 'error',
        message: 'Could not start the activity. Your reviewed details were preserved',
      });
    }
  }

  function onRosterKeyDown(event: KeyboardEvent & { currentTarget: HTMLButtonElement }): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.currentTarget.click();
  }

  return (
    <>
      <Show when={canStartActivity()}>
        <div class="shell-watch-start">
          <button
            ref={(element) => { startActivityTrigger = element; }}
            type="button"
            class="shell-watch-start__launcher"
            aria-label="Start watch activity"
            aria-expanded={startEditorOpen()}
            aria-controls={startEditorOpen() ? 'watch-start-editor' : undefined}
            onClick={() => startEditorOpen() ? onCloseStartEditor() : onOpenStartEditor()}
          >
            <span class="shell-watch-start__cue" aria-hidden="true">▶</span>
            <span class="shell-watch-start__launcher-copy">
              <strong>Start watch activity</strong>
              <span>Share a media cue with {channel() ?? 'this channel'}</span>
            </span>
            <span class="shell-watch-start__launcher-action" aria-hidden="true">Open</span>
          </button>
          <Show when={!startEditorOpen() && startFeedback()}>
            {(feedback) => (
              <span
                class="shell-watch-start__feedback shell-watch-start__feedback--launcher"
                role={feedback().kind === 'error' ? 'alert' : 'status'}
              >
                {feedback().message}
              </span>
            )}
          </Show>
        </div>
      </Show>

      <ModalShell
        open={startEditorOpen()}
        title={startReview() ? 'Review room-wide activity' : 'Start watch activity'}
        description={startReview()
          ? `Confirming publishes these details to everyone in ${channel() ?? 'this channel'}.`
          : `Review before publishing. Confirming makes these details room-wide in ${channel() ?? 'this channel'}; this draft is temporary and is never saved.`}
        closeLabel="Close activity editor"
        onOpenChange={(open) => {
          if (!open) onCloseStartEditor();
        }}
      >
        <form
          id="watch-start-editor"
          class="shell-watch-start__dialog-content"
          aria-label="Start watch activity"
          novalidate
          onSubmit={onStageStartActivity}
        >
          <Show when={startReview()} fallback={
            <>
              <div class="shell-watch-start__fields">
                <label class="shell-watch-start__field shell-watch-start__field--title" for="watch-start-title">
                  <span>Activity title</span>
                  <input
                    ref={(element) => { startTitleInput = element; }}
                    id="watch-start-title"
                    value={startTitle()}
                    maxlength={WATCH_TITLE_MAX_LENGTH}
                    required
                    autocomplete="off"
                    onInput={(event) => setStartTitle(event.currentTarget.value)}
                  />
                </label>
                <label class="shell-watch-start__field shell-watch-start__field--url" for="watch-start-url">
                  <span>Media URL (optional, http or https)</span>
                  <input
                    id="watch-start-url"
                    type="url"
                    value={startUrl()}
                    maxlength={WATCH_URL_MAX_LENGTH}
                    autocomplete="off"
                    onInput={(event) => setStartUrl(event.currentTarget.value)}
                  />
                </label>
                <label class="shell-watch-start__field shell-watch-start__field--duration" for="watch-start-duration">
                  <span>Duration in seconds (optional)</span>
                  <input
                    id="watch-start-duration"
                    type="number"
                    value={startDuration()}
                    min="0"
                    max={WATCH_SECONDS_MAX}
                    step="1"
                    onInput={(event) => setStartDuration(event.currentTarget.value)}
                  />
                </label>
              </div>
              <Show when={startFeedback()}>
                {(feedback) => (
                  <span
                    class="shell-watch-start__feedback"
                    role={feedback().kind === 'error' ? 'alert' : 'status'}
                  >
                    {feedback().message}
                  </span>
                )}
              </Show>
              <div class="shell-watch-start__actions">
                <button
                  ref={(element) => { reviewStartButton = element; }}
                  type="submit"
                  class="shell-watch-start__primary"
                >
                  Review activity
                </button>
                <button
                  type="button"
                  class="shell-watch-start__secondary"
                  onClick={onCloseStartEditor}
                >
                  Cancel
                </button>
              </div>
            </>
          }>
            {(pending) => (
              <section
                class="shell-watch-start__review"
                data-testid="watch-start-review"
                aria-label={`Review watch activity ${pending().activity.title}`}
              >
                <strong class="shell-watch-start__heading">{pending().activity.title}</strong>
                <p class="shell-watch-start__summary">
                  Host {pending().activity.host} in {pending().channel}. These details become
                  visible to everyone in the channel only after you confirm.
                </p>
                <dl class="shell-watch-start__review-details">
                  <Show when={pending().activity.url}>
                    {(url) => (
                      <div>
                        <dt>Media URL</dt>
                        <dd>{url()}</dd>
                      </div>
                    )}
                  </Show>
                  <Show when={pending().activity.durationSeconds !== null}>
                    <div>
                      <dt>Duration</dt>
                      <dd>{pending().activity.durationSeconds} seconds</dd>
                    </div>
                  </Show>
                </dl>
                <Show when={startFeedback()}>
                  {(feedback) => (
                    <span
                      class="shell-watch-start__feedback"
                      role={feedback().kind === 'error' ? 'alert' : 'status'}
                    >
                      {feedback().message}
                    </span>
                  )}
                </Show>
                <div class="shell-watch-start__actions" role="group" aria-label="Confirm new watch activity">
                  <button
                    ref={(element) => { confirmStartButton = element; }}
                    type="button"
                    class="shell-watch-start__primary"
                    onClick={onConfirmStartActivity}
                  >
                    Confirm start activity
                  </button>
                  <button
                    type="button"
                    class="shell-watch-start__secondary"
                    onClick={onCancelStartActivity}
                  >
                    Cancel starting activity
                  </button>
                </div>
              </section>
            )}
          </Show>
        </form>
      </ModalShell>

      <Show when={displayedActivity()}>
        {(item) => (
        <section
          class="shell-watch-together"
          data-state={item().state}
          aria-label={ariaLabel()}
        >
          <div class="shell-watch-together__pulse" aria-hidden="true" />
          <div class="shell-watch-together__main">
            <span class="shell-watch-together__label">Watch together</span>
            <strong class="shell-watch-together__title">{item().title}</strong>
            <span
              class="shell-watch-together__label"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              tabindex={-1}
              ref={(element) => { participationStatusElement = element; }}
              data-testid="watch-participation-status"
            >
              {participationStatus()}
            </span>
          </div>
          <div class="shell-watch-together__meta" aria-label="Watch together status">
            <span>{stateLabel()}</span>
            <Show when={item().positionSeconds !== null || item().durationSeconds !== null}>
              <span>{progressLabel()}</span>
            </Show>
            <Show when={item().host}>
              {(hostNick) => <span>Host {hostNick()}</span>}
            </Show>
            <span>{participantLabel()}</span>
          </div>

          <button
            type="button"
            class="shell-watch-together__ctl"
            aria-label={rosterButtonLabel()}
            aria-expanded={rosterOpen()}
            aria-controls={rosterOpen() ? 'watch-participant-roster' : undefined}
            onClick={() => setRosterOpen((open) => !open)}
            onKeyDown={onRosterKeyDown}
            data-testid="watch-roster-toggle"
          >
            {rosterButtonLabel()}
          </button>
          <Show when={rosterOpen()}>
            <div
              id="watch-participant-roster"
              class="shell-watch-together__main"
              role="region"
              aria-label={`Watch participants (${participantCount()})`}
            >
              <Show
                when={participantRoster().length > 0}
                fallback={<span>No participants are listed for this activity.</span>}
              >
                <ul aria-label="Participant roster">
                  <For each={participantRoster()}>
                    {(participant) => (
                      <li>
                        <span>{participant.nick}</span>
                        <Show when={participant.labels.length > 0}>
                          <span> — {participant.labels.join(', ')}</span>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          </Show>

          <Show when={isHost() && !handoffPending()}>
            <div
              class="shell-watch-together__controls"
              role="group"
              aria-label="Playback and host controls"
            >
              <Show
                when={isPlaying()}
                fallback={
                  <button
                    type="button"
                    class="shell-watch-together__ctl"
                    aria-label="Play"
                    data-watch-revision={watchActionRevision()?.id}
                    onClick={(event) => onPlay(event.currentTarget)}
                  >
                    Play
                  </button>
                }
              >
                <button
                  type="button"
                  class="shell-watch-together__ctl"
                  aria-label="Pause"
                  data-watch-revision={watchActionRevision()?.id}
                  onClick={(event) => onPause(event.currentTarget)}
                >
                  Pause
                </button>
              </Show>
              <Show when={item().durationSeconds !== null}>
                <input
                  type="range"
                  class="shell-watch-together__seek"
                  min="0"
                  max={item().durationSeconds ?? 0}
                  step="1"
                  value={displayPosition() ?? 0}
                  aria-label="Seek position"
                  aria-valuetext={`${formatWatchClock(displayPosition())} of ${formatWatchClock(item().durationSeconds)}`}
                  data-watch-revision={watchActionRevision()?.id}
                  onChange={(event) => onSeek(event.currentTarget.valueAsNumber, event.currentTarget)}
                />
              </Show>
              <Show when={handoffTargets().length > 0}>
                <label class="shell-watch-together__handoff-label">
                  <span>New host</span>
                  <select
                    class="shell-watch-together__handoff-select"
                    aria-label="New watch host"
                    value={selectedHandoffTarget()}
                    onChange={(event) => setChosenHandoffTarget(event.currentTarget.value)}
                  >
                    <For each={handoffTargets()}>
                      {(participant) => <option value={participant}>{participant}</option>}
                    </For>
                  </select>
                </label>
                <button
                  type="button"
                  class="shell-watch-together__ctl"
                  data-watch-revision={watchActionRevision()?.id}
                  onClick={(event) => onOfferHandoff(event.currentTarget)}
                >
                  Offer host
                </button>
              </Show>
            </div>
          </Show>

          <Show when={canAcceptHandoff()}>
            <button
              type="button"
              class="shell-watch-together__ctl shell-watch-together__accept"
              data-watch-revision={watchActionRevision()?.id}
              onClick={(event) => onAcceptHandoff(event.currentTarget)}
            >
              Accept host
            </button>
          </Show>

          <Show when={isHost() && handoffPending()}>
            <button
              type="button"
              class="shell-watch-together__ctl"
              data-watch-revision={watchActionRevision()?.id}
              onClick={(event) => onCancelHandoff(event.currentTarget)}
            >
              Cancel handoff
            </button>
          </Show>

          <Show
            when={endConfirmation()}
            fallback={
              <Show when={isHost()}>
                <button
                  ref={(element) => { endActivityTrigger = element; }}
                  type="button"
                  class="shell-watch-together__ctl"
                  aria-label={`End activity: ${item().title}`}
                  title="End this activity for every participant"
                  onClick={onStageEndActivity}
                  data-testid="watch-end-button"
                >
                  End activity
                </button>
              </Show>
            }
          >
            {(pending) => (
              <div
                class="shell-watch-together__controls"
                role="group"
                aria-label={`Confirm ending ${pending().title}`}
                data-testid="watch-end-confirmation"
              >
                <strong>End “{pending().title}”?</strong>
                <span>
                  This will remove the activity for {pending().participantCount}{' '}
                  {pending().participantCount === 1 ? 'participant' : 'participants'}.
                </span>
                <button
                  ref={(element) => { confirmEndButton = element; }}
                  type="button"
                  class="shell-watch-together__ctl"
                  onClick={onConfirmEndActivity}
                >
                  Confirm end activity
                </button>
                <button
                  type="button"
                  class="shell-watch-together__ctl"
                  onClick={onCancelEndActivity}
                >
                  Cancel ending activity
                </button>
              </div>
            )}
          </Show>

          <Show when={Boolean(ourNick()) && isHost()}>
            <button
              type="button"
              class="shell-watch-together__join"
              aria-label="Leave activity unavailable while hosting"
              title="Hand off host before leaving this activity"
              disabled
              data-testid="watch-leave-button"
            >
              Leave activity
            </button>
          </Show>

          <Show when={Boolean(ourNick()) && !isHost() && isParticipant()}>
            <button
              type="button"
              class="shell-watch-together__join"
              aria-label={leaveLabel()}
              title={publishingAvailable() ? 'Leave this watch activity' : 'Activity updates unavailable'}
              disabled={!publishingAvailable()}
              data-watch-revision={watchActionRevision()?.id}
              onClick={(event) => onLeave(event.currentTarget)}
              data-testid="watch-leave-button"
            >
              Leave activity
            </button>
          </Show>

          <Show when={Boolean(ourNick()) && !isHost() && !isParticipant()}>
            <button
              type="button"
              class="shell-watch-together__join"
              aria-label={joinLabel()}
              title={rosterFull() ? 'Activity participant limit reached' : publishingAvailable() ? 'Join this watch activity' : 'Activity updates unavailable'}
              disabled={rosterFull() || !publishingAvailable()}
              data-watch-revision={watchActionRevision()?.id}
              onClick={(event) => onJoin(event.currentTarget)}
              data-testid="watch-join-button"
            >
              Join activity
            </button>
          </Show>

          <Show when={safeHttpUrl(item().url)}>
            {(url) => (
              <a
                class="shell-watch-together__open"
                href={url()}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`Open ${item().title} in a new tab`}
              >
                Open
              </a>
            )}
          </Show>
        </section>
        )}
      </Show>
    </>
  );
}
