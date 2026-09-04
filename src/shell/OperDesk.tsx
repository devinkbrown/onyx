// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * OperDesk — the network operator surface.
 *
 * This is deliberately NOT a generic ircd oper panel. Onyx Server has no
 * `OPER` command (status comes from the SASL account, 491) and no `+w` WALLOPS
 * (ONYX_SERVER_PROTOCOL.md §16), so every control here maps onto an Event Spine
 * verb the daemon actually implements. `planOperAction` owns the mapping, the
 * bounds, and the refusals — this component only collects input and renders the
 * plan, so the composer's `/broadcast` and this desk's Announce button take one
 * validation path.
 *
 * Destructive plans (broadcast, KILL, REHASH) route through an inline review
 * step, matching the room desk's reviewed-action discipline: nothing
 * network-visible leaves the client on a single click.
 */
import { createMemo, createSignal, createUniqueId, For, Show, type JSX } from 'solid-js';
import { getState, useStore } from '@/lib/store';
import {
  OPER_EVENT_CATEGORIES,
  MAX_BROADCAST_LENGTH,
  operEventCategoryLabel,
  planOperAction,
  type OperDeskCommand,
  type OperDeskIntent,
} from '@/lib/oper/operDesk';
import './oper-desk.css';

/** Render the exact wire line a plan will send, for the open-wire disclosure. */
export function formatOperWirePreview(command: OperDeskCommand): string {
  const params = command.params.map((param, index) => {
    const last = index === command.params.length - 1;
    return last && (param === '' || param.includes(' ') || param.startsWith(':'))
      ? `:${param}`
      : param;
  });
  return [command.command, ...params].join(' ');
}

