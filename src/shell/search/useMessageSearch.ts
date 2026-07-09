import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import { getState, useStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import { preferences } from '@/lib/prefs/preferences';
import { searchVault } from '@/lib/vault/historyVault';

export type MessageSearchResult = {
  id: string;
  from: string;
  text: string;
  time: Date;
  target: string;
  ordinal: number;
};

export type VaultSearchResult = {
  id: string;
  from: string;
  text: string;
  time: Date;
  /** Conversation key the hit lives in ('#channel' or a DM nick). */
  target: string;
};

export type UseMessageSearch = {
  /** Server-side (draft/search) history search over the active conversation */
  canServerSearch: Accessor<boolean>;
  serverStatus: Accessor<'idle' | 'pending' | 'done' | 'error'>;
  serverResults: Accessor<MessageSearchResult[]>;
  serverError: Accessor<string | null>;
  runServerSearch: () => void;
  isOpen: Accessor<boolean>;
  query: Accessor<string>;
  setQuery: (next: string) => void;
  results: Accessor<MessageSearchResult[]>;
  resultCount: Accessor<number>;
  activeIndex: Accessor<number>;
  activePosition: Accessor<number>;
  activeResult: Accessor<MessageSearchResult | null>;
  activeResultId: Accessor<string | null>;
  targetLabel: Accessor<string>;
  hasConversation: Accessor<boolean>;
  /** Device-memory (vault) hits from OTHER conversations, newest first */
  vaultResults: Accessor<VaultSearchResult[]>;
  /** Open a vault hit: navigate to its conversation and land on the message */
  openVaultResult: (result: VaultSearchResult) => void;
  open: () => void;
  close: () => void;
  next: () => void;
  previous: () => void;
};

const [isMessageSearchOpen, setMessageSearchOpen] = createSignal(false);
const [messageSearchQuery, setMessageSearchQuerySignal] = createSignal('');
const [messageSearchActiveIndex, setMessageSearchActiveIndex] = createSignal(0);
const [messageSearchActiveResultId, setMessageSearchActiveResultId] = createSignal<string | null>(null);

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function sortedMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const byTime = a.message.time.getTime() - b.message.time.getTime();
      return byTime === 0 ? a.index - b.index : byTime;
    })
    .map((item) => item.message);
}

function currentConversationKey(): string | null {
  const view = getState().activeView;
  if (view.kind === 'channel') return `channel:${view.channel.toLocaleLowerCase()}`;
  if (view.kind === 'dm') return `dm:${view.nick.toLocaleLowerCase()}`;
  return null;
}

export function hasMessageSearchableConversation(): boolean {
  return currentConversationKey() !== null;
}

export function openMessageSearch(): void {
  if (!hasMessageSearchableConversation()) return;
  setMessageSearchOpen(true);
}

export function openMessageSearchWithQuery(query: string): void {
  if (!hasMessageSearchableConversation()) return;
  const trimmed = query.trim();
  if (!trimmed) return;
  setMessageSearchQuerySignal(trimmed);
  setMessageSearchActiveIndex(0);
  setMessageSearchOpen(true);
}

export function closeMessageSearch(): void {
  setMessageSearchOpen(false);
  setMessageSearchQuerySignal('');
  setMessageSearchActiveIndex(0);
  setMessageSearchActiveResultId(null);
  getState().clearServerSearch();
}

export function activeMessageSearchResultId(): string | null {
  return messageSearchActiveResultId();
}

