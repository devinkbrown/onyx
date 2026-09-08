// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Room safety desk (compatibility entry: ModerationCockpit).
 * Destructive per-target actions dispatch only after review; room switches
 * and invitations stay immediate. Server echoes remain the source of truth.
 * Temporary client-side bans are not exposed here.
 */
import { createEffect, createMemo, createSignal, createUniqueId, For, on, Show, splitProps, type JSX } from 'solid-js';
import {
  captureDeviceMemoryContext,
  getState,
  isDeviceMemoryContextCurrent,
  selectChannelModeState,
  selectIsChannelOp,
  selectLastRoomUpdateAt,
  selectRoomModerationLog,
  useStore,
  type DeviceMemoryContext,
  type OnyxState,
} from '@/lib/store';
import {
  memberModerationKindsForMode,
  type ModerationActionDraft,
  type NormalizedModerationAction,
} from '@/lib/moderation/actionModel';
import { preferences } from '@/lib/prefs/preferences';
import type { ChannelUser } from '@/lib/irc/types';
import { BanListPanel } from './moderation/BanListPanel';
import { ModerationActionReview } from './moderation/ModerationActionReview';
import './moderation-cockpit.css';
import './moderation/moderation-desk.css';

export type ModerationCockpitProps = { channel: string };

/** Stable empty map so useStore equality does not thrash when the channel is absent. */
const EMPTY_CHANNEL_USERS: ReadonlyMap<string, ChannelUser> = new Map();

const QUICK_MODES = [
  { letter: 'm', label: 'Moderated', help: 'Only voiced members and moderators can speak.' },
  { letter: 'i', label: 'Invite-only', help: 'New people need an invitation to join.' },
  { letter: 't', label: 'Protected topic', help: 'Only moderators can change the topic.' },
] as const;

const MEMBER_ACTIONS = [
  { kind: 'kick', label: 'Remove' },
  { kind: 'ban', label: 'Block' },
  { kind: 'op', label: 'Give moderator' },
  { kind: 'deop', label: 'Remove moderator' },
  { kind: 'voice', label: 'Give speak' },
  { kind: 'devoice', label: 'Remove speak' },
] as const;

type ModerationReviewAuthority = {
  account: string | null;
  serverId: string | null;
  serverUrl: string | null;
  client: OnyxState['client'];
  deviceMemory: DeviceMemoryContext | null;
};

function captureModerationReviewAuthority(state: OnyxState): ModerationReviewAuthority {
  return {
    account: state.server?.account ?? null,
    serverId: state.server?.id ?? null,
    serverUrl: state.server?.url ?? null,
    client: state.client,
    deviceMemory: captureDeviceMemoryContext(state),
  };
}

function moderationReviewAuthorityIsCurrent(
  captured: ModerationReviewAuthority,
  state: OnyxState,
): boolean {
  const currentDeviceMemory = captureDeviceMemoryContext(state);
  return captured.account === (state.server?.account ?? null)
    && captured.serverId === (state.server?.id ?? null)
    && captured.serverUrl === (state.server?.url ?? null)
    && captured.client === state.client
    && (captured.deviceMemory === null
      ? currentDeviceMemory === null
      : currentDeviceMemory !== null && isDeviceMemoryContextCurrent(captured.deviceMemory, state));
}

function moderationReviewAuthorityEqual(
  left: ModerationReviewAuthority,
  right: ModerationReviewAuthority,
): boolean {
  const leftDeviceMemory = left.deviceMemory;
  const rightDeviceMemory = right.deviceMemory;
  return left.account === right.account
    && left.serverId === right.serverId
    && left.serverUrl === right.serverUrl
    && left.client === right.client
    && ((leftDeviceMemory === null && rightDeviceMemory === null)
      || (leftDeviceMemory !== null
        && rightDeviceMemory !== null
        && leftDeviceMemory.generation === rightDeviceMemory.generation
        && leftDeviceMemory.client === rightDeviceMemory.client
        && leftDeviceMemory.owner.serverUrl === rightDeviceMemory.owner.serverUrl
        && leftDeviceMemory.owner.identity === rightDeviceMemory.owner.identity));
}