export function OperDesk(): JSX.Element {
  const instanceId = createUniqueId();
  const titleId = `oper-desk-title-${instanceId}`;
  const broadcastId = `oper-desk-broadcast-${instanceId}`;
  const categoryId = `oper-desk-category-${instanceId}`;
  const maskId = `oper-desk-mask-${instanceId}`;
  const killNickId = `oper-desk-kill-nick-${instanceId}`;
  const killReasonId = `oper-desk-kill-reason-${instanceId}`;

  const isOper = useStore((s) => s.isOper);
  const isNetworkAdmin = useStore((s) => s.isNetworkAdmin);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const networkName = useStore((s) => s.networkName);
  const ourNick = useStore((s) => s.ourNick);

  const [broadcast, setBroadcast] = createSignal('');
  const [category, setCategory] = createSignal<string>(OPER_EVENT_CATEGORIES[0]);
  const [mask, setMask] = createSignal('');
  const [killNick, setKillNick] = createSignal('');
  const [killReason, setKillReason] = createSignal('');
  const [pending, setPending] = createSignal<OperDeskCommand | null>(null);
  const [errors, setErrors] = createSignal<readonly string[]>([]);
  const [lastSent, setLastSent] = createSignal<string | null>(null);

  const connected = createMemo(() => connectionStatus() === 'connected');
  const roleLabel = createMemo(() => (isNetworkAdmin() ? 'Network administrator' : 'IRC operator'));
  const broadcastRemaining = createMemo(() => MAX_BROADCAST_LENGTH - broadcast().trim().length);

  /**
   * Validate an intent, then either stage it for review (destructive) or send
   * it straight away (a read such as PRIVS or an Event Spine subscription).
   */
  function submit(intent: OperDeskIntent): void {
    if (!connected()) return;
    const plan = planOperAction(intent);
    if (!plan.ok) {
      setPending(null);
      setErrors(plan.errors);
      return;
    }
    setErrors([]);
    if (plan.command.destructive) {
      setPending(plan.command);
      return;
    }
    dispatch(plan.command);
  }

  function dispatch(command: OperDeskCommand): void {
    // operAction re-checks oper status and connection in the store, so a stale
    // render can never push an operator verb from a downgraded session.
    getState().operAction(command.command, ...command.params);
    setPending(null);
    setLastSent(`${formatOperWirePreview(command)} · ${new Date().toLocaleTimeString()}`);
  }

  function confirmPending(): void {
    const command = pending();
    if (!command) return;
    dispatch(command);
    if (command.command === 'KILL') {
      setKillNick('');
      setKillReason('');
    }
    if (command.params[0] === 'BROADCAST') setBroadcast('');
  }

  return (
    <Show when={isOper()}>
      <section class="oper-desk" data-testid="oper-desk" aria-labelledby={titleId}>
        <div class="oper-desk__head">
          <p class="oper-desk__eyebrow">Network</p>
          <h3 id={titleId}>Operator desk</h3>
        </div>

        <dl class="oper-desk__rail" aria-label="Operator authority">
          <div>
            <dt>Role</dt>
            <dd data-testid="oper-desk-role">{roleLabel()}</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>{networkName()}</dd>
          </div>
          <div>
            <dt>Signed in as</dt>
            <dd>{ourNick() || 'Unknown'}</dd>
          </div>
        </dl>

        <Show when={!connected()}>
          <p class="oper-desk__offline" role="status" data-testid="oper-desk-offline">
            Reconnect to send operator commands. Drafts stay on this device.
          </p>
        </Show>

        <Show when={errors().length > 0}>
          <ul class="oper-desk__errors" role="alert" data-testid="oper-desk-errors">
            <For each={errors()}>{(error) => <li>{error}</li>}</For>
          </ul>
        </Show>

        <form
          class="oper-desk__form"
          data-testid="oper-desk-broadcast-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit({ kind: 'broadcast', text: broadcast() });
          }}
        >
          <label for={broadcastId}>Announce to the network</label>
          <div>
            <input
              id={broadcastId}
              data-testid="oper-desk-broadcast-input"
              value={broadcast()}
              maxlength={MAX_BROADCAST_LENGTH}
              autocomplete="off"
              placeholder="Maintenance at 03:00 UTC"
              onInput={(event) => setBroadcast(event.currentTarget.value)}
            />
            <button type="submit" disabled={!connected() || !broadcast().trim()}>
              Review announcement
            </button>
          </div>
          <p class="oper-desk__hint">
            Every connected member sees this. {broadcastRemaining()} characters left.
          </p>
        </form>

        <form
          class="oper-desk__form"
          data-testid="oper-desk-events-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit({ kind: 'event-subscribe', category: category() });
          }}
        >
          <label for={categoryId}>Event Spine categories</label>
          <div>
            <select
              id={categoryId}
              data-testid="oper-desk-category"
              value={category()}
              onChange={(event) => setCategory(event.currentTarget.value)}
            >
              <For each={OPER_EVENT_CATEGORIES}>
                {(value) => <option value={value}>{operEventCategoryLabel(value)}</option>}
              </For>
            </select>
            <button type="submit" disabled={!connected()}>Subscribe</button>
            <button
              type="button"
              data-testid="oper-desk-category-unsubscribe"
              disabled={!connected()}
              onClick={() => submit({ kind: 'event-unsubscribe', category: category() })}
            >
              Unsubscribe
            </button>
          </div>
          <p class="oper-desk__hint">
            Subscriptions are per session. Use List to ask the node what this session receives.
          </p>
          <div class="oper-desk__actions">
            <button
              type="button"
              data-testid="oper-desk-event-list"
              disabled={!connected()}
              onClick={() => submit({ kind: 'event-list' })}
            >
              List subscriptions
            </button>
            <button
              type="button"
              data-testid="oper-desk-privs"
              disabled={!connected()}
              onClick={() => submit({ kind: 'privs' })}
            >
              Show my privileges
            </button>
            <button
              type="button"
              class="oper-desk__danger"
              data-testid="oper-desk-rehash"
              disabled={!connected()}
              onClick={() => submit({ kind: 'rehash' })}
            >
              Reload node config
            </button>
          </div>
        </form>

        <form
          class="oper-desk__form"
          data-testid="oper-desk-observe-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit({ kind: 'observe', mask: mask() });
          }}
        >
          <label for={maskId}>Watch a mask network-wide</label>
          <div>
            <input
              id={maskId}
              data-testid="oper-desk-mask"
              value={mask()}
              autocomplete="off"
              placeholder="name!*@*.example"
              onInput={(event) => setMask(event.currentTarget.value)}
            />
            <button type="submit" disabled={!connected() || !mask().trim()}>Observe</button>
          </div>
          <p class="oper-desk__hint">
            OBSERVE reveals the subject’s real, uncloaked host to you. Use the narrowest mask
            that answers the question.
          </p>
          <div class="oper-desk__actions">
            <button
              type="button"
              data-testid="oper-desk-observe-list"
              disabled={!connected()}
              onClick={() => submit({ kind: 'observe-list' })}
            >
              List watches
            </button>
            <button
              type="button"
              data-testid="oper-desk-observe-off"
              disabled={!connected()}
              onClick={() => submit({ kind: 'observe-off' })}
            >
              Clear watches
            </button>
          </div>
        </form>

        <form
          class="oper-desk__form oper-desk__form--danger"
          data-testid="oper-desk-kill-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit({ kind: 'kill', target: killNick(), reason: killReason() });
          }}
        >
          <label for={killNickId}>Disconnect someone from the network</label>
          <div>
            <input
              id={killNickId}
              data-testid="oper-desk-kill-nick"
              value={killNick()}
              autocomplete="off"
              placeholder="Nickname"
              onInput={(event) => setKillNick(event.currentTarget.value)}
            />
          </div>
          <label for={killReasonId}>Reason (recorded network-wide)</label>
          <div>
            <input
              id={killReasonId}
              data-testid="oper-desk-kill-reason"
              value={killReason()}
              autocomplete="off"
              placeholder="Repeat flooding after a warning"
              onInput={(event) => setKillReason(event.currentTarget.value)}
            />
            <button
              type="submit"
              class="oper-desk__danger"
              disabled={!connected() || !killNick().trim() || !killReason().trim()}
            >
              Review disconnect
            </button>
          </div>
        </form>

        <Show when={pending()}>
          {(command) => (
            <div
              class="oper-desk__review"
              role="alertdialog"
              aria-label="Review operator action"
              data-testid="oper-desk-review"
            >
              <p class="oper-desk__review-summary" data-testid="oper-desk-review-summary">
                {command().summary}
              </p>
              <code class="oper-desk__wire" data-testid="oper-desk-review-wire">
                {formatOperWirePreview(command())}
              </code>
              <div class="oper-desk__actions">
                <button
                  type="button"
                  class="oper-desk__danger"
                  data-testid="oper-desk-review-confirm"
                  disabled={!connected()}
                  onClick={confirmPending}
                >
                  Send it
                </button>
                <button
                  type="button"
                  data-testid="oper-desk-review-cancel"
                  onClick={() => setPending(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Show>

        <Show when={lastSent()}>
          {(sent) => (
            <p class="oper-desk__hint" role="status" data-testid="oper-desk-last-sent">
              Sent {sent()}
            </p>
          )}
        </Show>

        <details class="oper-desk__protocol">
          <summary>Open-wire details</summary>
          <p>
            This network grants operator status from the signed-in account — there is no OPER
            command, and a broadcast rides the Event Spine rather than a user-mode WALLOPS.
          </p>
          <code>EVENT BROADCAST · EVENT ADD/DEL/LIST · EVENT OBSERVE · REHASH · PRIVS · KILL</code>
        </details>
      </section>
    </Show>
  );
}

export default OperDesk;
