// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PeopleProfileCard — consumer person card (tap a face or name).
 *
 * Default surface: circular avatar, display name, optional about/status,
 * and Message / Mention / Block / Report. Network WHOIS, room ledger, hostmasks,
 * and op/voice live under Advanced. Block reuses device ignore. Report drafts
 * a note to #root — there is no invented review inbox.
 */

import { createMemo, createUniqueId, Show, splitProps, type JSX } from 'solid-js';
import { getState, selectIsChannelOp, useStore } from '@/lib/store';
import type { ChannelUser } from '@/lib/irc/types';
import { resolveRole, type ResolvedRole } from '@/lib/memberGroups';
import { formatMentionInsert } from '@/lib/composer/composerInject';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import { preferences } from '@/lib/prefs/preferences';
import {
  memberModerationKindsForMode,
  type ModerationActionDraft,
} from '@/lib/moderation/actionModel';
import { normalizeIdentityOverrideNick } from '@/lib/identityOverrides';
import { statsRoomHref } from '@/lib/stats/channelDetail';
import { blockedDmComposeCopy, personUnblockToast } from '@/lib/people/personSafety';
import { Avatar, Button } from '@/primitives/index';
import { openPersonBlockConfirm, openPersonReport } from './people/personSafetyState';

export const PEOPLE_PROFILE_ADVANCED_TESTID = 'people-profile-advanced-toggle';

export type PeopleProfileCardProps = {
  nick: string;
  /** Active room for mention insert and room actions. Empty outside a channel. */
  channel: string;
  user?: ChannelUser;
  role?: ResolvedRole;
  onOpenDm?: (nick: string) => void;
  onOpenWhois?: (nick: string, returnFocus: HTMLElement) => void;
  onRequestModeration?: (draft: ModerationActionDraft, returnFocus: HTMLElement | null) => void;
};

function hostmaskFromWhois(info: {
  username?: string;
  host?: string;
  realHost?: string;
} | null | undefined): string | null {
  if (!info) return null;
  if (info.username && info.host) return `${info.username}@${info.host}`;
  return info.realHost ?? info.host ?? null;
}

