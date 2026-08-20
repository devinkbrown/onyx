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
  onCleanup,
  Show,
  splitProps,
  type JSX,
} from 'solid-js';
import {
  useStore,
  getState,
  selectChannelEncryptionPolicy,
  selectChannelEphemeralSeconds,
  selectChannelHistoryPolicy,
  selectChannelModeState,
  selectDeviceMemoryOwner,
  selectIsChannelOp,
} from '@/lib/store';
import { isHistoryPolicy, type HistoryPolicy } from '@/lib/irc/historyPolicy';
import {
  readChannelTopicDraft,
  saveChannelTopicDraft,
} from '@/lib/channel/topicDrafts';
import {
  channelNotifyMode,
  type NotifyMode,
} from '@/lib/notifications/channelNotifyMode';
import {
  ACCESS_LEVELS,
  accessLevelHint,
  accessLevelLabel,
  formatAccessDuration,
  normalizeAccessMask,
  parseAccessDuration,
  parseAccessLevel,
  sortAccessEntries,
  type AccessLevel,
  type ChannelAccessEntry,
} from '@/lib/irc/channelAccess';
import {
  BRIDGE_STATUS_PROP,
  parseBridgeStatus,
} from '@/lib/interop/bridgeStatus';
import { Button, FormField, Sheet, toast } from '@/primitives/index';
import { buildInviteLink } from '@/lib/invite/inviteLink';
import {
  encryptionPolicyBadge,
  parseEncryptionPolicy,
  withEncryptionPolicyParam,
} from '@/lib/invite/encryptionPolicyBadge';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import {
  buildConversationExport,
  downloadConversationExport,
} from '@/lib/export/conversationExport';
import { BridgeStatusBadge } from './BridgeStatusBadge';
import { RoomInsightsStrip } from './RoomInsightsStrip';

// Common simple channel flags exposed as toggles. Letters match Onyx Server's
// CHANMODES group D (flags) — see ISUPPORT `imnstCTNMSgWOA`.
const FLAG_TOGGLES: ReadonlyArray<{ letter: string; label: string; hint: string }> = [
  { letter: 'm', label: 'Moderated', hint: 'Only voiced members and ops may speak (+m)' },
  { letter: 'i', label: 'Invite only', hint: 'Members must be invited to join (+i)' },
  { letter: 't', label: 'Topic locked', hint: 'Only ops may change the topic (+t)' },
  { letter: 'n', label: 'No external messages', hint: 'Block messages from non-members (+n)' },
  { letter: 's', label: 'Secret', hint: 'Hide the room from listings (+s)' },
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
  { value: 'optional', label: 'Optional', hint: 'Encrypted messages are marked when clients support Onyx Server E2EE.' },
  { value: 'required', label: 'Required', hint: 'Clients should send only E2EE-tagged payloads here.' },
] as const;