export function useMessageSearch(): UseMessageSearch {
  const activeView = useStore((s) => s.activeView);
  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);
  const canSearchHistory = useStore((s) => s.canSearchHistory);
  const serverSearch = useStore((s) => s.serverSearch);

  const searchTarget = createMemo(() => {
    const view = activeView();
    if (view.kind === 'channel') return view.channel;
    if (view.kind === 'dm') return view.nick;
    return null;
  });

  const canServerSearch = createMemo(() => canSearchHistory() && searchTarget() !== null);

  const serverResults = createMemo((): MessageSearchResult[] =>
    serverSearch().results.map((message, ordinal) => ({
      id: message.id,
      from: message.from,
      text: message.text,
      time: message.time,
      target: message.target,
      ordinal,
    })),
  );

  function runServerSearch(): void {
    const target = searchTarget();
    const query = messageSearchQuery().trim();
    if (!target || !query || !canServerSearch()) return;
    getState().searchServerHistory(target, query);
  }

  const hasConversation = createMemo(() => {
    const view = activeView();
    return view.kind === 'channel' || view.kind === 'dm';
  });

  const targetLabel = createMemo(() => {
    const view = activeView();
    if (view.kind === 'channel') return view.channel;
    if (view.kind === 'dm') return `@${view.nick}`;
    return '';
  });

  const conversationKey = createMemo(() => {
    const view = activeView();
    if (view.kind === 'channel') return `channel:${view.channel.toLocaleLowerCase()}`;
    if (view.kind === 'dm') return `dm:${view.nick.toLocaleLowerCase()}`;
    return '';
  });

  const messages = createMemo((): ChatMessage[] => {
    const view = activeView();
    if (view.kind === 'channel') {
      const channel = channels().get(view.channel) ?? channels().get(view.channel.toLocaleLowerCase());
      return sortedMessages(channel?.messages ?? []);
    }
    if (view.kind === 'dm') {
      const dm = dms().get(view.nick.toLocaleLowerCase()) ?? dms().get(view.nick);
      return sortedMessages(dm?.messages ?? []);
    }
    return [];
  });

  const results = createMemo((): MessageSearchResult[] => {
    const query = normalized(messageSearchQuery());
    if (!query) return [];

    return messages()
      .filter((message) => {
        const text = message.text.toLocaleLowerCase();
        const from = message.from.toLocaleLowerCase();
        return text.includes(query) || from.includes(query);
      })
      .map((message, ordinal) => ({
        id: message.id,
        from: message.from,
        text: message.text,
        time: message.time,
        target: message.target,
        ordinal,
      }));
  });

  const loadedMessageIds = createMemo(() => new Set(messages().map((message) => message.id)));

  const resultCount = createMemo(() => results().length);
  const activeResult = createMemo(() => results()[messageSearchActiveIndex()] ?? null);
  const activeResultId = createMemo(() => (
    isMessageSearchOpen() ? activeResult()?.id ?? null : null
  ));
  const activePosition = createMemo(() => (activeResult() ? messageSearchActiveIndex() + 1 : 0));

  let lastSearchContext = '';
  createEffect(() => {
    const nextContext = `${conversationKey()}\n${messageSearchQuery()}`;
    if (nextContext === lastSearchContext) return;
    lastSearchContext = nextContext;
    setMessageSearchActiveIndex(0);
  });

  createEffect(() => {
    const count = resultCount();
    setMessageSearchActiveIndex((index) => {
      if (count === 0) return 0;
      return Math.min(index, count - 1);
    });
  });

  createEffect(() => {
    if (!hasConversation() && isMessageSearchOpen()) {
      closeMessageSearch();
      return;
    }

    setMessageSearchActiveResultId(activeResultId());
  });

  function setQuery(next: string): void {
    setMessageSearchQuerySignal(next);
    setMessageSearchActiveIndex(0);
  }

  // ── device-memory (vault) search across ALL conversations ──
  // Debounced against the query; loaded rows are de-duped by id while older
  // same-room rows that only exist in the local vault remain searchable.
  const [vaultHits, setVaultHits] = createSignal<VaultSearchResult[]>([]);
  let vaultTimer: ReturnType<typeof setTimeout> | undefined;
  let vaultSeq = 0;
  createEffect(() => {
    const query = messageSearchQuery().trim();
    const open = isMessageSearchOpen();
    const loadedIds = loadedMessageIds();
    if (vaultTimer !== undefined) clearTimeout(vaultTimer);
    if (!open || query.length < 2 || !preferences().localHistory) {
      setVaultHits([]);
      return;
    }
    const seq = ++vaultSeq;
    vaultTimer = setTimeout(() => {
      void searchVault(query).then((hits) => {
        if (seq !== vaultSeq) return; // a newer query superseded this one
        setVaultHits(
          hits
            .filter((h) => !loadedIds.has(h.message.id))
            .slice(0, 25)
            .map((h) => ({
              id: h.message.id,
              from: h.message.from,
              text: h.message.text,
              time: h.message.time,
              target: h.target,
            })),
        );
      });
    }, 200);
  });
  onCleanup(() => {
    if (vaultTimer !== undefined) clearTimeout(vaultTimer);
  });

  function openVaultResult(result: VaultSearchResult): void {
    getState().openVaultResult(result.target, result.id);
    closeMessageSearch();
  }

  function move(delta: number): void {
    const count = resultCount();
    if (count === 0) return;
    setMessageSearchActiveIndex((index) => (index + delta + count) % count);
  }

  return {
    canServerSearch,
    serverStatus: () => serverSearch().status,
    serverResults,
    serverError: () => serverSearch().error,
    runServerSearch,
    isOpen: isMessageSearchOpen,
    query: messageSearchQuery,
    setQuery,
    results,
    resultCount,
    activeIndex: messageSearchActiveIndex,
    activePosition,
    activeResult,
    activeResultId,
    targetLabel,
    hasConversation,
    vaultResults: vaultHits,
    openVaultResult,
    open: openMessageSearch,
    close: closeMessageSearch,
    next: () => move(1),
    previous: () => move(-1),
  };
}
