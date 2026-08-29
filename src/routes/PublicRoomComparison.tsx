// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PublicRoomComparison.tsx — a two-room, aggregate-only comparison plane.
 *
 * The public room directory already exposes enough normalized signal to answer
 * "which room is moving?" without fetching another endpoint. This component
 * keeps that comparison deliberately small: two rooms, four public counters,
 * and an honest feed-state caveat.
 */
import './public-room-comparison.css';
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import { relTime, type StatsChannel } from '@/lib/stats/networkIndex';
import type { StatsFeedState } from './Stats';

export const MAX_COMPARE_ROOMS = 2;

const MAX_ROOM_NAME_LENGTH = 128;
const VALID_ROOM = /^(?:#|&)[^\u0000\r\n\t ,]+$/u;

export type PublicRoomComparisonProps = {
  channels: () => readonly StatsChannel[];
  selectedChannels: () => readonly string[];
  feedState: () => StatsFeedState;
  totalMessages: () => number;
  nowMs: () => number;
  shareHref: () => string;
  onToggle: (channel: string) => void;
  onClear: () => void;
};

function validRoom(value: string): boolean {
  return value.length <= MAX_ROOM_NAME_LENGTH && VALID_ROOM.test(value);
}

/** Read at most two valid, distinct room names from the shareable URL state. */
export function parseStatsCompareQuery(search: string): string[] {
  const query = search.startsWith('?') ? search.slice(1) : search;
  let raw: string;
  try {
    raw = new URLSearchParams(query).get('compare') ?? '';
  } catch {
    return [];
  }
  const rooms: string[] = [];
  const seen = new Set<string>();
  for (const candidate of raw.split(',')) {
    const room = candidate.trim();
    const key = room.toLocaleLowerCase('en');
    if (!validRoom(room) || seen.has(key)) continue;
    seen.add(key);
    rooms.push(room);
    if (rooms.length === MAX_COMPARE_ROOMS) break;
  }
  return rooms;
}

/** Serialize valid room names for URLSearchParams.set without double-encoding. */
export function statsCompareQuery(channels: readonly string[]): string {
  const rooms: string[] = [];
  const seen = new Set<string>();
  for (const candidate of channels) {
    const room = candidate.trim();
    const key = room.toLocaleLowerCase('en');
    if (!validRoom(room) || seen.has(key)) continue;
    seen.add(key);
    rooms.push(room);
    if (rooms.length === MAX_COMPARE_ROOMS) break;
  }
  return rooms.join(',');
}

function safeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function roomPulse(channel: StatsChannel): number {
  return channel.spark.reduce((sum, point) => sum + safeCount(point), 0);
}

function formatCount(value: number): string {
  return Math.round(safeCount(value)).toLocaleString('en-US');
}

function networkShare(messages: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '—';
  const share = Math.min(100, Math.max(0, (safeCount(messages) / total) * 100));
  return `${share.toFixed(share >= 10 ? 0 : 1)}%`;
}

function selectionCopy(selected: number, available: number): string {
  if (available === 0) return 'Room choices will appear when a public room index is available.';
  if (selected === 0) return 'Select two rooms from the directory below to compare their public pulse.';
  if (selected === 1) return 'One room selected. Add one more room to unlock the side-by-side read.';
  return 'Two rooms selected. The comparison uses aggregate public counters only.';
}

function feedNote(state: StatsFeedState, selected: number, missing: number): string {
  if (state === 'loading') return 'Waiting for the public room index. No comparison claim yet.';
  if (state === 'unavailable') return 'Room comparison is unavailable until a public room index is exported.';
  if (missing > 0) return `${missing} selected ${missing === 1 ? 'room is' : 'rooms are'} not in this export. Clear the selection or choose another room.`;
  if (state === 'partial') return 'This export is incomplete. Compare only the validated aggregate rows shown here.';
  if (state !== 'current') return 'This is a retained snapshot. It remains useful for context, not as a current claim.';
  return selected === MAX_COMPARE_ROOMS
    ? 'Current export · aggregate-only comparison · no message text or participant rankings.'
    : 'Current export · choose up to two rooms from the public directory.';
}

function stepState(state: StatsFeedState): 'loading' | 'unavailable' | 'snapshot' | 'current' {
  if (state === 'loading') return 'loading';
  if (state === 'unavailable') return 'unavailable';
  if (state === 'current') return 'current';
  return 'snapshot';
}

export function PublicRoomComparison(props: PublicRoomComparisonProps): JSX.Element {
  const [shareState, setShareState] = createSignal<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  let shareEpoch = 0;
  let disposed = false;

  // The URL is the comparison's source of truth. A clipboard result for a
  // previous selection must never announce that the newly rendered rooms were
  // copied.
  createEffect(() => {
    props.shareHref();
    shareEpoch += 1;
    setShareState('idle');
  });

  onCleanup(() => {
    disposed = true;
    shareEpoch += 1;
  });

  const selectedRooms = createMemo(() => props.selectedChannels()
    .map((selected) => props.channels().find((channel) => channel.channel.toLocaleLowerCase('en') === selected.toLocaleLowerCase('en')))
    .filter((channel): channel is StatsChannel => Boolean(channel)));
  const missingRooms = createMemo(() => Math.max(0, props.selectedChannels().length - selectedRooms().length));
  const maxMessages = createMemo(() => Math.max(1, ...selectedRooms().map((channel) => safeCount(channel.messages))));
  const comparisonHeadline = createMemo(() => {
    const rooms = selectedRooms();
    if (rooms.length < 2) return '';
    const [left, right] = rooms;
    const difference = Math.abs(left!.messages - right!.messages);
    if (difference === 0) return `${left!.channel} and ${right!.channel} are level on tracked messages.`;
    const leader = left!.messages > right!.messages ? left : right;
    return `${leader!.channel} leads by ${formatCount(difference)} tracked ${difference === 1 ? 'message' : 'messages'}.`;
  });

  const copyComparisonLink = async (): Promise<void> => {
    if (shareState() === 'copying') return;
    const href = props.shareHref();
    if (!href) return;
    const epoch = ++shareEpoch;
    setShareState('copying');
    let copied: boolean;
    try {
      copied = await writeClipboardText(href);
    } catch {
      copied = false;
    }
    if (disposed || epoch !== shareEpoch) return;
    setShareState(copied ? 'copied' : 'failed');
  };

  return (
    <section
      id="room-comparison"
      class="r-wrap r-section public-room-comparison"
      data-feed-state={props.feedState()}
      data-testid="public-room-comparison"
      aria-labelledby="room-comparison-heading"
    >
      <div class="public-room-comparison__head">
        <div>
          <span class="r-eyebrow">public observatory</span>
          <h2 class="r-title" id="room-comparison-heading">Put two rooms side by side.</h2>
          <p class="public-room-comparison__lede" id="room-comparison-help">
            Compare the rooms&rsquo; public pulse without opening their messages or ranking their people.
          </p>
        </div>
        <Show when={props.selectedChannels().length > 0}>
          <div class="public-room-comparison__actions">
            <button
              type="button"
              class="public-room-comparison__share"
              onClick={() => void copyComparisonLink()}
              aria-label="Copy comparison link"
              aria-busy={shareState() === 'copying' || undefined}
              disabled={shareState() === 'copying'}
            >
              {shareState() === 'copying' ? 'Copying…' : shareState() === 'copied' ? 'Link copied' : 'Copy link'}
            </button>
            <button
              type="button"
              class="public-room-comparison__clear"
              onClick={() => props.onClear()}
              aria-label="Clear room comparison"
            >
              Clear selection
            </button>
          </div>
        </Show>
      </div>

      <Show when={shareState() === 'copied' || shareState() === 'failed'}>
        <p
          class="public-room-comparison__share-status"
          role={shareState() === 'failed' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {shareState() === 'copied'
            ? 'Comparison link copied to clipboard.'
            : 'Copy failed. Use your browser address bar to share this comparison.'}
        </p>
      </Show>

      <div class="public-room-comparison__ledger" data-state={stepState(props.feedState())}>
        <span class="public-room-comparison__marker" aria-hidden="true" />
        <p aria-live="polite" aria-atomic="true">
          {feedNote(props.feedState(), props.selectedChannels().length, missingRooms())}
        </p>
      </div>

      <Show
        when={props.channels().length > 0}
        fallback={(
          <div class="public-room-comparison__empty" data-state={stepState(props.feedState())}>
            <strong>{props.feedState() === 'loading' ? 'Room choices are loading.' : 'Room comparison is unavailable.'}</strong>
            <p>{selectionCopy(0, 0)}</p>
          </div>
        )}
      >
        <p class="public-room-comparison__selection" aria-live="polite" aria-atomic="true">
          {selectionCopy(props.selectedChannels().length, props.channels().length)}
        </p>

        <Show when={selectedRooms().length > 0}>
          <div class="public-room-comparison__chips" role="list" aria-label="Selected rooms">
            <For each={selectedRooms()}>
              {(room) => (
                <div role="listitem">
                  <button
                    type="button"
                    class="public-room-comparison__chip"
                    onClick={() => props.onToggle(room.channel)}
                    aria-label={`Remove ${room.channel} from comparison`}
                  >
                    <span>{room.channel}</span>
                    <span aria-hidden="true">&times;</span>
                  </button>
                </div>
              )}
            </For>
            <Show when={missingRooms() > 0}>
              <span class="public-room-comparison__missing" role="listitem">
                {missingRooms()} missing from export
              </span>
            </Show>
          </div>
        </Show>

        <Show
          when={selectedRooms().length > 0}
          fallback={(
            <div class="public-room-comparison__prompt">
              <span class="public-room-comparison__prompt-mark" aria-hidden="true">+</span>
              <p>Use <strong>Compare</strong> on any room below. You can keep one or two rooms here while you browse the directory.</p>
            </div>
          )}
        >
          <div class="public-room-comparison__table-wrap" tabindex="0" role="region" aria-label="Selected room comparison">
            <table class="public-room-comparison__table">
              <caption class="sr-only">Aggregate comparison of selected public rooms</caption>
              <thead>
                <tr>
                  <th scope="col">Signal</th>
                  <For each={selectedRooms()}>{(room) => <th scope="col">{room.channel}</th>}</For>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Messages tracked</th>
                  <For each={selectedRooms()}>
                    {(room) => (
                      <td>
                        <strong>{formatCount(room.messages)}</strong>
                        <span class="public-room-comparison__bar" aria-hidden="true">
                          <i style={{ width: `${Math.round((safeCount(room.messages) / maxMessages()) * 100)}%` }} />
                        </span>
                      </td>
                    )}
                  </For>
                </tr>
                <tr>
                  <th scope="row">Activity pulse</th>
                  <For each={selectedRooms()}>{(room) => <td>{formatCount(roomPulse(room))}</td>}</For>
                </tr>
                <tr>
                  <th scope="row">Present now</th>
                  <For each={selectedRooms()}>{(room) => <td>{formatCount(room.present)}</td>}</For>
                </tr>
                <tr>
                  <th scope="row">Network share</th>
                  <For each={selectedRooms()}>{(room) => <td>{networkShare(room.messages, props.totalMessages())}</td>}</For>
                </tr>
                <tr>
                  <th scope="row">Last active</th>
                  <For each={selectedRooms()}>{(room) => <td>{relTime(room.last_active, props.nowMs())}</td>}</For>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="public-room-comparison__headline" aria-live="polite">{comparisonHeadline()}</p>
        </Show>
      </Show>

      <p class="public-room-comparison__privacy">
        Aggregate view only: room totals, pulse, presence, and recency. No message text, private-room traffic, or participant ranking is read here.
      </p>
    </section>
  );
}

export default PublicRoomComparison;
