// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import { getState, useStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/irc/types';
import { isEnvelope } from '@/lib/e2ee/dmCipher';
import { preferences } from '@/lib/prefs/preferences';
import { VAULT_SEARCH_MODES, loadDefaultVaultSearchMode } from '@/lib/prefs/vaultSearchMode';
import { classifyVaultDmSearchPrivacy, searchVault } from '@/lib/vault/historyVault';
import { getVaultDmSearchPrivacy, subscribeVaultDmSearchPrivacy } from '@/lib/vault/dmSearchPrivacy';
import { searchVaultSemantic } from '@/lib/vault/searchVaultSemantic';
import { searchVaultHybrid } from '@/lib/vault/searchVaultHybrid';
import {
  boundedSearchField,
  boundedSearchQueryInput,
  boundedSearchResultText,
  SEARCH_QUERY_TEXT_MAX,
} from '@/lib/vault/searchBounds';

/**
 * How the device-memory (vault) pane matches:
 *  - 'hybrid'   — lexical substring hits first, then related token-vector neighbours (default)
 *  - 'exact'    — literal case-insensitive substring only
 *  - 'semantic' — on-device token-vector cosine neighbours only (persisted legacy name)
 */
export type VaultSearchMode = 'exact' | 'semantic' | 'hybrid';

/**
 * One work bound for every live Search Center entry path. Besides keeping the
 * UI and saved-search contract aligned, this prevents a pasted/prefilled value
 * from driving unbounded lowercase/token/vector work or an oversized SEARCH
 * command. The original message corpus remains untouched.
 */
export const MESSAGE_SEARCH_QUERY_MAX = SEARCH_QUERY_TEXT_MAX;

/**
 * Discoverable cycle order the toggle walks: default first, then the two pure
 * modes. Single-sourced from VAULT_SEARCH_MODES so the in-search toggle and the
 * Preferences "Default search mode" selector can never diverge on order.
 */
const VAULT_MODE_CYCLE: readonly VaultSearchMode[] = VAULT_SEARCH_MODES;

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
  /** True when an E2EE DM deliberately keeps query text off the server. */
  serverSearchBlockedByE2ee: Accessor<boolean>;
  serverStatus: Accessor<'idle' | 'pending' | 'done' | 'error'>;
  serverResults: Accessor<MessageSearchResult[]>;
  serverError: Accessor<string | null>;
  serverNotice: Accessor<string | null>;
  runServerSearch: () => void;
  isOpen: Accessor<boolean>;
  /** Increments for every open request, including Cmd/Ctrl-F while already open. */
  focusRequest: Accessor<number>;
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
  /** Whether device-memory persistence/search is enabled in Preferences. */
  localHistoryEnabled: Accessor<boolean>;
  /** Device-memory (vault) hits from OTHER conversations, newest first */
  vaultResults: Accessor<VaultSearchResult[]>;
  /** Async device-memory query lifecycle for accessible progress feedback. */
  vaultStatus: Accessor<'idle' | 'pending' | 'done' | 'error'>;
  /** How the vault pane matches: 'hybrid' | 'exact' | 'semantic' */
  vaultMode: Accessor<VaultSearchMode>;
  /** Cycle the vault pane through hybrid → exact → semantic */
  toggleVaultMode: () => void;
  /** Set the vault pane matching mode directly */
  setVaultMode: (mode: VaultSearchMode) => void;
  /** Device-only lexical pivots from visible and vault hits */
  recallSuggestions: Accessor<string[]>;
  applyRecallSuggestion: (term: string) => void;
  /** Open a vault hit: navigate to its conversation and land on the message */
  openVaultResult: (result: VaultSearchResult) => void;
  /** Hydrate an archived server hit around its timestamp and land on it. */
  openServerResult: (result: MessageSearchResult) => void;
  open: () => void;
  close: () => void;
  next: () => void;
  previous: () => void;
};

const [isMessageSearchOpen, setMessageSearchOpen] = createSignal(false);
const [messageSearchFocusRequest, setMessageSearchFocusRequest] = createSignal(0);
// The element focused when the non-modal search overlay opened (the trigger).
// Captured on open, replayed on close so Escape/close returns the keyboard user
// to where they were instead of dropping focus to <body>. (WCAG SC 2.4.3)
let messageSearchReturnFocus: HTMLElement | null = null;

