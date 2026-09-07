// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ScheduledMessagesSheet.tsx — the pending "send later" queue.
 *
 * A Sheet listing every message waiting to be dispatched (channel, a text
 * preview, and when it fires) with a per-entry cancel. Gated on the store's
 * showScheduledMessages flag; the Sheet primitive supplies focus-trap, Esc,
 * focus-restore and the dialog role, so this stays a thin, presentational list.
 *
 * SOLID IDIOMS: component runs once; never destructure props; reads via
 * useStore; lists via <For>; conditionals via <Show>.
 */
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { getState, isDmE2eeDesignated, selectChannelEncryptionPolicy, selectOwnedScheduledMessages, useStore } from '@/lib/store';
import { statsRoomHref } from '@/lib/stats/channelDetail';
import type { ScheduledMessage } from '@/lib/schedule/dispatch';
import { Sheet } from '@/primitives/Sheet';
import { RelativeTime } from '@/components/RelativeTime';
import { classifyScheduledMessage } from '@/lib/composer/scheduledSend';

export function ScheduledMessagesSheet() {
  const open = useStore((s) => s.showScheduledMessages);
  const scheduled = useStore(
    selectOwnedScheduledMessages,
    (left, right) => left.length === right.length
      && left.every((entry, index) => entry === right[index]),
  );
  const connectionStatus = useStore((s) => s.connectionStatus);
  const isIRCX = useStore((s) => s.isIRCX);
  const channelPropsSynced = useStore((s) => s.channelPropsSynced);
  const channelProps = useStore((s) => s.channelProps);
  const peerDmKeys = useStore((s) => s.peerDmKeys);
  const peerKeyChanges = useStore((s) => s.peerKeyChanges);
  const client = useStore((s) => s.client);
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    onCleanup(() => window.clearInterval(timer));
  });

  return (
    <Sheet
      open={open()}
      title="Scheduled messages"
      description="Messages waiting to send. They are kept on this device and send when their time arrives and you are connected."
      closeLabel="Close scheduled messages"
      onOpenChange={(next) =>
        next ? getState().openScheduledMessages() : getState().closeScheduledMessages()
      }
    >
      <Show
        when={scheduled().length > 0}
        fallback={<p class="shell-scheduled-empty"><strong>No scheduled messages.</strong><span>Use the clock in the composer to keep a message on this device until later.</span></p>}
      >
        <ul class="shell-scheduled-list" aria-label="Pending scheduled messages">
          <For each={scheduled()}>
            {(entry) => <ScheduledMessageRow entry={entry} now={now} chantypes={() => client()?.isupport.CHANTYPES ?? '#&'} connectionStatus={connectionStatus} isIRCX={isIRCX} channelPropsSynced={channelPropsSynced} channelProps={channelProps} peerDmKeys={peerDmKeys} peerKeyChanges={peerKeyChanges} />}
          </For>
        </ul>
      </Show>
    </Sheet>
  );
}

function ScheduledMessageRow(props: {
  entry: ScheduledMessage;
  now: () => number;
  chantypes: () => string;
  connectionStatus: () => string;
  isIRCX: () => boolean;
  channelPropsSynced: () => Set<string>;
  channelProps: () => unknown;
  peerDmKeys: () => unknown;
  peerKeyChanges: () => unknown;
}) {
  const channel = () => props.entry.channel.trim();
  const isChannel = createMemo(() => channel().length > 0 && props.chantypes().includes(channel()[0]!));
  const protectedHold = createMemo(() => props.isIRCX() && isChannel() && !props.channelPropsSynced().has(channel().toLowerCase()));
  const encryptionRequired = createMemo(() => isChannel()
    ? (props.channelProps(), selectChannelEncryptionPolicy(channel())(getState()) === 'required')
    : (props.peerDmKeys(), props.peerKeyChanges(), isDmE2eeDesignated(getState(), channel())));
  const state = createMemo(() => classifyScheduledMessage({ sendAt: props.entry.sendAt, now: props.now(), connected: props.connectionStatus() === 'connected', protected: protectedHold(), encryptionRequired: encryptionRequired() }));
  const stateLabel = createMemo(() => props.entry.claim
    ? 'Sending; delivery is uncertain'
    : state() === 'future' ? 'Saved; waiting for its time'
      : state() === 'overdue-disconnected' ? 'Waiting for connection'
        : state() === 'protected' ? 'Waiting for room protection'
          : state() === 'encryption-required' ? 'Waiting for encryption'
            : 'Due; awaiting send');
  const uncertain = () => !!props.entry.claim;
  return <li class="shell-scheduled-item">
    <div class="shell-scheduled-meta"><span class="shell-scheduled-channel">{isChannel() ? 'Room' : 'Direct message'} · {props.entry.channel}</span><RelativeTime timestamp={props.entry.sendAt} /></div>
    <p class="shell-scheduled-text">{props.entry.text}</p>
    <div class="shell-scheduled-actions">
      <span class="shell-scheduled-state" role="status">{stateLabel()}</span>
      <Show when={isChannel()}><a class="shell-scheduled-ledger shell-ribbon-stats" href={statsRoomHref(props.entry.channel)} aria-label={`Room ledger for ${props.entry.channel}`} data-testid="scheduled-channel-ledger">Room ledger</a></Show>
      <button type="button" class="shell-scheduled-cancel" aria-label={`${uncertain() ? 'Remove uncertain scheduled message' : 'Cancel scheduled message'} to ${props.entry.channel}: ${props.entry.text.slice(0, 40)}`} onClick={() => getState().cancelScheduledMessage(props.entry.id)}>{uncertain() ? 'Remove row' : 'Cancel'}</button>
    </div>
    <Show when={uncertain()}><p class="shell-scheduled-uncertain">Sending was attempted. Removing this row cannot confirm or undo delivery.</p></Show>
  </li>;
}
