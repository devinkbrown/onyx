// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * StagePanel.tsx — Discord Stages-class room UI (Era 2 B13).
 *
 * Backed by store STAGE CTCP + PROP STAGE=1 / +m. Host starts a stage;
 * audience raises hands; host invites/voices; invitee accepts.
 *
 * SOLID: never destructure props; read props in tracked scopes.
 */
import { createMemo, For, Show, type JSX } from 'solid-js';
import { useStore, getState, selectIsChannelOp } from '@/lib/store';
import { Button } from '@/primitives/index';
import './stage-panel.css';

export function StagePanel(): JSX.Element {
  const activeView = useStore((s) => s.activeView);
  const stageChannel = useStore((s) => s.stageChannel);
  const raisedHands = useStore((s) => s.stageRaisedHands);
  const isHost = useStore((s) => s.isStageHost);
  const isSpeaker = useStore((s) => s.isStageSpeaker);
  const handRaised = useStore((s) => s.stageHandRaised);
  const pendingInvite = useStore((s) => s.pendingSpeakInvite);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const channelProps = useStore((s) => s.channelProps);
  const channels = useStore((s) => s.channels);

  const room = createMemo(() => {
    const v = activeView();
    return v.kind === 'channel' ? v.channel : null;
  });

  const stagePropOn = createMemo(() => {
    const ch = room();
    if (!ch) return false;
    const raw = channelProps().get(ch.toLowerCase())?.STAGE ?? channelProps().get(ch.toLowerCase())?.stage;
    return raw === '1' || raw === 'true' || raw === 'on';
  });

  const moderated = createMemo(() => {
    const ch = room();
    if (!ch) return false;
    const modes = channels().get(ch.toLowerCase())?.modes ?? '';
    return modes.includes('m');
  });

  const activeHere = createMemo(() => {
    const ch = room();
    const stage = stageChannel();
    if (!ch || !stage) return false;
    return stage.toLowerCase() === ch.toLowerCase();
  });

  const isOp = useStore((s) => {
    const ch = room();
    return ch ? selectIsChannelOp(ch)(s) : false;
  });

  const connected = createMemo(() => connectionStatus() === 'connected');

  // Show when this room is a live stage, or ops can start one on a channel.
  const visible = createMemo(() => {
    const ch = room();
    if (!ch) return false;
    if (activeHere() || stagePropOn()) return true;
    // Ops see a dormant strip so they can start a stage without a hidden menu.
    return isOp() && connected();
  });

  function start(): void {
    const ch = room();
    if (ch) getState().startStage(ch);
  }

  function end(): void {
    getState().endStage();
  }

  function join(): void {
    const ch = room();
    if (ch) getState().joinStage(ch);
  }

  return (
    <Show when={visible()}>
      <section
        class="stage-panel"
        data-testid="stage-panel"
        data-active={activeHere() || stagePropOn() ? 'true' : 'false'}
        aria-label="Stage"
      >
        <div class="stage-panel__head">
          <h2 class="stage-panel__title">Stage</h2>
          <p class="stage-panel__hint">
            <Show
              when={activeHere() || stagePropOn()}
              fallback="Start a stage to host speakers with a raised-hand queue."
            >
              {isSpeaker() ? 'You are a speaker.' : 'You are in the audience.'}
              {moderated() ? ' Room is moderated (+m).' : ''}
            </Show>
          </p>
        </div>

        <div class="stage-panel__actions">
          <Show when={!activeHere() && !stagePropOn() && isOp()}>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!connected()}
              onClick={start}
              data-testid="stage-start"
            >
              Start stage
            </Button>
          </Show>

          <Show when={(stagePropOn() || moderated()) && !activeHere()}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!connected()}
              onClick={join}
              data-testid="stage-join"
            >
              Join as audience
            </Button>
          </Show>

          <Show when={activeHere() && isHost()}>
            <Button type="button" variant="danger" size="sm" onClick={end} data-testid="stage-end">
              End stage
            </Button>
          </Show>

          <Show when={activeHere() && !isHost()}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => getState().leaveStage()}
              data-testid="stage-leave"
            >
              Leave stage
            </Button>
          </Show>

          <Show when={activeHere() && !isSpeaker()}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!connected()}
              onClick={() => (handRaised() ? getState().lowerHand() : getState().raiseHand())}
              data-testid="stage-hand"
              aria-pressed={handRaised()}
            >
              {handRaised() ? 'Lower hand' : 'Raise hand'}
            </Button>
          </Show>
        </div>

        <Show when={pendingInvite()}>
          {(from) => (
            <div class="stage-panel__invite" role="status" data-testid="stage-invite">
              <p>
                <strong>{from()}</strong> invited you to speak.
              </p>
              <div class="stage-panel__actions">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => getState().acceptSpeakInvite()}
                  data-testid="stage-accept"
                >
                  Accept
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => getState().declineSpeakInvite()}
                  data-testid="stage-decline"
                >
                  Decline
                </Button>
              </div>
            </div>
          )}
        </Show>

        <Show when={activeHere() && isHost() && raisedHands().length > 0}>
          <ul class="stage-panel__hands" aria-label="Raised hands" data-testid="stage-hands">
            <For each={raisedHands()}>
              {(nick) => (
                <li class="stage-panel__hand-row">
                  <span>{nick}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => getState().inviteToSpeak(nick)}
                    data-testid={`stage-invite-${nick}`}
                  >
                    Invite to speak
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </Show>
  );
}

export default StagePanel;