const HISTORY_POLICIES: ReadonlyArray<{ value: HistoryPolicy; label: string; hint: string }> = [
  {
    value: 'public',
    label: 'Public',
    hint: 'Anyone who can request room history may read this room’s history (server default).',
  },
  {
    value: 'members',
    label: 'Members only',
    hint: 'Only people currently in the room may request history.',
  },
  {
    value: 'opers',
    label: 'Ops only',
    hint: 'Only room ops (and network operators) may request history.',
  },
];

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
  const historyPolicy = useStore((s) => selectChannelHistoryPolicy(local.channel)(s));
  const serviceNotices = useStore((s) => s.serviceNotices);
  const channelProps = useStore((s) => s.channelProps);
  const channelAccessMap = useStore((s) => s.channelAccess);
  const channelAccessLoadingSet = useStore((s) => s.channelAccessLoading);
  const isOp = useStore((s) => selectIsChannelOp(local.channel)(s));
  const connectionStatus = useStore((s) => s.connectionStatus);
  const networkName = useStore((s) => s.networkName);
  const memoryOwner = useStore(
    selectDeviceMemoryOwner,
    (left, right) => left?.serverUrl === right?.serverUrl && left?.identity === right?.identity,
  );

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
    const authoritativeTopic = serverTopic();
    const owner = memoryOwner();
    const savedDraft = owner ? readChannelTopicDraft(local.channel, undefined, owner) : null;
    const acknowledged = savedDraft !== null && savedDraft === authoritativeTopic;
    if (acknowledged && owner) {
      saveChannelTopicDraft(local.channel, savedDraft, authoritativeTopic, undefined, owner);
    }
    if (!local.open) return;
    if (savedDraft === null || acknowledged) {
      setTopicDraft(authoritativeTopic);
      return;
    }
    setTopicDraft(savedDraft);
  });

  // +t locks topic editing to ops. Without +t, anyone may set it.
  const topicLocked = createMemo(() => modeState().flags.has('t'));
  const canEditTopic = createMemo(() => !topicLocked() || isOp());
  const topicDirty = createMemo(() => topicDraft() !== serverTopic());

  function submitTopic(event: Event): void {
    event.preventDefault();
    if (!canEditTopic() || !topicDirty() || !isConnected()) return;
    getState().setTopic(channel()?.name ?? local.channel, topicDraft());
  }

  // ── Share invite (any member can build a rich shareable link) ─────────────
  // The generated link carries the room (+ an optional preferred guest nick)
  // through the same `?join=`/`?as=` deep-link contract the website and connect
  // flow already honour. buildInviteLink re-validates every field, so a hostile
  // nick can never corrupt the link; a preferred nick that fails validation is
  // simply dropped and the room link still works.
  const [invitePreferredNick, setInvitePreferredNick] = createSignal('');
  // Copy result announced through a co-located polite live region: the primitive
  // toast host is not mounted in the shell, so a screen reader would otherwise
  // never learn the clipboard write succeeded (SC 4.1.3 Status Messages).
  const [copyStatus, setCopyStatus] = createSignal('');
  const [shareBusy, setShareBusy] = createSignal(false);
  const [copyBusy, setCopyBusy] = createSignal(false);
  let shareEpoch = 0;
  let copyEpoch = 0;

  // The sheet can remain mounted while the session owner or selected channel
  // changes. Treat that as a hard boundary for typed invite data and browser
  // share/clipboard completions even when the resulting URL is identical.
  createEffect(() => {
    void local.open;
    void local.channel;
    void memoryOwner();
    shareEpoch += 1;
    copyEpoch += 1;
    setShareBusy(false);
    setCopyBusy(false);
    setInvitePreferredNick('');
    setCopyStatus('');
  });

  const inviteOrigin = createMemo(() =>
    typeof window !== 'undefined'
      ? `${window.location.origin}/invite/`
      : 'https://eshmaki.me/invite/',
  );
  const memberCount = createMemo(() => channel()?.users.size ?? 0);
  const inviteLink = createMemo(() =>
    buildInviteLink(
      {
        channel: channel()?.name ?? local.channel,
        guestName: invitePreferredNick(),
      },
      { network: networkName(), origin: inviteOrigin(), appOrigin: '/app/' },
    ),
  );

  const inviteE2eeBadge = createMemo(() =>
    encryptionPolicyBadge(parseEncryptionPolicy(encryptionPolicy())),
  );

  const inviteShareUrl = createMemo(() =>
    withEncryptionPolicyParam(inviteLink().shareUrl, inviteE2eeBadge().policy),
  );

  const inviteShareData = createMemo<ShareData>(() => ({
    title: `${inviteLink().card.channel ?? networkName()} on ${networkName()}`,
    text: inviteLink().hasChannel
      ? `Join ${inviteLink().card.channel} on ${networkName()} (${inviteE2eeBadge().chip}).`
      : `Join ${networkName()} in Onyx.`,
    url: inviteShareUrl(),
  }));
  const canShareInvite = createMemo(() => {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
    try {
      return typeof navigator.canShare !== 'function' || navigator.canShare(inviteShareData());
    } catch {
      return false;
    }
  });

  // A changing invite invalidates status from an older native share sheet. The
  // OS sheet cannot be force-closed, but its later completion must not describe
  // a newly edited invite or a reopened panel.
  createEffect(() => {
    const open = local.open;
    const shareUrl = inviteShareData().url;
    shareEpoch += 1;
    copyEpoch += 1;
    setShareBusy(false);
    setCopyBusy(false);
    if (open && shareUrl) setCopyStatus('');
  });
  onCleanup(() => {
    shareEpoch += 1;
    copyEpoch += 1;
  });

  async function shareInvite(): Promise<void> {
    if (!canShareInvite() || shareBusy() || copyBusy()) return;
    const epoch = ++shareEpoch;
    const data = inviteShareData();
    setShareBusy(true);
    setCopyStatus('Opening your device share sheet.');
    try {
      await navigator.share(data);
      if (epoch === shareEpoch && local.open) setCopyStatus('Invite shared.');
    } catch (err) {
      if (epoch !== shareEpoch || !local.open) return;
      if (err instanceof DOMException && err.name === 'AbortError') {
        setCopyStatus('Share cancelled. The invite link is still available below.');
      } else {
        setCopyStatus('Could not open the share sheet. Copy the invite link instead.');
      }
    } finally {
      if (epoch === shareEpoch) setShareBusy(false);
    }
  }

  async function copyInviteLink(): Promise<void> {
    if (copyBusy() || shareBusy()) return;
    const epoch = ++copyEpoch;
    const url = inviteShareUrl();
    setCopyBusy(true);
    try {
      const copied = await writeClipboardText(url);
      if (epoch !== copyEpoch || !local.open) return;
      if (copied) {
        setCopyStatus('Invite link copied to clipboard.');
        toast({ title: 'Invite link copied', description: url, intent: 'success' });
        return;
      }

      setCopyStatus('Copy failed. Select and copy the link shown above.');
      toast({
        title: 'Copy failed',
        description: 'Select and copy the link shown below.',
        intent: 'warning',
      });
    } finally {
      if (epoch === copyEpoch) setCopyBusy(false);
    }
  }

  // ── Local transcript export (this device only; never server-complete) ────
  const [exportStatus, setExportStatus] = createSignal('');
  const [leaveConfirming, setLeaveConfirming] = createSignal(false);
  const messageCount = createMemo(() => channel()?.messages.length ?? 0);

  function exportTranscript(format: 'txt' | 'json'): void {
    const name = channel()?.name ?? local.channel;
    const msgs = channel()?.messages ?? [];
    const state = getState();
    const doc = buildConversationExport({
      target: name,
      messages: msgs,
      network: state.networkName,
      ourNick: state.ourNick,
    });
    const ok = downloadConversationExport(doc, format);
    if (ok) {
      setExportStatus(
        `Exported ${doc.messageCount} message${doc.messageCount === 1 ? '' : 's'} as ${format} (this device only).`,
      );
      toast({
        title: 'Export started',
        description: `${doc.messageCount} local message${doc.messageCount === 1 ? '' : 's'} (${format}).`,
        intent: 'success',
      });
    } else {
      setExportStatus('Export failed. Try again or use /export in the composer.');
      toast({
        title: 'Export failed',
        description: 'Could not build a downloadable transcript.',
        intent: 'warning',
      });
    }
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

  // ── History visibility (IRCX history-policy prop) ─────────────────────────
  const [historyDraft, setHistoryDraft] = createSignal<HistoryPolicy>('public');
  createEffect(() => {
    if (local.open) setHistoryDraft(historyPolicy());
  });

  const historyPolicyLabel = createMemo(() =>
    HISTORY_POLICIES.find((policy) => policy.value === historyPolicy())?.label ?? 'Public',
  );

  function applyHistoryPolicy(event: Event): void {
    event.preventDefault();
    if (!isOp() || !isConnected()) return;
    const next = historyDraft();
    if (next === historyPolicy()) return;
    if (!isHistoryPolicy(next)) return;
    getState().setChannelHistoryPolicy(channel()?.name ?? local.channel, next);
  }

  // ── IRCX ACCESS roles (persistent on-join ranks / deny / grant) ─────────
  const accessKey = createMemo(() => local.channel.toLowerCase());
  const accessEntries = createMemo(() =>
    sortAccessEntries(channelAccessMap().get(accessKey()) ?? []),
  );
  const accessLoading = createMemo(() => channelAccessLoadingSet().has(accessKey()));
  const [accessLevelDraft, setAccessLevelDraft] = createSignal<AccessLevel>('HOST');
  const [accessMaskDraft, setAccessMaskDraft] = createSignal('');
  const [accessTimeoutDraft, setAccessTimeoutDraft] = createSignal('');
  const [accessFormError, setAccessFormError] = createSignal('');

  // Ops pull a fresh LIST whenever the sheet opens on a connected channel.
  // Non-ops do not: ACCESS LIST is operator-gated on the server (482).
  createEffect(() => {
    if (!local.open || !isOp() || !isConnected()) return;
    getState().fetchChannelAccess(channel()?.name ?? local.channel);
  });

  createEffect(() => {
    if (!local.open) {
      setAccessMaskDraft('');
      setAccessTimeoutDraft('');
      setAccessFormError('');
      setAccessLevelDraft('HOST');
    }
  });

  function refreshAccessList(): void {
    if (!isOp() || !isConnected()) return;
    getState().fetchChannelAccess(channel()?.name ?? local.channel);
  }

  function submitAccessAdd(event: Event): void {
    event.preventDefault();
    if (!isOp() || !isConnected()) return;
    const level = parseAccessLevel(accessLevelDraft());
    const mask = normalizeAccessMask(accessMaskDraft());
    if (!level || !mask) {
      setAccessFormError('Enter a name or hostmask (e.g. alice or alice!*@*).');
      return;
    }
    const rawTimeout = accessTimeoutDraft().trim();
    let timeout: number | undefined;
    if (rawTimeout !== '') {
      const parsed = parseAccessDuration(rawTimeout);
      if (parsed === undefined) {
        setAccessFormError('Timeout must be a whole number of seconds (or leave blank).');
        return;
      }
      timeout = parsed;
    }
    setAccessFormError('');
    getState().addChannelAccess(channel()?.name ?? local.channel, level, mask, timeout);
    setAccessMaskDraft('');
    setAccessTimeoutDraft('');
  }

  function removeAccessEntry(entry: ChannelAccessEntry): void {
    if (!isOp() || !isConnected()) return;
    getState().deleteChannelAccess(
      channel()?.name ?? local.channel,
      entry.level,
      entry.mask,
    );
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
      title="Room settings"
      description={channel()?.name ?? local.channel}
      onOpenChange={local.onOpenChange}
      closeLabel="Close room settings"
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
                  This room is topic-locked (+t). Only room hosts can change the topic.
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
                  const owner = memoryOwner();
                  if (owner) {
                    saveChannelTopicDraft(
                      local.channel,
                      e.currentTarget.value,
                      serverTopic(),
                      undefined,
                      owner,
                    );
                  }
                }}
                rows={3}
                aria-describedby="chset-topic-hint"
              />
              <p id="chset-topic-hint" class="shell-chset-hint">
                <Show
                  when={isConnected()}
                  fallback="Offline: topic changes stay drafted on this device and can be saved after reconnect."
                >
                  <Show when={topicLocked()} fallback="Press Save to update the room topic.">
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

        {/* ── Share invite ── */}
        <section class="shell-chset-section" aria-labelledby="chset-invite-heading">
          <h3 id="chset-invite-heading" class="shell-chset-heading">Share invite</h3>

          <div class="shell-chset-readonly" role="group" aria-label="Invite preview">
            <p class="shell-chset-readonly-label">This invite opens</p>
            {/* Sourced from the RESOLVED card, never the raw channel, so the
                preview can never claim a room the link actually dropped. */}
            <p class="shell-chset-readonly-value">{inviteLink().card.channel ?? networkName()}</p>
            <Show
              when={inviteLink().hasChannel}
              fallback={
                <p class="shell-chset-hint">A network invite — the recipient picks a room from Home.</p>
              }
            >
              <p class="shell-chset-hint">
                {memberCount() > 0
                  ? `${memberCount()} ${memberCount() === 1 ? 'person' : 'people'} here`
                  : 'Membership shown once loaded'}
                <Show when={serverTopic().trim()}>{(t) => <> · {t()}</>}</Show>
              </p>
            </Show>
          </div>

          <form class="shell-chset-param" onSubmit={(e) => e.preventDefault()}>
            <FormField
              id="chset-invite-nick"
              label="Suggested guest name (optional)"
              description="Pre-fills the connect form for whoever opens the link. Leave blank to let them choose."
              type="text"
              value={invitePreferredNick()}
              autocomplete="off"
              maxLength={64}
              onInput={(e) => setInvitePreferredNick(e.currentTarget.value)}
            />
          </form>

          <div class="shell-chset-readonly">
            <p class="shell-chset-readonly-label">Encryption on invite</p>
            <p
              class="shell-chset-readonly-value"
              data-testid="invite-e2ee-badge"
              data-e2ee-policy={inviteE2eeBadge().policy}
            >
              {inviteE2eeBadge().chip}
              <span class="shell-chset-hint"> — {inviteE2eeBadge().label}</span>
            </p>
          </div>

          <div class="shell-chset-readonly">
            <p class="shell-chset-readonly-label">Shareable link</p>
            <p class="shell-chset-readonly-value shell-chset-modes-mono">{inviteShareUrl()}</p>
          </div>

          <div class="shell-chset-inline-actions">
            <Show when={canShareInvite()}>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={shareBusy() || copyBusy()}
                aria-busy={shareBusy()}
                onClick={() => void shareInvite()}
              >
                {shareBusy() ? 'Opening share sheet…' : 'Share invite'}
              </Button>
            </Show>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={copyBusy() || shareBusy()}
              aria-busy={copyBusy()}
              onClick={() => void copyInviteLink()}
            >
              {copyBusy() ? 'Copying invite link…' : 'Copy invite link'}
            </Button>
            <a class="shell-chset-invite-open" href={inviteLink().appHref}>
              Open invite in Onyx
            </a>
          </div>

          {/* Always-mounted polite live region so the copy result is announced. */}
          <span
            class="sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="chset-invite-status"
          >
            {copyStatus()}
          </span>
        </section>

        {/* ── Export transcript (local device memory only) ── */}
        <section class="shell-chset-section" aria-labelledby="chset-export-heading">
          <h3 id="chset-export-heading" class="shell-chset-heading">Export transcript</h3>
          <p class="shell-chset-hint" id="chset-export-hint">
            Downloads scrollback stored on this device only
            {messageCount() > 0
              ? ` (${messageCount()} message${messageCount() === 1 ? '' : 's'} in memory).`
              : ' (no messages loaded here yet).'}
            {' '}
            Not a complete server history.
          </p>
          <div class="shell-chset-inline-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="chset-export-txt"
              aria-describedby="chset-export-hint"
              onClick={() => exportTranscript('txt')}
            >
              Download text
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="chset-export-json"
              aria-describedby="chset-export-hint"
              onClick={() => exportTranscript('json')}
            >
              Download JSON
            </Button>
          </div>
          <span
            class="sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="chset-export-status"
          >
            {exportStatus()}
          </span>
        </section>

        {/* ── Leave room ── */}
        <section class="shell-chset-section" aria-labelledby="chset-leave-heading">
          <h3 id="chset-leave-heading" class="shell-chset-heading">Leave room</h3>
          <p class="shell-chset-hint" id="chset-leave-hint">
            Leaves {channel()?.name ?? local.channel} on this connection. You can rejoin later from Browse rooms. Local scrollback stays on this device.
          </p>
          <Show
            when={leaveConfirming()}
            fallback={
              <Button
                type="button"
                variant="danger"
                size="sm"
                data-testid="chset-leave"
                aria-describedby="chset-leave-hint"
                disabled={!isConnected()}
                onClick={() => setLeaveConfirming(true)}
              >
                Leave room
              </Button>
            }
          >
            <div
              class="shell-chset-inline-actions"
              role="group"
              aria-label={`Confirm leave ${channel()?.name ?? local.channel}`}
            >
              <Button
                type="button"
                variant="danger"
                size="sm"
                data-testid="chset-leave-confirm"
                disabled={!isConnected()}
                onClick={() => {
                  const name = channel()?.name ?? local.channel;
                  getState().partChannel(name);
                  setLeaveConfirming(false);
                  local.onOpenChange(false);
                  getState().addToast({
                    variant: 'info',
                    title: `Left ${name}`,
                    description: 'You left this room on this connection.',
                  });
                }}
              >
                Confirm leave
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="chset-leave-cancel"
                onClick={() => setLeaveConfirming(false)}
              >
                Stay
              </Button>
            </div>
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
              Your own alerts for this room on this device. All messages notify, Mentions only
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
                <p class="shell-chset-hint">Only room hosts can change room modes.</p>
              </div>
            }
          >
            {/* Flag toggles */}
            <ul class="shell-chset-flags" role="group" aria-label="Room mode flags">
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
                label="Room key (+k)"
                description="People must supply this key to join. Leave blank to remove."
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
                <p class="shell-chset-hint">Only room hosts can change history retention.</p>
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
                When enabled, replay and search omit messages older than this window, and room stats skip new messages.
              </p>
              <Button type="submit" variant="ghost" size="sm" disabled={!isConnected() || ephemeralDraft() === String(ephemeralSeconds() ?? 0)}>
                Apply retention
              </Button>
            </form>
          </Show>
        </section>

        {/* ── Roles (IRCX ACCESS) ── */}
        <section class="shell-chset-section" aria-labelledby="chset-access-heading">
          <h3 id="chset-access-heading" class="shell-chset-heading">Roles &amp; access</h3>

          <Show
            when={isOp()}
            fallback={
              <div class="shell-chset-readonly">
                <p class="shell-chset-readonly-label">Persistent access list</p>
                <p class="shell-chset-readonly-value">Managed by room hosts.</p>
                <p class="shell-chset-hint">
                  Access entries grant founder, owner, host, or voice on join — or deny/grant masks.
                </p>
              </div>
            }
          >
            <div class="shell-chset-access">
              <div class="shell-chset-inline-actions">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!isConnected() || accessLoading()}
                  aria-busy={accessLoading()}
                  onClick={refreshAccessList}
                >
                  {accessLoading() ? 'Loading access list…' : 'Refresh list'}
                </Button>
              </div>

              <Show
                when={accessEntries().length > 0}
                fallback={
                  <p class="shell-chset-hint" data-testid="chset-access-empty">
                    {accessLoading()
                      ? 'Loading access entries…'
                      : 'No access entries yet. Add a nick or hostmask below.'}
                  </p>
                }
              >
                <ul class="shell-chset-access-list" aria-label="Room access entries">
                  <For each={accessEntries()}>
                    {(entry) => (
                      <li class="shell-chset-access-row">
                        <div class="shell-chset-access-meta">
                          <span class="shell-chset-access-level">
                            {accessLevelLabel(entry.level)}
                          </span>
                          <span class="shell-chset-access-mask shell-chset-modes-mono">
                            {entry.mask}
                          </span>
                          <span class="shell-chset-access-extra">
                            {formatAccessDuration(entry.duration)}
                            <Show when={entry.setBy}>
                              {(setter) => <> · set by {setter()}</>}
                            </Show>
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={!isConnected()}
                          aria-label={`Remove ${entry.level} access for ${entry.mask}`}
                          onClick={() => removeAccessEntry(entry)}
                        >
                          Remove
                        </Button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>

              <form onSubmit={submitAccessAdd} class="shell-chset-param shell-chset-access-form">
                <label class="shell-chset-label" for="chset-access-level">Role level</label>
                <select
                  id="chset-access-level"
                  class="shell-chset-select"
                  value={accessLevelDraft()}
                  aria-describedby="chset-access-level-hint"
                  onChange={(e) => {
                    const next = parseAccessLevel(e.currentTarget.value);
                    if (next) setAccessLevelDraft(next);
                  }}
                >
                  <For each={[...ACCESS_LEVELS]}>
                    {(level) => <option value={level}>{accessLevelLabel(level)}</option>}
                  </For>
                </select>
                <p id="chset-access-level-hint" class="shell-chset-hint">
                  {accessLevelHint(accessLevelDraft())}
                </p>

                <FormField
                  id="chset-access-mask"
                  label="Name or hostmask"
                  description="Bare nicks expand to nick!*@*. Full masks use nick!user@host."
                  type="text"
                  value={accessMaskDraft()}
                  autocomplete="off"
                  maxLength={128}
                  onInput={(e) => setAccessMaskDraft(e.currentTarget.value)}
                />

                <FormField
                  id="chset-access-timeout"
                  label="Timeout seconds (optional)"
                  description="Leave blank for a permanent entry."
                  type="number"
                  min="1"
                  inputmode="numeric"
                  value={accessTimeoutDraft()}
                  onInput={(e) => setAccessTimeoutDraft(e.currentTarget.value)}
                />

                <Show when={accessFormError()}>
                  {(err) => (
                    <p class="shell-chset-hint shell-chset-access-error" role="alert">
                      {err()}
                    </p>
                  )}
                </Show>

                <Button type="submit" variant="primary" size="sm" disabled={!isConnected()}>
                  Add access entry
                </Button>
              </form>
            </div>
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
                <p class="shell-chset-hint">Only room hosts can change the room encryption policy.</p>
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

        {/* ── History visibility policy ── */}
        <section class="shell-chset-section" aria-labelledby="chset-history-heading">
          <h3 id="chset-history-heading" class="shell-chset-heading">History visibility</h3>

          <Show
            when={isOp()}
            fallback={
              <div class="shell-chset-readonly">
                <p class="shell-chset-readonly-label">Who can request history</p>
                <p class="shell-chset-readonly-value shell-chset-modes-mono">
                  {historyPolicyLabel()}
                </p>
                <p class="shell-chset-hint">Only room hosts can change the room history policy.</p>
              </div>
            }
          >
            <form onSubmit={applyHistoryPolicy} class="shell-chset-param shell-chset-retention">
              <label class="shell-chset-label" for="chset-history">Who can request history</label>
              <select
                id="chset-history"
                class="shell-chset-select"
                value={historyDraft()}
                aria-describedby="chset-history-hint"
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  if (isHistoryPolicy(v)) setHistoryDraft(v);
                }}
              >
                <For each={HISTORY_POLICIES}>
                  {(policy) => <option value={policy.value}>{policy.label}</option>}
                </For>
              </select>
              <p id="chset-history-hint" class="shell-chset-hint">
                {HISTORY_POLICIES.find((policy) => policy.value === historyDraft())?.hint}
              </p>
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={!isConnected() || historyDraft() === historyPolicy()}
              >
                Apply history policy
              </Button>
            </form>
          </Show>
        </section>

        {/* ── Public room insights (B10) ── */}
        <section class="shell-chset-section" aria-labelledby="chset-insights-heading">
          <h3 id="chset-insights-heading" class="shell-chset-heading">Public insights</h3>
          <RoomInsightsStrip />
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
                <p class="shell-chset-readonly-value">Managed by room hosts.</p>
                <p class="shell-chset-hint">Discord-compatible webhook URLs can post into this room.</p>
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