function captureMessageSearchTrigger(): void {
  if (isMessageSearchOpen()) return; // already open — keep the original trigger
  messageSearchReturnFocus =
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
}
// Seed the live in-search mode from the user's persisted DEFAULT (Preferences →
// "Search & History"). With no stored value this is 'hybrid', so behaviour is
// unchanged for a fresh device; the in-search toggle then walks this transient
// session value without disturbing the persisted default.
const [vaultSearchMode, setVaultSearchMode] = createSignal<VaultSearchMode>(loadDefaultVaultSearchMode());
const [messageSearchQuery, setMessageSearchQuerySignal] = createSignal('');
const [messageSearchActiveIndex, setMessageSearchActiveIndex] = createSignal(0);
const [messageSearchActiveResultId, setMessageSearchActiveResultId] = createSignal<string | null>(null);
const SEARCH_RECALL_LIMIT = 5;
const SEARCH_RECALL_STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'because',
  'before',
  'being',
  'could',
  'from',
  'have',
  'here',
  'into',
  'just',
  'like',
  'line',
  'lines',
  'message',
  'messages',
  'need',
  'note',
  'once',
  'only',
  'over',
  'room',
  'that',
  'their',
  'then',
  'there',
  'they',
  'this',
  'with',
  'would',
]);

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function sameSearchTarget(left: string, right: string): boolean {
  // Compare lengths before case-folding so malformed injected state cannot
  // force an unbounded lowercase allocation at the render/click boundary.
  return left.length === right.length && left.toLowerCase() === right.toLowerCase();
}

function boundedQuery(value: string): string {
  return boundedSearchQueryInput(value);
}

