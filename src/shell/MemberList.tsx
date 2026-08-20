// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MemberList.tsx — channel member list with live role badges.
 *
 * Role precedence (Onyx Server PREFIX=(YQqov)*!.@+):
 *   Y → netop   (*)  — lapis badge
 *   Q → founder (!)  — gold bright badge
 *   q → owner   (. or ~) — gold badge
 *   a → admin   (&)  — gold badge
 *   o → op      (@)  — vermilion badge
 *   h → halfop  (%)  — muted badge
 *   v → voice   (+)  — green badge
 *   ''→ member  (no badge)
 *
 * Sorted: netop > founder > owner > admin > op > halfop > voice > member; then alpha within group.
 *
 * Click a user → Popover mini-card with nick, account, badges, and actions.
 *
 * SOLID IDIOMS: never destructure props; splitProps; createMemo; For/Show.
 */

import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  Show,
  splitProps,
  type JSX,
} from 'solid-js';
import { useStore, getState, selectIsChannelOp } from '@/lib/store';
import type { ChannelUser } from '@/lib/irc/types';
import { createGroupReconciler, type ResolvedRole } from '@/lib/memberGroups';
import {
  computeMemberWindow,
  flattenMemberRows,
  memberPrefixHeight,
  sectionMemberWindow,
} from './memberWindow';
import { formatMentionInsert } from '@/lib/composer/composerInject';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import { preferences } from '@/lib/prefs/preferences';
import {
  memberModerationKindsForMode,
  type ModerationActionDraft,
  type NormalizedModerationAction,
} from '@/lib/moderation/actionModel';
import { Avatar, Popover, Button, IconButton } from '@/primitives/index';
import { ModerationActionReview } from './moderation/ModerationActionReview';
import { statsRoomHref } from '@/lib/stats/channelDetail';

// Role resolution, grouping, and identity-stable reconciliation live in
// `@/lib/memberGroups` (unit-tested there). See that module for why entry/group
// objects keep reference identity across roster events.

// ── Role Badge ───────────────────────────────────────────────────────────────

type RoleBadgeProps = {
  role: ResolvedRole;
  /**
   * When the surrounding control already names the role for assistive tech
   * (e.g. the roster row's sr-only summary), render the badge as a purely
   * visual glyph so screen readers don't announce the role a second time.
   */
  decorative?: boolean;
};

function RoleBadge(props: RoleBadgeProps): JSX.Element {
  const [local] = splitProps(props, ['role', 'decorative']);
  return (
    <Show when={local.role.key !== 'member'}>
    <span
      class={`shell-role-badge shell-role-badge--${local.role.key}`}
      aria-label={local.decorative ? undefined : local.role.label}
      aria-hidden={local.decorative ? 'true' : undefined}
      title={local.role.label}
    >
      {local.role.symbol}
    </span>
    </Show>
  );
}

// ── Member popover card ──────────────────────────────────────────────────────

type MemberCardProps = {
  user: ChannelUser;
  role: ResolvedRole;
  /** Active channel the member belongs to (for moderation commands). */
  channel: string;
  /** Let the owning shell coordinate navigation with drawer and focus state. */
  onOpenDm?: (nick: string) => void;
  /** Open WHOIS with a persistent row control as the modal return target. */
  onOpenWhois?: (nick: string, returnFocus: HTMLElement) => void;
  /** Stage a reviewed room action without sending it yet. */
  onRequestModeration?: (draft: ModerationActionDraft, returnFocus: HTMLElement | null) => void;
};

