// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import './public-info.css';
import './guides.css';
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { PublicFrame } from '@/ui/public';
import { setPageMeta } from './pageMeta';
import NotFoundPage from './NotFound';
import {
  guideProgressSummary,
  readGuideProgress,
  writeGuideProgress,
} from '@/lib/guides/progress';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import {
  buildRoomStarterExport,
  buildRoomStarterRoute,
  ROOM_STARTER_EXPORT_FILENAME,
  ROOM_STARTER_SAFETY_NOTES,
} from '@/lib/guides/roomStarter';

export type GuidesSurface = 'guides' | 'community';

const GUIDES_PATHS = {
  '/guides': 'guides',
  '/guides/': 'guides',
  '/community': 'community',
  '/community/': 'community',
} as const satisfies Readonly<Record<string, GuidesSurface>>;

export function resolveGuidesSurface(path: string): GuidesSurface {
  const surface = GUIDES_PATHS[path as keyof typeof GUIDES_PATHS];
  if (!surface) throw new Error('Onyx: Guides route was not allowlisted');
  return surface;
}

export const GUIDE_PAGE_META = {
  guides: {
    title: 'Onyx guides — join a room in the official app',
    description: 'Short how-tos for joining a room, inviting a friend, private messages, calls, and keeping Onyx on this device.',
    kicker: 'Guides',
    mainLabel: 'Onyx guides',
    contextLabel: 'Getting started',
  },
  community: {
    title: 'Onyx community — how to join and be here',
    description: 'How to join a room in Onyx, invite a friend, and treat each other well. The official app is the usual way in.',
    kicker: 'Community',
    mainLabel: 'Onyx community',
    contextLabel: 'Getting started',
  },
} as const satisfies Record<GuidesSurface, {
  title: string;
  description: string;
  kicker: string;
  mainLabel: string;
  contextLabel: string;
}>;

export const GUIDE_HOWTOS = [
  {
    id: 'join',
    title: 'Join a room',
    optional: false,
    body: [
      'Open Onyx in your browser. Pick a name — guests are welcome, and an account is optional.',
      'Browse rooms, or open a room someone invited you to. Say hello.',
    ],
    links: [
      { href: '/app/', label: 'Join a room' },
      { href: '/app/?join=%23root', label: 'Open the public room' },
    ],
  },
  {
    id: 'invite',
    title: 'Invite a friend',
    optional: false,
    body: [
      'Send them to Onyx, or share an invite if you have one. They can join as a guest and pick a name.',
      'Tell them the room you are in. Friends, clubs, and class groups all start the same way: one person opens the door.',
    ],
    links: [
      { href: '/invite/', label: 'Open an invite' },
    ],
  },
  {
    id: 'messages',
    title: 'Messages and private DMs',
    optional: false,
    body: [
      'Rooms are shared conversations. Everyone in the room can read them.',
      'Direct messages are one-to-one. Those can be private: Onyx seals them on your device so the rest of the room does not see the words. If a private message cannot open, it stays locked instead of turning into plain text.',
      'Group rooms are not end-to-end encrypted. Passkeys are not the everyday way to sign in.',
    ],
    links: [],
  },
  {
    id: 'calls',
    title: 'Calls when you want them',
    optional: false,
    body: [
      'In a room, start a call when you want one — voice, video, or your screen. Joining is a choice; a call does not pull you in.',
      'Calls are not recorded. You can see whether the call is protected while you are in it.',
    ],
    links: [],
  },
  {
    id: 'this-device',
    title: 'Keep it on this device',
    optional: false,
    body: [
      'Add Onyx to your Home Screen so it sits with your other apps. On a phone, use the browser menu or Share, then Add to Home Screen. On a computer, use the browser menu and Install app when your browser offers it.',
      'Your history and sign-in stay on this device. Coming back in the same browser usually picks up where you left off.',
    ],
    links: [
      { href: '/download/', label: 'Other ways to keep Onyx' },
    ],
  },
  {
    id: 'another-client',
    title: 'Another client, or your own server',
    optional: true,
    body: [
      'The official Onyx app in the browser is the usual way in.',
      'Other ways in are available for people who need them, but the official Onyx app in the browser is the usual way to join.',
      'Running your own copy of the engine is for people who want to operate a server.',
    ],
    links: [
      { href: 'https://github.com/devinkbrown/onyx-server', label: 'Onyx Server on GitHub' },
      { href: '/about/', label: 'How Onyx is put together' },
    ],
  },
] as const;

const REQUIRED_GUIDE_IDS = GUIDE_HOWTOS.filter((howto) => !howto.optional).map((howto) => howto.id);
const REQUIRED_GUIDE_STEPS = GUIDE_HOWTOS.filter((howto) => !howto.optional).map(({ id, title }) => ({ id, title }));

type RoomStarterShareState = 'idle' | 'copying' | 'copied' | 'failed';

