// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * RoomMediaIndex — Pictures · Files · Links for the current room or DM.
 * Filters this-device transcript + vault. No dest unfurl, no gallery write.
 */

import { createEffect, createMemo, createResource, createSignal, For, Show, splitProps, type JSX } from 'solid-js';
import { Sheet } from '@/primitives';
import { Tabs } from '@/primitives/Tabs';
import { preferences } from '@/lib/prefs/preferences';
import { isPreviewableUrl } from '@/lib/preview/linkPreview';
import { unfurlPrivacyFromPrefs } from '@/lib/preview/unfurlPrivacy';
import {
  getState,
  selectDeviceMemoryOwner,
  useStore,
} from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import { loadRecentWithStatus, VAULT_KEEP, type RecentHistoryStatus } from '@/lib/vault/historyVault';
import { ProvenanceBadge } from '@/shell/ProvenanceBadge';
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

function isSameOriginHttpUrl(url: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const parsed = new URL(url, window.location.href);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.username === ''
      && parsed.password === ''
      && parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

function mediaHost(url: string): string {
  try {
    return new URL(url).hostname || 'external host';
  } catch {
    return 'external host';
  }
}

function mediaScopeKey(
  open: boolean,
  target: string,
  owner: ReturnType<typeof selectDeviceMemoryOwner>,
): string {
  return [
    open ? 'open' : 'closed',
    target,
    owner?.serverUrl ?? '',
    owner?.identity ?? '',
  ].join('\u0000');
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
  const scopeKey = createMemo(() => mediaScopeKey(local.open, local.target, memoryOwner()));

  const [vaultResult, { refetch: retryVault }] = createResource(
    () => ({
      open: local.open,
      target: local.target,
      owner: memoryOwner(),
    }),
    async (source) => {
      if (!source.open || !source.target) return { messages: [], status: 'complete' as const };
      try {
        return await loadRecentWithStatus(source.target, VAULT_KEEP, source.owner ?? undefined);
      } catch {
        return { messages: [], status: 'unavailable' as const };
      }
    },
    { initialValue: { messages: [], status: 'complete' as RecentHistoryStatus } },
  );

  const index = createMemo(() => {
    const target = local.target.toLowerCase();
    const live = liveMessages().filter((message) => message.target.toLowerCase() === target);
    // createResource retains its previous value while a new scope is loading.
    // Do not let that value cross an account/room boundary.
    const vault = vaultResult.loading ? EMPTY_MESSAGES : (vaultResult()?.messages ?? EMPTY_MESSAGES);
    return indexRoomMedia(mergeRoomHistory(
      live,
      vault,
    ));
  });

  function jumpTo(messageId: string): void {
    getState().focusMessage(messageId);
    local.onOpenChange(false);
  }

  return (
    <Sheet
      open={local.open}
      title="Pictures, files, and links"
      description="From this conversation, indexed on this device. Selecting an item returns you to its message; links open the destination in a new tab."
      onOpenChange={local.onOpenChange}
      closeLabel="Close pictures, files, and links"
    >
      <div class="room-media-index" data-testid="room-media-index">
        <div class="room-media-index-context" data-testid="room-media-index-context">
          <div class="room-media-index-context-copy">
            <span class="room-media-index-context-kicker">Conversation media</span>
            {' '}
            <strong dir="auto">{local.target}</strong>
          </div>
          <ProvenanceBadge scope="device" subject="Conversation media index" />
        </div>
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
          <Show when={vaultResult.loading}>
            <div class="room-media-index-status room-media-index-status--loading" role="status" aria-live="polite">
              <span>Loading media from this device…</span>
              <span class="room-media-index-skeleton" aria-hidden="true" />
            </div>
          </Show>
          <Show when={!vaultResult.loading && (vaultResult.error || vaultResult()?.status !== 'complete')}>
            <div class="room-media-index-status room-media-index-status--error" role="alert" aria-live="assertive">
              <p>{vaultResult.error || vaultResult()?.status === 'unavailable'
                ? 'Device history is unavailable. Showing media from the live conversation and any history recovered.'
                : 'Device history is incomplete. Showing live media and the history recovered so far; more history may exist.'}</p>
              <button type="button" class="room-media-index-retry" onClick={() => retryVault()}>
                Retry
              </button>
            </div>
          </Show>
          <For each={FILTERS}>
            {(filter) => (
              <Tabs.Content
                class="room-media-index-panel"
                value={filter.id}
                data-media-filter={filter.id}
              >
                  <ul class="room-media-index-list" aria-label={`${filter.label} in this conversation`}>
                      <For each={itemsForFilter(index(), filter.id)}>
                        {(item) => (
                          <li class="room-media-index-item">
                            <Show when={item.kind === 'picture'}>
                              <PictureRow
                                item={item as RoomMediaPicture}
                                onJump={jumpTo}
                                scopeKey={scopeKey()}
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
                <Show when={!vaultResult.loading && itemsForFilter(index(), filter.id).length === 0}>
                  <p class="room-media-index-empty">{ROOM_MEDIA_EMPTY[filter.id]}</p>
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
  scopeKey: string;
}): JSX.Element {
  const [local] = splitProps(props, ['item', 'onJump', 'scopeKey']);
  const label = createMemo(() => local.item.name ?? 'Picture');
  const [previewFailed, setPreviewFailed] = createSignal(false);
  const [externalAllowed, setExternalAllowed] = createSignal(false);

  // Match MessageText's media boundary: same-origin resources are safe to
  // render locally, while public resources must pass the current unfurl
  // policy and remain inert until this picture gets its own consent.
  const sameOrigin = createMemo(() => isSameOriginHttpUrl(local.item.href));
  const privacy = createMemo(() => unfurlPrivacyFromPrefs(preferences()));
  const safeHref = createMemo(() => {
    const href = local.item.href;
    const currentPrivacy = privacy();
    if (!currentPrivacy.linkPreviews) return null;
    return sameOrigin() || isPreviewableUrl(href, currentPrivacy) ? href : null;
  });
  const allowedHref = createMemo(() => {
    const href = safeHref();
    return href && (sameOrigin() || externalAllowed()) ? href : null;
  });

  let observedItem = '';
  createEffect(() => {
    const nextItem = `${local.scopeKey}\u0000${local.item.id}\u0000${local.item.href}\u0000${JSON.stringify(privacy())}`;
    if (nextItem === observedItem) return;
    observedItem = nextItem;
    setPreviewFailed(false);
    setExternalAllowed(false);
  });

  return (
    <div
      class="room-media-index-row room-media-index-row--picture"
    >
      <span
        class="room-media-index-picture-frame"
        data-preview-state={previewFailed() ? 'unavailable' : 'available'}
      >
        <Show
          when={allowedHref()}
          fallback={(
            <Show
              when={safeHref() && !sameOrigin()}
              fallback={<span class="room-media-index-picture-fallback">Preview unavailable</span>}
            >
              <button
                type="button"
                class="room-media-index-jump room-media-index-picture-load"
                aria-label={`Load external picture from ${mediaHost(local.item.href)}`}
                onClick={() => setExternalAllowed(true)}
              >
                Load picture
              </button>
            </Show>
          )}
        >
          {(href) => (
            <Show
              when={!previewFailed()}
              fallback={<span class="room-media-index-picture-fallback">Preview unavailable</span>}
            >
              <img
                src={href()}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setPreviewFailed(true)}
              />
            </Show>
          )}
        </Show>
      </span>
      <span class="room-media-index-copy">
        <span class="room-media-index-title" title={label()}>{label()}</span>
        <span class="room-media-index-meta">
          <span>{local.item.from}</span>
          <span aria-hidden="true"> · </span>
          <span>{local.item.sizeLabel ?? 'Size not recorded'}</span>
        </span>
      </span>
      <button
        type="button"
        class="room-media-index-jump"
        aria-label={`Jump to picture ${label()}`}
        onClick={() => local.onJump(local.item.messageId)}
      >
        Jump
      </button>
    </div>
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
      class="room-media-index-row room-media-index-row--file"
      aria-label={`Jump to file ${label()}`}
      onClick={() => local.onJump(local.item.messageId)}
    >
      <span class="room-media-index-filemark" aria-hidden="true">file</span>
      <span class="room-media-index-copy">
        <span class="room-media-index-title" title={label()}>{label()}</span>
        <span class="room-media-index-meta">
          <span>{local.item.from}</span>
          <span aria-hidden="true"> · </span>
          <span>{local.item.sizeLabel ?? 'Size not recorded'}</span>
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
        aria-label={`Open link to ${local.item.domain}`}
        title={local.item.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span class="room-media-index-copy">
          <span class="room-media-index-title">{local.item.domain}</span>
          <span class="room-media-index-meta" dir="auto">
            <span>{local.item.href}</span>
            <span aria-hidden="true"> · </span>
            <span>{local.item.from}</span>
          </span>
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