function recallTermsFromText(text: string): string[] {
  const terms = new Set<string>();
  for (const raw of boundedSearchField(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) ?? []) {
    const term = raw.replace(/^-+|-+$/g, '');
    if (term.length < 3 || SEARCH_RECALL_STOP_WORDS.has(term)) continue;
    terms.add(term);
  }
  return [...terms];
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

/**
 * Search/display text for a loaded row. E2EE ciphertext is never useful user
 * text and must not enter recall terms; decrypted plaintext is transient store
 * state and remains device-only.
 */
function visibleSearchText(message: ChatMessage, dmContext: boolean): string | null {
  if (!message.encrypted && !(dmContext && isEnvelope(message.text))) return message.text;
  return typeof message.plaintext === 'string' && message.plaintext.length > 0
    ? message.plaintext
    : null;
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
  captureMessageSearchTrigger();
  setMessageSearchFocusRequest((request) => request + 1);
  setMessageSearchOpen(true);
}

export function openMessageSearchWithQuery(query: string): void {
  const trimmed = boundedQuery(query.trim());
  if (!trimmed) return;
  captureMessageSearchTrigger();
  setMessageSearchQuerySignal(trimmed);
  setMessageSearchActiveIndex(0);
  setMessageSearchFocusRequest((request) => request + 1);
  setMessageSearchOpen(true);
}

export function closeMessageSearch(): void {
  const wasOpen = isMessageSearchOpen();
  setMessageSearchOpen(false);
  setMessageSearchQuerySignal('');
  setMessageSearchActiveIndex(0);
  setMessageSearchActiveResultId(null);
  const state = getState();
  // SEARCH replies have no client request id. Keep a pending request locked
  // across close/reopen so a late batch cannot be mistaken for a newer query
  // on the same target. Settled state is safe to clear immediately.
  if (state.serverSearch.status !== 'pending') state.clearServerSearch();
  // Restore focus to the trigger so a keyboard user keeps their place; the
  // search input unmounts on close and would otherwise strand focus on <body>.
  const previous = messageSearchReturnFocus;
  messageSearchReturnFocus = null;
  if (wasOpen) previous?.focus?.();
}

export function activeMessageSearchResultId(): string | null {
  return messageSearchActiveResultId();
}

/** Current shared vault-pane matching mode. */
export { vaultSearchMode };

/** Set the shared vault-pane matching mode explicitly. */
export function setVaultMode(mode: VaultSearchMode): void {
  setVaultSearchMode(mode);
}

/** Advance the shared vault-pane matching one step: hybrid → exact → semantic → hybrid. */
export function toggleVaultMode(): void {
  setVaultSearchMode((mode) => {
    const at = VAULT_MODE_CYCLE.indexOf(mode);
    return VAULT_MODE_CYCLE[(at + 1) % VAULT_MODE_CYCLE.length] ?? 'hybrid';
  });
}

export function useMessageSearch(): UseMessageSearch {
  const activeView = useStore((s) => s.activeView);
  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);
  const canSearchHistory = useStore((s) => s.canSearchHistory);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const serverSearch = useStore((s) => s.serverSearch);
  const peerDmKeys = useStore((s) => s.peerDmKeys);
  const client = useStore((s) => s.client);

  // IndexedDB classification is async, but its result must participate in this
  // reactive search gate. Missing/invalidated targets remain `unknown` and thus
  // fail closed until the complete target scan proves them plain.
  const [vaultPrivacyRevision, setVaultPrivacyRevision] = createSignal(0);
  onCleanup(subscribeVaultDmSearchPrivacy(() => {
    setVaultPrivacyRevision((revision) => revision + 1);
  }));

  createEffect(() => {
    const view = activeView();
    if (view.kind === 'dm') void classifyVaultDmSearchPrivacy(view.nick);
  });

  const activeDmVaultPrivacy = createMemo(() => {
    vaultPrivacyRevision();
    const view = activeView();
    return view.kind === 'dm' ? getVaultDmSearchPrivacy(view.nick) : 'plain';
  });

  const channelTypes = createMemo(() => client()?.isupport.CHANTYPES ?? '#&');

  const searchTarget = createMemo(() => {
    const view = activeView();
    if (view.kind === 'channel') return view.channel;
    if (view.kind === 'dm') return view.nick;
    return null;
  });

  const serverSearchBlockedByE2ee = createMemo(() => {
    const view = activeView();
    if (view.kind !== 'dm') return false;
    const key = view.nick.toLowerCase();
    const conversation = dms().get(key) ?? dms().get(view.nick);
    // A remembered encrypted row keeps the boundary active even when the local
    // preference was later disabled, fresh key discovery has not completed, or
    // the peer rotated/removed a key. The preference gates only prospective
    // key-based capability; it must never reclassify existing ciphertext as a
    // conversation whose query is safe to send to server history.
    const containsEncryptedHistory = conversation?.messages.some(
      (message) => message.encrypted || isEnvelope(message.text),
    ) ?? false;
    return containsEncryptedHistory
      || activeDmVaultPrivacy() !== 'plain'
      || (preferences().e2eeDms && peerDmKeys().has(key));
  });

  const canServerSearch = createMemo(() =>
    connectionStatus() === 'connected'
      && canSearchHistory()
      && searchTarget() !== null
      && !serverSearchBlockedByE2ee(),
  );

  const serverSearchMatchesContext = createMemo(() => {
    const search = serverSearch();
    const target = searchTarget();
    return target !== null
      && sameSearchTarget(search.target, target)
      && search.query === messageSearchQuery().trim();
  });

  const serverStatus = createMemo(() => {
    const status = serverSearch().status;
    // Keep an in-flight request visible/locked even if the input changes: the
    // wire protocol has no request id with which to cancel or disambiguate a
    // second SEARCH. Once that request settles, however, never present its
    // results or error under a different query/conversation.
    if (status === 'pending') return status;
    return serverSearchMatchesContext() ? status : 'idle';
  });

  const serverResults = createMemo((): MessageSearchResult[] =>
    (serverSearchMatchesContext() ? serverSearch().results : [])
      // Archived E2EE rows contain ciphertext because plaintext is never stored
      // server-side. Do not render or derive recall terms from that envelope.
      // The collector also enforces target equality; keep this UI boundary so
      // injected/stale store state can never turn a result click into a jump to
      // a conversation other than the one that was searched.
      .filter((message) => {
        const view = activeView();
        const target = searchTarget();
        return target !== null
          && sameSearchTarget(message.target, target)
          && !message.encrypted
          && !(view.kind === 'dm' && isEnvelope(message.text));
      })
      .map((message, ordinal) => ({
        id: message.id,
        from: message.from,
        text: boundedSearchResultText(message.text, messageSearchQuery()),
        time: message.time,
        target: message.target,
        ordinal,
      })),
  );

  function runServerSearch(): void {
    const target = searchTarget();
    const query = messageSearchQuery().trim();
    // Only one SEARCH can safely be in flight: replies carry no client request
    // id, so overlapping same-target requests can otherwise be misattributed.
    if (!target || !query || !canServerSearch() || serverSearch().status === 'pending') return;
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
    return 'all remembered conversations';
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
    const dmContext = activeView().kind === 'dm';

    return messages()
      .flatMap((message) => {
        const visibleText = visibleSearchText(message, dmContext);
        if (visibleText === null) return [];
        const text = boundedSearchField(visibleText).toLocaleLowerCase();
        const from = boundedSearchField(message.from).toLocaleLowerCase();
        if (!text.includes(query) && !from.includes(query)) return [];
        return [{ message, visibleText }];
      })
      .map(({ message, visibleText }, ordinal) => ({
        id: message.id,
        from: message.from,
        text: boundedSearchResultText(visibleText, query),
        time: message.time,
        target: message.target,
        ordinal,
      }));
  });

  const loadedMessageKeys = createMemo(() => {
    const target = searchTarget()?.toLowerCase();
    if (!target) return new Set<string>();
    return new Set(messages().map((message) => `${target}\n${message.id}`));
  });

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
    setMessageSearchActiveResultId(activeResultId());
  });

  function setQuery(next: string): void {
    setMessageSearchQuerySignal(boundedQuery(next));
    setMessageSearchActiveIndex(0);
  }

  // ── device-memory (vault) search across ALL conversations ──
  // The async fetch is debounced against ONLY the query, panel-open state, mode,
  // and the localHistory preference — deliberately NOT the set of loaded message
  // ids. Tracking loadedMessageIds here would re-run this effect (clearing and
  // rescheduling the 200ms debounce, and re-hitting IndexedDB) on every incoming
  // message in ANY conversation, since the store replaces the channels/dms Map
  // immutably on each one — which can starve the vault search entirely on a busy
  // network. The loaded-row de-dupe is instead applied reactively in the
  // `vaultHits` memo below, so newly-loaded rows still drop out cheaply without
  // disturbing the debounce.
  const [vaultRawHits, setVaultRawHits] = createSignal<VaultSearchResult[]>([]);
  const [vaultStatus, setVaultStatus] = createSignal<'idle' | 'pending' | 'done' | 'error'>('idle');
  let vaultTimer: ReturnType<typeof setTimeout> | undefined;
  let vaultAbort: AbortController | undefined;
  let vaultSeq = 0;
  createEffect(() => {
    const query = messageSearchQuery().trim();
    const open = isMessageSearchOpen();
    const mode = vaultSearchMode();
    const localHistory = preferences().localHistory;
    const chantypes = channelTypes();
    if (vaultTimer !== undefined) clearTimeout(vaultTimer);
    vaultAbort?.abort();
    vaultAbort = undefined;
    // Invalidate not just an older valid query, but also an in-flight request
    // when search closes, the query becomes too short, or local history is
    // disabled. Otherwise its late promise can repopulate a cleared panel.
    const seq = ++vaultSeq;
    if (!open || query.length < 2 || !localHistory) {
      setVaultRawHits([]);
      setVaultStatus('idle');
      return;
    }
    setVaultStatus('pending');
    vaultTimer = setTimeout(() => {
      const abort = new AbortController();
      vaultAbort = abort;
      const run =
        mode === 'semantic'
          ? searchVaultSemantic(query, { signal: abort.signal })
          : mode === 'hybrid'
            ? searchVaultHybrid(query, { signal: abort.signal })
            : searchVault(query);
      void run
        .then((hits) => {
          if (seq !== vaultSeq || abort.signal.aborted) return; // a newer query superseded this one
          setVaultRawHits(
            hits
              // Vault serialization strips plaintext by construction. An
              // encrypted hit is therefore only a ciphertext envelope.
              .filter((hit) => (
                !hit.message.encrypted
                && (
                  (hit.target.length > 0 && chantypes.includes(hit.target[0]!))
                  || !isEnvelope(hit.message.text)
                )
              ))
              .map((h) => ({
                id: h.message.id,
                from: h.message.from,
                text: boundedSearchResultText(h.message.text, query),
                time: h.message.time,
                target: h.target,
              })),
          );
          setVaultStatus('done');
        })
        .catch(() => {
          // IndexedDB or an opt-in embedding provider may fail. Search is a
          // best-effort projection, so fail closed without an unhandled promise.
          if (seq === vaultSeq && !abort.signal.aborted) {
            setVaultRawHits([]);
            setVaultStatus('error');
          }
        })
        .finally(() => {
          if (vaultAbort === abort) vaultAbort = undefined;
        });
    }, 200);
  });
  onCleanup(() => {
    if (vaultTimer !== undefined) clearTimeout(vaultTimer);
    vaultAbort?.abort();
    vaultAbort = undefined;
    vaultSeq += 1;
  });

  // De-dupe vault hits against messages already loaded in the active conversation.
  // Reactive over loadedMessageIds so incoming messages re-filter cheaply without
  // re-running the debounced fetch above; older same-room rows that only exist in
  // the local vault remain searchable.
  const vaultHits = createMemo((): VaultSearchResult[] => {
    const loaded = loadedMessageKeys();
    return vaultRawHits()
      .filter((hit) => !loaded.has(`${hit.target.toLowerCase()}\n${hit.id}`))
      .slice(0, 25);
  });

  const recallSuggestions = createMemo(() => {
    const query = normalized(messageSearchQuery());
    if (query.length < 2) return [];

    const blocked = new Set(recallTermsFromText(query));
    blocked.add(query);
    const counts = new Map<string, number>();
    for (const result of [...results(), ...vaultHits()]) {
      for (const term of recallTermsFromText(result.text)) {
        if (blocked.has(term)) continue;
        counts.set(term, (counts.get(term) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .sort(([aTerm, aCount], [bTerm, bCount]) => bCount - aCount || aTerm.localeCompare(bTerm))
      .slice(0, SEARCH_RECALL_LIMIT)
      .map(([term]) => term);
  });

  function openVaultResult(result: VaultSearchResult): void {
    getState().openVaultResult(result.target, result.id);
    closeMessageSearch();
  }

  function openServerResult(result: MessageSearchResult): void {
    const state = getState();
    const view = state.activeView;
    const target = searchTarget();
    if (
      target === null
      || !sameSearchTarget(result.target, target)
    ) return;
    // SEARCH is target-bound, but explicitly navigate before hydration so this
    // remains correct if the active view changes between response and click.
    if (view.kind === 'channel') {
      state.navigate({ kind: 'channel', channel: result.target });
    } else if (view.kind === 'dm') {
      state.navigate({ kind: 'dm', nick: result.target });
    } else {
      return;
    }
    state.travelTo(result.target, result.time, result.id);
    state.focusMessage(result.id);
    closeMessageSearch();
  }

  function move(delta: number): void {
    const count = resultCount();
    if (count === 0) return;
    setMessageSearchActiveIndex((index) => (index + delta + count) % count);
  }

  return {
    canServerSearch,
    serverSearchBlockedByE2ee,
    serverStatus,
    serverResults,
    serverError: () => serverSearchMatchesContext() ? serverSearch().error : null,
    serverNotice: () => serverSearchMatchesContext() ? serverSearch().notice ?? null : null,
    runServerSearch,
    isOpen: isMessageSearchOpen,
    focusRequest: messageSearchFocusRequest,
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
    localHistoryEnabled: () => preferences().localHistory,
    vaultResults: vaultHits,
    vaultStatus,
    vaultMode: vaultSearchMode,
    toggleVaultMode,
    setVaultMode,
    recallSuggestions,
    applyRecallSuggestion: setQuery,
    openVaultResult,
    openServerResult,
    open: openMessageSearch,
    close: closeMessageSearch,
    next: () => move(1),
    previous: () => move(-1),
  };
}
