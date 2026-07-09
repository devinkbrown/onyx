/**
 * MemberList.tsx — channel member list with live role badges.
 *
 * Role precedence (Orochi PREFIX=(YQqov)*!.@+):
 *   Y → netop   (*)  — lapis badge
 *   Q → founder (!)  — gold bright badge
 *   q → owner   (.)  — gold badge
 *   o → op      (@)  — vermilion badge
 *   v → voice   (+)  — green badge
 *   ''→ member  (no badge)
 *
 * Sorted: netop > founder > owner > op > voice > member; then alpha within group.
 *
 * Click a user → Popover mini-card with nick, account, badges, and actions.
 *
 * SOLID IDIOMS: never destructure props; splitProps; createMemo; For/Show.
 */

import {
  createMemo,
  For,
  Show,
  splitProps,
  type JSX,
} from 'solid-js';
import { useStore, getState, selectIsChannelOp } from '@/lib/store';
import type { ChannelUser } from '@/lib/irc/types';
import { Avatar, Popover, Button } from '@/primitives/index';

// ── Role resolution ──────────────────────────────────────────────────────────

type RoleKey = 'netop' | 'founder' | 'owner' | 'op' | 'voice' | 'member';

interface ResolvedRole {
  key: RoleKey;
  label: string;
  symbol: string;
  sort: number;
}

const ROLE_ORDER: Record<RoleKey, number> = {
  netop: 0,
  founder: 1,
  owner: 2,
  op: 3,
  voice: 4,
  member: 5,
};

function resolveRole(user: ChannelUser): ResolvedRole {
  const modes = user.modes;
  if (modes.has('Y')) return { key: 'netop',   label: 'Network Oper', symbol: '*', sort: ROLE_ORDER.netop };
  if (modes.has('Q')) return { key: 'founder',  label: 'Founder',      symbol: '!', sort: ROLE_ORDER.founder };
  if (modes.has('q')) return { key: 'owner',    label: 'Owner',        symbol: '.', sort: ROLE_ORDER.owner };
  if (modes.has('o')) return { key: 'op',       label: 'Op',           symbol: '@', sort: ROLE_ORDER.op };
  if (modes.has('v')) return { key: 'voice',    label: 'Voice',        symbol: '+', sort: ROLE_ORDER.voice };
  return            { key: 'member',   label: 'Member',       symbol: '',  sort: ROLE_ORDER.member };
}

// ── Group labels ─────────────────────────────────────────────────────────────

const GROUP_LABELS: Partial<Record<RoleKey, string>> = {
  netop: 'Network Operators',
  founder: 'Founders',
  owner: 'Owners',
  op: 'Ops',
  voice: 'Voice',
  member: 'Members',
};

interface MemberEntry {
  user: ChannelUser;
  role: ResolvedRole;
}

interface GroupEntry {
  key: RoleKey;
  label: string;
  members: MemberEntry[];
}

// ── Role Badge ───────────────────────────────────────────────────────────────

type RoleBadgeProps = {
  role: ResolvedRole;
};