export function PeopleProfileCard(props: PeopleProfileCardProps): JSX.Element {
  const [local] = splitProps(props, [
    'nick',
    'channel',
    'user',
    'role',
    'onOpenDm',
    'onOpenWhois',
    'onRequestModeration',
  ]);

  const ourNick = useStore((s) => s.ourNick);
  const channels = useStore((s) => s.channels);
  const modeToPrefix = useStore((s) => s.client?.modeToPrefix ?? s.isupportModeToPrefix);
  const canModerate = useStore((s) => selectIsChannelOp(local.channel)(s));
  const profile = useStore((s) => s.userProfiles.get(local.nick.toLowerCase()) ?? null);
  const localDisplayName = useStore((s) => {
    const key = normalizeIdentityOverrideNick(local.nick);
    return key ? s.displayNameOverrides[key] : undefined;
  });
  const whois = useStore((s) => s.whoisData.get(local.nick.toLowerCase()) ?? null);
  const isIgnored = useStore((s) => s.isIgnored(local.nick));

  const rosterUser = createMemo((): ChannelUser => {
    if (local.user) return local.user;
    const channel = local.channel.trim();
    if (!channel) return { nick: local.nick, modes: new Set() };
    return channels().get(channel.toLowerCase())?.users.get(local.nick.toLowerCase())
      ?? { nick: local.nick, modes: new Set() };
  });

  const role = createMemo(() => local.role ?? resolveRole(rosterUser(), modeToPrefix()));
  const isSelf = createMemo(() => local.nick.toLowerCase() === ourNick().toLowerCase());
  const displayName = createMemo(() => {
    const override = localDisplayName()?.trim();
    if (override) return override;
    const published = profile()?.displayName?.trim();
    if (published) return published;
    return local.nick;
  });
  const showNick = createMemo(() => displayName().toLowerCase() !== local.nick.toLowerCase());
  const about = createMemo(() => profile()?.bio?.trim() || '');
  const pronouns = createMemo(() => profile()?.pronouns?.trim() || '');
  const away = createMemo(() => rosterUser().away === true);
  const account = createMemo(() => rosterUser().account?.trim() || whois()?.account?.trim() || '');
  const hostmask = createMemo(() => hostmaskFromWhois(whois()));
  // 313 carries the operator line; `operRole` is the parsed label from it, so
  // fall back to the generic word only when the server sent no detail.
  const networkRole = createMemo(() => {
    const info = whois();
    if (!info?.isOper) return '';
    return info.operRole?.trim() || 'IRC operator';
  });
  const roomLedger = createMemo(() => {
    const channel = local.channel.trim();
    if (!/^[#&]/.test(channel)) return null;
    return { channel, href: statsRoomHref(channel) };
  });

  const cardInstanceId = createUniqueId();
  const cardId = createMemo(() => {
    const channel = local.channel.replace(/[^a-z0-9_-]+/giu, '-').replace(/^-|-$/gu, '') || 'room';
    const nick = local.nick.replace(/[^a-z0-9_-]+/giu, '-').replace(/^-|-$/gu, '') || 'person';
    return `people-card-${cardInstanceId}-${channel}-${nick}`;
  });
  const descriptionId = createMemo(() => {
    if (about()) return `${cardId()}-about`;
    if (away()) return `${cardId()}-status`;
    if (pronouns()) return `${cardId()}-pronouns`;
    return undefined;
  });

  const showRoomModeration = createMemo(() => {
    const kinds = memberModerationKindsForMode(preferences().experienceMode);
    return canModerate() && !isSelf() && kinds.includes('kick');
  });
  const showIrcRoleControls = createMemo(() => {
    const kinds = memberModerationKindsForMode(preferences().experienceMode);
    return canModerate() && !isSelf() && kinds.includes('op');
  });

  function hasMode(mode: string): boolean {
    return rosterUser().modes.has(mode);
  }

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
    const target = focusRoster ? roster ?? memberTrigger : memberTrigger;

    if (memberTrigger.getAttribute('aria-expanded') === 'true') memberTrigger.click();
    target?.focus({ preventScroll: true });
    if (focusRoster && target) queueMicrotask(() => target.focus({ preventScroll: true }));
    return target;
  }

  function handleDm(): void {
    if (isIgnored()) {
      const copy = blockedDmComposeCopy(local.nick);
      getState().addToast({
        variant: 'info',
        title: copy.title,
        description: copy.description,
      });
      return;
    }
    if (local.onOpenDm) {
      local.onOpenDm(local.nick);
      return;
    }
    getState().navigate({ kind: 'dm', nick: local.nick });
  }

  function handleMention(): void {
    const insert = formatMentionInsert(local.nick);
    if (!insert) return;
    const target = local.channel.trim();
    if (target) getState().injectComposerText(target, insert, 'append');
    getState().addToast({
      variant: 'info',
      title: `Mention ${local.nick}`,
      description: target
        ? 'Inserted into the composer for this room.'
        : 'Mention is available in a room.',
    });
    queueMicrotask(() => {
      document.querySelector<HTMLElement>('[data-composer-input]')?.focus();
    });
  }

  async function handleCopyNick(): Promise<void> {
    const nick = local.nick.trim();
    if (!nick) return;
    const ok = await writeClipboardText(nick);
    getState().addToast({
      variant: ok ? 'success' : 'warning',
      title: ok ? 'Name copied' : 'Could not copy name',
      description: ok
        ? `${nick} is on the clipboard.`
        : 'Clipboard access was denied in this browser.',
    });
  }

  function handleWhois(event: MouseEvent): void {
    const memberTrigger = closeCardForHandoff(event);
    if (local.onOpenWhois && memberTrigger) {
      local.onOpenWhois(local.nick, memberTrigger);
      return;
    }
    getState().whois(local.nick);
  }

  function requestModeration(event: MouseEvent, draft: ModerationActionDraft): void {
    const trigger = closeCardForHandoff(event, true);
    local.onRequestModeration?.(draft, trigger);
  }

  function handleOp(event: MouseEvent): void {
    requestModeration(event, {
      kind: hasMode('o') ? 'deop' : 'op',
      channel: local.channel,
      target: local.nick,
    });
  }

  function handleVoice(event: MouseEvent): void {
    requestModeration(event, {
      kind: hasMode('v') ? 'devoice' : 'voice',
      channel: local.channel,
      target: local.nick,
    });
  }

  function handleKick(event: MouseEvent): void {
    requestModeration(event, {
      kind: 'kick',
      channel: local.channel,
      target: local.nick,
    });
  }

  function handleBan(event: MouseEvent): void {
    requestModeration(event, {
      kind: 'ban',
      channel: local.channel,
      target: local.nick,
    });
  }

  function handleBlock(event: MouseEvent): void {
    closeCardForHandoff(event, true);
    const nick = local.nick;
    if (isIgnored()) {
      getState().unignoreUser(nick);
      getState().addToast({
        variant: 'info',
        ...personUnblockToast(nick),
      });
      return;
    }
    openPersonBlockConfirm(nick, !account());
  }

  function handleReport(event: MouseEvent): void {
    closeCardForHandoff(event, true);
    openPersonReport(local.nick, !account());
  }

  return (
    <div
      class="shell-member-card shell-people-card"
      role="region"
      aria-labelledby={`${cardId()}-name`}
      aria-describedby={descriptionId()}
    >
      <div class="shell-people-card-identity">
        <Avatar
          class="shell-people-card-avatar"
          name={displayName()}
          size="md"
          aria-hidden="true"
        />
        <div class="shell-people-card-copy">
          <p class="shell-people-card-name" id={`${cardId()}-name`}>{displayName()}</p>
          <Show when={showNick()}>
            <p class="shell-people-card-nick">{local.nick}</p>
          </Show>
          <Show when={pronouns()}>
            {(value) => (
              <p class="shell-people-card-pronouns" id={`${cardId()}-pronouns`}>{value()}</p>
            )}
          </Show>
          <Show when={away()}>
            <p class="shell-people-card-status" id={`${cardId()}-status`}>Away</p>
          </Show>
          <Show when={about()}>
            {(value) => (
              <p class="shell-people-card-about" id={`${cardId()}-about`}>{value()}</p>
            )}
          </Show>
          <Show when={!isSelf() && !account()}>
            <p class="shell-people-card-guest">Guest</p>
          </Show>
        </div>
      </div>

      <Show when={!isSelf()}>
        <div class="shell-member-card-actions shell-people-card-actions">
          <Button
            variant="primary"
            size="sm"
            onClick={handleDm}
            aria-label={`Send DM to ${local.nick}`}
          >
            Message
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMention}
            data-testid="member-card-mention"
            aria-label={`Mention ${local.nick} in the composer`}
          >
            Mention
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBlock}
            data-testid="member-card-block"
            aria-label={
              isIgnored()
                ? `Unblock ${local.nick} on this device`
                : `Block ${local.nick} on this device`
            }
          >
            {isIgnored() ? 'Unblock' : 'Block'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReport}
            data-testid="member-card-report"
            aria-label={`Report ${local.nick}`}
          >
            Report
          </Button>
        </div>
      </Show>

      <details class="shell-people-card-advanced">
        <summary
          class="shell-people-card-advanced-toggle"
          data-testid={PEOPLE_PROFILE_ADVANCED_TESTID}
        >
          Advanced
        </summary>
        <div class="shell-people-card-advanced-body">
          <Show when={account()}>
            {(value) => <p class="shell-people-card-meta">Account {value()}</p>}
          </Show>
          <Show when={local.channel}>
            <p class="shell-people-card-meta">
              {role().label} in {local.channel}
            </p>
          </Show>
          <Show when={networkRole()}>
            {(value) => (
              <p class="shell-people-card-meta" data-testid="people-profile-oper-role">
                {value()} on this network
              </p>
            )}
          </Show>
          <Show when={hostmask()}>
            {(value) => (
              <p class="shell-people-card-hostmask" data-testid="people-profile-hostmask">
                {value()}
              </p>
            )}
          </Show>
          <div class="shell-people-card-advanced-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleCopyNick()}
              data-testid="member-card-copy-nick"
              aria-label={`Copy name ${local.nick}`}
            >
              Copy name
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleWhois}
              aria-label={`View profile of ${local.nick}`}
            >
              Network profile
            </Button>
            <Show when={roomLedger()}>
              {(ledger) => (
                <a
                  class="shell-people-card-ledger"
                  href={ledger().href}
                  aria-label={`Room ledger for ${ledger().channel}`}
                  data-testid="people-profile-ledger"
                >
                  Room ledger
                </a>
              )}
            </Show>
          </div>

          <Show when={showRoomModeration()}>
            <div
              class="shell-member-card-mod"
              role="group"
              aria-label={`Moderate ${local.nick}`}
            >
              <Show when={showIrcRoleControls()}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOp}
                  aria-label={hasMode('o') ? `Remove op from ${local.nick}` : `Give op to ${local.nick}`}
                >
                  {hasMode('o') ? 'Deop' : 'Op'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleVoice}
                  aria-label={hasMode('v') ? `Remove voice from ${local.nick}` : `Give voice to ${local.nick}`}
                >
                  {hasMode('v') ? 'Devoice' : 'Voice'}
                </Button>
              </Show>
              <Button
                variant="danger"
                size="sm"
                onClick={handleKick}
                aria-label={`Kick ${local.nick} from ${local.channel}`}
              >
                Kick
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleBan}
                aria-label={`Ban ${local.nick} from ${local.channel}`}
              >
                Ban
              </Button>
            </div>
          </Show>
        </div>
      </details>
    </div>
  );
}