function guideTitle(id: string): string {
  return GUIDE_HOWTOS.find((howto) => howto.id === id)?.title ?? 'the next step';
}

export function Guides(props: { surface: GuidesSurface }) {
  const meta = createMemo(() => GUIDE_PAGE_META[props.surface]);
  const [completed, setCompleted] = createSignal<ReadonlySet<string>>(new Set());
  const progress = createMemo(() => guideProgressSummary(REQUIRED_GUIDE_IDS, completed()));
  const roomStarterRoute = createMemo(() => buildRoomStarterRoute(REQUIRED_GUIDE_STEPS, completed()));
  const roomStarterExport = createMemo(() => buildRoomStarterExport(REQUIRED_GUIDE_STEPS, completed()));
  const roomStarterDownload = createMemo(
    () => `data:text/plain;charset=utf-8,${encodeURIComponent(roomStarterExport())}`,
  );
  const [shareState, setShareState] = createSignal<RoomStarterShareState>('idle');
  let shareAttempt = 0;
  let disposed = false;

  onMount(() => {
    setCompleted(readGuideProgress(window.localStorage, REQUIRED_GUIDE_IDS));
  });

  function toggleStep(id: string): void {
    setCompleted((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeGuideProgress(window.localStorage, REQUIRED_GUIDE_IDS, next);
      return next;
    });
  }

  function resetPlan(): void {
    const next = new Set<string>();
    setCompleted(next);
    writeGuideProgress(window.localStorage, REQUIRED_GUIDE_IDS, next);
  }

  async function copyRoomStarterPlan(): Promise<void> {
    if (shareState() === 'copying') return;

    const attempt = ++shareAttempt;
    setShareState('copying');
    const copied = await writeClipboardText(roomStarterExport()).catch(() => false);
    if (disposed || attempt !== shareAttempt) return;
    setShareState(copied ? 'copied' : 'failed');
  }

  createEffect(() => {
    completed();
    shareAttempt += 1;
    setShareState('idle');
  });

  onCleanup(() => {
    disposed = true;
    shareAttempt += 1;
  });

  createEffect(() => {
    const item = meta();
    setPageMeta(item.title, item.description, `/${props.surface}/`);
  });

  return (
    <PublicFrame
      currentPath={`/${props.surface}/`}
      mainLabel={meta().mainLabel}
      context={(
        <p class="public-frame__current-line">
          <span class="public-frame__current-kicker">{meta().kicker}</span>
          <span aria-hidden="true">·</span>
          <span class="public-frame__current-label">{meta().contextLabel}</span>
        </p>
      )}
    >
      <div class={`ui-root r data-page public-info-page guides-page guides-page--${props.surface}`}>
        <div class="r-ground" aria-hidden="true" />
        <div class="r-flecks" aria-hidden="true" />
        <section class="r-wrap data-hero">
          <p class="r-kicker">{meta().kicker}</p>
          <h1>Getting started</h1>
          <p class="sub">
            Friends, clubs, rooms. Open Onyx in your browser, join a room, and talk.
            These short how-tos are for the official app — not another chat program.
          </p>
          <p class="guides-hero-actions">
            <a class="guides-action" href="/app/">Join a room</a>
          </p>
        </section>
        <section class="r-wrap r-section guides-body">
          <section class="guides-progress" aria-labelledby="guides-progress-title">
            <div class="guides-progress__head">
              <div>
                <p class="guides-progress__eyebrow">Your first room plan</p>
                <h2 id="guides-progress-title">One small step at a time</h2>
              </div>
              <span class="guides-progress__count">{progress().complete} of {progress().total}</span>
            </div>
            <progress
              class="guides-progress__meter"
              aria-label="Guide plan progress"
              max={progress().total}
              value={progress().complete}
              aria-describedby="guides-progress-status"
            >
              {progress().complete} of {progress().total}
            </progress>
            <p class="guides-progress__status" id="guides-progress-status" role="status">
              <Show
                when={progress().done}
                fallback={<>Your progress stays in this browser. Next: {guideTitle(progress().nextId ?? '')}.</>}
              >
                You have your bearings. Start a conversation when you are ready.
              </Show>
            </p>
            <section class="guides-route-map" aria-labelledby="guides-route-title">
              <div class="guides-route-map__head">
                <p class="guides-route-map__eyebrow">Room starter</p>
                <h3 id="guides-route-title">A route for the first room</h3>
              </div>
              <ol class="guides-route" aria-label="First room route">
                <For each={roomStarterRoute()}>
                  {(step) => (
                    <li class="guides-route__item" data-state={step.state}>
                      <a
                        class="guides-route__card"
                        href={`#${step.id}`}
                        aria-current={step.state === 'current' ? 'step' : undefined}
                      >
                        <span class="guides-route__number" aria-hidden="true">{step.number}</span>
                        <span class="guides-route__copy">
                          <span class="guides-route__state">{step.stateLabel}</span>
                          <span class="guides-route__title">{step.title}</span>
                        </span>
                      </a>
                    </li>
                  )}
                </For>
              </ol>
            </section>
            <div class="guides-starter-details">
              <section class="guides-snapshot" aria-labelledby="guides-snapshot-title">
                <p class="guides-snapshot__eyebrow">Before you enter</p>
                <h3 id="guides-snapshot-title">Privacy and safety, at a glance</h3>
                <ul>
                  <For each={ROOM_STARTER_SAFETY_NOTES}>
                    {(note) => <li>{note}</li>}
                  </For>
                </ul>
              </section>
              <section class="guides-share" aria-labelledby="guides-share-title">
                <p class="guides-share__eyebrow">Your handoff slip</p>
                <h3 id="guides-share-title">Share this plan locally</h3>
                <p>Copy or download this small text plan. Onyx does not send it anywhere.</p>
                <div class="guides-share__actions">
                  <button
                    class="guides-copy"
                    type="button"
                    aria-label="Copy first-room plan"
                    aria-describedby="guides-share-status"
                    disabled={shareState() === 'copying'}
                    onClick={copyRoomStarterPlan}
                  >
                    <Show when={shareState() === 'copying'} fallback="Copy plan">Copying plan…</Show>
                  </button>
                  <a
                    class="guides-download"
                    href={roomStarterDownload()}
                    download={ROOM_STARTER_EXPORT_FILENAME}
                  >
                    Download text
                  </a>
                </div>
                <p
                  class="guides-share__status"
                  id="guides-share-status"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  aria-label="Plan share status"
                >
                  <Show when={shareState() === 'copying'}>
                    Creating your local plan…
                  </Show>
                  <Show when={shareState() === 'copied'}>
                    First-room plan copied. It was created here and nothing was sent.
                  </Show>
                  <Show when={shareState() === 'failed'}>
                    Copy did not complete. Download the text instead; nothing was sent.
                  </Show>
                </p>
              </section>
            </div>
            <div class="guides-progress__actions">
              <Show when={progress().nextId}>
                {(nextId) => <a class="guides-action" href={`#${nextId()}`}>Go to: {guideTitle(nextId())}</a>}
              </Show>
              <Show when={progress().complete > 0}>
                <button class="guides-reset" type="button" onClick={resetPlan}>Reset plan</button>
              </Show>
            </div>
          </section>
          <article class="data-card public-info-card guides-card" id="together">
            <div class="label">How we treat each other</div>
            <h2>Be kind, then talk</h2>
            <p>
              Welcome people. Argue about ideas, not people. Do not harass anyone,
              do not share someone else&apos;s private information, and do not spam.
              A room can be stricter than that. If a room is not for you, leave.
            </p>
          </article>
          <For each={GUIDE_HOWTOS}>
            {(howto) => (
              <article
                class="data-card public-info-card guides-card"
                classList={{
                  'guides-card--optional': howto.optional,
                  'guides-card--complete': !howto.optional && completed().has(howto.id),
                }}
                id={howto.id}
              >
                <div class="guides-card__meta">
                  <div class="label">{howto.optional ? 'Optional' : 'How-to'}</div>
                  <Show when={!howto.optional}>
                    <button
                      class="guides-step-toggle"
                      type="button"
                      aria-pressed={completed().has(howto.id)}
                      aria-label={`Mark ${howto.title} ${completed().has(howto.id) ? 'not complete' : 'complete'}`}
                      onClick={() => toggleStep(howto.id)}
                    >
                      {completed().has(howto.id) ? 'Done' : 'Mark done'}
                    </button>
                  </Show>
                </div>
                <h2>{howto.title}</h2>
                <For each={howto.body}>
                  {(paragraph) => <p>{paragraph}</p>}
                </For>
                <Show when={howto.links.length > 0}>
                  <p class="guides-card-actions">
                    <For each={howto.links}>
                      {(link) => (
                        <a
                          class="guides-action"
                          href={link.href}
                          rel={link.href.startsWith('http') ? 'noreferrer noopener' : undefined}
                          target={link.href.startsWith('http') ? '_blank' : undefined}
                        >
                          {link.label}
                        </a>
                      )}
                    </For>
                  </p>
                </Show>
              </article>
            )}
          </For>
        </section>
      </div>
    </PublicFrame>
  );
}

/** Route-facing resolver; the named component remains useful for focused rendering tests. */
export default function GuidesRoute() {
  const location = useLocation();
  const surface = () => GUIDES_PATHS[location.pathname as keyof typeof GUIDES_PATHS];
  return (
    <Show when={surface()} fallback={<NotFoundPage />}>
      {(current) => <Guides surface={current()} />}
    </Show>
  );
}