function RoleBadge(props: RoleBadgeProps): JSX.Element {
  const [local] = splitProps(props, ['role']);
  return (
    <Show when={local.role.key !== 'member'}>
    <span
      class={`shell-role-badge shell-role-badge--${local.role.key}`}
      aria-label={local.role.label}
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
};

function MemberCard(props: MemberCardProps): JSX.Element {
  const [local] = splitProps(props, ['user', 'role', 'channel']);

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

  function handleDm(): void {
    getState().navigate({ kind: 'dm', nick: local.user.nick });
  }

  function handleWhois(): void {
    getState().whois(local.user.nick);
  }

  function handleOp(): void {
    getState().opMember(local.channel, local.user.nick, !hasMode('o'));
  }

  function handleVoice(): void {
    getState().voiceMember(local.channel, local.user.nick, !hasMode('v'));
  }

  function handleKick(): void {
    getState().kickMember(local.channel, local.user.nick);
  }

  function handleBan(): void {
    // Ban by nick mask — a conservative, readable default.
    getState().banMask(local.channel, `${local.user.nick}!*@*`);
  }

  return (
    <div
      class="shell-member-card"
      role="region"
      aria-labelledby={`${cardId()}-nick`}
      aria-describedby={`${cardId()}-role`}
    >
      <div class="shell-member-card-head">
        <Avatar name={local.user.nick} size="md" owner={local.role.key === 'owner' || local.role.key === 'founder'} />
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
          onClick={handleWhois}
          aria-label={`View profile of ${local.user.nick}`}
        >
          Profile
        </Button>
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

// ── Main component ───────────────────────────────────────────────────────────

export type MemberListProps = {
  hidden?: boolean;
};

export function MemberList(props: MemberListProps): JSX.Element {
  const [local] = splitProps(props, ['hidden']);

  const activeView = useStore((s) => s.activeView);
  const channels = useStore((s) => s.channels);
  const connectionStatus = useStore((s) => s.connectionStatus);

  const activeChannel = createMemo(() => {
    const view = activeView();
    if (view.kind !== 'channel') return null;
    return channels().get(view.channel) ?? null;
  });

  // We're in the channel but the roster hasn't landed yet (NAMES in flight): a
  // channel you're a member of always lists at least yourself, so an empty user
  // map while connected means "loading", not "genuinely empty".
  const isLoadingRoster = createMemo(() => {
    const ch = activeChannel();
    return !!ch && ch.users.size === 0 && connectionStatus() === 'connected';
  });

  // Build sorted, grouped member list
  const groups = createMemo((): GroupEntry[] => {
    const ch = activeChannel();
    if (!ch) return [];

    const entries: MemberEntry[] = [];
    ch.users.forEach((user) => {
      entries.push({ user, role: resolveRole(user) });
    });

    // Sort: by role sort order, then alphabetically
    entries.sort((a, b) => {
      const roleDiff = a.role.sort - b.role.sort;
      if (roleDiff !== 0) return roleDiff;
      return a.user.nick.localeCompare(b.user.nick);
    });

    // Group by role key
    const groupMap = new Map<RoleKey, MemberEntry[]>();
    for (const entry of entries) {
      const existing = groupMap.get(entry.role.key);
      if (existing) {
        existing.push(entry);
      } else {
        groupMap.set(entry.role.key, [entry]);
      }
    }

    const result: GroupEntry[] = [];
    const roleOrder: RoleKey[] = ['netop', 'founder', 'owner', 'op', 'voice', 'member'];
    for (const key of roleOrder) {
      const members = groupMap.get(key);
      if (members && members.length > 0) {
        result.push({
          key,
          label: GROUP_LABELS[key] ?? key,
          members,
        });
      }
    }
    return result;
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

  return (
    <aside
      class={`shell-members${local.hidden ? ' shell-members--hidden' : ''}`}
      aria-label={memberListLabel()}
      aria-hidden={local.hidden ? 'true' : 'false'}
    >
      <div class="shell-members-head">
        <span>members</span>
        <span
          class="shell-members-count"
          aria-live="polite"
          aria-atomic="true"
          aria-label={`${totalCount()} member${totalCount() === 1 ? '' : 's'}`}
        >
          {totalCount()}
        </span>
      </div>

      <div class="shell-members-scroll" role="region" aria-label={rosterLabel()}>
        <Show
          when={groups().length > 0}
          fallback={
            <Show
              when={isLoadingRoster()}
              fallback={
                <p style={{ padding: '10px 12px', color: 'var(--washi-mute)', 'font-family': 'var(--font-mono)', 'font-size': '0.72rem' }}>
                  No one here yet
                </p>
              }
            >
              <div class="shell-members-skel" role="status" aria-label="Loading members">
                <span class="sr-only">Loading members…</span>
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
                        <li class="shell-members-group-item">
                          <Popover
                            panelLabel={`Member details for ${user.nick}`}
                            trigger={
                              <div
                                class={`shell-member-row${user.away ? ' shell-member-row--away' : ''}`}
                              >
                                <span class="shell-member-avatar">
                                  <Avatar
                                    name={user.nick}
                                    size="sm"
                                    owner={role.key === 'owner' || role.key === 'founder'}
                                    aria-hidden="true"
                                  />
                                  <span
                                    class={`shell-member-presence${user.away ? ' shell-member-presence--away' : ''}`}
                                    aria-hidden="true"
                                  />
                                </span>
                                <span
                                  class={`shell-member-nick${user.away ? ' shell-member-nick--away' : ''}`}
                                >
                                  {user.nick}
                                </span>
                                <span class="sr-only">
                                  Open member details for {user.nick}, {role.label}{user.away ? ', away' : ''}
                                </span>
                                <Show when={role.key !== 'member'}>
                                  <RoleBadge role={role} />
                                </Show>
                              </div>
                            }
                          >
                            <MemberCard user={user} role={role} channel={activeChannel()?.name ?? ''} />
                          </Popover>
                        </li>
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
