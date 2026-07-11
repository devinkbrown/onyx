// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * SinceDigestCard - presentational since-you-left digest summary.
 */
import './SinceDigestCard.css';
import { createMemo, For, Show, type JSX } from 'solid-js';
import {
  digestHeadline,
  digestReaderNote,
  type ChannelDigest,
  type SinceDigest,
} from '@/lib/notifications/sinceDigest';
import { ProvenanceBadge } from './ProvenanceBadge';

const MAX_VISIBLE_PARTICIPANTS = 3;

export function SinceDigestCard(props: {
  digest: SinceDigest;
  onOpenChannel?: (channel: string) => void;
  onReviewUnread?: () => void;
}): JSX.Element {
  return (
    <section class="since-digest-card" aria-label="Since you left">
      <header class="since-digest-card__head">
        <p class="since-digest-card__kicker">Since you left</p>
        <h2 class="since-digest-card__title">{digestHeadline(props.digest)}</h2>
        <ProvenanceBadge scope="device" subject="Since-you-left digest" />
        <p class="since-digest-card__reader-note">{digestReaderNote(props.digest)}</p>
        <div class="since-digest-card__handoff">
          <p class="since-digest-card__since">since {formatSince(props.digest.since)}</p>
          <Show when={props.digest.totalMessages > 0 ? props.onReviewUnread : undefined} keyed>
            {(onReviewUnread) => (
              <button
                type="button"
                class="since-digest-card__review"
                onClick={() => onReviewUnread()}
              >
                Review new messages
              </button>
            )}
          </Show>
        </div>
      </header>

      <Show
        when={props.digest.totalMessages > 0}
        fallback={
          <div class="since-digest-card__empty">
            <span class="since-digest-card__empty-mark" aria-hidden="true">
              0
            </span>
            <div>
              <h3>All caught up</h3>
              <p>No missed messages since your last visit.</p>
            </div>
          </div>
        }
      >
        <ul class="since-digest-card__list" role="list">
          <For each={props.digest.channels}>
            {(channelDigest) => (
              <li class="since-digest-card__item">
                <Show
                  when={props.onOpenChannel}
                  keyed
                  fallback={
                    <div class={rowClass(channelDigest)}>
                      <ChannelDigestRowContent channelDigest={channelDigest} />
                    </div>
                  }
                >
                  {(onOpenChannel) => (
                    <button
                      type="button"
                      class={`${rowClass(channelDigest)} since-digest-card__row--button`}
                      aria-label={rowAriaLabel(channelDigest)}
                      onClick={() => onOpenChannel(channelDigest.channel)}
                    >
                      <ChannelDigestRowContent channelDigest={channelDigest} />
                    </button>
                  )}
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function ChannelDigestRowContent(props: { channelDigest: ChannelDigest }): JSX.Element {
  const visibleParticipants = createMemo(() =>
    props.channelDigest.participants.slice(0, MAX_VISIBLE_PARTICIPANTS),
  );
  const overflowCount = createMemo(() =>
    Math.max(props.channelDigest.participants.length - MAX_VISIBLE_PARTICIPANTS, 0),
  );
  const recallTerms = createMemo(() => props.channelDigest.recallTerms.slice(0, 3));

  return (
    <>
      <span class="since-digest-card__main">
        <span class="since-digest-card__channel">{props.channelDigest.channel}</span>
        <span class="since-digest-card__meta">
          <Show
            when={visibleParticipants().length > 0}
            fallback={<span class="since-digest-card__muted">activity only</span>}
          >
            <span class="since-digest-card__participants">
              <For each={visibleParticipants()}>
                {(participant) => (
                  <span class="since-digest-card__participant">{participant}</span>
                )}
              </For>
              <Show when={overflowCount() > 0}>
                <span class="since-digest-card__participant-overflow">+{overflowCount()}</span>
              </Show>
            </span>
          </Show>
          <span class="since-digest-card__window">{formatChannelWindow(props.channelDigest)}</span>
        </span>
        <Show when={recallTerms().length > 0}>
          <span
            class="since-digest-card__recall"
            aria-label={`Local recall terms for ${props.channelDigest.channel}: ${recallTerms().join(', ')}`}
          >
            <For each={recallTerms()}>
              {(term) => <span class="since-digest-card__recall-term">{term}</span>}
            </For>
          </span>
        </Show>
      </span>

      <span class="since-digest-card__stats">
        <Show when={props.channelDigest.mentions > 0}>
          <span class="since-digest-card__mentions">
            {props.channelDigest.mentions.toLocaleString()} @you
          </span>
        </Show>
        <span class="since-digest-card__count">
          {props.channelDigest.count.toLocaleString()}
          <span>msgs</span>
        </span>
      </span>
    </>
  );
}

function rowClass(channelDigest: ChannelDigest): string {
  return `since-digest-card__row${hasMentions(channelDigest) ? ' is-mentioned' : ''}`;
}

function hasMentions(channelDigest: ChannelDigest): boolean {
  return channelDigest.mentions > 0;
}

function rowAriaLabel(channelDigest: ChannelDigest): string {
  const messageLabel = channelDigest.count === 1 ? 'message' : 'messages';
  const mentionLabel = channelDigest.mentions === 1 ? 'mention' : 'mentions';
  const mentionSummary =
    channelDigest.mentions > 0
      ? `, ${channelDigest.mentions.toLocaleString()} ${mentionLabel}`
      : '';

  return `Open ${channelDigest.channel}, ${channelDigest.count.toLocaleString()} ${messageLabel}${mentionSummary}`;
}

function formatSince(since: Date): string {
  return since.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatChannelWindow(channelDigest: ChannelDigest): string {
  if (channelDigest.firstAt.getTime() === channelDigest.lastAt.getTime()) {
    return `last ${formatClock(channelDigest.lastAt)}`;
  }

  return `${formatClock(channelDigest.firstAt)}-${formatClock(channelDigest.lastAt)}`;
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}
