// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ChannelSettings.tsx — channel topic + modes panel (Sheet).
 *
 * Opened from the PresenceRibbon gear affordance for the active channel.
 *
 * Gating:
 *   - Topic: editable by anyone, UNLESS the channel is +t (topic-locked), in
 *     which case only ops (or higher) may change it. Non-permitted users see a
 *     read-only topic.
 *   - Modes: the toggle grid + key/limit inputs are op-only. Non-ops get a
 *     read-only summary of the channel's current modes.
 *
 * All channel state is read live from the store (selectChannelModeState,
 * selectIsChannelOp). Every change is dispatched as a raw IRC command via the
 * store actions; the server's MODE/TOPIC echo updates state, so this panel
 * never optimistically mutates.
 *
 * SOLID IDIOMS: never destructure props; splitProps; createMemo; Show/For.
 * a11y: labelled controls, focus-trapped Sheet, reduced-motion via tokens.
 */

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  splitProps,
  type JSX,
} from 'solid-js';
import {
  useStore,
  getState,
  selectChannelEncryptionPolicy,
  selectChannelEphemeralSeconds,
  selectChannelModeState,
  selectIsChannelOp,
} from '@/lib/store';
import {
  readChannelTopicDraft,
  saveChannelTopicDraft,
} from '@/lib/channel/topicDrafts';
import {
  channelNotifyMode,
  type NotifyMode,
} from '@/lib/notifications/channelNotifyMode';
import {
  BRIDGE_STATUS_PROP,
  parseBridgeStatus,
} from '@/lib/interop/bridgeStatus';
import { Button, FormField, Sheet } from '@/primitives/index';
import { BridgeStatusBadge } from './BridgeStatusBadge';

// Common simple channel flags exposed as toggles. Letters match Orochi's
// CHANMODES group D (flags) — see ISUPPORT `imnstCTNMSgWOA`.
const FLAG_TOGGLES: ReadonlyArray<{ letter: string; label: string; hint: string }> = [
  { letter: 'm', label: 'Moderated', hint: 'Only voiced members and ops may speak (+m)' },
  { letter: 'i', label: 'Invite only', hint: 'Members must be invited to join (+i)' },
  { letter: 't', label: 'Topic locked', hint: 'Only ops may change the topic (+t)' },
  { letter: 'n', label: 'No external messages', hint: 'Block messages from non-members (+n)' },
  { letter: 's', label: 'Secret', hint: 'Hide the channel from listings (+s)' },
];

const EPHEMERAL_PRESETS: ReadonlyArray<{ seconds: number; label: string }> = [
  { seconds: 0, label: 'Off' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 86_400, label: '1 day' },
  { seconds: 604_800, label: '7 days' },
  { seconds: 2_592_000, label: '30 days' },
];

// Personal (per-device) notification preference for this channel. Unlike the
// op-only channel modes below, every member sets their own; the store is the
// single source of truth, so changes apply immediately (no server round-trip).
const NOTIFY_OPTIONS: ReadonlyArray<{ value: NotifyMode; label: string }> = [
  { value: 'all', label: 'All messages' },
  { value: 'mentions', label: 'Mentions only' },
  { value: 'mute', label: 'Mute' },
];

const ENCRYPTION_POLICIES = [
  { value: 'off', label: 'Off', hint: 'Plaintext and encrypted messages are both accepted.' },
  { value: 'optional', label: 'Optional', hint: 'Encrypted messages are marked when clients support Orochi E2EE.' },
  { value: 'required', label: 'Required', hint: 'Clients should send only E2EE-tagged payloads here.' },
] as const;

