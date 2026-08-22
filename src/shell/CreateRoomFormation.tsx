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

export default function CreateRoomFormation(): JSX.Element {
  const friends = useStore((s) => s.friends);
  const networkName = useStore((s) => s.networkName);
  const ourNick = useStore((s) => s.ourNick);

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
  const [shareBusy, setShareBusy] = createSignal(false);
  const [copyBusy, setCopyBusy] = createSignal(false);
  let shareEpoch = 0;
  let copyEpoch = 0;

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
    shareEpoch += 1;
    copyEpoch += 1;
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
    const epoch = ++shareEpoch;
    const data = shareData();
    setShareBusy(true);
    setCopyStatus('Opening your device share sheet.');
    try {
      await navigator.share(data);
      if (epoch === shareEpoch) markShared('Invite shared.');
    } catch (err) {
      if (epoch !== shareEpoch) return;
      if (err instanceof DOMException && err.name === 'AbortError') {
        setCopyStatus('Share cancelled. Copy the link to finish starting the room.');
      } else {
        setCopyStatus('Could not open the share sheet. Copy the link instead.');
      }
    } finally {
      if (epoch === shareEpoch) setShareBusy(false);
    }
  }

  async function copyInviteLink(): Promise<void> {
    if (!channel() || copyBusy() || shareBusy()) return;
    const epoch = ++copyEpoch;
    const url = payload().shareUrl;
    setCopyBusy(true);
    try {
      const copied = await writeClipboardText(url);
      if (epoch !== copyEpoch) return;
      if (copied) markShared('Invite link copied. Enter the room when you are ready.');
      else setCopyStatus('Copy failed. Select and copy the link shown above.');
    } finally {
      if (epoch === copyEpoch) setCopyBusy(false);
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
    getState().createRoom({
      name,
      skin: skin(),
      hangLabel: includeHang() ? hangLabel() : null,
      firstLine: includeFirstLine() ? firstLine() : null,
      sharedInvite: true,
    });
  };

  return (
    <form class="chb-create" onSubmit={enterRoom} data-testid="create-room-formation">
      <p class="chb-create-lead">{FORMATION_COPY}</p>

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
        <Button type="submit" disabled={!canEnter()}>
          Enter the room
        </Button>
      </div>
    </form>
  );
}
