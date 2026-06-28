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
      {/* Inner row shares the conversation reading measure so the title and
          controls stay aligned with the message column on ultra-wide displays;
          the ribbon's background + underline remain full-bleed chrome. */}
      <div class="shell-ribbon-inner">
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

        {/* Appearance — theme + background switcher. Always reachable here
            (the rail entry is hidden when fewer than 3 servers). */}
        <button
          type="button"
          class="shell-ribbon-appearance"
          aria-label="Appearance — theme and background"
          aria-haspopup="dialog"
          onClick={() => getState().openAppearance()}
          data-testid="ribbon-appearance"
        >
          <svg class="shell-ribbon-appearance-glyph" viewBox="0 0 24 24" aria-hidden="true"
            fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-3.9-4-7.4-9-7.4Z" />
            <circle cx="7.5" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="11" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
          </svg>
        </button>

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
