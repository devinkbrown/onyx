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
  selectChannelModeState,
  selectIsChannelOp,
} from '@/lib/store';
import { Button, FormField, Sheet } from '@/primitives/index';

// Common simple channel flags exposed as toggles. Letters match Orochi's
// CHANMODES group D (flags) — see ISUPPORT `imnstCTNMSgWOA`.
const FLAG_TOGGLES: ReadonlyArray<{ letter: string; label: string; hint: string }> = [
  { letter: 'm', label: 'Moderated', hint: 'Only voiced members and ops may speak (+m)' },
  { letter: 'i', label: 'Invite only', hint: 'Members must be invited to join (+i)' },
  { letter: 't', label: 'Topic locked', hint: 'Only ops may change the topic (+t)' },
  { letter: 'n', label: 'No external messages', hint: 'Block messages from non-members (+n)' },
  { letter: 's', label: 'Secret', hint: 'Hide the channel from listings (+s)' },
];

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
  const isOp = useStore((s) => selectIsChannelOp(local.channel)(s));

  const channel = createMemo(() =>
    channels().get(local.channel.toLowerCase()) ?? null,
  );

  // ── Topic editing ──────────────────────────────────────────────────────
  const serverTopic = createMemo(() => channel()?.topic ?? '');
  const [topicDraft, setTopicDraft] = createSignal('');

  // Re-seed the draft whenever the panel opens or the server topic changes
  // (and we're not mid-edit). Keeps the field in sync without clobbering typing.
  createEffect(() => {
    if (local.open) {
      setTopicDraft(serverTopic());
    }
  });

  // +t locks topic editing to ops. Without +t, anyone may set it.
  const topicLocked = createMemo(() => modeState().flags.has('t'));
  const canEditTopic = createMemo(() => !topicLocked() || isOp());
  const topicDirty = createMemo(() => topicDraft() !== serverTopic());

  function submitTopic(event: Event): void {
    event.preventDefault();
    if (!canEditTopic() || !topicDirty()) return;
    getState().setTopic(channel()?.name ?? local.channel, topicDraft());
  }

  // ── Mode toggles (op-only) ───────────────────────────────────────────────
  function toggleFlag(letter: string, currentlyOn: boolean): void {
    if (!isOp()) return;
    getState().setChannelMode(channel()?.name ?? local.channel, currentlyOn ? `-${letter}` : `+${letter}`);
  }

  // ── Key (+k) ──────────────────────────────────────────────────────────────
  const [keyDraft, setKeyDraft] = createSignal('');
  createEffect(() => {
    if (local.open) setKeyDraft(modeState().key ?? '');
  });

  function applyKey(event: Event): void {
    event.preventDefault();
    if (!isOp()) return;
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
    if (!isOp()) return;
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
                onInput={(e) => setTopicDraft(e.currentTarget.value)}
                rows={3}
                aria-describedby="chset-topic-hint"
              />
              <p id="chset-topic-hint" class="shell-chset-hint">
                <Show when={topicLocked()} fallback="Press Save to update the channel topic.">
                  Topic-locked (+t): your op rank lets you edit it.
                </Show>
              </p>
              <div class="shell-chset-actions">
                <Button type="submit" variant="primary" size="sm" disabled={!topicDirty()}>
                  Save topic
                </Button>
              </div>
            </form>
          </Show>
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
              <Button type="submit" variant="ghost" size="sm">Apply key</Button>
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
              <Button type="submit" variant="ghost" size="sm">Apply limit</Button>
            </form>
          </Show>
        </section>
      </div>
    </Sheet>
  );
}
