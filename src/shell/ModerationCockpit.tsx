// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Permission-aware room moderation controls. This is deliberately a context
 * surface: it dispatches existing store actions and waits for server echoes;
 * nothing here pretends a mode, ban, or invitation completed optimistically.
 */
import { createMemo, createSignal, For, Show, splitProps, type JSX } from 'solid-js';
import { getState, selectChannelModeState, selectIsChannelOp, useStore } from '@/lib/store';

export type ModerationCockpitProps = { channel: string };

const QUICK_MODES = [
  { letter: 'm', label: 'Moderated', help: 'Only voiced members and moderators can speak.' },
  { letter: 'i', label: 'Invite-only', help: 'New people need an invitation to join.' },
  { letter: 't', label: 'Protected topic', help: 'Only moderators can change the topic.' },
] as const;

export function ModerationCockpit(props: ModerationCockpitProps): JSX.Element {
  const [local] = splitProps(props, ['channel']);
  const canModerate = useStore((s) => selectIsChannelOp(local.channel)(s));
  const connectionStatus = useStore((s) => s.connectionStatus);
  const modeState = useStore((s) => selectChannelModeState(local.channel)(s));
  const members = useStore((s) => s.channels.get(local.channel.toLowerCase())?.users ?? new Map());
  const rawModes = useStore((s) => s.channels.get(local.channel.toLowerCase())?.modes ?? '');
  const [inviteNick, setInviteNick] = createSignal('');
  const [banMask, setBanMask] = createSignal('');
  const [confirmBan, setConfirmBan] = createSignal(false);
  const connected = createMemo(() => connectionStatus() === 'connected');
  const candidates = createMemo(() => [...members().values()].filter((member) => member.nick.trim()).slice(0, 5));

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

  function prepareBan(event: SubmitEvent): void {
    event.preventDefault();
    if (!canModerate() || !connected() || !banMask().trim()) return;
    setConfirmBan(true);
  }

  function confirmBanAction(): void {
    const mask = banMask().trim();
    if (!mask || !canModerate() || !connected()) return;
    getState().banMask(local.channel, mask);
    setBanMask('');
    setConfirmBan(false);
  }

  return (
    <section class="moderation-cockpit" aria-labelledby="moderation-cockpit-title" data-testid="moderation-cockpit">
      <div class="moderation-cockpit__head">
        <div>
          <p class="moderation-cockpit__eyebrow">Room controls</p>
          <h3 id="moderation-cockpit-title">Moderation</h3>
        </div>
        <span class={`moderation-cockpit__state${connected() ? '' : ' moderation-cockpit__state--offline'}`} role="status">
          {connected() ? 'Live changes' : 'Reconnect to make changes'}
        </span>
      </div>

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
          <label for="moderation-invite-nick">Invite someone</label>
          <div>
            <input id="moderation-invite-nick" value={inviteNick()} onInput={(event) => setInviteNick(event.currentTarget.value)} placeholder="Nickname" autocomplete="off" />
            <button type="submit" disabled={!connected() || !inviteNick().trim()}>Send invite</button>
          </div>
          <Show when={candidates().length > 0}>
            <p class="moderation-cockpit__hint">Try: {candidates().map((member) => member.nick).join(', ')}</p>
          </Show>
        </form>

        <form class="moderation-cockpit__form moderation-cockpit__form--danger" onSubmit={prepareBan}>
          <label for="moderation-ban-mask">Block a matching address</label>
          <div>
            <input id="moderation-ban-mask" value={banMask()} onInput={(event) => { setBanMask(event.currentTarget.value); setConfirmBan(false); }} placeholder="nick!*@*" autocomplete="off" />
            <button type="submit" disabled={!connected() || !banMask().trim()}>Review block</button>
          </div>
          <p class="moderation-cockpit__hint">This sends a server-side ban. It cannot be undone here because this view does not receive a ban list.</p>
          <Show when={confirmBan()}>
            <div class="moderation-cockpit__confirm" role="alert">
              <p>Block <code>{banMask().trim()}</code> from {local.channel}?</p>
              <button type="button" class="moderation-cockpit__confirm-action" onClick={confirmBanAction}>Confirm block</button>
              <button type="button" onClick={() => setConfirmBan(false)}>Cancel</button>
            </div>
          </Show>
        </form>
      </Show>
      <details class="moderation-cockpit__protocol">
        <summary>IRC details</summary>
        <p>This is a read-only view of the room’s last known mode state. Changes above wait for a server reply before the interface updates.</p>
        <code>MODE {local.channel} {rawModes() || '(no modes set)'}</code>
      </details>
    </section>
  );
}
