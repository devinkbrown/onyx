// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * RoomInviteShare — one-tap Invite friends sheet.
 *
 * Copy the existing /invite/?join= link, or use the browser share sheet when
 * present. Not an IRC INVITE command.
 */
import './room-invite-share.css';
import { createEffect, createMemo, createSignal, onCleanup, Show, splitProps } from 'solid-js';
import { useStore } from '@/lib/store';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import {
  buildRoomSharePayload,
  canNativeShare,
  inviteLandingOrigin,
} from '@/lib/invite/shareRoomInvite';
import { Button, Sheet } from '@/primitives/index';
import { closeRoomInviteShare, roomInviteShareTarget } from './roomInviteShareState';

export type RoomInviteShareProps = {
  channel?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function RoomInviteShare(props: RoomInviteShareProps) {
  const [local] = splitProps(props, ['channel', 'open', 'onOpenChange']);
  const networkName = useStore((s) => s.networkName);
  const channels = useStore((s) => s.channels);
  const connectionStatus = useStore((s) => s.connectionStatus);

  const [copyStatus, setCopyStatus] = createSignal('');
  const [shareBusy, setShareBusy] = createSignal(false);
  const [copyBusy, setCopyBusy] = createSignal(false);
  let shareEpoch = 0;
  let copyEpoch = 0;

  const controlled = createMemo(() => local.open !== undefined);
  const channelName = createMemo(() =>
    controlled() ? (local.channel ?? '') : (roomInviteShareTarget()?.channel ?? ''),
  );
  const isOpen = createMemo(() =>
    controlled() ? !!local.open : roomInviteShareTarget() !== null,
  );

  const channel = createMemo(() => {
    const name = channelName().trim();
    if (!name) return null;
    return channels().get(name.toLowerCase()) ?? null;
  });
  const topic = createMemo(() => channel()?.topic.trim() ?? '');

  const payload = createMemo(() =>
    buildRoomSharePayload({
      channel: channelName(),
      network: networkName(),
      origin: inviteLandingOrigin(),
    }),
  );
  const shareData = createMemo(() => payload().shareData);
  const canShare = createMemo(() => canNativeShare(shareData()));
  let lastPayload = '';
  createEffect(() => {
    const current = payload().shareUrl;
    if (lastPayload && current !== lastPayload) {
      setCopyStatus('Invite changed. Share or copy the current link again.');
      shareEpoch += 1;
      copyEpoch += 1;
    }
    lastPayload = current;
  });

  createEffect(() => {
    void isOpen();
    void channelName();
    shareEpoch += 1;
    copyEpoch += 1;
    setShareBusy(false);
    setCopyBusy(false);
    setCopyStatus('');
  });
  onCleanup(() => {
    shareEpoch += 1;
    copyEpoch += 1;
  });

  function setOpen(open: boolean): void {
    if (local.onOpenChange) local.onOpenChange(open);
    if (!controlled() && !open) closeRoomInviteShare();
  }

  async function shareInvite(): Promise<void> {
    if (!canShare() || shareBusy() || copyBusy()) return;
    const epoch = ++shareEpoch;
    const data = shareData();
    setShareBusy(true);
    setCopyStatus('Opening your device share sheet.');
    try {
      await navigator.share(data);
      if (epoch === shareEpoch && isOpen()) setCopyStatus('Invite shared.');
    } catch (err) {
      if (epoch !== shareEpoch || !isOpen()) return;
      if (err instanceof DOMException && err.name === 'AbortError') {
        setCopyStatus('Share cancelled. The link is still available below.');
      } else {
        setCopyStatus('Could not open the share sheet. Copy the link instead.');
      }
    } finally {
      if (epoch === shareEpoch) setShareBusy(false);
    }
  }

  async function copyInviteLink(): Promise<void> {
    if (copyBusy() || shareBusy()) return;
    const epoch = ++copyEpoch;
    const url = payload().shareUrl;
    setCopyBusy(true);
    try {
      const copied = await writeClipboardText(url);
      if (epoch !== copyEpoch || !isOpen()) return;
      setCopyStatus(
        copied
          ? 'Invite link copied to clipboard.'
          : 'Copy failed. Select and copy the link shown above.',
      );
    } finally {
      if (epoch === copyEpoch) setCopyBusy(false);
    }
  }

  return (
    <Sheet
      open={isOpen()}
      title="Invite friends"
      description={payload().link.card.channel ?? networkName()}
      onOpenChange={setOpen}
      closeLabel="Close invite friends"
      data-testid="room-invite-share"
    >
      <div class="room-invite-share">
        <p class="room-invite-share__copy">
          Send this link. Friends choose a name and join.
        </p>
        <p class="room-invite-share__context" role="status">
          {connectionStatus() === 'connected'
            ? 'Anyone with the link can choose to join this room.'
            : 'You’re offline. You can still copy this link and share it.'}
        </p>
        <div class="room-invite-share__preview" role="group" aria-label="Invite preview">
          <p class="room-invite-share__label">Room</p>
          <p class="room-invite-share__room">{payload().link.card.channel ?? networkName()}</p>
          <Show when={topic()}>
            {(text) => <p class="room-invite-share__topic">{text()}</p>}
          </Show>
        </div>
        <div class="room-invite-share__preview">
          <p class="room-invite-share__label">Link</p>
          <p class="room-invite-share__url">{payload().shareUrl}</p>
        </div>
        <div class="room-invite-share__actions">
          <Show when={canShare()}>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={shareBusy() || copyBusy()}
              aria-busy={shareBusy()}
              onClick={() => void shareInvite()}
            >
              {shareBusy() ? 'Opening share sheet…' : 'Share'}
            </Button>
          </Show>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={copyBusy() || shareBusy()}
            aria-busy={copyBusy()}
            onClick={() => void copyInviteLink()}
          >
            {copyBusy() ? 'Copying link…' : 'Copy link'}
          </Button>
        </div>
        <Show when={!canShare()}>
          <p class="room-invite-share__fallback">Sharing is not available here. Copy the link instead.</p>
        </Show>
        <span
          class="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="room-invite-share-status"
        >
          {copyStatus()}
        </span>
      </div>
    </Sheet>
  );
}

export function RoomInviteShareHost() {
  return <RoomInviteShare />;
}
