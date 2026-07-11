// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ChannelNotifyControl.tsx — compact per-channel notification-level control for
 * the presence ribbon's channel cluster.
 *
 * Lets any member set a channel's personal alert level (All / Mentions / Mute)
 * directly, without opening Channel settings. This is a per-device preference:
 * the store's `channelNotify` map is the single source of truth, so a change
 * lands synchronously (no server round-trip) via the EXISTING
 * `setChannelNotifyMode` action — this component invents no state and no action.
 *
 * The active segment reflects `channelNotifyMode(channelNotify, channel)`
 * reactively. Muting/mentions-only gating is applied upstream by the notify
 * decision engine that reads the same map; this control only writes it.
 *
 * a11y: a roving-tabindex radio group (WCAG SC 2.1.1) — the group is one tab
 * stop, only the selected radio is tabbable, and Arrow/Home/End move both
 * selection and focus (selection follows focus). Each segment is a labelled
 * radio; the selected state is exposed via aria-checked and shown with a filled
 * surface plus heavier weight (not color alone). The group is named for the
 * channel it controls.
 *
 * SOLID IDIOMS: component body runs once; never destructure props; splitProps;
 * For; reads go through useStore, the write through getState().
 */

import { createMemo, For, splitProps, type JSX } from 'solid-js';
import { useStore, getState } from '@/lib/store';
import { channelNotifyMode } from '@/lib/notifications/channelNotifyMode';
import {
  CHANNEL_NOTIFY_OPTIONS,
  channelNotifyIndex,
  nextChannelNotifyIndex,
} from '@/lib/notifications/channelNotifyControl';
import './ChannelNotifyControl.css';

export interface ChannelNotifyControlProps {
  /** Display-cased channel name (e.g. "#general"). */
  channel: string;
  class?: string;
}

export function ChannelNotifyControl(props: ChannelNotifyControlProps): JSX.Element {
  const [local] = splitProps(props, ['channel', 'class']);

  // Derive the active mode reactively from BOTH inputs: the store's map (which
  // is replaced on every write, so the useStore signal fires) AND local.channel
  // (so the control stays correct if the channel prop changes in place, e.g. the
  // non-keyed <Show> that hosts it in the ribbon). createMemo re-runs on either.
  const channelNotify = useStore((s) => s.channelNotify);
  const mode = createMemo(() => channelNotifyMode(channelNotify(), local.channel));

  // Refs so the roving key handler can move DOM focus to the newly-selected
  // radio when selection follows focus.
  const segments: (HTMLButtonElement | undefined)[] = [];

  function selectAt(index: number): void {
    const option = CHANNEL_NOTIFY_OPTIONS[index];
    if (option === undefined) return;
    getState().setChannelNotifyMode(local.channel, option.mode);
    segments[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent): void {
    const next = nextChannelNotifyIndex(channelNotifyIndex(mode()), event.key);
    if (next === null) return;
    event.preventDefault();
    selectAt(next);
  }

  const className = (): string =>
    local.class ? `chan-notify ${local.class}` : 'chan-notify';

  return (
    <div
      class={className()}
      role="radiogroup"
      aria-label={`Notifications for ${local.channel}`}
      onKeyDown={onKeyDown}
    >
      <For each={CHANNEL_NOTIFY_OPTIONS}>
        {(option, index) => {
          const active = (): boolean => mode() === option.mode;
          return (
            <button
              ref={(el) => (segments[index()] = el)}
              type="button"
              class="chan-notify-seg"
              role="radio"
              aria-checked={active()}
              aria-label={option.title}
              title={option.title}
              tabindex={active() ? 0 : -1}
              onClick={() => getState().setChannelNotifyMode(local.channel, option.mode)}
            >
              <span aria-hidden="true">{option.label}</span>
            </button>
          );
        }}
      </For>
    </div>
  );
}
