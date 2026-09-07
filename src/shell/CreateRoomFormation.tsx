// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CreateRoomFormation — name + optional skin + share 3 people, then land inside.
 *
 * Founders cannot finish without copying or sharing an invite. There is no
 * "you're all set" screen: Enter the room JOINs and focuses the composer.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import {
  buildRoomSharePayload,
  canNativeShare,
  inviteLandingOrigin,
} from '@/lib/invite/shareRoomInvite';
import {
  FORMATION_COPY,
  FORMATION_INVITE_TARGET,
  ROOM_SKINS,
  addFormationInvitee,
  canFinishCreateRoom,
  formatHangLabel,
  nextSaturdayHang,
  normalizeCreateRoomName,
  removeFormationInvitee,
  suggestedFirstLine,
  type RoomSkin,
} from '@/lib/rooms/createRoomFormation';
import { useStore, getState } from '@/lib/store';
import { Button, FormField } from '@/primitives/index';
import { updateCoordinator } from '@/pwa/updateCoordinator';

export default function CreateRoomFormation(): JSX.Element {
  const friends = useStore((s) => s.friends);
  const networkName = useStore((s) => s.networkName);
  const ourNick = useStore((s) => s.ourNick);
  const connectionStatus = useStore((s) => s.connectionStatus);
  let releaseUpdateHold: (() => void) | null = null;
  createEffect(() => {
    const protectedWork = Boolean(nameInput().trim() || firstLine().trim() || inviteeDraft().trim() || invitees().length || sharedInvite());
    if (protectedWork && !releaseUpdateHold) releaseUpdateHold = updateCoordinator.hold('create-room-form');
    if (!protectedWork && releaseUpdateHold) { releaseUpdateHold(); releaseUpdateHold = null; }
  });
  onCleanup(() => { releaseUpdateHold?.(); releaseUpdateHold = null; });

  const [nameInput, setNameInput] = createSignal('');
  const [skin, setSkin] = createSignal<RoomSkin | null>(null);
  const [includeHang, setIncludeHang] = createSignal(false);
  const [includeFirstLine, setIncludeFirstLine] = createSignal(true);
  const [firstLine, setFirstLine] = createSignal(suggestedFirstLine(null));
  const [invitees, setInvitees] = createSignal<string[]>([]);
  const [inviteeDraft, setInviteeDraft] = createSignal('');
  const [inviteeError, setInviteeError] = createSignal('');
  const [nameError, setNameError] = createSignal('');
  const [sharedInvite, setSharedInvite] = createSignal(false);
  const [copyStatus, setCopyStatus] = createSignal('');
  const [createError, setCreateError] = createSignal('');
  const [shareBusy, setShareBusy] = createSignal(false);
  const [copyBusy, setCopyBusy] = createSignal(false);
  type ShareOperation = { id: number; kind: 'share' | 'copy' };
  let nextOperationId = 0;
  let currentOperation: ShareOperation | null = null;

  const hangLabel = createMemo(() => formatHangLabel(nextSaturdayHang()));
  const channel = createMemo(() => normalizeCreateRoomName(nameInput()));
  const friendChoices = createMemo(() => {
    const taken = new Set(invitees().map((nick) => nick.toLowerCase()));
    const self = ourNick().trim().toLowerCase();
    if (self) taken.add(self);
    return [...friends().values()]
      .filter((friend) => !taken.has(friend.nick.toLowerCase()))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.nick.localeCompare(b.nick));
  });

  const payload = createMemo(() =>
    buildRoomSharePayload({
      channel: channel() ?? '',
      network: networkName(),
      origin: inviteLandingOrigin(),
    }),
  );
  const shareData = createMemo(() => payload().shareData);
  const canShare = createMemo(() => canNativeShare(shareData()));
  const canEnter = createMemo(() =>
    canFinishCreateRoom({ sharedInvite: sharedInvite() }) && channel() !== null,
  );
  const connected = createMemo(() => connectionStatus() === 'connected');

  // A receipt is valid only for the exact invite payload that was shared.
  // Renaming the room (or changing its derived URL) requires a fresh receipt.
  let lastInvitePayload = '';
  createEffect(() => {
    const current = payload().shareUrl;
    if (lastInvitePayload && current !== lastInvitePayload) {
      setSharedInvite(false);
      setCopyStatus('Room name changed. Share or copy the new invite before entering.');
      currentOperation = null;
      setShareBusy(false);
      setCopyBusy(false);
    }
    lastInvitePayload = current;
  });

  createEffect(() => {
    const next = suggestedFirstLine(skin());
    setFirstLine((current) => {
      const previous = suggestedFirstLine(null);
      const club = suggestedFirstLine('club');
      const creator = suggestedFirstLine('creator');
      const friendsLine = suggestedFirstLine('friends');
      if (current === '' || current === previous || current === club || current === creator || current === friendsLine) {
        return next;
      }
      return current;
    });
  });

  onCleanup(() => {
    currentOperation = null;
  });

  const addInvitee = (raw: string): void => {
    const next = addFormationInvitee(invitees(), raw);
    if (!next) {
      setInviteeError('Enter a short name — letters or numbers, no spaces.');
      return;
    }
    setInvitees(next);
    setInviteeDraft('');
    setInviteeError('');
  };

  const markShared = (status: string): void => {
    setSharedInvite(true);
    setCopyStatus(status);
  };

  async function shareInvite(): Promise<void> {
    if (!channel() || !canShare() || shareBusy() || copyBusy()) return;
    const operation = { id: ++nextOperationId, kind: 'share' as const };
    currentOperation = operation;
    const data = shareData();
    setShareBusy(true);
    setCopyStatus('Opening your device share sheet.');
    try {
      await navigator.share(data);
      if (currentOperation === operation) markShared('Invite shared.');
    } catch (err) {
      if (currentOperation !== operation) return;
      if (err instanceof DOMException && err.name === 'AbortError') {
        setCopyStatus('Share cancelled. Copy the link to finish starting the room.');
      } else {
        setCopyStatus('Could not open the share sheet. Copy the link instead.');
      }
    } finally {
      if (currentOperation === operation) {
        currentOperation = null;
        setShareBusy(false);
      }
    }
  }

  async function copyInviteLink(): Promise<void> {
    if (!channel() || copyBusy() || shareBusy()) return;
    const operation = { id: ++nextOperationId, kind: 'copy' as const };
    currentOperation = operation;
    const url = payload().shareUrl;
    setCopyBusy(true);
    try {
      const copied = await writeClipboardText(url);
      if (currentOperation !== operation) return;
      if (copied) markShared('Invite link copied. Enter the room when you are ready.');
      else setCopyStatus('Copy failed. Select and copy the link shown above.');
    } finally {
      if (currentOperation === operation) {
        currentOperation = null;
        setCopyBusy(false);
      }
    }
  }

  const enterRoom = (event: SubmitEvent): void => {
    event.preventDefault();
    const name = channel();
    if (!name) {
      setNameError('Enter a short room name — letters or numbers, no spaces.');
      return;
    }
    if (!canFinishCreateRoom({ sharedInvite: sharedInvite() })) {
      setCopyStatus('Copy or share the invite before entering the room.');
      return;
    }
    setNameError('');
    setCreateError('');
    const admitted = getState().createRoom({
      name,
      skin: skin(),
      hangLabel: includeHang() ? hangLabel() : null,
      firstLine: includeFirstLine() ? firstLine() : null,
      sharedInvite: true,
    });
    if (!admitted) {
      setCreateError('The room could not be started on this connection. Reconnect and try again; your form is still here.');
    }
  };

  return (
    <form class="chb-create" onSubmit={enterRoom} data-testid="create-room-formation">
      <header class="chb-create-header">
        <span class="chb-eyebrow">Create</span>
        <h2>Start a room</h2>
        <p class="chb-create-lead">A room is a shared conversation. Name it, choose an optional look, and share the invite before you enter.</p>
      </header>
      <p class="chb-create-note">{FORMATION_COPY}</p>
      <Show when={!connected()}>
        <p class="chb-state chb-state--offline" role="status"><strong>You’re offline.</strong> Reconnect to create or join this room. Your form will stay here.</p>
      </Show>
      <Show when={createError()}>
        <p class="chb-state chb-state--offline" role="alert">{createError()}</p>
      </Show>

      <FormField
        id="chb-create-name"
        label="Room name"
        description="Friends will see this name when they open the invite."
        error={nameError() || undefined}
        type="text"
        autocomplete="off"
        spellcheck={false}
        placeholder="book club"
        value={nameInput()}
        onInput={(event) => {
          setNameInput(event.currentTarget.value);
          if (nameError()) setNameError('');
        }}
      />

      <fieldset class="chb-skins">
        <legend>Room skin (optional)</legend>
        <div class="chb-skins-row" role="group" aria-label="Room skin">
          <For each={ROOM_SKINS}>
            {(option) => (
              <button
                type="button"
                class="chb-skin"
                aria-label={option.label}
                aria-pressed={skin() === option.id}
                onClick={() => setSkin((current) => (current === option.id ? null : option.id))}
              >
                <span class="chb-skin-label">{option.label}</span>
                <span class="chb-skin-blurb">{option.blurb}</span>
              </button>
            )}
          </For>
        </div>
      </fieldset>

      <label class="chb-check">
        <input
          type="checkbox"
          checked={includeHang()}
          onChange={(event) => setIncludeHang(event.currentTarget.checked)}
        />
        <span>Suggest a next hang · {hangLabel()}</span>
      </label>

      <label class="chb-check">
        <input
          type="checkbox"
          checked={includeFirstLine()}
          onChange={(event) => setIncludeFirstLine(event.currentTarget.checked)}
        />
        <span>Leave a first line in the composer</span>
      </label>
      <Show when={includeFirstLine()}>
        <FormField
          id="chb-create-first-line"
          label="First line"
          description="Optional. You land in the room ready to send it — or you can edit it."
          type="text"
          autocomplete="off"
          value={firstLine()}
          onInput={(event) => setFirstLine(event.currentTarget.value)}
        />
      </Show>

      <section class="chb-invite" aria-labelledby="chb-invite-heading">
        <h3 id="chb-invite-heading" class="chb-invite-heading">
          Add {FORMATION_INVITE_TARGET} people
        </h3>
        <p class="chb-invite-progress" role="status">
          {invitees().length} of {FORMATION_INVITE_TARGET} people added.
          {sharedInvite() ? ' Invite shared.' : ' Share the link so they can join.'}
        </p>

        <Show when={friendChoices().length > 0}>
          <div class="chb-friends" role="group" aria-label="Friends you can add">
            <For each={friendChoices()}>
              {(friend) => (
                <button
                  type="button"
                  class="chb-friend"
                  disabled={invitees().length >= FORMATION_INVITE_TARGET}
                  onClick={() => addInvitee(friend.nick)}
                >
                  Add {friend.nick}
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="chb-invitee-row">
          <FormField
            id="chb-create-invitee"
            label="Add someone by name"
            description="A suggested name on their invite. They can still pick their own."
            error={inviteeError() || undefined}
            type="text"
            autocomplete="off"
            spellcheck={false}
            placeholder="ada"
            value={inviteeDraft()}
            onInput={(event) => {
              setInviteeDraft(event.currentTarget.value);
              if (inviteeError()) setInviteeError('');
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              addInvitee(inviteeDraft());
            }}
          />
          <Button
            type="button"
            variant="ghost"
            disabled={invitees().length >= FORMATION_INVITE_TARGET}
            onClick={() => addInvitee(inviteeDraft())}
          >
            Add
          </Button>
        </div>

        <Show when={invitees().length > 0}>
          <ul class="chb-seats" aria-label="People to invite">
            <For each={invitees()}>
              {(nick) => (
                <li>
                  <span>{nick}</span>
                  <button type="button" onClick={() => setInvitees(removeFormationInvitee(invitees(), nick))}>
                    Remove {nick}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <div class="chb-invite-preview" role="group" aria-label="Invite link">
          <p class="chb-invite-label">Invite link</p>
          <p class="chb-invite-url">
            {channel()
              ? payload().shareUrl
              : 'Name the room to get a shareable invite.'}
          </p>
          <div class="chb-invite-actions">
            <Show when={canShare()}>
              <Button
                type="button"
                variant="primary"
                disabled={!channel() || shareBusy() || copyBusy()}
                aria-busy={shareBusy()}
                onClick={() => void shareInvite()}
              >
                {shareBusy() ? 'Opening share sheet…' : 'Share invite'}
              </Button>
            </Show>
            <Button
              type="button"
              variant="primary"
              disabled={!channel() || copyBusy() || shareBusy()}
              aria-busy={copyBusy()}
              onClick={() => void copyInviteLink()}
            >
              {copyBusy() ? 'Copying invite link…' : 'Copy invite'}
            </Button>
          </div>
        </div>
        <span class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="create-room-share-status">
          {copyStatus()}
        </span>
      </section>

      <details class="chb-advanced">
        <summary>Advanced</summary>
        <p>
          Room rules, keys, and who can join stay in This room after you enter.
          This form names the place, shares the existing invite link, and opens the composer.
        </p>
      </details>

      <div class="chb-create-actions">
        <Button type="button" variant="ghost" onClick={() => getState().openChannelBrowser()}>
          Browse rooms
        </Button>
        <Button type="submit" disabled={!canEnter() || !connected()}>
          Create and enter room
        </Button>
      </div>
    </form>
  );
}
