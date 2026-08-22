// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * RoomMediaIndex — Pictures · Files · Links for the current room or DM.
 * Filters this-device transcript + vault. No dest unfurl, no gallery write.
 */

import { createMemo, createResource, For, Show, splitProps, type JSX } from 'solid-js';
import { Sheet } from '@/primitives';
import { Tabs } from '@/primitives/Tabs';
import {
  getState,
  selectDeviceMemoryOwner,
  useStore,
} from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import { loadRecent, VAULT_KEEP } from '@/lib/vault/historyVault';
import {
  ROOM_MEDIA_EMPTY,
  indexRoomMedia,
  itemsForFilter,
  mergeRoomHistory,
  type RoomMediaFile,
  type RoomMediaFilter,
  type RoomMediaLink,
  type RoomMediaPicture,
} from '@/lib/upload/roomMediaIndex';
import './room-media-index.css';

export type RoomMediaIndexProps = {
  target: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const EMPTY_MESSAGES: readonly ChatMessage[] = [];
const FILTERS: ReadonlyArray<{ id: RoomMediaFilter; label: string }> = [
  { id: 'pictures', label: 'Pictures' },
  { id: 'files', label: 'Files' },
  { id: 'links', label: 'Links' },
];

function sameOwner(
  left: ReturnType<typeof selectDeviceMemoryOwner>,
  right: ReturnType<typeof selectDeviceMemoryOwner>,
): boolean {
  return left?.serverUrl === right?.serverUrl && left?.identity === right?.identity;
}

export function RoomMediaIndex(props: RoomMediaIndexProps): JSX.Element {
  const [local] = splitProps(props, ['target', 'open', 'onOpenChange']);

  const liveMessages = useStore((s): readonly ChatMessage[] => {
    const view = s.activeView;
    if (view.kind === 'channel') {
      return s.channels.get(view.channel.toLowerCase())?.messages ?? EMPTY_MESSAGES;
    }
    if (view.kind === 'dm') {
      return s.dms.get(view.nick)?.messages
        ?? s.dms.get(view.nick.toLowerCase())?.messages
        ?? EMPTY_MESSAGES;
    }
    return EMPTY_MESSAGES;
  });

  const memoryOwner = useStore(selectDeviceMemoryOwner, sameOwner);

  const [vaultMessages] = createResource(
    () => ({
      open: local.open,
      target: local.target,
      owner: memoryOwner(),
    }),
    async (source) => {
      if (!source.open || !source.target) return [] as ChatMessage[];
      return loadRecent(source.target, VAULT_KEEP, source.owner ?? undefined);
    },
    { initialValue: [] as ChatMessage[] },
  );

  const index = createMemo(() => (
    indexRoomMedia(mergeRoomHistory(liveMessages(), vaultMessages() ?? []))
  ));

  function jumpTo(messageId: string): void {
    getState().focusMessage(messageId);
    local.onOpenChange(false);
  }

  return (
    <Sheet
      open={local.open}
      title="Pictures, files, and links"
      description="On this device"
      onOpenChange={local.onOpenChange}
      closeLabel="Close pictures, files, and links"
    >
      <div class="room-media-index" data-testid="room-media-index">
        <Tabs defaultValue="pictures">
          <Tabs.List class="room-media-index-filters" aria-label="Pictures, files, and links">
            <For each={FILTERS}>
              {(filter) => (
                <Tabs.Trigger class="room-media-index-filter" value={filter.id}>
                  {filter.label}
                </Tabs.Trigger>
              )}
            </For>
          </Tabs.List>
          <For each={FILTERS}>
            {(filter) => (
              <Tabs.Content class="room-media-index-panel" value={filter.id}>
                <Show
                  when={itemsForFilter(index(), filter.id).length > 0}
                  fallback={<p class="room-media-index-empty">{ROOM_MEDIA_EMPTY[filter.id]}</p>}
                >
                  <ul class="room-media-index-list">
                    <For each={itemsForFilter(index(), filter.id)}>
                      {(item) => (
                        <li class="room-media-index-item">
                          <Show when={item.kind === 'picture'}>
                            <PictureRow
                              item={item as RoomMediaPicture}
                              onJump={jumpTo}
                            />
                          </Show>
                          <Show when={item.kind === 'file'}>
                            <FileRow item={item as RoomMediaFile} onJump={jumpTo} />
                          </Show>
                          <Show when={item.kind === 'link'}>
                            <LinkRow item={item as RoomMediaLink} onJump={jumpTo} />
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </Tabs.Content>
            )}
          </For>
        </Tabs>
      </div>
    </Sheet>
  );
}

function PictureRow(props: {
  item: RoomMediaPicture;
  onJump: (messageId: string) => void;
}): JSX.Element {
  const [local] = splitProps(props, ['item', 'onJump']);
  const label = createMemo(() => local.item.name ?? 'Picture');

  return (
    <button
      type="button"
      class="room-media-index-row"
      aria-label={`Jump to picture ${label()}`}
      onClick={() => local.onJump(local.item.messageId)}
    >
      <span class="room-media-index-squircle" aria-hidden="true" />
      <span class="room-media-index-copy">
        <span class="room-media-index-title">{label()}</span>
        <span class="room-media-index-meta">{local.item.from}</span>
      </span>
    </button>
  );
}

function FileRow(props: {
  item: RoomMediaFile;
  onJump: (messageId: string) => void;
}): JSX.Element {
  const [local] = splitProps(props, ['item', 'onJump']);
  const label = createMemo(() => local.item.name ?? 'File');

  return (
    <button
      type="button"
      class="room-media-index-row"
      aria-label={`Jump to file ${label()}`}
      onClick={() => local.onJump(local.item.messageId)}
    >
      <span class="room-media-index-filemark" aria-hidden="true">file</span>
      <span class="room-media-index-copy">
        <span class="room-media-index-title">{label()}</span>
        <span class="room-media-index-meta">
          {local.item.sizeLabel ?? local.item.from}
        </span>
      </span>
    </button>
  );
}

function LinkRow(props: {
  item: RoomMediaLink;
  onJump: (messageId: string) => void;
}): JSX.Element {
  const [local] = splitProps(props, ['item', 'onJump']);

  return (
    <div class="room-media-index-link">
      <a
        class="room-media-index-row room-media-index-row--link"
        href={local.item.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span class="room-media-index-copy">
          <span class="room-media-index-title">{local.item.domain}</span>
          <span class="room-media-index-meta">{local.item.href}</span>
        </span>
      </a>
      <button
        type="button"
        class="room-media-index-jump"
        aria-label={`Jump to link ${local.item.domain}`}
        onClick={() => local.onJump(local.item.messageId)}
      >
        Jump
      </button>
    </div>
  );
}