function MemberCard(props: MemberCardProps): JSX.Element {
  const [local] = splitProps(props, ['user', 'role', 'channel', 'onOpenDm', 'onOpenWhois', 'onRequestModeration']);

  // Reactive op-gate: moderation controls only render for op (or higher).
  const canModerate = useStore((s) => selectIsChannelOp(local.channel)(s));
  const ourNick = useStore((s) => s.ourNick);

  // Whether the target currently holds the named status mode.
  const hasMode = (m: string): boolean => local.user.modes.has(m);
  const isSelf = (): boolean => local.user.nick.toLowerCase() === ourNick().toLowerCase();
  const cardInstanceId = createUniqueId();
  const cardId = createMemo(() => {
    const channel = local.channel.replace(/[^a-z0-9_-]+/giu, '-').replace(/^-|-$/gu, '') || 'channel';
    const nick = local.user.nick.replace(/[^a-z0-9_-]+/giu, '-').replace(/^-|-$/gu, '') || 'member';
    return `member-card-${cardInstanceId}-${channel}-${nick}`;
  });

  function memberTriggerForAction(event: MouseEvent): HTMLButtonElement | null {
    const action = event.currentTarget;
    return action instanceof HTMLElement
      ? action.closest('.onyx-popover')?.querySelector<HTMLButtonElement>('.onyx-popover__trigger') ?? null
      : null;
  }

  function closeCardForHandoff(event: MouseEvent, focusRoster = false): HTMLElement | null {
    const memberTrigger = memberTriggerForAction(event);
    if (!memberTrigger) return null;

    const roster = memberTrigger.closest<HTMLElement>('.shell-members');
    const target = focusRoster ? roster : memberTrigger;

    if (memberTrigger.getAttribute('aria-expanded') === 'true') memberTrigger.click();
    target?.focus({ preventScroll: true });
    // Popover restores its own opener in a microtask. Run after that restore so
    // a later MODE/KICK echo cannot remove the element that owns focus.
    if (focusRoster && target) queueMicrotask(() => target.focus({ preventScroll: true }));
    return target;
  }

  function handleDm(): void {
    if (local.onOpenDm) {
      local.onOpenDm(local.user.nick);
      return;
    }
    getState().navigate({ kind: 'dm', nick: local.user.nick });
  }

  function handleMention(): void {
    const insert = formatMentionInsert(local.user.nick);
    if (!insert) return;
    getState().injectComposerText(local.channel, insert, 'append');
    getState().addToast({
      variant: 'info',
      title: `Mention ${local.user.nick}`,
      description: 'Inserted into the composer for this room.',
    });
    queueMicrotask(() => {
      document.querySelector<HTMLElement>('[data-composer-input]')?.focus();
    });
  }

  async function handleCopyNick(): Promise<void> {
    const nick = local.user.nick.trim();
    if (!nick) return;
    const ok = await writeClipboardText(nick);
    getState().addToast({
      variant: ok ? 'success' : 'warning',
      title: ok ? 'Nick copied' : 'Could not copy nick',
      description: ok
        ? `${nick} is on the clipboard.`
        : 'Clipboard access was denied in this browser.',
    });
  }

  function handleWhois(event: MouseEvent): void {
    // The WHOIS Sheet lives outside this native popover. Its first pointer
    // interaction light-dismisses the popover and removes this Profile button,
    // so explicitly give the owning shell the persistent member-row trigger
    // instead of relying on native popover focus timing.
    const memberTrigger = closeCardForHandoff(event);
    if (local.onOpenWhois && memberTrigger) {
      local.onOpenWhois(local.user.nick, memberTrigger);
      return;
    }
    getState().whois(local.user.nick);
  }

  const showRoomModeration = createMemo(() => {
    const kinds = memberModerationKindsForMode(preferences().experienceMode);
    return canModerate() && !isSelf() && kinds.includes('kick');
  });

  const showIrcRoleControls = createMemo(() => {
    const kinds = memberModerationKindsForMode(preferences().experienceMode);
    return canModerate() && !isSelf() && kinds.includes('op');
  });

  function requestModeration(event: MouseEvent, draft: ModerationActionDraft): void {
    const trigger = closeCardForHandoff(event, true);
    local.onRequestModeration?.(draft, trigger);
  }

  function handleOp(event: MouseEvent): void {
    requestModeration(event, {
      kind: hasMode('o') ? 'deop' : 'op',
      channel: local.channel,
      target: local.user.nick,
    });
  }

  function handleVoice(event: MouseEvent): void {
    requestModeration(event, {
      kind: hasMode('v') ? 'devoice' : 'voice',
      channel: local.channel,
      target: local.user.nick,
    });
  }

  function handleKick(event: MouseEvent): void {
    requestModeration(event, {
      kind: 'kick',
      channel: local.channel,
      target: local.user.nick,
    });
  }

  function handleBan(event: MouseEvent): void {
    requestModeration(event, {
      kind: 'ban',
      channel: local.channel,
      target: local.user.nick,
    });
  }

  const isIgnored = useStore((s) => s.isIgnored(local.user.nick));

  function handleIgnore(event: MouseEvent): void {
    closeCardForHandoff(event, true);
    const nick = local.user.nick;
    if (isIgnored()) {
      getState().unignoreUser(nick);
      getState().addToast({
        variant: 'info',
        title: `Unignored ${nick}`,
        description: 'Messages and notifications from this nick resume on this device.',
      });
      return;
    }
    getState().ignoreUser(nick);
    getState().addToast({
      variant: 'info',
      title: `Ignoring ${nick}`,
      description: 'Their messages are hidden on this device. Notifications are silenced too.',
    });
  }

  return (
    <div
      class="shell-member-card"
      role="region"
      aria-labelledby={`${cardId()}-nick`}
      aria-describedby={`${cardId()}-role`}
    >
      <div class="shell-member-card-head">
        <Avatar
          name={local.user.nick}
          size="md"
          owner={local.role.key === 'owner' || local.role.key === 'founder'}
          aria-hidden="true"
        />
        <div>
          <p class="shell-member-card-nick" id={`${cardId()}-nick`}>{local.user.nick}</p>
          <p class="shell-member-card-role" id={`${cardId()}-role`}>
            {local.role.label} in {local.channel}
          </p>
          <Show when={local.user.account}>
            {(acct) => (
              <p class="shell-member-card-account">~{acct()}</p>
            )}
          </Show>
        </div>
      </div>
      <Show when={local.role.key !== 'member'}>
        <div class="shell-member-card-badges">
          <RoleBadge role={local.role} />
        </div>
      </Show>
      <div class="shell-member-card-actions">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDm}
          aria-label={`Send DM to ${local.user.nick}`}
        >
          Message
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleMention}
          data-testid="member-card-mention"
          aria-label={`Mention ${local.user.nick} in the composer`}
        >
          Mention
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleCopyNick()}
          data-testid="member-card-copy-nick"
          aria-label={`Copy nick ${local.user.nick}`}
        >
          Copy nick
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleWhois}
          aria-label={`View profile of ${local.user.nick}`}
        >
          Profile
        </Button>
        <Show when={!isSelf()}>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleIgnore}
            data-testid="member-card-ignore"
            aria-label={
              isIgnored()
                ? `Stop ignoring ${local.user.nick} on this device`
                : `Ignore ${local.user.nick} on this device`
            }
          >
            {isIgnored() ? 'Unignore' : 'Ignore'}
          </Button>
        </Show>
      </div>

      {/* Advanced / Network Ops only — never against yourself, never in Standard. */}
      <Show when={showRoomModeration()}>
        <div
          class="shell-member-card-mod"
          role="group"
          aria-label={`Moderate ${local.user.nick}`}
        >
          <Show when={showIrcRoleControls()}>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOp}
              aria-label={hasMode('o') ? `Remove op from ${local.user.nick}` : `Give op to ${local.user.nick}`}
            >
              {hasMode('o') ? 'Deop' : 'Op'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleVoice}
              aria-label={hasMode('v') ? `Remove voice from ${local.user.nick}` : `Give voice to ${local.user.nick}`}
            >
              {hasMode('v') ? 'Devoice' : 'Voice'}
            </Button>
          </Show>
          <Button
            variant="danger"
            size="sm"
            onClick={handleKick}
            aria-label={`Kick ${local.user.nick} from ${local.channel}`}
          >
            Kick
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleBan}
            aria-label={`Ban ${local.user.nick} from ${local.channel}`}
          >
            Ban
          </Button>
        </div>
      </Show>
    </div>
  );
}

