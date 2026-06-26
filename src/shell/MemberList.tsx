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
import { useStore, getState } from '@/lib/store';
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
  if (local.role.key === 'member') return <></>;
  return (
    <span
      class={`shell-role-badge shell-role-badge--${local.role.key}`}
      aria-label={local.role.label}
      title={local.role.label}
    >
      {local.role.symbol}
    </span>
  );
}

// ── Member popover card ──────────────────────────────────────────────────────

type MemberCardProps = {
  user: ChannelUser;
  role: ResolvedRole;
};

function MemberCard(props: MemberCardProps): JSX.Element {
  const [local] = splitProps(props, ['user', 'role']);

  function handleDm(): void {
    getState().navigate({ kind: 'dm', nick: local.user.nick });
  }

  function handleWhois(): void {
    getState().openWhois(local.user.nick);
  }

  return (
    <div class="shell-member-card" role="document">
      <div class="shell-member-card-head">
        <Avatar name={local.user.nick} size="md" owner={local.role.key === 'owner' || local.role.key === 'founder'} />
        <div>
          <p class="shell-member-card-nick">{local.user.nick}</p>
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

  const activeChannel = createMemo(() => {
    const view = activeView();
    if (view.kind !== 'channel') return null;
    return channels().get(view.channel) ?? null;
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

  return (
    <aside
      class={`shell-members${local.hidden ? ' shell-members--hidden' : ''}`}
      aria-label="Member list"
      aria-hidden={local.hidden ? 'true' : 'false'}
    >
      <div class="shell-members-head">
        <span>members</span>
        <span class="shell-members-count">{totalCount()}</span>
      </div>

      <div class="shell-members-scroll" role="region" aria-label="Channel members">
        <Show
          when={groups().length > 0}
          fallback={
            <p style={{ padding: '10px 12px', color: 'var(--washi-mute)', 'font-family': 'var(--font-mono)', 'font-size': '0.72rem' }}>
              No one here yet
            </p>
          }
        >
          <For each={groups()}>
            {(group) => (
              <>
                <p class="shell-members-group-label" role="heading" aria-level={3}>
                  {group.label} — {group.members.length}
                </p>
                <For each={group.members}>
                  {({ user, role }) => (
                    <Popover
                      trigger={
                        <div
                          class={`shell-member-row${user.away ? ' shell-member-row--away' : ''}`}
                          role="listitem"
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
                          <Show when={role.key !== 'member'}>
                            <RoleBadge role={role} />
                          </Show>
                        </div>
                      }
                    >
                      <MemberCard user={user} role={role} />
                    </Popover>
                  )}
                </For>
              </>
            )}
          </For>
        </Show>
      </div>
    </aside>
  );
}