export function ModerationCockpit(props: ModerationCockpitProps): JSX.Element {
  const [local] = splitProps(props, ['channel']);
  const instanceId = createUniqueId();
  const titleId = `moderation-cockpit-title-${instanceId}`;
  const inviteId = `moderation-invite-nick-${instanceId}`;
  const banId = `moderation-ban-mask-${instanceId}`;
  const memberId = `moderation-member-${instanceId}`;
  const actionId = `moderation-member-action-${instanceId}`;
  const reasonId = `moderation-member-reason-${instanceId}`;
  const canModerate = useStore((s) => selectIsChannelOp(local.channel)(s));
  const connectionStatus = useStore((s) => s.connectionStatus);
  const serverConnected = useStore((s) => !!s.server?.connected);
  const modeState = useStore((s) => selectChannelModeState(local.channel)(s));
  const members = useStore((s) => s.channels.get(local.channel.toLowerCase())?.users ?? EMPTY_CHANNEL_USERS);
  const rawModes = useStore((s) => s.channels.get(local.channel.toLowerCase())?.modes ?? '');
  const ourNick = useStore((s) => s.ourNick);
  const lastUpdate = useStore((s) => selectLastRoomUpdateAt(local.channel)(s));
  const activity = useStore((s) => selectRoomModerationLog(local.channel)(s));
  const [inviteNick, setInviteNick] = createSignal('');
  const [banMask, setBanMask] = createSignal('');
  const [memberNick, setMemberNick] = createSignal('');
  const [memberAction, setMemberAction] = createSignal<(typeof MEMBER_ACTIONS)[number]['kind']>('kick');
  const [memberReason, setMemberReason] = createSignal('');
  const [pending, setPending] = createSignal<ModerationActionDraft | null>(null);
  const [reviewAuthority, setReviewAuthority] = createSignal<ModerationReviewAuthority | null>(null);
  const [returnFocus, setReturnFocus] = createSignal<HTMLElement | null>(null);
  const liveReviewAuthority = useStore(captureModerationReviewAuthority, moderationReviewAuthorityEqual);
  const connected = createMemo(() => connectionStatus() === 'connected' && serverConnected());
  const memberActions = createMemo(() => {
    const allowed = new Set(memberModerationKindsForMode(preferences().experienceMode));
    return MEMBER_ACTIONS.filter((action) => allowed.has(action.kind));
  });
  const candidates = createMemo(() => [...members().values()]
    .filter((member) => member.nick.trim() && member.nick.toLowerCase() !== ourNick().toLowerCase())
    .slice(0, 12));

  createEffect(on(
    liveReviewAuthority,
    (authority, previous) => {
      if (previous !== undefined && !moderationReviewAuthorityEqual(authority, previous)) {
        setPending(null);
        setReviewAuthority(null);
        setReturnFocus(null);
      }
    },
  ));

  createEffect(on(
    () => local.channel,
    (channel, previous) => {
      if (previous !== undefined && channel !== previous) {
        setPending(null);
        setReviewAuthority(null);
        setReturnFocus(null);
      }
    },
  ));

  function toggleMode(letter: string): void {
    if (!canModerate() || !connected()) return;
    getState().setChannelMode(local.channel, modeState().flags.has(letter) ? `-${letter}` : `+${letter}`);
  }

  function sendInvite(event: SubmitEvent): void {
    event.preventDefault();
    const nick = inviteNick().trim();
    if (!canModerate() || !connected() || !nick) return;
    getState().inviteUser(local.channel, nick);
    setInviteNick('');
  }

  function prepareDraft(event: SubmitEvent, draft: ModerationActionDraft): void {
    event.preventDefault();
    if (!canModerate() || !connected()) return;
    const submitter = event.submitter;
    setReturnFocus(submitter instanceof HTMLElement ? submitter : null);
    setReviewAuthority(captureModerationReviewAuthority(getState()));
    setPending(draft);
  }

  function applyReviewed(action: NormalizedModerationAction): void {
    const state = getState();
    const currentConnected = state.connectionStatus === 'connected' && !!state.server?.connected;
    const currentCanModerate = selectIsChannelOp(local.channel)(state);
    const capturedAuthority = reviewAuthority();
    if (
      action.channel.trim().toLowerCase() !== local.channel.trim().toLowerCase()
      || !currentCanModerate
      || !currentConnected
      || !capturedAuthority
      || !moderationReviewAuthorityIsCurrent(capturedAuthority, state)
    ) {
      setPending(null);
      setReviewAuthority(null);
      setReturnFocus(null);
      return;
    }
    switch (action.kind) {
      case 'kick':
        state.kickMember(action.channel, action.target, action.reason);
        break;
      case 'ban':
        state.banMask(action.channel, action.mask);
        setBanMask('');
        break;
      case 'unban':
        state.unbanMask(action.channel, action.mask);
        break;
      case 'op':
        state.opMember(action.channel, action.target, true);
        break;
      case 'deop':
        state.opMember(action.channel, action.target, false);
        break;
      case 'voice':
        state.voiceMember(action.channel, action.target, true);
        break;
      case 'devoice':
        state.voiceMember(action.channel, action.target, false);
        break;
      default: {
        const _exhaustive: never = action;
        void _exhaustive;
      }
    }
    setPending(null);
    setReviewAuthority(null);
  }

  const lastUpdateLabel = createMemo(() => {
    const at = lastUpdate();
    if (!at) return 'None yet';
    try {
      return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'None yet';
    }
  });

  return (
    <section class="moderation-cockpit" aria-labelledby={titleId} data-testid="moderation-cockpit">
      <div class="moderation-cockpit__head">
        <div>
          <p class="moderation-cockpit__eyebrow">Room safety</p>
          <h3 id={titleId}>Room desk</h3>
        </div>
        <p class="moderation-cockpit__room" aria-label="Current room">{local.channel}</p>
      </div>

      <div class="moderation-desk__boundary" role="note">
        <strong>Room moderation</strong>
        <span>These controls affect this room on the server. Personal mute/block lives in Preferences and only affects your device.</span>
      </div>

      <dl class="moderation-desk__rail" aria-label="Room authority">
        <div>
          <dt>Connected</dt>
          <dd>{connected() ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt>Moderator</dt>
          <dd>{canModerate() ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt>Last room update</dt>
          <dd>{lastUpdateLabel()}</dd>
        </div>
      </dl>

      <Show when={!connected()}>
        <p class="moderation-desk__offline" role="status">
          Reconnect to send room changes. Drafts stay on this device.
        </p>
      </Show>

      <Show when={canModerate()} fallback={<p class="moderation-cockpit__empty">You can view this room’s context, but only room moderators can change its rules or invite people.</p>}>
        <div class="moderation-cockpit__modes" role="group" aria-label="Room safeguards">
          <For each={QUICK_MODES}>{(mode) => (
            <button
              type="button"
              class="moderation-cockpit__mode"
              aria-pressed={modeState().flags.has(mode.letter)}
              disabled={!connected()}
              title={mode.help}
              onClick={() => toggleMode(mode.letter)}
            >
              <span>{mode.label}</span>
              <small>{modeState().flags.has(mode.letter) ? 'On' : 'Off'}</small>
            </button>
          )}</For>
        </div>

        <form class="moderation-cockpit__form" onSubmit={sendInvite}>
          <label for={inviteId}>Invite someone</label>
          <div>
            <input id={inviteId} value={inviteNick()} onInput={(event) => setInviteNick(event.currentTarget.value)} placeholder="Nickname" autocomplete="off" />
            <button type="submit" disabled={!connected() || !inviteNick().trim()}>Send invite</button>
          </div>
          <Show when={candidates().length > 0}>
            <p class="moderation-cockpit__hint">People here: {candidates().map((member) => member.nick).join(', ')}</p>
          </Show>
        </form>

        <Show when={memberActions().length > 0}>
          <form
            class="moderation-cockpit__form moderation-desk__members"
            onSubmit={(event) => {
              const kind = memberAction();
              const target = memberNick().trim();
              const reason = memberReason().trim();
              if (!memberActions().some((action) => action.kind === kind)) return;
              prepareDraft(event, kind === 'kick' || kind === 'ban'
                ? { kind, channel: local.channel, target, ...(reason ? { reason } : {}) }
                : { kind, channel: local.channel, target });
            }}
          >
            <label for={memberId}>Room member action</label>
            <div>
              <select
                id={memberId}
                value={memberNick()}
                onChange={(event) => setMemberNick(event.currentTarget.value)}
              >
                <option value="">Choose a member</option>
                <For each={candidates()}>
                  {(member) => <option value={member.nick}>{member.nick}</option>}
                </For>
              </select>
              <select
                id={actionId}
                aria-label="Member action"
                value={memberAction()}
                onChange={(event) => setMemberAction(event.currentTarget.value as (typeof MEMBER_ACTIONS)[number]['kind'])}
              >
                <For each={memberActions()}>
                  {(action) => <option value={action.kind}>{action.label}</option>}
                </For>
              </select>
            </div>
            <Show when={memberAction() === 'kick' || memberAction() === 'ban'}>
              <label for={reasonId}>Reason <span class="moderation-desk__optional">optional</span></label>
              <input id={reasonId} value={memberReason()} onInput={(event) => setMemberReason(event.currentTarget.value)} autocomplete="off" />
              <p class="moderation-cockpit__hint">No expiry is available for this room action; a moderator can lift a block later.</p>
            </Show>
            <button type="submit" disabled={!connected() || !memberNick().trim()}>Review action</button>
          </form>
        </Show>

        <form
          class="moderation-cockpit__form moderation-cockpit__form--danger"
          onSubmit={(event) => prepareDraft(event, { kind: 'ban', channel: local.channel, mask: banMask() })}
        >
          <label for={banId}>Block an address in this room</label>
          <div>
            <input id={banId} value={banMask()} onInput={(event) => setBanMask(event.currentTarget.value)} placeholder="name!*@*" autocomplete="off" />
            <button type="submit" disabled={!connected() || !banMask().trim()}>Review block</button>
          </div>
          <p class="moderation-cockpit__hint">Server-side, persistent until lifted. Review the target and reason before sending.</p>
        </form>

        <BanListPanel channel={local.channel} />

        <section class="moderation-desk__log" aria-label="Recent room activity">
          <h4>Server activity</h4>
          <p class="moderation-desk__receipt">Only server-echoed changes appear here. A review is a local draft until confirmed.</p>
          <Show
            when={activity().length > 0}
            fallback={<p class="moderation-cockpit__hint">No recent server-echoed moderation activity in this room.</p>}
          >
            <ul class="moderation-desk__log-list">
              <For each={activity()}>
                {(entry) => (
                  <li>
                    {entry.by} {entry.action.toLowerCase()} {entry.target}
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </Show>
      <details class="moderation-cockpit__protocol">
        <summary>Open-wire details</summary>
        <p>This is a read-only view of the room’s last known mode state. Changes above wait for a server reply before the interface updates.</p>
        <code>MODE {local.channel} {rawModes() || '(no modes set)'}</code>
      </details>
      <ModerationActionReview
        open={pending() !== null}
        draft={pending()}
        actorNick={ourNick()}
        connected={connected()}
        canModerate={canModerate()}
        returnFocus={returnFocus()}
        onConfirm={applyReviewed}
        onCancel={() => {
          setPending(null);
          setReviewAuthority(null);
        }}
      />
    </section>
  );
}