type MemberRowProps = {
  user: ChannelUser;
  role: ResolvedRole;
  channel: string;
  hidden?: boolean;
  onOpenDm?: (nick: string) => void;
  onOpenWhois?: (nick: string, returnFocus: HTMLElement) => void;
  onRequestModeration?: (draft: ModerationActionDraft, returnFocus: HTMLElement | null) => void;
  getRoster: () => HTMLElement | undefined;
};

function MemberRow(props: MemberRowProps): JSX.Element {
  let itemRef: HTMLLIElement | undefined;
  const ourNick = useStore((s) => s.ourNick);

  // A PART removes this control; a MODE update can move it between role groups
  // and replace the DOM row. If keyboard focus was inside the outgoing row,
  // hand it to the replacement for the same nick or to the stable roster when
  // the member is gone. Otherwise browsers reset focus to <body>.
  onCleanup(() => {
    const active = document.activeElement;
    if (!itemRef || !(active instanceof Node) || !itemRef.contains(active)) return;
    const focusKey = props.user.nick.toLowerCase();
    const roster = props.getRoster();

    queueMicrotask(() => {
      if (!roster?.isConnected || roster.matches('[inert], [aria-hidden="true"]')) return;
      const replacement = Array.from(
        roster.querySelectorAll<HTMLElement>('[data-member-focus-key]'),
      ).find((element) => element.dataset.memberFocusKey === focusKey)
        ?.querySelector<HTMLButtonElement>('.onyx-popover__trigger');
      (replacement ?? roster).focus({ preventScroll: true });
    });
  });

  function openDmFromRow(): void {
    if (props.user.nick.toLowerCase() === ourNick().toLowerCase()) return;
    if (props.onOpenDm) {
      props.onOpenDm(props.user.nick);
      return;
    }
    getState().navigate({ kind: 'dm', nick: props.user.nick });
  }

  return (
    <li
      ref={itemRef}
      class="shell-members-group-item"
      data-member-focus-key={props.user.nick.toLowerCase()}
    >
      <Popover
        panelLabel={`Member details for ${props.user.nick}`}
        disabled={props.hidden}
        trigger={
          <div
            class={`shell-member-row${props.user.away ? ' shell-member-row--away' : ''}`}
            onDblClick={(e) => {
              // Double-click is a classic IRC comfort: open DM without the card.
              e.preventDefault();
              e.stopPropagation();
              openDmFromRow();
            }}
            title="Double-click to message"
          >
            <span class="shell-member-avatar">
              <Avatar
                name={props.user.nick}
                size="sm"
                owner={props.role.key === 'owner' || props.role.key === 'founder'}
                aria-hidden="true"
              />
              <span
                class={`shell-member-presence${props.user.away ? ' shell-member-presence--away' : ''}`}
                aria-hidden="true"
              />
            </span>
            <span
              class={`shell-member-nick${props.user.away ? ' shell-member-nick--away' : ''}`}
              aria-hidden="true"
            >
              {props.user.nick}
            </span>
            <span class="sr-only">
              Open member details for {props.user.nick}, {props.role.label}{props.user.away ? ', away' : ''}
            </span>
            <Show when={props.role.key !== 'member'}>
              <RoleBadge role={props.role} decorative />
            </Show>
          </div>
        }
      >
        <MemberCard
          user={props.user}
          role={props.role}
          channel={props.channel}
          onOpenDm={props.onOpenDm}
          onOpenWhois={props.onOpenWhois}
          onRequestModeration={props.onRequestModeration}
        />
      </Popover>
    </li>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export type MemberListProps = {
  hidden?: boolean;
  modal?: boolean;
  onClose?: () => void;
  onOpenDm?: (nick: string) => void;
  onOpenWhois?: (nick: string, returnFocus: HTMLElement) => void;
};

export function MemberList(props: MemberListProps): JSX.Element {
  const [local] = splitProps(props, ['hidden', 'modal', 'onClose', 'onOpenDm', 'onOpenWhois']);
  let memberListRef: HTMLElement | undefined;
  let memberScrollRef: HTMLDivElement | undefined;
  const instanceId = createUniqueId();
  const filterId = `member-filter-input-${instanceId}`;
  const [memberFilter, setMemberFilter] = createSignal('');
  const [pendingModeration, setPendingModeration] = createSignal<{
    draft: ModerationActionDraft;
    returnFocus: HTMLElement | null;
  } | null>(null);
  const ourNick = useStore((s) => s.ourNick);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const serverConnected = useStore((s) => !!s.server?.connected);
  const isOper = useStore((s) => s.isOper);
  const canModeratePending = createMemo(() => {
    const channel = pendingModeration()?.draft.channel;
    if (!channel) return false;
    // Subscribe to every input used by selectIsChannelOp so authority loss
    // invalidates an open review even though the pending channel is local UI
    // state rather than a store field.
    void isOper();
    void channels();
    void ourNick();
    return selectIsChannelOp(channel)(getState());
  });

  const activeView = useStore((s) => s.activeView);
  const channels = useStore((s) => s.channels);
  const rosterSyncing = useStore((s) => s.rosterSyncing);
  const modeToPrefix = useStore((s) => s.client?.modeToPrefix ?? s.isupportModeToPrefix);

  const activeChannel = createMemo(() => {
    const view = activeView();
    if (view.kind !== 'channel') return null;
    return channels().get(view.channel.toLowerCase()) ?? null;
  });

  const isRefreshingRoster = createMemo(() => {
    const view = activeView();
    return view.kind === 'channel'
      && rosterSyncing().has(view.channel.toLowerCase());
  });

  // We're in the channel but the first roster hasn't landed yet (NAMES in
  // flight): a channel you're a member of always lists at least yourself, so an
  // empty user map while connected means "loading", not "genuinely empty".
  // A refresh with existing rows keeps those rows visible and labels them as
  // syncing; replacing useful content with a zero-count skeleton made the
  // nicklist look broken on every remembered-session resume.
  const isLoadingRoster = createMemo(() => {
    const ch = activeChannel();
    return !!ch && connectionStatus() === 'connected'
      && ch.users.size === 0;
  });

  const rosterStatusLabel = createMemo(() => {
    const ch = activeChannel();
    return ch && ch.users.size > 0 ? 'Refreshing members' : 'Loading members';
  });

  // Identity-stable grouping: unchanged members keep their entry/group object
  // references across roster events, so a single join/part/mode change patches
  // one row instead of rebuilding the whole roster. The reconciler is created
  // once per component instance and retains its cache across recomputes.
  const reconciler = createGroupReconciler();
  const groups = createMemo(() => {
    const ch = activeChannel();
    if (!ch) return [];
    return reconciler.reconcile(ch.users, modeToPrefix());
  });

  /** Filter roster groups by nick substring without mutating reconciler cache. */
  const visibleGroups = createMemo(() => {
    const q = memberFilter().trim().toLowerCase();
    if (!q) return groups();
    return groups()
      .map((group) => ({
        ...group,
        members: group.members.filter(({ user }) =>
          user.nick.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.members.length > 0);
  });

  const totalCount = createMemo(() => {
    return groups().reduce((sum, g) => sum + g.members.length, 0);
  });

  const visibleCount = createMemo(() => {
    return visibleGroups().reduce((sum, g) => sum + g.members.length, 0);
  });

  const [scrollTop, setScrollTop] = createSignal(0);
  const flatRows = createMemo(() => flattenMemberRows(visibleGroups()));
  const memberWindow = createMemo(() => computeMemberWindow(flatRows(), scrollTop()));
  const windowedSections = createMemo(() => {
    const win = memberWindow();
    return sectionMemberWindow(flatRows(), win.start, win.end);
  });
  const padBefore = createMemo(() => memberPrefixHeight(flatRows(), memberWindow().start));
  const padAfter = createMemo(() => {
    const rows = flatRows();
    return memberPrefixHeight(rows, rows.length) - memberPrefixHeight(rows, memberWindow().end);
  });

  createEffect(() => {
    void activeChannel()?.name;
    void memberFilter();
    setScrollTop(0);
    if (memberScrollRef) memberScrollRef.scrollTop = 0;
  });

  const memberListLabel = createMemo(() => {
    const channel = activeChannel();
    return channel ? `Member list for ${channel.name}` : 'Member list';
  });

  const rosterLabel = createMemo(() => {
    const channel = activeChannel();
    return channel ? `People in ${channel.name}` : 'People';
  });

  const channelLedger = createMemo(() => {
    const ch = activeChannel();
    if (!ch) return null;
    const name = ch.name.trim();
    if (!/^[#&]/.test(name)) return null;
    return { channel: name, href: statsRoomHref(name) };
  });

  // Solid's DOM property table predates `HTMLElement.inert` in some supported
  // runtimes, so assigning a boolean JSX property can become an inert expando
  // instead of the native content attribute. Toggle the attribute explicitly:
  // browsers activate native inertness from it, while aria-hidden + disabled
  // member triggers below remain the keyboard/AT fallback.
  createEffect(() => {
    memberListRef?.toggleAttribute('inert', !!local.hidden);
  });

  return (
    <aside
      ref={memberListRef}
      class={`shell-members${local.hidden ? ' shell-members--hidden' : ''}`}
      /* Non-modal roster is a complementary landmark; modal drawer is a dialog.
         Keep role explicit so dense/high-zoom reflow never loses the landmark
         name when the native <aside> mapping is overridden by CSS containment. */
      role={local.modal ? 'dialog' : 'complementary'}
      aria-label={memberListLabel()}
      aria-hidden={local.hidden ? 'true' : 'false'}
      aria-modal={local.modal && !local.hidden ? 'true' : undefined}
      tabindex={!local.hidden ? -1 : undefined}
    >
      <div class="shell-members-head">
        <span class="shell-members-title">People</span>
        {/*
          Not a live region: on a busy channel the count churns on every
          join/leave (and on history replay / ?at= time-travel / roster
          reconciliation), and announcing a bare integer each time is pure
          screen-reader spam (SC 4.1.3). The count stays visible and carries an
          accessible name so it reads meaningfully on demand, but membership
          changes are announced elsewhere — never by re-reading this number.
        */}
        <span class="shell-members-head-actions">
          <Show when={channelLedger()}>
            {(ledger) => (
              <a
                class="shell-members-ledger shell-ribbon-stats"
                href={ledger().href}
                aria-label={`Room ledger for ${ledger().channel}`}
                data-testid="members-channel-ledger"
              >
                Ledger
              </a>
            )}
          </Show>
          <span class="shell-members-head-meta">
            <Show when={isRefreshingRoster() && groups().length > 0}>
              <span class="shell-members-refresh" role="status" aria-label="Refreshing members">sync</span>
            </Show>
            <span
              class="shell-members-count"
              aria-label={
                memberFilter().trim()
                  ? `${visibleCount()} of ${totalCount()} members shown`
                  : `${totalCount()} member${totalCount() === 1 ? '' : 's'}`
              }
            >
              {memberFilter().trim() ? `${visibleCount()}/${totalCount()}` : totalCount()}
            </span>
          </span>
          <Show when={local.modal && !local.hidden && local.onClose}>
            <IconButton
              class="shell-members-close"
              size="sm"
              label="Close member list"
              onClick={() => local.onClose?.()}
            >
              ×
            </IconButton>
          </Show>
        </span>
      </div>

      <Show when={!isLoadingRoster() && groups().length > 0}>
        <div class="shell-members-filter" role="search">
          <label class="sr-only" for={filterId}>Filter members</label>
          <input
            id={filterId}
            class="shell-members-filter-input"
            type="search"
            data-testid="member-filter"
            placeholder="Filter members"
            autocomplete="off"
            spellcheck={false}
            value={memberFilter()}
            onInput={(e) => setMemberFilter(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && memberFilter()) {
                e.preventDefault();
                e.stopPropagation();
                setMemberFilter('');
              }
            }}
          />
        </div>
      </Show>

      <div
        class="shell-members-scroll"
        role="region"
        aria-label={rosterLabel()}
        ref={memberScrollRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <Show
          when={!isLoadingRoster() && groups().length > 0}
          fallback={
            <Show
              when={isLoadingRoster()}
              fallback={
                <p style={{ padding: '10px 12px', color: 'var(--paper-mute)', 'font-family': 'var(--font-mono)', 'font-size': '0.72rem' }}>
                  No one here yet
                </p>
              }
            >
              <div class="shell-members-skel" role="status" aria-label={rosterStatusLabel()}>
                <span class="sr-only">{rosterStatusLabel()}…</span>
                <For each={[0, 1, 2, 3, 4]}>
                  {(i) => (
                    <div class="shell-members-skel-row" style={{ '--skel-i': i }} aria-hidden="true">
                      <span class="shell-members-skel-avatar" />
                      <span class="shell-members-skel-name" style={{ width: `${68 - i * 7}%` }} />
                    </div>
                  )}
                </For>
              </div>
            </Show>
          }
        >
          <Show
            when={visibleGroups().length > 0}
            fallback={
              <p class="shell-members-filter-empty" data-testid="member-filter-empty" role="status">
                No members match “{memberFilter().trim()}”.
              </p>
            }
          >
            <div class="shell-members-window-pad" style={{ height: `${padBefore()}px` }} aria-hidden="true" />
            <For each={windowedSections()}>
              {(group) => {
                const groupLabelId = `members-group-${instanceId}-${group.key}`;
                return (
                  <section aria-labelledby={groupLabelId}>
                    <p
                      class="shell-members-group-label"
                      id={groupLabelId}
                      role="heading"
                      aria-level={3}
                    >
                      {group.label} — {group.count}
                    </p>
                    <ul class="shell-members-group-list" role="list" aria-labelledby={groupLabelId}>
                      <For each={group.members}>
                        {(entry) => (
                          <MemberRow
                            user={entry.user}
                            role={entry.role}
                            channel={activeChannel()?.name ?? ''}
                            hidden={local.hidden}
                            onOpenDm={local.onOpenDm}
                            onOpenWhois={local.onOpenWhois}
                            onRequestModeration={(draft, returnFocus) => {
                              setPendingModeration({ draft, returnFocus });
                            }}
                            getRoster={() => memberListRef}
                          />
                        )}
                      </For>
                    </ul>
                  </section>
                );
              }}
            </For>
            <div class="shell-members-window-pad" style={{ height: `${padAfter()}px` }} aria-hidden="true" />
          </Show>
        </Show>
      </div>
      <ModerationActionReview
        open={pendingModeration() !== null}
        draft={pendingModeration()?.draft ?? null}
        actorNick={ourNick()}
        connected={connectionStatus() === 'connected' && serverConnected()}
        canModerate={canModeratePending()}
        returnFocus={pendingModeration()?.returnFocus ?? memberListRef ?? null}
        onConfirm={(action) => {
          applyMemberModeration(action);
          setPendingModeration(null);
        }}
        onCancel={() => setPendingModeration(null)}
      />
    </aside>
  );
}

function applyMemberModeration(action: NormalizedModerationAction): void {
  const state = getState();
  switch (action.kind) {
    case 'kick':
      state.kickMember(action.channel, action.target, action.reason);
      break;
    case 'ban':
      state.banMask(action.channel, action.mask);
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
}
