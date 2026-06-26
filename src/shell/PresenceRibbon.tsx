/**
 * PresenceRibbon.tsx — top ribbon of the conversation column.
 *
 * Shows: channel name + topic, self identity (selfNick),
 * connection status dot, member count, and a member-list toggle.
 *
 * SOLID IDIOMS: never destructure props; splitProps; createMemo.
 */

import { createMemo, createSignal, Show, splitProps, type JSX } from 'solid-js';
import { useStore, getState, selectAccount } from '@/lib/store';
import { ChannelSettings } from './ChannelSettings';

export type PresenceRibbonProps = {
  selfNick?: string;
  onToggleMembers?: () => void;
};

export function PresenceRibbon(props: PresenceRibbonProps): JSX.Element {
  const [local] = splitProps(props, ['selfNick', 'onToggleMembers']);

  const activeView = useStore((s) => s.activeView);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);
  const ourNick = useStore((s) => s.ourNick);
  const account = useStore(selectAccount);

  // ── derived ──
  const activeChannel = createMemo(() => {
    const view = activeView();
    if (view.kind !== 'channel') return null;
    return channels().get(view.channel) ?? null;
  });

  const activeDm = createMemo(() => {
    const view = activeView();
    if (view.kind !== 'dm') return null;
    return dms().get(view.nick.toLowerCase()) ?? dms().get(view.nick) ?? null;
  });

  const channelName = createMemo(() => {
    const view = activeView();
    if (view.kind === 'channel') return view.channel;
    if (view.kind === 'dm') return view.nick;
    return null;
  });

  const topic = createMemo(() => {
    const ch = activeChannel();
    if (ch) return ch.topic || null;
    return null;
  });

  const memberCount = createMemo(() => {
    const ch = activeChannel();
    return ch ? ch.users.size : 0;
  });

  const displayNick = createMemo(() => local.selfNick ?? ourNick() ?? '');

  // Active channel name for the settings panel (display-cased, e.g. "#general").
  const settingsChannel = createMemo(() => activeChannel()?.name ?? null);
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  const connMod = createMemo(() => {
    const s = connectionStatus();
    if (s === 'connected') return '--connected';
    if (s === 'connecting' || s === 'reconnecting') return '--connecting';
    return '--disconnected';
  });

  const connLabel = createMemo(() => {
    const s = connectionStatus();
    if (s === 'connected') return 'connected';
    if (s === 'reconnecting') return 'reconnecting';
    if (s === 'connecting') return 'connecting';
    return 'disconnected';
  });

  function handleMembersClick(): void {
    if (local.onToggleMembers) {
      local.onToggleMembers();
    } else {
      getState().toggleMemberList();
    }
  }

  return (
    <header class="shell-ribbon" role="banner" aria-label="Channel information">
      {/* Channel / DM name */}
      <Show when={channelName()} fallback={
        <span class="shell-ribbon-channel" aria-label="No active channel">
          IRCXNet
        </span>
      }>
        {(name) => (
          <span
            class="shell-ribbon-channel"
            aria-label={activeView().kind === 'channel' ? `Channel: ${name()}` : `Direct message: ${name()}`}
          >
            <Show when={activeView().kind === 'channel'}>
              <span class="shell-ribbon-sigil" aria-hidden="true">#</span>
            </Show>
            <Show when={activeView().kind === 'dm'}>
              <span class="shell-ribbon-sigil shell-ribbon-sigil--dm" aria-hidden="true">@</span>
            </Show>
            {activeView().kind === 'channel'
              ? name().replace(/^#/, '')
              : name()}
          </span>
        )}
      </Show>

      {/* Separator + topic */}
      <Show when={topic()}>
        {(t) => (
          <>
            <span class="shell-ribbon-sep" aria-hidden="true" />
            <p class="shell-ribbon-topic" title={t()}>
              {t()}
            </p>
          </>
        )}
      </Show>

      {/* Right side: identity, conn status, member count */}
      <div class="shell-ribbon-right" role="group" aria-label="Connection status">
        {/* Channel settings — only in a channel. Opens topic + modes panel. */}
        <Show when={activeView().kind === 'channel' && settingsChannel()}>
          <button
            type="button"
            class="shell-ribbon-settings"
            aria-label={`Channel settings for ${settingsChannel()}`}
            aria-haspopup="dialog"
            onClick={() => setSettingsOpen(true)}
            data-testid="ribbon-settings-gear"
          >
            <span class="shell-ribbon-settings-glyph" aria-hidden="true">⚙</span>
          </button>
        </Show>

        {/* Member count — only show in channel */}
        <Show when={activeView().kind === 'channel' && memberCount() > 0}>
          <button
            type="button"
            class="shell-ribbon-members"
            aria-label={`${memberCount()} members — toggle member list`}
            onClick={handleMembersClick}
          >
            {memberCount()} members
          </button>
        </Show>

        {/* Identity / account chip — opens the account panel. Shows the
            logged-in account, or "Guest" when browsing anonymously. */}
        <button
          type="button"
          class="shell-ribbon-account"
          data-guest={account() ? 'false' : 'true'}
          aria-label={
            account()
              ? `Account: ${account()} — open account panel`
              : 'Guest — open account panel'
          }
          aria-haspopup="dialog"
          onClick={() => getState().openAccount()}
          data-testid="ribbon-account-chip"
        >
          <span class="shell-ribbon-account-glyph" aria-hidden="true">
            {account() ? '◆' : '◌'}
          </span>
          <span class="shell-ribbon-account-text">
            <Show when={account()} fallback={<span class="shell-ribbon-account-name">Guest</span>}>
              {(acct) => <span class="shell-ribbon-account-name">{acct()}</span>}
            </Show>
            <Show when={displayNick() && displayNick() !== account()}>
              <span class="shell-ribbon-account-nick">{displayNick()}</span>
            </Show>
          </span>
        </button>

        {/* Connection status */}
        <span class="shell-ribbon-conn" aria-live="polite" aria-atomic="true">
          <span
            class={`shell-ribbon-conn-dot shell-ribbon-conn-dot${connMod()}`}
            aria-hidden="true"
          />
          <span class="sr-only">{connLabel()}</span>
        </span>
      </div>

      {/* Channel settings panel (topic + modes) — portaled Sheet. */}
      <Show when={settingsChannel()}>
        {(name) => (
          <ChannelSettings
            channel={name()}
            open={settingsOpen()}
            onOpenChange={setSettingsOpen}
          />
        )}
      </Show>
    </header>
  );
}
