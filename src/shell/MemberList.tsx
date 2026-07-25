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
  For,
  onCleanup,
  Show,
  splitProps,
  type JSX,
} from 'solid-js';
import { useStore, getState, selectIsChannelOp } from '@/lib/store';
import type { ChannelUser } from '@/lib/irc/types';
import { createGroupReconciler, type ResolvedRole } from '@/lib/memberGroups';
import { formatMentionInsert } from '@/lib/composer/composerInject';
import { Avatar, Popover, Button, IconButton } from '@/primitives/index';

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
};

function MemberCard(props: MemberCardProps): JSX.Element {
  const [local] = splitProps(props, ['user', 'role', 'channel', 'onOpenDm', 'onOpenWhois']);

  // Reactive op-gate: moderation controls only render for op (or higher).
  const canModerate = useStore((s) => selectIsChannelOp(local.channel)(s));
  const ourNick = useStore((s) => s.ourNick);

  // Whether the target currently holds the named status mode.
  const hasMode = (m: string): boolean => local.user.modes.has(m);
  const isSelf = (): boolean => local.user.nick.toLowerCase() === ourNick().toLowerCase();
  const cardId = createMemo(() => {
    const channel = local.channel.replace(/[^a-z0-9_-]+/giu, '-').replace(/^-|-$/gu, '') || 'channel';
    const nick = local.user.nick.replace(/[^a-z0-9_-]+/giu, '-').replace(/^-|-$/gu, '') || 'member';
    return `member-card-${channel}-${nick}`;
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
      description: 'Inserted into the composer for this channel.',
    });
    queueMicrotask(() => {
      document.querySelector<HTMLElement>('[data-composer-input]')?.focus();
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

  function handleOp(event: MouseEvent): void {
    closeCardForHandoff(event, true);
    getState().opMember(local.channel, local.user.nick, !hasMode('o'));
  }

  function handleVoice(event: MouseEvent): void {
    closeCardForHandoff(event, true);
    getState().voiceMember(local.channel, local.user.nick, !hasMode('v'));
  }

  function handleKick(event: MouseEvent): void {
    closeCardForHandoff(event, true);
    getState().kickMember(local.channel, local.user.nick);
  }

  function handleBan(event: MouseEvent): void {
    closeCardForHandoff(event, true);
    // Ban by nick mask — a conservative, readable default.
    getState().banMask(local.channel, `${local.user.nick}!*@*`);
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

      {/* Moderation — op (or higher) only, and never against yourself. */}
      <Show when={canModerate() && !isSelf()}>
        <div
          class="shell-member-card-mod"
          role="group"
          aria-label={`Moderate ${local.user.nick}`}
        >
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
  getRoster: () => HTMLElement | undefined;
};

function MemberRow(props: MemberRowProps): JSX.Element {
  let itemRef: HTMLLIElement | undefined;

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

  const activeView = useStore((s) => s.activeView);
  const channels = useStore((s) => s.channels);
  const rosterSyncing = useStore((s) => s.rosterSyncing);
  const connectionStatus = useStore((s) => s.connectionStatus);
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

  const totalCount = createMemo(() => {
    return groups().reduce((sum, g) => sum + g.members.length, 0);
  });

  const memberListLabel = createMemo(() => {
    const channel = activeChannel();
    return channel ? `Member list for ${channel.name}` : 'Member list';
  });

  const rosterLabel = createMemo(() => {
    const channel = activeChannel();
    return channel ? `Channel members in ${channel.name}` : 'Channel members';
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
        <span class="shell-members-title">members</span>
        {/*
          Not a live region: on a busy channel the count churns on every
          join/leave (and on history replay / ?at= time-travel / roster
          reconciliation), and announcing a bare integer each time is pure
          screen-reader spam (SC 4.1.3). The count stays visible and carries an
          accessible name so it reads meaningfully on demand, but membership
          changes are announced elsewhere — never by re-reading this number.
        */}
        <span class="shell-members-head-actions">
          <span class="shell-members-head-meta">
            <Show when={isRefreshingRoster() && groups().length > 0}>
              <span class="shell-members-refresh" role="status" aria-label="Refreshing members">sync</span>
            </Show>
            <span
              class="shell-members-count"
              aria-label={`${totalCount()} member${totalCount() === 1 ? '' : 's'}`}
            >
              {totalCount()}
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

      <div class="shell-members-scroll" role="region" aria-label={rosterLabel()}>
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
          <For each={groups()}>
            {(group) => {
              const groupLabelId = `members-group-${group.key}`;
              return (
                <section aria-labelledby={groupLabelId}>
                  <p
                    class="shell-members-group-label"
                    id={groupLabelId}
                    role="heading"
                    aria-level={3}
                  >
                    {group.label} — {group.members.length}
                  </p>
                  <ul class="shell-members-group-list" role="list" aria-labelledby={groupLabelId}>
                    <For each={group.members}>
                      {({ user, role }) => (
                        <MemberRow
                          user={user}
                          role={role}
                          channel={activeChannel()?.name ?? ''}
                          hidden={local.hidden}
                          onOpenDm={local.onOpenDm}
                          onOpenWhois={local.onOpenWhois}
                          getRoster={() => memberListRef}
                        />
                      )}
                    </For>
                  </ul>
                </section>
              );
            }}
          </For>
        </Show>
      </div>
    </aside>
  );
}