function formatEphemeral(seconds: number | null): string {
  if (!seconds) return 'Full history';
  const preset = EPHEMERAL_PRESETS.find((p) => p.seconds === seconds);
  if (preset && preset.seconds !== 0) return preset.label;
  if (seconds % 86_400 === 0) return `${seconds / 86_400} days`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hours`;
  if (seconds % 60 === 0) return `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

export type ChannelSettingsProps = {
  /** The active channel name (e.g. "#general"). */
  channel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ChannelSettings(props: ChannelSettingsProps): JSX.Element {
  const [local] = splitProps(props, ['channel', 'open', 'onOpenChange']);

  const channels = useStore((s) => s.channels);
  const modeState = useStore((s) => selectChannelModeState(local.channel)(s));
  const ephemeralSeconds = useStore((s) => selectChannelEphemeralSeconds(local.channel)(s));
  const encryptionPolicy = useStore((s) => selectChannelEncryptionPolicy(local.channel)(s));
  const serviceNotices = useStore((s) => s.serviceNotices);
  const channelProps = useStore((s) => s.channelProps);
  const isOp = useStore((s) => selectIsChannelOp(local.channel)(s));
  const connectionStatus = useStore((s) => s.connectionStatus);

  const channel = createMemo(() =>
    channels().get(local.channel.toLowerCase()) ?? null,
  );
  const isConnected = createMemo(() => connectionStatus() === 'connected');

  // ── Topic editing ──────────────────────────────────────────────────────
  const serverTopic = createMemo(() => channel()?.topic ?? '');
  const [topicDraft, setTopicDraft] = createSignal('');

  // Re-seed the draft whenever the panel opens or the server topic changes
  // (and we're not mid-edit). Keeps the field in sync without clobbering typing.
  createEffect(() => {
    if (local.open) {
      setTopicDraft(readChannelTopicDraft(local.channel) ?? serverTopic());
    }
  });

  // +t locks topic editing to ops. Without +t, anyone may set it.
  const topicLocked = createMemo(() => modeState().flags.has('t'));
  const canEditTopic = createMemo(() => !topicLocked() || isOp());
  const topicDirty = createMemo(() => topicDraft() !== serverTopic());

  function submitTopic(event: Event): void {
    event.preventDefault();
    if (!canEditTopic() || !topicDirty() || !isConnected()) return;
    getState().setTopic(channel()?.name ?? local.channel, topicDraft());
    saveChannelTopicDraft(local.channel, serverTopic(), serverTopic());
  }

  // ── Notifications (personal, per-channel; available to every member) ──────
  // Reactive read straight from the store's single source of truth via the pure
  // helper — no local draft, since a change lands in the store synchronously.
  const notifyMode = useStore((s) => channelNotifyMode(s.channelNotify, local.channel));

  function changeNotify(event: Event & { currentTarget: HTMLSelectElement }): void {
    const value = event.currentTarget.value;
    if (value !== 'all' && value !== 'mentions' && value !== 'mute') return;
    getState().setChannelNotifyMode(channel()?.name ?? local.channel, value);
  }

  // ── Mode toggles (op-only) ───────────────────────────────────────────────
  function toggleFlag(letter: string, currentlyOn: boolean): void {
    if (!isOp() || !isConnected()) return;
    getState().setChannelMode(channel()?.name ?? local.channel, currentlyOn ? `-${letter}` : `+${letter}`);
  }

  // ── Key (+k) ──────────────────────────────────────────────────────────────
  const [keyDraft, setKeyDraft] = createSignal('');
  createEffect(() => {
    if (local.open) setKeyDraft(modeState().key ?? '');
  });

  function applyKey(event: Event): void {
    event.preventDefault();
    if (!isOp() || !isConnected()) return;
    const next = keyDraft().trim();
    const current = modeState().key ?? '';
    if (next === current) return;
    const name = channel()?.name ?? local.channel;
    if (next) {
      getState().setChannelMode(name, '+k', next);
    } else if (current) {
      getState().setChannelMode(name, '-k', current);
    }
  }

  // ── Limit (+l) ─────────────────────────────────────────────────────────────
  const [limitDraft, setLimitDraft] = createSignal('');
  createEffect(() => {
    if (local.open) setLimitDraft(modeState().limit != null ? String(modeState().limit) : '');
  });

  function applyLimit(event: Event): void {
    event.preventDefault();
    if (!isOp() || !isConnected()) return;
    const raw = limitDraft().trim();
    const current = modeState().limit;
    const name = channel()?.name ?? local.channel;
    if (raw === '') {
      if (current != null) getState().setChannelMode(name, '-l');
      return;
    }
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    if (n === current) return;
    getState().setChannelMode(name, '+l', String(n));
  }

  // ── Ephemeral history (IRCX EPHEMERAL prop) ─────────────────────────────
  const [ephemeralDraft, setEphemeralDraft] = createSignal('0');
  createEffect(() => {
    if (local.open) setEphemeralDraft(String(ephemeralSeconds() ?? 0));
  });

  function applyEphemeral(event: Event): void {
    event.preventDefault();
    if (!isOp() || !isConnected()) return;
    const seconds = Number(ephemeralDraft());
    if (!Number.isInteger(seconds)) return;
    if (seconds === (ephemeralSeconds() ?? 0)) return;
    getState().setChannelEphemeral(channel()?.name ?? local.channel, seconds);
  }

  // ── E2EE message policy (IRCX encryption-policy prop) ─────────────────────
  const [encryptionDraft, setEncryptionDraft] = createSignal('off');
  createEffect(() => {
    if (local.open) setEncryptionDraft(encryptionPolicy());
  });

  const encryptionPolicyLabel = createMemo(() =>
    ENCRYPTION_POLICIES.find((policy) => policy.value === encryptionPolicy())?.label ?? 'Off',
  );

  function applyEncryptionPolicy(event: Event): void {
    event.preventDefault();
    if (!isOp() || !isConnected()) return;
    const next = encryptionDraft();
    if (next === encryptionPolicy()) return;
    if (next !== 'off' && next !== 'optional' && next !== 'required') return;
    getState().setChannelEncryptionPolicy(channel()?.name ?? local.channel, next);
  }

  // ── Incoming webhooks (WEBHOOK command) ─────────────────────────────────
  const [webhookName, setWebhookName] = createSignal('ci');
  const [webhookDeleteId, setWebhookDeleteId] = createSignal('');
  const webhookNotices = createMemo(() =>
    serviceNotices()
      .filter((notice) => notice.source === 'Webhook')
      .slice(-4)
      .reverse(),
  );
  const bridgeStatus = createMemo(() =>
    parseBridgeStatus(channelProps().get(local.channel.toLowerCase())?.[BRIDGE_STATUS_PROP] ?? ''),
  );

  function createWebhook(event: Event): void {
    event.preventDefault();
    if (!isOp() || !isConnected()) return;
    getState().webhookCreate(channel()?.name ?? local.channel, webhookName());
  }

  function listWebhooks(): void {
    if (!isOp() || !isConnected()) return;
    getState().webhookList(channel()?.name ?? local.channel);
  }

  function deleteWebhook(event: Event): void {
    event.preventDefault();
    if (!isOp() || !isConnected()) return;
    const id = webhookDeleteId().trim();
    if (!id) return;
    getState().webhookDelete(id);
    setWebhookDeleteId('');
  }

  // Read-only summary for non-ops (and a quick glance for ops).
  const modeSummary = createMemo(() => {
    const st = modeState();
    const parts: string[] = [];
    for (const f of FLAG_TOGGLES) {
      if (st.flags.has(f.letter)) parts.push(`+${f.letter}`);
    }
    if (st.flags.has('k') && st.key) parts.push('+k');
    if (st.flags.has('l') && st.limit != null) parts.push(`+l ${st.limit}`);
    return parts.length ? parts.join(' ') : 'no modes set';
  });

  return (
    <Sheet
      open={local.open}
      title="Channel settings"
      description={channel()?.name ?? local.channel}
      onOpenChange={local.onOpenChange}
      closeLabel="Close channel settings"
      data-testid="channel-settings"
    >
      <div class="shell-chset">
        {/* ── Topic ── */}
        <section class="shell-chset-section" aria-labelledby="chset-topic-heading">
          <h3 id="chset-topic-heading" class="shell-chset-heading">Topic</h3>
          <Show
            when={canEditTopic()}
            fallback={
              <div class="shell-chset-readonly">
                <p class="shell-chset-readonly-value">{serverTopic() || 'No topic set'}</p>
                <p class="shell-chset-hint">
                  This channel is topic-locked (+t). Only ops can change the topic.
                </p>
              </div>
            }
          >
            <form onSubmit={submitTopic} class="shell-chset-topic-form">
              <label class="shell-chset-label" for="chset-topic-input">Topic text</label>
              <textarea
                id="chset-topic-input"
                class="shell-chset-textarea"
                value={topicDraft()}
                onInput={(e) => {
                  setTopicDraft(e.currentTarget.value);
                  saveChannelTopicDraft(local.channel, e.currentTarget.value, serverTopic());
                }}
                rows={3}
                aria-describedby="chset-topic-hint"
              />
              <p id="chset-topic-hint" class="shell-chset-hint">
                <Show
                  when={isConnected()}
                  fallback="Offline: topic changes stay drafted on this device and can be saved after reconnect."
                >
                  <Show when={topicLocked()} fallback="Press Save to update the channel topic.">
                    Topic-locked (+t): your op rank lets you edit it.
                  </Show>
                </Show>
              </p>
              <div class="shell-chset-actions">
                <Button type="submit" variant="primary" size="sm" disabled={!topicDirty() || !isConnected()}>
                  Save topic
                </Button>
              </div>
            </form>
          </Show>
        </section>

        {/* ── Notifications (personal) ── */}
        <section class="shell-chset-section" aria-labelledby="chset-notify-heading">
          <h3 id="chset-notify-heading" class="shell-chset-heading">Notifications</h3>
          <form class="shell-chset-param shell-chset-retention" onSubmit={(e) => e.preventDefault()}>
            <label class="shell-chset-label" for="chset-notify">
              Notifications for {channel()?.name ?? local.channel}
            </label>
            <select
              id="chset-notify"
              class="shell-chset-select"
              value={notifyMode()}
              aria-describedby="chset-notify-hint"
              onChange={changeNotify}
            >
              <For each={NOTIFY_OPTIONS}>
                {(option) => <option value={option.value}>{option.label}</option>}
              </For>
            </select>
            <p id="chset-notify-hint" class="shell-chset-hint">
              Your own alerts for this channel on this device. All messages notify, Mentions only
              alerts when someone @-mentions you, and Mute silences it.
            </p>
          </form>
        </section>

        {/* ── Modes ── */}
        <section class="shell-chset-section" aria-labelledby="chset-modes-heading">
          <h3 id="chset-modes-heading" class="shell-chset-heading">Modes</h3>

          <Show
            when={isOp()}
            fallback={
              <div class="shell-chset-readonly">
                <p class="shell-chset-readonly-label">Current modes</p>
                <p class="shell-chset-readonly-value shell-chset-modes-mono">{modeSummary()}</p>
                <p class="shell-chset-hint">Only ops can change channel modes.</p>
              </div>
            }
          >
            {/* Flag toggles */}
            <ul class="shell-chset-flags" role="group" aria-label="Channel mode flags">
              <For each={FLAG_TOGGLES}>
                {(flag) => {
                  const on = createMemo(() => modeState().flags.has(flag.letter));
                  return (
                    <li class="shell-chset-flag">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on() ? 'true' : 'false'}
                        class={`shell-chset-toggle${on() ? ' shell-chset-toggle--on' : ''}`}
                        disabled={!isConnected()}
                        onClick={() => toggleFlag(flag.letter, on())}
                      >
                        <span class="shell-chset-toggle-track" aria-hidden="true">
                          <span class="shell-chset-toggle-thumb" />
                        </span>
                        <span class="shell-chset-toggle-text">
                          <span class="shell-chset-toggle-label">
                            {flag.label} <span class="shell-chset-toggle-letter">+{flag.letter}</span>
                          </span>
                          <span class="shell-chset-toggle-hint">{flag.hint}</span>
                        </span>
                      </button>
                    </li>
                  );
                }}
              </For>
            </ul>

            {/* Key (+k) */}
            <form onSubmit={applyKey} class="shell-chset-param">
              <FormField
                id="chset-key"
                label="Channel key (+k)"
                description="Members must supply this key to join. Leave blank to remove."
                type="text"
                value={keyDraft()}
                autocomplete="off"
                onInput={(e) => setKeyDraft(e.currentTarget.value)}
              />
              <Button type="submit" variant="ghost" size="sm" disabled={!isConnected()}>Apply key</Button>
            </form>

            {/* Limit (+l) */}
            <form onSubmit={applyLimit} class="shell-chset-param">
              <FormField
                id="chset-limit"
                label="User limit (+l)"
                description="Maximum members allowed. Leave blank to remove."
                type="number"
                min="1"
                inputmode="numeric"
                value={limitDraft()}
                onInput={(e) => setLimitDraft(e.currentTarget.value)}
              />
              <Button type="submit" variant="ghost" size="sm" disabled={!isConnected()}>Apply limit</Button>
            </form>
          </Show>
        </section>

        {/* ── History retention ── */}
        <section class="shell-chset-section" aria-labelledby="chset-history-heading">
          <h3 id="chset-history-heading" class="shell-chset-heading">History</h3>

          <Show
            when={isOp()}
            fallback={
              <div class="shell-chset-readonly">
                <p class="shell-chset-readonly-label">Ephemeral history</p>
                <p class="shell-chset-readonly-value shell-chset-modes-mono">
                  {formatEphemeral(ephemeralSeconds())}
                </p>
                <p class="shell-chset-hint">Only ops can change history retention.</p>
              </div>
            }
          >
            <form onSubmit={applyEphemeral} class="shell-chset-param shell-chset-retention">
              <label class="shell-chset-label" for="chset-ephemeral">Ephemeral history</label>
              <select
                id="chset-ephemeral"
                class="shell-chset-select"
                value={ephemeralDraft()}
                aria-describedby="chset-ephemeral-hint"
                onChange={(e) => setEphemeralDraft(e.currentTarget.value)}
              >
                <For each={EPHEMERAL_PRESETS}>
                  {(preset) => <option value={String(preset.seconds)}>{preset.label}</option>}
                </For>
              </select>
              <p id="chset-ephemeral-hint" class="shell-chset-hint">
                When enabled, replay and search omit messages older than this window, and channel stats skip new messages.
              </p>
              <Button type="submit" variant="ghost" size="sm" disabled={!isConnected() || ephemeralDraft() === String(ephemeralSeconds() ?? 0)}>
                Apply retention
              </Button>
            </form>
          </Show>
        </section>

        {/* ── Encryption policy ── */}
        <section class="shell-chset-section" aria-labelledby="chset-encryption-heading">
          <h3 id="chset-encryption-heading" class="shell-chset-heading">Encryption</h3>

          <Show
            when={isOp()}
            fallback={
              <div class="shell-chset-readonly">
                <p class="shell-chset-readonly-label">Message policy</p>
                <p class="shell-chset-readonly-value shell-chset-modes-mono">
                  {encryptionPolicyLabel()}
                </p>
                <p class="shell-chset-hint">Only ops can change the channel encryption policy.</p>
              </div>
            }
          >
            <form onSubmit={applyEncryptionPolicy} class="shell-chset-param shell-chset-retention">
              <label class="shell-chset-label" for="chset-encryption">Message policy</label>
              <select
                id="chset-encryption"
                class="shell-chset-select"
                value={encryptionDraft()}
                aria-describedby="chset-encryption-hint"
                onChange={(e) => setEncryptionDraft(e.currentTarget.value)}
              >
                <For each={ENCRYPTION_POLICIES}>
                  {(policy) => <option value={policy.value}>{policy.label}</option>}
                </For>
              </select>
              <p id="chset-encryption-hint" class="shell-chset-hint">
                {ENCRYPTION_POLICIES.find((policy) => policy.value === encryptionDraft())?.hint}
              </p>
              <Button type="submit" variant="ghost" size="sm" disabled={!isConnected() || encryptionDraft() === encryptionPolicy()}>
                Apply policy
              </Button>
            </form>
          </Show>
        </section>

        {/* ── Integrations ── */}
        <section class="shell-chset-section" aria-labelledby="chset-integrations-heading">
          <h3 id="chset-integrations-heading" class="shell-chset-heading">Integrations</h3>

          <div class="shell-chset-readonly">
            <p class="shell-chset-readonly-label">Bridge status</p>
            <BridgeStatusBadge status={bridgeStatus()} />
          </div>

          <Show
            when={isOp()}
            fallback={
              <div class="shell-chset-readonly">
                <p class="shell-chset-readonly-label">Incoming webhooks</p>
                <p class="shell-chset-readonly-value">Managed by channel ops.</p>
                <p class="shell-chset-hint">Discord-compatible webhook URLs can post into this channel.</p>
              </div>
            }
          >
            <div class="shell-chset-webhooks">
              <form onSubmit={createWebhook} class="shell-chset-param">
                <FormField
                  id="chset-webhook-name"
                  label="Webhook name"
                  description="The created URL is shown once in server notices."
                  type="text"
                  value={webhookName()}
                  maxLength={32}
                  onInput={(e) => setWebhookName(e.currentTarget.value)}
                />
                <div class="shell-chset-inline-actions">
                  <Button type="submit" variant="ghost" size="sm" disabled={!isConnected()}>Create webhook</Button>
                  <Button type="button" variant="ghost" size="sm" disabled={!isConnected()} onClick={listWebhooks}>List webhooks</Button>
                </div>
              </form>

              <form onSubmit={deleteWebhook} class="shell-chset-param">
                <FormField
                  id="chset-webhook-delete"
                  label="Delete webhook id"
                  description="Use WEBHOOK LIST if you do not know the id."
                  type="text"
                  value={webhookDeleteId()}
                  onInput={(e) => setWebhookDeleteId(e.currentTarget.value)}
                />
                <Button type="submit" variant="ghost" size="sm" disabled={!isConnected() || !webhookDeleteId().trim()}>
                  Delete webhook
                </Button>
              </form>

              <Show when={webhookNotices().length > 0}>
                <div class="shell-chset-notices" aria-live="polite">
                  <For each={webhookNotices()}>
                    {(notice) => <p class="shell-chset-notice">{notice.text}</p>}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
        </section>
      </div>
    </Sheet>
  );
}
