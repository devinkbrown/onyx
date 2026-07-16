// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readClientExtensionActions, recordClientExtensionActionRun } from '@/lib/extensions/clientActions';
import { closePreferences, openPreferences, preferences, resetPreferences } from '@/lib/prefs/preferences';
import { sceneMotion, setSceneMotion } from '@/lib/prefs/sceneMotion';
import { defaultVaultSearchMode, resetDefaultVaultSearchMode } from '@/lib/prefs/vaultSearchMode';
import { setVaultMode, vaultSearchMode } from '@/shell/search/useMessageSearch';
import { store } from '@/lib/store/store';
import {
  _resetVaultForTests,
  getRetentionPolicy,
  loadRecent,
  loadOutbox,
  queueOutbox,
  saveMessages,
  setRetentionPolicy,
} from '@/lib/vault/historyVault';
import * as historyVault from '@/lib/vault/historyVault';
import {
  _resetSavedSearchesForTests,
  deleteSearch as deleteScopedSearch,
  listSearches as listScopedSearches,
  saveSearch as saveScopedSearch,
  type SavedSearchInput,
} from '@/lib/vault/savedSearches';
import { RETENTION_POLICY_STORAGE_KEY } from '@/lib/vault/retentionPolicy';
import {
  markTopicRead as markScopedTopicRead,
  readTopicReadMarker as readScopedTopicReadMarker,
  readTopicReadLedger as readScopedTopicReadLedger,
  TOPIC_READ_LEDGER_KEY,
} from '@/lib/topics/topicReadLedger';
import {
  FOLLOWED_STORAGE_KEY,
  clearFollowed as clearScopedFollowed,
  follow as followScoped,
  isFollowed as isScopedFollowed,
} from '@/lib/notifications/followed';
import {
  readReviewHistory as readScopedReviewHistory,
  recordReviewHistory as recordScopedReviewHistory,
  REVIEW_HISTORY_KEY,
} from '@/lib/notifications/reviewHistory';
import type { ReviewHistoryEntry } from '@/lib/notifications/reviewHistory';
import type { ChatMessage } from '@/lib/irc/types';
import {
  loadComposerDrafts,
  saveComposerDrafts,
} from '@/lib/composer/drafts';
import {
  CHANNEL_TOPIC_DRAFTS_KEY,
  loadChannelTopicDrafts,
  saveChannelTopicDrafts,
} from '@/lib/channel/topicDrafts';
import {
  loadCredentials,
  saveCredentials,
  storeMeshToken,
  storeSessionToken,
} from '@/lib/credentials';
import { PreferencesPanel } from './PreferencesPanel';
import { AppearancePanel } from './AppearancePanel';
import { PORTABLE_JSON_MAX_FILE_BYTES } from './importFileLimits';
import * as portableTransfer from '@/lib/vault/portableTransfer';
import type { PortableTransferSnapshot } from '@/lib/vault/portableTransfer';
import * as portableCompression from '@/lib/vault/portableCompression';
import * as portableShare from '@/lib/vault/portableShare';
import * as portableFileSave from '@/lib/vault/portableFileSave';
import { deviceMemoryStorageKey } from '@/lib/deviceMemoryOwner';

const MEMORY_OWNER = { serverUrl: 'wss://preferences.example/ws', identity: 'testuser' } as const;
const TOPIC_READ_STORAGE_KEY = deviceMemoryStorageKey(TOPIC_READ_LEDGER_KEY, MEMORY_OWNER)!;
const FOLLOWED_OWNER_STORAGE_KEY = deviceMemoryStorageKey(FOLLOWED_STORAGE_KEY, MEMORY_OWNER)!;

function markTopicRead(
  channel: string,
  topic: string,
  message: Parameters<typeof markScopedTopicRead>[2],
) {
  return markScopedTopicRead(channel, topic, message, MEMORY_OWNER);
}

function readTopicReadMarker(channel: string, topic: string) {
  return readScopedTopicReadMarker(channel, topic, MEMORY_OWNER);
}

function readTopicReadLedger() {
  return readScopedTopicReadLedger(MEMORY_OWNER);
}

function clearFollowed() {
  return clearScopedFollowed(MEMORY_OWNER);
}

function follow(target: string, topic?: string | null) {
  return followScoped(target, topic, MEMORY_OWNER);
}

function isFollowed(target: string, topic?: string | null) {
  return isScopedFollowed(target, topic, MEMORY_OWNER);
}

function readReviewHistory(): ReviewHistoryEntry[] {
  return readScopedReviewHistory(MEMORY_OWNER);
}

function recordReviewHistory(entry: ReviewHistoryEntry): ReviewHistoryEntry[] {
  return recordScopedReviewHistory(entry, MEMORY_OWNER);
}

function listSearches() {
  return listScopedSearches(MEMORY_OWNER);
}

function saveSearch(input: SavedSearchInput) {
  return saveScopedSearch(input, MEMORY_OWNER);
}

function deleteSearch(id: string) {
  return deleteScopedSearch(id, MEMORY_OWNER);
}

function emptyPortableSnapshot(): PortableTransferSnapshot {
  return {
    kind: 'onyx-vault',
    version: 1,
    exportedAt: '2026-07-16T00:00:00.000Z',
    targets: [],
    reviewHistory: [],
    composerDrafts: {},
    channelTopicDrafts: {},
    accountHandoffs: [],
    preferenceHandoff: null,
    followedConversations: [],
    topicReadCursors: [],
    savedSearches: [],
  };
}

const emptyPortableImportResult = {
  targets: 0,
  messages: 0,
  reviews: 0,
  drafts: 0,
  topicDrafts: 0,
  accountHandoffs: 0,
  preferenceHandoffs: 0,
  followedConversations: 0,
  topicReadCursors: 0,
  savedSearches: 0,
};

async function stageEmptyPortableImport(): Promise<void> {
  const file = new File(
    [JSON.stringify(emptyPortableSnapshot())],
    'onyx-portable.json',
    { type: 'application/json' },
  );
  fireEvent.change(screen.getByLabelText('Import portable JSON'), { target: { files: [file] } });
  await screen.findByRole('heading', { name: 'Review import' });
}

type PreferenceCategoryLabel =
  | 'Display'
  | 'Conversation'
  | 'History & data'
  | 'Import & export'
  | 'App & tools'
  | 'Accessibility';

function selectPreferenceCategory(category: PreferenceCategoryLabel): HTMLElement {
  const tab = screen.getByRole('tab', { name: new RegExp(`^${category}`) });
  fireEvent.click(tab);
  return tab;
}

function renderPreferences(category: PreferenceCategoryLabel = 'Display') {
  openPreferences();
  const view = render(() => <PreferencesPanel />);
  if (category !== 'Display') selectPreferenceCategory(category);
  return view;
}

describe('PreferencesPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    clearFollowed();
    resetPreferences();
    resetDefaultVaultSearchMode();
    setVaultMode('hybrid');
    setRetentionPolicy(null);
    closePreferences();
    store.setState({
      showAppearance: false,
      composerDrafts: {},
      ourNick: MEMORY_OWNER.identity,
      server: {
        id: 'preferences-test',
        name: 'Preferences',
        network: 'Preferences',
        url: MEMORY_OWNER.serverUrl,
        icon: '',
        nick: MEMORY_OWNER.identity,
        account: MEMORY_OWNER.identity,
        connected: true,
      },
    });
  });

  afterEach(() => {
    cleanup();
    closePreferences();
    resetDefaultVaultSearchMode();
    setVaultMode('hybrid');
    setRetentionPolicy(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    clearFollowed();
    store.setState({ showAppearance: false, composerDrafts: {} });
  });

  it('shows one selected category pane instead of one giant settings scroll', () => {
    renderPreferences();

    const tabs = screen.getAllByRole('tab');
    const categoryNav = screen.getByRole('navigation', { name: 'Preference categories' });
    expect(tabs).toHaveLength(6);
    expect(screen.getByRole('tablist', { name: 'Preference categories' })).toHaveAttribute('aria-orientation', 'vertical');
    expect(categoryNav).toBeInTheDocument();
    expect(within(categoryNav).queryByRole('button', { name: 'Reset to defaults' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Display/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /^Display/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Display');
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(6);
    expect(screen.getByRole('button', { name: /Theme and background/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export vault' })).not.toBeInTheDocument();

    selectPreferenceCategory('History & data');

    expect(screen.getByRole('tab', { name: /^History & data/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /^History & data/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: /^Display/ })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('History & data');
    expect(screen.queryByRole('button', { name: 'Export vault' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Theme and background/i })).not.toBeInTheDocument();

    selectPreferenceCategory('Import & export');

    expect(screen.getByRole('tab', { name: /^Import & export/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Import & export');
    expect(screen.getByRole('button', { name: 'Export vault' })).toBeInTheDocument();
    expect(screen.getByLabelText('Import portable JSON')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear local history' })).not.toBeInTheDocument();
  });

  it('preserves a staged portable import while navigating through mounted categories', async () => {
    renderPreferences('Import & export');
    await stageEmptyPortableImport();
    const review = screen.getByRole('group', { name: 'Review import' });

    selectPreferenceCategory('History & data');
    expect(screen.queryByRole('group', { name: 'Review import' })).not.toBeInTheDocument();
    expect(within(document.getElementById('pref-category-panel-transfer')!).getByRole('group', {
      name: 'Review import',
      hidden: true,
    })).toBe(review);

    selectPreferenceCategory('Import & export');
    expect(screen.getByRole('group', { name: 'Review import' })).toBe(review);
  });

  it('moves focus into a portable import review and returns it after cancellation', async () => {
    renderPreferences('Import & export');
    const input = screen.getByLabelText('Import portable JSON');
    input.focus();

    await stageEmptyPortableImport();

    const reviewHeading = screen.getByRole('heading', { name: 'Review import' });
    await waitFor(() => expect(reviewHeading).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));

    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByText('Import cancelled.')).toHaveAttribute('role', 'status');
  });

  it('moves category selection and focus with tab-list navigation keys', () => {
    renderPreferences();
    const display = screen.getByRole('tab', { name: /^Display/ });
    display.focus();

    fireEvent.keyDown(display, { key: 'ArrowRight' });
    expect(display).toHaveFocus();
    expect(display).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(display, { key: 'ArrowDown' });
    const conversation = screen.getByRole('tab', { name: /^Conversation/ });
    expect(conversation).toHaveFocus();
    expect(conversation).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Conversation');

    fireEvent.keyDown(conversation, { key: 'End' });
    const accessibility = screen.getByRole('tab', { name: /^Accessibility/ });
    expect(accessibility).toHaveFocus();
    expect(accessibility).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(accessibility, { key: 'Home' });
    expect(display).toHaveFocus();
    expect(display).toHaveAttribute('aria-selected', 'true');

    const history = selectPreferenceCategory('History & data');
    history.focus();
    fireEvent.keyDown(history, { key: 'ArrowDown' });
    const transfer = screen.getByRole('tab', { name: /^Import & export/ });
    expect(transfer).toHaveFocus();
    expect(transfer).toHaveAttribute('aria-selected', 'true');
  });

  it('uses horizontal arrow keys on mobile and disposes its responsive listener', () => {
    let categoryTabsListener: ((event: MediaQueryListEvent) => void) | undefined;
    const removeEventListener = vi.fn();
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 42rem)',
      media: query,
      onchange: null,
      addEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (query === '(max-width: 42rem)' && type === 'change') categoryTabsListener = listener;
      },
      removeEventListener,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList));

    const view = renderPreferences();
    const tablist = screen.getByRole('tablist', { name: 'Preference categories' });
    const display = screen.getByRole('tab', { name: /^Display/ });
    display.focus();

    expect(tablist).toHaveAttribute('aria-orientation', 'horizontal');
    fireEvent.keyDown(display, { key: 'ArrowDown' });
    expect(display).toHaveFocus();

    fireEvent.keyDown(display, { key: 'ArrowRight' });
    const conversation = screen.getByRole('tab', { name: /^Conversation/ });
    expect(conversation).toHaveFocus();
    expect(conversation).toHaveAttribute('aria-selected', 'true');

    categoryTabsListener?.({ matches: false } as MediaQueryListEvent);
    expect(tablist).toHaveAttribute('aria-orientation', 'vertical');

    view.unmount();
    expect(removeEventListener).toHaveBeenCalledWith('change', categoryTabsListener);
  });

  it('fully reveals a category selected with mobile arrow navigation', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 42rem)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as MediaQueryList));
    const revealed: string[] = [];
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      window.HTMLElement.prototype,
      'scrollIntoView',
    );
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      value(this: HTMLElement) {
        revealed.push(this.getAttribute('aria-label') ?? '');
      },
      configurable: true,
    });

    try {
      renderPreferences();
      await waitFor(() => expect(revealed).toContain('Display'));
      revealed.length = 0;
      const display = screen.getByRole('tab', { name: /^Display/ });
      display.focus();

      fireEvent.keyDown(display, { key: 'ArrowRight' });

      await waitFor(() => expect(revealed).toEqual(['Conversation']));

      revealed.length = 0;
      openPreferences('accessibility');

      await waitFor(() => expect(revealed).toEqual(['Accessibility']));
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
      } else {
        delete (window.HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
      }
    }
  });

  it('reveals a retained mobile category on reopen without stealing initial focus', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 42rem)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as MediaQueryList));
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      window.HTMLElement.prototype,
      'scrollIntoView',
    );
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
    });

    try {
      renderPreferences();
      selectPreferenceCategory('Accessibility');
      closePreferences();
      expect(screen.queryByRole('dialog', { name: 'Preferences' })).not.toBeInTheDocument();
      scrollIntoView.mockClear();

      openPreferences();

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /^Accessibility/ })).toHaveAttribute('aria-selected', 'true');
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'center' });
        expect(screen.getByRole('button', { name: 'Close preferences' })).toHaveFocus();
      });
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
      } else {
        delete (window.HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
      }
    }
  });

  it('opens category-specific entry points while ordinary reopens retain the last category', async () => {
    renderPreferences('Accessibility');
    closePreferences();

    openPreferences('history');

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /^History & data/ })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel')).toHaveAccessibleName('History & data');
    });

    selectPreferenceCategory('Accessibility');
    openPreferences('history');

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /^History & data/ })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel')).toHaveAccessibleName('History & data');
    });

    closePreferences();
    openPreferences();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /^History & data/ })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel')).toHaveAccessibleName('History & data');
    });
  });

  it('moves focus out of a pane hidden by programmatic category routing', async () => {
    renderPreferences('Accessibility');
    const reduceMotion = screen.getByRole('switch', { name: 'Reduce motion' });
    reduceMotion.focus();

    openPreferences('history');

    const historyTab = screen.getByRole('tab', { name: /^History & data/ });
    await waitFor(() => {
      expect(historyTab).toHaveAttribute('aria-selected', 'true');
      expect(historyTab).toHaveFocus();
      expect(reduceMotion.closest('[role="tabpanel"]')).toHaveAttribute('hidden');
    });
  });

  it('resets category scroll while preserving tab focus and mounted pane state', () => {
    renderPreferences('History & data');
    fireEvent.click(screen.getByRole('button', { name: 'Clear local history' }));
    const confirmation = screen.getByRole('group', { name: 'Confirm clear local history' });
    const sheetBody = document.querySelector<HTMLElement>('.onyx-sheet__body');
    expect(sheetBody).not.toBeNull();
    const scrollTo = vi.spyOn(sheetBody!, 'scrollTo');
    sheetBody!.scrollTop = 480;
    const history = screen.getByRole('tab', { name: /^History & data/ });
    history.focus();

    fireEvent.keyDown(history, { key: 'ArrowUp' });

    const conversation = screen.getByRole('tab', { name: /^Conversation/ });
    expect(conversation).toHaveFocus();
    expect(conversation).toHaveAttribute('aria-selected', 'true');
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.queryByRole('group', { name: 'Confirm clear local history' })).not.toBeInTheDocument();
    const historyPanel = document.getElementById('pref-category-panel-history');
    expect(historyPanel).toHaveAttribute('hidden');
    expect(within(historyPanel!).getByRole('group', {
      name: 'Confirm clear local history',
      hidden: true,
    })).toBe(confirmation);

    fireEvent.keyDown(conversation, { key: 'ArrowDown' });

    expect(history).toHaveFocus();
    expect(screen.getByRole('group', { name: 'Confirm clear local history' })).toBe(confirmation);
  });

  it('traps focus around visible controls while inactive category panes stay mounted', () => {
    renderPreferences();
    const close = screen.getByRole('button', { name: 'Close preferences' });
    const lastVisible = screen.getByRole('radio', { name: '24-hour' });

    lastVisible.focus();
    fireEvent.keyDown(lastVisible, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(lastVisible).toHaveFocus();
  });

  it('surfaces the client accessibility audit ledger', () => {
    renderPreferences();

    expect(screen.getByTestId('preferences-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Theme and background/i })).toBeInTheDocument();
    expect(screen.getByText('Open Appearance for themes, room atmosphere, shared theme import, and background selection.')).toBeInTheDocument();
    selectPreferenceCategory('Conversation');
    expect(screen.getByRole('heading', { name: 'Conversation' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Show 24-hour activity strip/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /Show join voice\/video controls/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /Show topic, forum, and follow controls/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: /Show shared watch activity/i })).toHaveAttribute('aria-checked', 'true');
    selectPreferenceCategory('Import & export');
    expect(screen.getByRole('heading', { name: 'Portable vault' })).toBeInTheDocument();
    expect(screen.getByText(/Saved query text is included/i)).toBeInTheDocument();
    expect(screen.getByText(/Read cursors contain only room\/topic, message ID, and timestamp metadata/i)).toBeInTheDocument();
    expect(screen.getByText(/decrypted DM plaintext are not exported automatically/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export vault' })).toBeInTheDocument();
    expect(screen.getByLabelText('Import portable JSON')).toHaveAttribute('type', 'file');
    selectPreferenceCategory('History & data');
    const reviewedAnchors = screen.getByRole('heading', { name: 'Reviewed catch-up anchors' }).closest('section');
    expect(reviewedAnchors).not.toBeNull();
    expect(within(reviewedAnchors!).getByText('0 reviewed anchors')).toBeInTheDocument();
    expect(within(reviewedAnchors!).getByRole('button', { name: 'Clear reviewed anchors' })).toBeInTheDocument();
    selectPreferenceCategory('App & tools');
    expect(screen.getByRole('heading', { name: 'Installed app readiness' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Install guide' })).toHaveAttribute('href', '/install/');
    expect(screen.getByRole('button', { name: 'Refresh app shell' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Installed app readiness checks' })).toBeInTheDocument();
    expect(screen.getByText('App window')).toBeInTheDocument();
    expect(screen.getByText('Service worker')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Local state')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Extension action audit' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Extension actions' })).toBeInTheDocument();
    expect(screen.getByLabelText('Action manifest JSON')).toBeInTheDocument();
    expect(screen.getByText('No extension actions recorded on this device.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Local language tools' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Local language tools provenance: This device/i)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Local language tool readiness' })).toBeInTheDocument();
    expect(screen.getByText('Caption transcript copy')).toBeInTheDocument();
    expect(screen.getByText('Live caption overlays can copy the current transcript from local client state.')).toBeInTheDocument();
    expect(screen.getByText(/No browser local translator detected|Browser local translator available/)).toBeInTheDocument();
    expect(screen.getByText(/will not send message text to an external translation endpoint|on-device translator/)).toBeInTheDocument();
    selectPreferenceCategory('Accessibility');
    expect(screen.getByRole('heading', { name: 'Client access audit' })).toBeInTheDocument();
    expect(screen.getByText('Connect')).toBeInTheDocument();
    expect(screen.getByText('Channel settings')).toBeInTheDocument();
    expect(screen.getByText('Voice controls')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Home catch-up')).toBeInTheDocument();
    expect(screen.getByText('Message search')).toBeInTheDocument();
    expect(screen.getByText('Notification center')).toBeInTheDocument();
    expect(screen.getByText('Channel browser')).toBeInTheDocument();
    expect(screen.getByText('Account panel')).toBeInTheDocument();
    expect(screen.getByText('Channel sidebar')).toBeInTheDocument();
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Command palette')).toBeInTheDocument();
    expect(screen.getByText('Pinned messages')).toBeInTheDocument();
    expect(screen.getByText('Theme import')).toBeInTheDocument();
    expect(screen.getByText('Thread panel')).toBeInTheDocument();
    expect(screen.getByText('Voice settings')).toBeInTheDocument();
    expect(screen.getByText('Call overlays')).toBeInTheDocument();
    expect(screen.getByText('Message actions')).toBeInTheDocument();
    expect(screen.getByText('Member list')).toBeInTheDocument();
    expect(screen.getByText('Notification controls')).toBeInTheDocument();
    expect(screen.getByText('Channel-scoped scrubber region, labelled UTC-hour jump buttons, date jump input, and target-specific moment copy action.')).toBeInTheDocument();
    expect(screen.getByText('Mobile drawers')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Reduce transparency/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Flatten glassy overlays and translucent panels for stronger separation from the background.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Raise interface contrast/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Strengthens text, borders, focus outlines, and panel separation across the active theme.')).toBeInTheDocument();
    expect(screen.getByText('Labelled Sheet, topic form, switch-mode flags, read-only non-op fallbacks.')).toBeInTheDocument();
    expect(screen.getByText('Toolbar groups, labelled icon buttons, aria-pressed media states, live timer.')).toBeInTheDocument();
    expect(screen.getByText('Theme and background radio groups, labelled swatches, Sheet focus trap.')).toBeInTheDocument();
    expect(screen.getByText('Catch-up recaps, reviewed ranges, and channel directory cards expose list semantics and labelled actions.')).toBeInTheDocument();
    expect(screen.getByText('Search landmark, labelled result navigation, and named archived/device-memory result lists.')).toBeInTheDocument();
    expect(screen.getByText('Named inbox dialog, labelled notification list, and row-specific open/dismiss actions.')).toBeInTheDocument();
    expect(screen.getByText('Sheet dialog, named directory search, labelled public-channel list, and target-specific Join/Open actions.')).toBeInTheDocument();
    expect(screen.getByText('Named account-management regions, alert/status feedback, and target-specific persona actions.')).toBeInTheDocument();
    expect(screen.getByText('Complementary navigation landmark, roving channel/DM rows, unread/mention names, and target-specific join action.')).toBeInTheDocument();
    expect(screen.getByText('Named shortcuts dialog, labelled close action, grouped live keymap lists, and J/K transcript navigation.')).toBeInTheDocument();
    expect(screen.getByText('Named pins dialog, channel-specific pins list, target-specific jump buttons, and real unpin controls.')).toBeInTheDocument();
    expect(screen.getByText('Named import/share dialog, described theme-code input, target-specific import and copy actions, and invalid-code feedback.')).toBeInTheDocument();
    expect(screen.getByText('Named thread Sheet, labelled parent/reply articles, and reply log scoped to the source message.')).toBeInTheDocument();
    expect(screen.getByText('Named settings Sheet, labelled device/processing/PTT regions, described selects, and target-specific PTT key actions.')).toBeInTheDocument();
    expect(screen.getByText('Named incoming/outgoing call dialogs with target-specific accept, decline, and cancel actions.')).toBeInTheDocument();
    expect(screen.getByText('Per-message action groups, named reaction/overflow triggers, labelled menus, and row-specific action names.')).toBeInTheDocument();
    expect(screen.getByText('Channel-scoped member landmark, labelled role groups, named detail dialogs, and target-specific member actions.')).toBeInTheDocument();
    expect(screen.getByText('Labelled compact control group, described calm-mode radios, and pressed-state desktop/sound/push/DND toggles.')).toBeInTheDocument();
    expect(screen.getByText('Channel-scoped scrubber region, labelled UTC-hour jump buttons, date jump input, and target-specific moment copy action.')).toBeInTheDocument();
    expect(screen.getByText('Bottom-nav trigger handoff, drawer-initial focus, Escape close, Tab trap, and trigger focus restore.')).toBeInTheDocument();
    expect(screen.queryByText(/still need a pass/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Public ledger' })).toHaveAttribute(
      'href',
      '/accessibility/',
    );
  });

  it('keeps the client access ledger compact until its evidence is requested', () => {
    renderPreferences('Accessibility');

    const summary = screen.getByText('25 surfaces checked · Review audit details');
    const disclosure = summary.closest('details');
    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute('open');

    fireEvent.click(summary);

    expect(disclosure).toHaveAttribute('open');
    expect(within(disclosure!).getByRole('list')).toHaveAttribute('aria-label', 'Audited client surfaces');
  });

  it('downloads one portable vault through an attached anchor and releases its object URL', async () => {
    let resolveExport: (snapshot: PortableTransferSnapshot) => void = () => {};
    const pendingExport = new Promise<PortableTransferSnapshot>((resolve) => {
      resolveExport = resolve;
    });
    const exportPortableTransfer = vi.spyOn(portableTransfer, 'exportPortableTransfer')
      .mockReturnValue(pendingExport);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:onyx-portable');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const activatedAnchors: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      activatedAnchors.push(this);
      expect(this.isConnected).toBe(true);
      this.focus();
    });
    renderPreferences('Import & export');

    const exportButton = screen.getByRole('button', { name: 'Export vault' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close preferences' })).toHaveFocus());
    exportButton.focus();
    fireEvent.click(exportButton);
    fireEvent.click(exportButton);

    expect(exportPortableTransfer).toHaveBeenCalledTimes(1);
    expect(exportButton).toBeDisabled();
    expect(exportButton).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Preparing portable vault export…')).toHaveAttribute('role', 'status');

    resolveExport(emptyPortableSnapshot());
    expect(await screen.findByText(/^Exported 0 messages/)).toBeInTheDocument();
    expect(click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(activatedAnchors).toHaveLength(1);
    expect(activatedAnchors[0]?.download).toMatch(/^onyx-portable-\d{4}-\d{2}-\d{2}\.json$/);
    expect(activatedAnchors[0]?.isConnected).toBe(false);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:onyx-portable'));
    expect(screen.getByRole('button', { name: 'Export vault' })).not.toBeDisabled();
    await waitFor(() => expect(exportButton).toHaveFocus());
  });

  it('preserves newer category focus when a pending download finishes', async () => {
    let resolveExport: (snapshot: PortableTransferSnapshot) => void = () => {};
    const pendingExport = new Promise<PortableTransferSnapshot>((resolve) => {
      resolveExport = resolve;
    });
    vi.spyOn(portableTransfer, 'exportPortableTransfer').mockReturnValue(pendingExport);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:focus-portable');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      this.focus();
    });
    renderPreferences('Import & export');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close preferences' })).toHaveFocus());
    const exportButton = screen.getByRole('button', { name: 'Export vault' });
    exportButton.focus();
    fireEvent.click(exportButton);
    const history = selectPreferenceCategory('History & data');
    history.focus();

    resolveExport(emptyPortableSnapshot());
    await pendingExport;

    await waitFor(() => expect(history).toHaveFocus());
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('History & data');
  });

  it('cleans up the anchor and object URL when download activation fails', async () => {
    vi.spyOn(portableTransfer, 'exportPortableTransfer').mockResolvedValue(emptyPortableSnapshot());
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed-portable');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const activatedAnchors: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      activatedAnchors.push(this);
      this.focus();
      throw new Error('downloads blocked');
    });
    renderPreferences('Import & export');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close preferences' })).toHaveFocus());
    const exportButton = screen.getByRole('button', { name: 'Export vault' });
    exportButton.focus();

    fireEvent.click(exportButton);

    expect(await screen.findByRole('alert')).toHaveTextContent('Export failed');
    expect(activatedAnchors).toHaveLength(1);
    expect(activatedAnchors[0]?.isConnected).toBe(false);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:failed-portable'));
    expect(screen.getByRole('button', { name: 'Export vault' })).not.toBeDisabled();
    await waitFor(() => expect(exportButton).toHaveFocus());
  });

  it('does not activate a stale export after the Preferences panel unmounts', async () => {
    let resolveExport: (snapshot: PortableTransferSnapshot) => void = () => {};
    const pendingExport = new Promise<PortableTransferSnapshot>((resolve) => {
      resolveExport = resolve;
    });
    vi.spyOn(portableTransfer, 'exportPortableTransfer').mockReturnValue(pendingExport);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stale-portable');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const view = renderPreferences('Import & export');

    fireEvent.click(screen.getByRole('button', { name: 'Export vault' }));
    expect(screen.getByText('Preparing portable vault export…')).toHaveAttribute('role', 'status');
    view.unmount();

    resolveExport(emptyPortableSnapshot());
    await pendingExport;
    await Promise.resolve();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it('offers gzip as a secondary export with a safe filename and the same URL cleanup', async () => {
    vi.spyOn(portableCompression, 'supportsPortableGzip').mockReturnValue(true);
    vi.spyOn(portableTransfer, 'exportPortableTransfer').mockResolvedValue(emptyPortableSnapshot());
    const compressedBlob = new Blob(['compressed'], { type: 'application/gzip' });
    const compressPortableJson = vi.spyOn(portableCompression, 'compressPortableJson')
      .mockResolvedValue(compressedBlob);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:compressed-portable');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const activatedAnchors: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      activatedAnchors.push(this);
      expect(this.isConnected).toBe(true);
    });
    renderPreferences('Import & export');

    fireEvent.click(screen.getByRole('button', { name: 'Export compressed vault' }));

    expect(await screen.findByText(/^Exported compressed 0 messages/)).toBeInTheDocument();
    expect(compressPortableJson).toHaveBeenCalledOnce();
    expect(JSON.parse(compressPortableJson.mock.calls[0]?.[0] ?? '{}')).toMatchObject({ kind: 'onyx-vault' });
    expect(createObjectURL).toHaveBeenCalledWith(compressedBlob);
    expect(activatedAnchors).toHaveLength(1);
    expect(activatedAnchors[0]?.download).toMatch(/^onyx-portable-\d{4}-\d{2}-\d{2}\.json\.gz$/);
    expect(activatedAnchors[0]?.isConnected).toBe(false);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:compressed-portable'));
    expect(screen.getByRole('button', { name: 'Export vault' })).toBeInTheDocument();
  });

  it('keeps ordinary JSON available when Compression Streams are unsupported', () => {
    vi.spyOn(portableCompression, 'supportsPortableGzip').mockReturnValue(false);
    renderPreferences('Import & export');

    expect(screen.getByRole('button', { name: 'Export vault' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export compressed vault' })).not.toBeInTheDocument();
    expect(screen.getByText('Compressed export unavailable; ordinary JSON remains portable.')).toBeInTheDocument();
  });

  it('saves JSON through the explicit file picker action without replacing the download export', async () => {
    vi.spyOn(portableFileSave, 'supportsPortableFileSave').mockReturnValue(true);
    const exportPortableTransfer = vi.spyOn(portableTransfer, 'exportPortableTransfer')
      .mockResolvedValue(emptyPortableSnapshot());
    const savePortableVaultFile = vi.spyOn(portableFileSave, 'savePortableVaultFile')
      .mockImplementation(async (saveRequest) => {
        const blob = await saveRequest.createBlob();
        expect(blob.type).toBe('application/json');
        return { state: 'saved', detail: 'Portable vault saved.' };
      });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    renderPreferences('Import & export');

    const saveButton = screen.getByRole('button', { name: 'Save vault to file' });
    expect(screen.getByRole('button', { name: 'Export vault' })).toBeInTheDocument();
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(savePortableVaultFile).toHaveBeenCalledOnce();
    expect(exportPortableTransfer).toHaveBeenCalledOnce();
    expect(savePortableVaultFile.mock.calls[0]?.[0]).toMatchObject({
      format: 'json',
      suggestedName: expect.stringMatching(/^onyx-portable-\d{4}-\d{2}-\d{2}\.json$/),
    });
    expect(await screen.findByText(/^Saved 0 messages/)).toHaveAttribute('role', 'status');
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save vault to file' })).not.toBeDisabled();
  });

  it('keeps the object-URL download controls unchanged when direct file saving is unsupported', () => {
    vi.spyOn(portableFileSave, 'supportsPortableFileSave').mockReturnValue(false);
    renderPreferences('Import & export');

    expect(screen.getByRole('button', { name: 'Export vault' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save vault to file' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save compressed vault to file' })).not.toBeInTheDocument();
  });

  it('saves compressed JSON with the gzip format and filename', async () => {
    vi.spyOn(portableCompression, 'supportsPortableGzip').mockReturnValue(true);
    vi.spyOn(portableFileSave, 'supportsPortableFileSave').mockReturnValue(true);
    vi.spyOn(portableTransfer, 'exportPortableTransfer').mockResolvedValue(emptyPortableSnapshot());
    const compressedBlob = new Blob(['compressed'], { type: 'application/gzip' });
    const compressPortableJson = vi.spyOn(portableCompression, 'compressPortableJson')
      .mockResolvedValue(compressedBlob);
    const savePortableVaultFile = vi.spyOn(portableFileSave, 'savePortableVaultFile')
      .mockImplementation(async (saveRequest) => {
        expect(await saveRequest.createBlob()).toBe(compressedBlob);
        return { state: 'saved', detail: 'Portable vault saved.' };
      });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    renderPreferences('Import & export');

    fireEvent.click(screen.getByRole('button', { name: 'Save compressed vault to file' }));

    expect(await screen.findByText(/^Saved compressed 0 messages/)).toBeInTheDocument();
    expect(savePortableVaultFile.mock.calls[0]?.[0]).toMatchObject({
      format: 'gzip',
      suggestedName: expect.stringMatching(/^onyx-portable-\d{4}-\d{2}-\d{2}\.json\.gz$/),
    });
    expect(compressPortableJson).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('treats picker cancellation as neutral without preparing an export', async () => {
    vi.spyOn(portableFileSave, 'supportsPortableFileSave').mockReturnValue(true);
    const exportPortableTransfer = vi.spyOn(portableTransfer, 'exportPortableTransfer');
    vi.spyOn(portableFileSave, 'savePortableVaultFile').mockImplementation(async () => {
      const nativePicker = document.createElement('button');
      document.body.append(nativePicker);
      nativePicker.focus();
      nativePicker.remove();
      return {
        state: 'cancelled',
        detail: 'Portable vault save cancelled. No file was changed.',
      };
    });
    renderPreferences('Import & export');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close preferences' })).toHaveFocus());
    const saveButton = screen.getByRole('button', { name: 'Save vault to file' });
    saveButton.focus();

    fireEvent.click(saveButton);

    expect(await screen.findByText('Portable vault save cancelled. No file was changed.')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(exportPortableTransfer).not.toHaveBeenCalled();
    await waitFor(() => expect(saveButton).toHaveFocus());
  });

  it('re-enables direct file saving after a writer failure so the user can retry', async () => {
    vi.spyOn(portableFileSave, 'supportsPortableFileSave').mockReturnValue(true);
    vi.spyOn(portableTransfer, 'exportPortableTransfer').mockResolvedValue(emptyPortableSnapshot());
    const savePortableVaultFile = vi.spyOn(portableFileSave, 'savePortableVaultFile')
      .mockResolvedValueOnce({
        state: 'failed',
        detail: 'The portable vault could not be written. The download export remains available.',
      })
      .mockImplementationOnce(async (saveRequest) => {
        await saveRequest.createBlob();
        return { state: 'saved', detail: 'Portable vault saved.' };
      });
    renderPreferences('Import & export');

    fireEvent.click(screen.getByRole('button', { name: 'Save vault to file' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('download export remains available');
    expect(screen.getByRole('button', { name: 'Save vault to file' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save vault to file' }));
    expect(await screen.findByText(/^Saved 0 messages/)).toBeInTheDocument();
    expect(savePortableVaultFile).toHaveBeenCalledTimes(2);
  });

  it('decompresses a bounded portable gzip before staging the ordinary import review', async () => {
    const decompressPortableJson = vi.spyOn(portableCompression, 'decompressPortableJson')
      .mockResolvedValue(JSON.stringify(emptyPortableSnapshot()));
    renderPreferences('Import & export');
    const file = new File(['gzip bytes'], 'onyx-portable.json.gz', { type: 'application/gzip' });

    fireEvent.change(screen.getByLabelText('Import portable JSON'), { target: { files: [file] } });

    expect(screen.getByText('Decompressing and checking portable vault…')).toHaveAttribute('role', 'status');
    expect(await screen.findByRole('heading', { name: 'Review import' })).toBeInTheDocument();
    expect(decompressPortableJson).toHaveBeenCalledWith(file);
    expect(screen.getByRole('group', { name: 'Review import' })).toHaveTextContent('onyx-portable.json.gz');
  });

  it('rejects an oversized compressed vault before opening its stream', async () => {
    const decompressPortableJson = vi.spyOn(portableCompression, 'decompressPortableJson');
    const stream = vi.fn();
    const file = {
      name: 'oversized-portable.json.gz',
      type: 'application/gzip',
      size: portableCompression.PORTABLE_GZIP_MAX_COMPRESSED_BYTES + 1,
      stream,
    } as unknown as File;
    renderPreferences('Import & export');

    fireEvent.change(screen.getByLabelText('Import portable JSON'), { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'oversized-portable.json.gz exceeds the 16 MiB compressed portable vault limit',
    );
    expect(decompressPortableJson).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it('ignores a stale gzip decompression after Preferences unmounts', async () => {
    let resolveDecompression: (json: string) => void = () => {};
    const pendingDecompression = new Promise<string>((resolve) => {
      resolveDecompression = resolve;
    });
    vi.spyOn(portableCompression, 'decompressPortableJson').mockReturnValue(pendingDecompression);
    const view = renderPreferences('Import & export');
    const file = new File(['gzip bytes'], 'onyx-portable.json.gz', { type: 'application/gzip' });

    fireEvent.change(screen.getByLabelText('Import portable JSON'), { target: { files: [file] } });
    expect(screen.getByText('Decompressing and checking portable vault…')).toBeInTheDocument();
    view.unmount();
    resolveDecompression(JSON.stringify(emptyPortableSnapshot()));
    await pendingDecompression;
    await Promise.resolve();

    expect(screen.queryByRole('heading', { name: 'Review import' })).not.toBeInTheDocument();
  });

  it('shares a bounded portable vault once from the explicit secondary action', async () => {
    let resolveExport: (snapshot: PortableTransferSnapshot) => void = () => {};
    const pendingExport = new Promise<PortableTransferSnapshot>((resolve) => {
      resolveExport = resolve;
    });
    vi.spyOn(portableShare, 'supportsPortableFileShare').mockReturnValue(true);
    const exportPortableTransfer = vi.spyOn(portableTransfer, 'exportPortableTransfer')
      .mockReturnValue(pendingExport);
    const sharePortableVaultJson = vi.spyOn(portableShare, 'sharePortableVaultJson')
      .mockResolvedValue({ state: 'shared', detail: 'Portable vault file shared.' });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    renderPreferences('Import & export');

    const share = screen.getByRole('button', { name: 'Share vault file' });
    fireEvent.click(share);
    fireEvent.click(share);

    expect(exportPortableTransfer).toHaveBeenCalledOnce();
    expect(share).toBeDisabled();
    expect(share).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Preparing portable vault file to share…')).toHaveAttribute('role', 'status');

    resolveExport(emptyPortableSnapshot());
    expect(await screen.findByText('Portable vault file shared.')).toBeInTheDocument();
    expect(sharePortableVaultJson).toHaveBeenCalledOnce();
    expect(JSON.parse(sharePortableVaultJson.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      kind: 'onyx-vault',
    });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Share vault file' })).not.toBeDisabled();
  });

  it('keeps JSON export first and visible when file sharing is unavailable', () => {
    vi.spyOn(portableShare, 'supportsPortableFileShare').mockReturnValue(false);
    renderPreferences('Import & export');

    expect(screen.getByRole('button', { name: 'Export vault' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share vault file' })).not.toBeInTheDocument();
    expect(screen.getByText('File sharing unavailable; ordinary JSON export remains universal.')).toBeInTheDocument();
  });

  it('announces share cancellation as status and rejection as failure', async () => {
    vi.spyOn(portableShare, 'supportsPortableFileShare').mockReturnValue(true);
    vi.spyOn(portableTransfer, 'exportPortableTransfer').mockResolvedValue(emptyPortableSnapshot());
    const sharePortableVaultJson = vi.spyOn(portableShare, 'sharePortableVaultJson')
      .mockImplementationOnce(async () => {
        const nativeShare = document.createElement('button');
        document.body.append(nativeShare);
        nativeShare.focus();
        nativeShare.remove();
        return { state: 'cancelled', detail: 'Portable vault sharing cancelled.' };
      })
      .mockResolvedValueOnce({ state: 'rejected', detail: 'The browser rejected portable vault sharing. Export ordinary JSON instead.' });
    renderPreferences('Import & export');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close preferences' })).toHaveFocus());
    const shareButton = screen.getByRole('button', { name: 'Share vault file' });
    shareButton.focus();

    fireEvent.click(shareButton);
    expect(await screen.findByText('Portable vault sharing cancelled.')).toHaveAttribute('role', 'status');
    await waitFor(() => expect(shareButton).toHaveFocus());

    fireEvent.click(shareButton);
    expect(await screen.findByText(/browser rejected portable vault sharing/i)).toHaveAttribute('role', 'alert');
    expect(sharePortableVaultJson).toHaveBeenCalledTimes(2);
  });

  it('ignores a share completion after Preferences unmounts', async () => {
    let resolveShare: (result: portableShare.PortableShareResult) => void = () => {};
    const pendingShare = new Promise<portableShare.PortableShareResult>((resolve) => {
      resolveShare = resolve;
    });
    vi.spyOn(portableShare, 'supportsPortableFileShare').mockReturnValue(true);
    vi.spyOn(portableTransfer, 'exportPortableTransfer').mockResolvedValue(emptyPortableSnapshot());
    const sharePortableVaultJson = vi.spyOn(portableShare, 'sharePortableVaultJson')
      .mockReturnValue(pendingShare);
    const view = renderPreferences('Import & export');

    fireEvent.click(screen.getByRole('button', { name: 'Share vault file' }));
    await waitFor(() => expect(sharePortableVaultJson).toHaveBeenCalledOnce());
    view.unmount();
    resolveShare({ state: 'shared', detail: 'Portable vault file shared.' });
    await pendingShare;
    await Promise.resolve();

    expect(screen.queryByText('Portable vault file shared.')).not.toBeInTheDocument();
  });

  it('announces failed app-shell recovery as an alert', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: {},
        getRegistration: vi.fn(async () => ({
          waiting: null,
          update: vi.fn(async () => {
            throw new Error('offline');
          }),
        })),
      },
    });
    renderPreferences('App & tools');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh app shell' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Update recovery could not complete. Use the browser reload control once.',
    );
  });

  it('requests persistent vault storage only from the explicit button and guards rapid clicks', async () => {
    let resolvePersistence: (granted: boolean) => void = () => {};
    const pendingPersistence = new Promise<boolean>((resolve) => {
      resolvePersistence = resolve;
    });
    const persisted = vi.fn().mockResolvedValue(false);
    const persist = vi.fn().mockReturnValue(pendingPersistence);
    vi.stubGlobal('navigator', {
      storage: { persisted, persist },
      serviceWorker: { controller: null },
    });
    renderPreferences('App & tools');

    const request = await screen.findByRole('button', { name: 'Keep vault on this device' });
    expect(persisted).toHaveBeenCalledOnce();
    expect(persist).not.toHaveBeenCalled();

    fireEvent.click(request);
    fireEvent.click(request);
    expect(persist).toHaveBeenCalledOnce();
    expect(request).toBeDisabled();
    expect(request).toHaveAttribute('aria-busy', 'true');
    expect(request).toHaveTextContent('Requesting persistence');

    resolvePersistence(true);
    expect(await screen.findByText(/Persistent storage was granted for Onyx against automatic eviction/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep vault on this device' })).not.toBeInTheDocument();
  });

  it('reports persistent-storage request failure without claiming durability and allows retry', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('browser rejected request'));
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(false),
        persist,
      },
      serviceWorker: { controller: null },
    });
    renderPreferences('App & tools');

    fireEvent.click(await screen.findByRole('button', { name: 'Keep vault on this device' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('must not be assumed durable');
    expect(screen.getByRole('button', { name: 'Keep vault on this device' })).not.toBeDisabled();
  });

  it('ignores a persistent-storage completion after Preferences unmounts', async () => {
    let resolvePersistence: (granted: boolean) => void = () => {};
    const pendingPersistence = new Promise<boolean>((resolve) => {
      resolvePersistence = resolve;
    });
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(false),
        persist: vi.fn().mockReturnValue(pendingPersistence),
      },
      serviceWorker: { controller: null },
    });
    const view = renderPreferences('App & tools');

    fireEvent.click(await screen.findByRole('button', { name: 'Keep vault on this device' }));
    view.unmount();
    resolvePersistence(false);
    await pendingPersistence;
    await Promise.resolve();

    expect(screen.queryByText(/browser did not grant persistent storage/i)).not.toBeInTheDocument();
  });

  it('shows an origin-wide storage estimate and guards rapid refresh clicks', async () => {
    let resolveRefresh: (estimate: StorageEstimate) => void = () => {};
    const pendingRefresh = new Promise<StorageEstimate>((resolve) => {
      resolveRefresh = resolve;
    });
    const estimate = vi.fn()
      .mockResolvedValueOnce({ usage: 12 * 1024 * 1024, quota: 2 * 1024 * 1024 * 1024 })
      .mockReturnValueOnce(pendingRefresh);
    const persist = vi.fn().mockResolvedValue(false);
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(false),
        persist,
        estimate,
      },
      serviceWorker: { controller: null },
    });
    renderPreferences('App & tools');

    expect(await screen.findByText(/12 MiB used of an estimated 2 GiB quota/i)).toHaveTextContent(
      'origin-wide storage, not vault-only',
    );
    expect(persist).not.toHaveBeenCalled();

    const refresh = screen.getByRole('button', { name: 'Refresh storage estimate' });
    fireEvent.click(refresh);
    fireEvent.click(refresh);
    expect(estimate).toHaveBeenCalledTimes(2);
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute('aria-busy', 'true');

    resolveRefresh({ usage: 24 * 1024 * 1024, quota: 2 * 1024 * 1024 * 1024 });
    expect(await screen.findByText(/24 MiB used of an estimated 2 GiB quota/i)).toBeInTheDocument();
  });

  it('reports unsupported origin estimates without a misleading refresh control', async () => {
    const persist = vi.fn().mockResolvedValue(false);
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(false),
        persist,
      },
      serviceWorker: { controller: null },
    });
    renderPreferences('App & tools');

    expect(await screen.findByText(/does not expose an origin storage estimate/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /storage estimate/i })).not.toBeInTheDocument();
    expect(persist).not.toHaveBeenCalled();
  });

  it('surfaces estimate errors and retries without requesting persistence', async () => {
    const estimate = vi.fn()
      .mockRejectedValueOnce(new Error('private mode'))
      .mockResolvedValueOnce({ usage: 3 * 1024 * 1024 });
    const persist = vi.fn().mockResolvedValue(false);
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(false),
        persist,
        estimate,
      },
      serviceWorker: { controller: null },
    });
    renderPreferences('App & tools');

    expect(await screen.findByRole('alert')).toHaveTextContent('browser storage estimate failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry storage estimate' }));
    expect(await screen.findByText(/3 MiB estimated used; quota was not reported/i)).toBeInTheDocument();
    expect(estimate).toHaveBeenCalledTimes(2);
    expect(persist).not.toHaveBeenCalled();
  });

  it('ignores an origin estimate that resolves after Preferences unmounts', async () => {
    let resolveEstimate: (estimate: StorageEstimate) => void = () => {};
    const pendingEstimate = new Promise<StorageEstimate>((resolve) => {
      resolveEstimate = resolve;
    });
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(false),
        persist: vi.fn().mockResolvedValue(false),
        estimate: vi.fn().mockReturnValue(pendingEstimate),
      },
      serviceWorker: { controller: null },
    });
    const view = renderPreferences('App & tools');

    expect(screen.getByText('Checking origin-wide storage usage…')).toBeInTheDocument();
    view.unmount();
    resolveEstimate({ usage: 99 * 1024 * 1024, quota: 1024 * 1024 * 1024 });
    await pendingEstimate;
    await Promise.resolve();

    expect(screen.queryByText(/99 MiB used/i)).not.toBeInTheDocument();
  });

  it('exposes segmented settings as a valid roving-tabindex radio group', () => {
    renderPreferences();

    const group = screen.getByRole('radiogroup', { name: 'Message density' });
    const radios = screen.getAllByRole('radio').filter((radio) => group.contains(radio));
    expect(radios.length).toBe(3);

    // aria-pressed is not a supported state on role="radio" (SC 4.1.2) — it must be gone.
    for (const radio of radios) {
      expect(radio).not.toHaveAttribute('aria-pressed');
    }

    // Exactly one radio is checked and it is the sole tab stop (roving tabindex).
    const checked = radios.filter((radio) => radio.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    const cozy = screen.getByRole('radio', { name: 'Cozy' });
    expect(cozy).toHaveAttribute('aria-checked', 'true');
    expect(cozy).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Compact' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('radio', { name: 'Roomy' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves radio-group selection with arrow keys', () => {
    renderPreferences();

    const group = screen.getByRole('radiogroup', { name: 'Message density' });
    expect(screen.getByRole('radio', { name: 'Cozy' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Roomy' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Roomy' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Cozy' })).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(group, { key: 'Home' });
    expect(screen.getByRole('radio', { name: 'Compact' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(screen.getByRole('radio', { name: 'Roomy' })).toHaveAttribute('aria-checked', 'true');
  });

  it('exposes toggles as switches without a conflicting aria-pressed state', () => {
    renderPreferences('Accessibility');

    const reduceMotion = screen.getByRole('switch', { name: /Reduce motion/i });
    expect(reduceMotion).toHaveAttribute('aria-checked', 'false');
    // aria-pressed is not a supported state on role="switch" (SC 4.1.2).
    expect(reduceMotion).not.toHaveAttribute('aria-pressed');
  });

  it('names toggle switches by their title and moves help text to a description', () => {
    renderPreferences('Accessibility');

    // A role="switch" accessible NAME must be its concise title — the long help
    // text belongs in the accessible description (aria-describedby), matching the
    // Segmented radio group and CalmModeControl. Folding the description into the
    // name (the prior bug) forced every switch query onto a regex substring and
    // made screen readers read a paragraph as the control's name (SC 4.1.2).
    const reduceMotion = screen.getByRole('switch', { name: 'Reduce motion' });
    expect(reduceMotion).toHaveAccessibleName('Reduce motion');
    expect(reduceMotion).toHaveAccessibleDescription(
      'Force-disable animations regardless of your OS setting.',
    );
    // Visible label text stays in the accessible name (SC 2.5.3 Label in Name).
    expect(reduceMotion).toHaveTextContent('Reduce motion');
  });

  it('opens Appearance from Preferences for mobile theming discoverability', () => {
    renderPreferences();

    fireEvent.click(screen.getByRole('button', { name: /Theme and background/i }));

    expect(store.getState().showAppearance).toBe(true);
  });

  it('returns from Appearance to the Preferences launcher without losing the panel', async () => {
    openPreferences();
    render(() => (
      <>
        <AppearancePanel />
        <PreferencesPanel />
      </>
    ));
    const launcher = screen.getByRole('button', { name: /Theme and background/i });
    launcher.focus();

    fireEvent.click(launcher);

    expect(screen.getByRole('dialog', { name: 'Preferences' })).toBeInTheDocument();
    const appearance = screen.getByRole('dialog', { name: 'Appearance' });
    await waitFor(() => expect(within(appearance).getByRole('button', { name: 'Close appearance' })).toHaveFocus());

    fireEvent.click(within(appearance).getByRole('button', { name: 'Close appearance' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Appearance' })).toBeNull();
      expect(screen.getByRole('dialog', { name: 'Preferences' })).toBeInTheDocument();
      expect(launcher).toHaveFocus();
    });
  });

  it('reviews portable vault imports before merging them', async () => {
    renderPreferences('Import & export');

    const snapshot = {
      kind: 'onyx-vault',
      version: 1,
      exportedAt: '2026-07-09T00:00:00.000Z',
      targets: [
        {
          target: '#root',
          messages: [
            {
              id: 'm1',
              time: '2026-07-09T00:00:00.000Z',
              from: 'kain',
              text: 'hello',
              type: 'msg',
              target: '#root',
            },
            {
              id: 'm2',
              time: '2026-07-09T00:01:00.000Z',
              from: 'onyx',
              text: 'world',
              type: 'msg',
              target: '#root',
            },
          ],
        },
      ],
      reviewHistory: [
        {
          target: '#root',
          name: '#root',
          kind: 'channel',
          firstMessageId: 'm1',
          firstAt: '2026-07-09T00:00:00.000Z',
          reviewedAt: '2026-07-09T00:02:00.000Z',
          messageCount: 2,
          mentionCount: 0,
          preview: 'hello world',
        },
      ],
      composerDrafts: {
        '#root': 'draft handoff',
        alice: 'dm draft should be ignored',
      },
      channelTopicDrafts: {
        '#root': 'topic handoff',
        alice: 'ignored non-channel topic draft',
      },
      accountHandoffs: [
        {
          nick: 'kain',
          server: 'wss://eshmaki.me',
          savedAt: '2026-07-09T00:00:00.000Z',
          active: true,
          password: 'must not be trusted',
          sessionToken: 'must not import',
          meshToken: 'must not import',
        },
      ],
      followedConversations: ['#root', '#root/roadmap'],
      topicReadCursors: [
        {
          channel: '#ROOT',
          topic: 'Roadmap',
          lastReadMessageId: 'm1',
          lastReadAt: 1_752_019_200_000,
          text: 'topic cursor preview plaintext',
          sessionToken: 'topic-cursor-preview-secret',
        },
        {
          channel: '#root',
          topic: 'Release train',
          lastReadMessageId: 'm2',
          lastReadAt: 1_752_019_260_000,
        },
        {
          channel: '#bad room',
          topic: 'invalid',
          lastReadMessageId: 'bad',
          lastReadAt: 1_752_019_300_000,
        },
      ],
      preferenceHandoff: {
        preferences: {
          density: 'compact',
          fontScale: 'lg',
          hideEvents: true,
          width: 'full',
          readerMode: true,
          reduceMotion: true,
          reduceTransparency: true,
          highContrast: true,
          linkPreviews: false,
          clock: '12h',
          localHistory: true,
          e2eeDms: true,
          timeScrubber: false,
          voiceEntry: false,
          topicTools: true,
          watchTogether: false,
        },
        sceneMotion: 'off',
        retentionPolicy: { keep: 1000, maxAgeDays: 30 },
      },
    };

    const input = screen.getByLabelText('Import portable JSON') as HTMLInputElement;
    const file = new File([JSON.stringify(snapshot)], 'onyx-portable.json', {
      type: 'application/json',
    });
    await fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole('heading', { name: 'Review import' })).toBeInTheDocument();
    const review = screen.getByRole('group', { name: 'Review import' });
    expect(review).toHaveTextContent('onyx-portable.json: 2 messages, 1 target, 1 review');
    expect(review).toHaveTextContent('1 room draft, 1 topic draft, 2 followed conversations');
    expect(review).toHaveTextContent('2 topic read cursors');
    expect(review).toHaveTextContent('0 saved searches, 1 account handoff, and 1 preference set');
    expect(review).not.toHaveTextContent('topic cursor preview plaintext');
    expect(review).not.toHaveTextContent('topic-cursor-preview-secret');
    expect(screen.getByRole('button', { name: 'Cancel import' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import reviewed file' }));
    expect(await screen.findByText(/Imported .*2 topic read cursors.*1 preference set/i)).toBeInTheDocument();
    expect(readTopicReadMarker('#root', 'roadmap')?.lastReadMessageId).toBe('m1');
    expect(readTopicReadMarker('#root', 'release train')?.lastReadMessageId).toBe('m2');
    selectPreferenceCategory('History & data');
    expect(screen.getByRole('radio', { name: '1,000' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '30 days' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('radio', { name: '90 days' }));
    expect(getRetentionPolicy()).toEqual({ keep: 1000, maxAgeDays: 90 });
  });

  it('rejects an oversized portable JSON file before reading it', async () => {
    renderPreferences('Import & export');
    const text = vi.fn(async () => '{"kind":"onyx-vault"}');
    const file = {
      name: 'huge-portable.json',
      size: PORTABLE_JSON_MAX_FILE_BYTES + 1,
      text,
    } as unknown as File;

    const input = screen.getByLabelText('Import portable JSON');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close preferences' })).toHaveFocus());
    input.focus();
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('huge-portable.json exceeds the 64 MiB portable JSON limit. Choose a smaller portable vault file.');
    expect(input).toHaveFocus();
    expect(text).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Review import' })).not.toBeInTheDocument();
  });

  it('recreates repeated portable validation alerts so assistive technology announces them again', async () => {
    renderPreferences('Import & export');
    const file = {
      name: 'repeat-portable.json',
      size: PORTABLE_JSON_MAX_FILE_BYTES + 1,
      text: vi.fn(async () => '{"kind":"onyx-vault"}'),
    } as unknown as File;
    const input = screen.getByLabelText('Import portable JSON');

    fireEvent.change(input, { target: { files: [file] } });
    const firstAlert = await screen.findByRole('alert');

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByRole('alert')).not.toBe(firstAlert));
    expect(screen.getByRole('alert')).toHaveTextContent('repeat-portable.json exceeds the 64 MiB portable JSON limit.');
  });

  it('keeps a reviewed import staged when another tab holds the import lock', async () => {
    const request = vi.fn(async (
      _name: string,
      _options: LockOptions,
      callback: (held: Lock | null) => Promise<unknown>,
    ) => callback(null));
    vi.stubGlobal('navigator', { locks: { request } });
    const importPortableTransfer = vi.spyOn(portableTransfer, 'importPortableTransfer');
    renderPreferences('Import & export');
    await stageEmptyPortableImport();

    fireEvent.click(screen.getByRole('button', { name: 'Import reviewed file' }));

    const contention = await screen.findByText(/Another Onyx tab is applying a portable vault import/i);
    expect(contention).toHaveAttribute('role', 'status');
    expect(request).toHaveBeenCalledWith(
      'onyx:portable-vault-import',
      { mode: 'exclusive', ifAvailable: true },
      expect.any(Function),
    );
    expect(importPortableTransfer).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Review import' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import reviewed file' })).not.toBeDisabled();
  });

  it('holds one exclusive lock across the full reviewed apply and guards rapid confirmation', async () => {
    let resolveImport: (result: typeof emptyPortableImportResult) => void = () => {};
    const pendingImport = new Promise<typeof emptyPortableImportResult>((resolve) => {
      resolveImport = resolve;
    });
    const request = vi.fn(async (
      _name: string,
      _options: LockOptions,
      callback: (held: Lock | null) => Promise<unknown>,
    ) => callback({ name: 'onyx:portable-vault-import', mode: 'exclusive' } as Lock));
    vi.stubGlobal('navigator', { locks: { request } });
    const importPortableTransfer = vi.spyOn(portableTransfer, 'importPortableTransfer')
      .mockReturnValue(pendingImport);
    renderPreferences('Import & export');
    await stageEmptyPortableImport();

    const confirm = screen.getByRole('button', { name: 'Import reviewed file' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(importPortableTransfer).toHaveBeenCalledOnce());

    expect(request).toHaveBeenCalledOnce();
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Review import' })).toBeInTheDocument();

    resolveImport(emptyPortableImportResult);
    expect(await screen.findByText(/^Imported 0 messages/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Review import' })).not.toBeInTheDocument();
  });

  it('reports lock-manager failure without starting or discarding the reviewed import', async () => {
    const request = vi.fn().mockRejectedValue(new Error('locks disabled'));
    vi.stubGlobal('navigator', { locks: { request } });
    const importPortableTransfer = vi.spyOn(portableTransfer, 'importPortableTransfer');
    renderPreferences('Import & export');
    await stageEmptyPortableImport();

    fireEvent.click(screen.getByRole('button', { name: 'Import reviewed file' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not coordinate this import across tabs');
    expect(importPortableTransfer).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Review import' })).toBeInTheDocument();
  });

  it('ignores reviewed-import completion after Preferences unmounts', async () => {
    let resolveImport: (result: typeof emptyPortableImportResult) => void = () => {};
    const pendingImport = new Promise<typeof emptyPortableImportResult>((resolve) => {
      resolveImport = resolve;
    });
    const request = vi.fn(async (
      _name: string,
      _options: LockOptions,
      callback: (held: Lock | null) => Promise<unknown>,
    ) => callback({ name: 'onyx:portable-vault-import', mode: 'exclusive' } as Lock));
    vi.stubGlobal('navigator', { locks: { request } });
    const importPortableTransfer = vi.spyOn(portableTransfer, 'importPortableTransfer')
      .mockReturnValue(pendingImport);
    const view = renderPreferences('Import & export');
    await stageEmptyPortableImport();

    fireEvent.click(screen.getByRole('button', { name: 'Import reviewed file' }));
    await waitFor(() => expect(importPortableTransfer).toHaveBeenCalledOnce());
    view.unmount();
    resolveImport(emptyPortableImportResult);
    await pendingImport;
    await Promise.resolve();

    expect(screen.queryByText(/^Imported 0 messages/)).not.toBeInTheDocument();
  });

  it('surfaces and clears local extension action audit entries', () => {
    recordClientExtensionActionRun({
      id: 'open.build',
      title: 'Open build dashboard',
      capability: 'open-url',
      url: 'https://example.test/build?token=secret',
      keywords: [],
    });
    renderPreferences('App & tools');

    expect(screen.getByRole('list', { name: 'Recent extension actions' })).toBeInTheDocument();
    expect(screen.getByText('Open build dashboard')).toBeInTheDocument();
    expect(screen.getByText('Opened https://example.test')).toBeInTheDocument();
    expect(screen.queryByText(/token=secret/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.queryByRole('list', { name: 'Recent extension actions' })).not.toBeInTheDocument();
    expect(screen.getByText('No extension actions recorded on this device.')).toBeInTheDocument();
  });

  it('stages a payload-safe extension action preview before explicit verified import', () => {
    renderPreferences('App & tools');

    fireEvent.input(screen.getByLabelText('Action manifest JSON'), {
      target: {
        value: JSON.stringify({
          version: 1,
          actions: [
            {
              id: 'open.status',
              title: 'Open status',
              capability: 'open-url',
              url: 'https://example.test/status/?token=url-secret',
            },
            {
              id: 'copy.room',
              title: 'Copy room',
              capability: 'copy-text',
              text: 'super-secret-token',
            },
            { id: 'bad', title: 'Bad', capability: 'open-url', url: 'javascript:alert(1)' },
          ],
        }),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review actions' }));

    expect(readClientExtensionActions()).toEqual([]);
    const preview = screen.getByRole('list', { name: 'Reviewed extension actions' });
    expect(preview).toHaveTextContent('Open status');
    expect(preview).toHaveTextContent('open-url');
    expect(preview).toHaveTextContent('https://example.test');
    expect(preview).toHaveTextContent('Copy room');
    expect(preview).toHaveTextContent('copy-text');
    expect(preview).toHaveTextContent('18 characters');
    expect(preview).not.toHaveTextContent('/status');
    expect(preview).not.toHaveTextContent('url-secret');
    expect(preview).not.toHaveTextContent('super-secret-token');

    fireEvent.click(screen.getByRole('button', { name: 'Import reviewed actions' }));

    expect(screen.getByText('Imported 2 safe actions.')).toBeInTheDocument();
    expect(readClientExtensionActions().map((action) => action.id)).toEqual(['open.status', 'copy.room']);

    fireEvent.click(screen.getByRole('button', { name: 'Clear actions' }));
    expect(readClientExtensionActions()).toEqual([]);
  });

  it('cancels and replaces staged extension actions without persistence', () => {
    renderPreferences('App & tools');
    const input = screen.getByLabelText('Action manifest JSON');
    const manifest = JSON.stringify({
      version: 1,
      actions: [{ id: 'copy.room', title: 'Copy room', capability: 'copy-text', text: '#root' }],
    });

    fireEvent.input(input, { target: { value: manifest } });
    fireEvent.click(screen.getByRole('button', { name: 'Review actions' }));
    expect(screen.getByRole('list', { name: 'Reviewed extension actions' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel reviewed actions' }));
    expect(readClientExtensionActions()).toEqual([]);
    expect(screen.queryByRole('list', { name: 'Reviewed extension actions' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Review actions' }));
    fireEvent.input(input, { target: { value: `${manifest} ` } });
    expect(readClientExtensionActions()).toEqual([]);
    expect(screen.queryByRole('list', { name: 'Reviewed extension actions' })).toBeNull();
  });

  it('rejects invalid and unsupported manifest versions without staging or persistence', () => {
    renderPreferences('App & tools');
    const input = screen.getByLabelText('Action manifest JSON');

    fireEvent.input(input, {
      target: {
        value: JSON.stringify({
          version: 2,
          actions: [{ id: 'copy.room', title: 'Copy room', capability: 'copy-text', text: '#root' }],
        }),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review actions' }));

    expect(screen.getByText('Manifest must be a version 1 object or a legacy action array.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Reviewed extension actions' })).toBeNull();
    expect(readClientExtensionActions()).toEqual([]);
  });

  it('keeps the reviewed stage and reports failure when extension action storage is unavailable', () => {
    renderPreferences('App & tools');
    fireEvent.input(screen.getByLabelText('Action manifest JSON'), {
      target: {
        value: JSON.stringify({
          version: 1,
          actions: [{ id: 'copy.room', title: 'Copy room', capability: 'copy-text', text: '#root' }],
        }),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review actions' }));
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Import reviewed actions' }));

    expect(screen.getByText('Could not save reviewed actions on this device.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Reviewed extension actions' })).toBeInTheDocument();
    expect(readClientExtensionActions()).toEqual([]);
  });

  it('selects a default vault search mode, persisting it and applying it live', () => {
    renderPreferences('History & data');

    const group = screen.getByRole('radiogroup', { name: 'Default search mode' });
    const radios = screen.getAllByRole('radio').filter((radio) => group.contains(radio));
    expect(radios.map((radio) => radio.textContent)).toEqual(['Text + related', 'Exact', 'Related terms']);
    expect(screen.getByRole('radio', { name: 'Text + related' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('radio', { name: 'Related terms' }));

    // Persisted default updates and the DOM reflects the new checked radio.
    expect(defaultVaultSearchMode()).toBe('semantic');
    expect(localStorage.getItem('onyx:vault-search-mode')).toBe('semantic');
    expect(screen.getByRole('radio', { name: 'Related terms' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Text + related' })).toHaveAttribute('aria-checked', 'false');
    // The live in-search mode is applied immediately, not just on next load.
    expect(vaultSearchMode()).toBe('semantic');
  });

  it('surfaces bounded on-device retention controls with private framing', () => {
    renderPreferences('History & data');

    const card = screen.getByRole('heading', { name: 'On-device history' }).closest('section');
    expect(card).not.toBeNull();
    const controls = within(card!);
    expect(controls.getByText('This device')).toBeInTheDocument();
    expect(controls.getByRole('radiogroup', { name: 'Messages per conversation' })).toBeInTheDocument();
    expect(controls.getByRole('radiogroup', { name: 'Maximum local age' })).toBeInTheDocument();
    expect(controls.getByRole('radio', { name: '400' })).toHaveAttribute('aria-checked', 'true');
    expect(controls.getByRole('radio', { name: 'Any age' })).toHaveAttribute('aria-checked', 'true');
    expect(controls.getByText(/does not change server history/i)).toBeInTheDocument();
    expect(controls.getByText(/EPHEMERAL retention setting/i)).toBeInTheDocument();
    expect(controls.getByText(/Encrypted DM plaintext is\s+never stored/i)).toBeInTheDocument();
  });

  it('persists retention choices and applies them to the live vault policy', async () => {
    renderPreferences('History & data');

    fireEvent.click(screen.getByRole('radio', { name: '1,000' }));
    fireEvent.click(screen.getByRole('radio', { name: '90 days' }));

    expect(getRetentionPolicy()).toEqual({ keep: 1000, maxAgeDays: 90 });
    expect(JSON.parse(localStorage.getItem(RETENTION_POLICY_STORAGE_KEY) ?? '')).toEqual({
      keep: 1000,
      maxAgeDays: 90,
    });
    expect(screen.getByRole('radio', { name: '1,000' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '90 days' })).toHaveAttribute('aria-checked', 'true');
    const card = screen.getByRole('heading', { name: 'On-device history' }).closest('section');
    await waitFor(() => {
      expect(within(card!).getByRole('status')).toHaveTextContent(/Local history limit saved/);
    });
  });

  it('restores the persisted retention policy when the panel mounts', () => {
    localStorage.setItem(
      RETENTION_POLICY_STORAGE_KEY,
      JSON.stringify({ keep: 5000, maxAgeDays: 365 }),
    );
    renderPreferences('History & data');

    expect(getRetentionPolicy()).toEqual({ keep: 5000, maxAgeDays: 365 });
    expect(screen.getByRole('radio', { name: '5,000' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '1 year' })).toHaveAttribute('aria-checked', 'true');
  });

  it('guards clearing local history behind an explicit confirm step', async () => {
    renderPreferences('History & data');

    // First press only reveals the confirm affordance — it does not erase yet.
    fireEvent.click(screen.getByRole('button', { name: 'Clear local history' }));
    expect(screen.getByRole('group', { name: 'Confirm clear local history' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erase history' })).toBeInTheDocument();

    // Backing out keeps history and dismisses the confirm.
    fireEvent.click(screen.getByRole('button', { name: 'Keep history' }));
    expect(
      screen.queryByRole('group', { name: 'Confirm clear local history' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear local history' })).toBeInTheDocument();

    // Confirming runs the wipe and reports it.
    fireEvent.click(screen.getByRole('button', { name: 'Clear local history' }));
    fireEvent.click(screen.getByRole('button', { name: 'Erase history' }));
    expect(await screen.findByText('Local history cleared on this device.')).toBeInTheDocument();
  });

  it('hands focus into the local history confirmation and restores it when cancelled', async () => {
    renderPreferences('History & data');
    await Promise.resolve();

    const trigger = screen.getByRole('button', { name: 'Clear local history' });
    trigger.focus();
    fireEvent.click(trigger);

    const erase = screen.getByRole('button', { name: 'Erase history' });
    await waitFor(() => expect(erase).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'Keep history' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Clear local history' })).toHaveFocus();
    });
  });

  it('keeps history disabled and discloses retained rows when toggle erasure cannot be verified', async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
    const target = '#retained-after-toggle';
    await saveMessages(target, [{
      id: 'retained-row',
      time: new Date(1000),
      from: 'kain',
      text: 'must be disclosed after a failed wipe',
      type: 'msg',
      target,
    } as ChatMessage]);
    const realClear = IDBObjectStore.prototype.clear;
    vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (
      this: IDBObjectStore,
    ): IDBRequest<undefined> {
      const request = realClear.call(this);
      if (this.name === 'outbox') this.transaction.abort();
      return request;
    });
    renderPreferences('History & data');

    const toggle = screen.getByRole('switch', { name: 'Remember conversations on this device' });
    fireEvent.click(toggle);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Stored conversations may still remain on this device because erasure could not be verified',
    );
    expect(preferences().localHistory).toBe(false);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Retry erasing stored conversations' })).toBeInTheDocument();
    expect((await loadRecent(target)).map((message) => message.id)).toEqual(['retained-row']);
  });

  it('guards a rejected toggle wipe and lets the user retry it to verified completion', async () => {
    let resolveRetry: (cleared: boolean) => void = () => {};
    const retry = new Promise<boolean>((resolve) => {
      resolveRetry = resolve;
    });
    const clearVault = vi.spyOn(historyVault, 'clearVault')
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockReturnValueOnce(retry);
    renderPreferences('History & data');

    const toggle = screen.getByRole('switch', { name: 'Remember conversations on this device' });
    fireEvent.click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent('Onyx will not save new conversations');
    expect(screen.queryByText(/were erased from this device/i)).not.toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: 'Retry erasing stored conversations' });
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);

    expect(clearVault).toHaveBeenCalledTimes(2);
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-busy', 'true');
    expect(retryButton).toBeDisabled();
    expect(screen.getByText('Erasing stored conversations from this device…')).toHaveAttribute('role', 'status');
    expect(preferences().localHistory).toBe(false);

    resolveRetry(true);

    expect(await screen.findByText('Local history is off. Stored conversations were erased from this device.')).toHaveAttribute('role', 'status');
    expect(toggle).not.toBeDisabled();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry erasing stored conversations' })).not.toBeInTheDocument();
  });

  it('announces verified toggle erasure only after stored rows are gone', async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
    const target = '#verified-toggle-clear';
    await saveMessages(target, [{
      id: 'erase-me',
      time: new Date(1000),
      from: 'kain',
      text: 'erase after disabling history',
      type: 'msg',
      target,
    } as ChatMessage]);
    renderPreferences('History & data');

    const toggle = screen.getByRole('switch', { name: 'Remember conversations on this device' });
    fireEvent.click(toggle);

    expect(await screen.findByText('Local history is off. Stored conversations were erased from this device.')).toHaveAttribute('role', 'status');
    expect(await loadRecent(target)).toEqual([]);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry erasing stored conversations' })).not.toBeInTheDocument();
  });

  it('confirms or cancels reviewed-anchor clearing without touching other local data', async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
    _resetSavedSearchesForTests();
    const target = '#review-clear-isolation';
    const messageTime = new Date(Date.now());
    const vaultMessage = {
      id: 'review-clear-message',
      time: messageTime,
      from: 'kain',
      text: 'vault row must remain',
      type: 'msg',
      target,
    } as ChatMessage;
    await saveMessages(target, [vaultMessage]);
    expect((await loadRecent(target)).map((message) => message.id)).toContain(vaultMessage.id);
    markTopicRead(target, 'roadmap', {
      id: vaultMessage.id,
      time: vaultMessage.time,
    });
    await saveSearch({
      label: 'Review clear isolation',
      query: 'saved search must remain',
      mode: 'exact',
    });
    recordReviewHistory({
      target,
      name: target,
      kind: 'channel',
      firstMessageId: vaultMessage.id,
      firstAt: vaultMessage.time.toISOString(),
      reviewedAt: new Date(messageTime.getTime() + 60_000).toISOString(),
      messageCount: 1,
      mentionCount: 0,
      preview: 'reviewed anchor only',
    });
    renderPreferences('History & data');

    const card = screen.getByRole('heading', { name: 'Reviewed catch-up anchors' }).closest('section');
    expect(card).not.toBeNull();
    const controls = within(card!);
    expect(controls.getByText('1 reviewed anchor')).toBeInTheDocument();
    await Promise.resolve();

    const trigger = controls.getByRole('button', { name: 'Clear reviewed anchors' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(controls.getByRole('group', { name: 'Confirm clear reviewed anchors' })).toBeInTheDocument();
    expect(readReviewHistory()).toHaveLength(1);
    await waitFor(() => {
      expect(controls.getByRole('button', { name: 'Erase reviewed anchors' })).toHaveFocus();
    });

    fireEvent.click(controls.getByRole('button', { name: 'Keep reviewed anchors' }));
    expect(controls.queryByRole('group', { name: 'Confirm clear reviewed anchors' })).toBeNull();
    expect(readReviewHistory()).toHaveLength(1);
    await waitFor(() => {
      expect(controls.getByRole('button', { name: 'Clear reviewed anchors' })).toHaveFocus();
    });

    fireEvent.click(controls.getByRole('button', { name: 'Clear reviewed anchors' }));
    fireEvent.click(controls.getByRole('button', { name: 'Erase reviewed anchors' }));

    expect(controls.getByRole('status')).toHaveTextContent('Cleared 1 reviewed anchor from this device.');
    await waitFor(() => {
      expect(controls.getByRole('button', { name: 'Clear reviewed anchors' })).toHaveFocus();
    });
    expect(controls.getByText('0 reviewed anchors')).toBeInTheDocument();
    expect(readReviewHistory()).toEqual([]);
    expect((await loadRecent(target)).map((message) => message.id)).toContain(vaultMessage.id);
    expect(readTopicReadMarker(target, 'roadmap')?.lastReadMessageId).toBe(vaultMessage.id);
    expect((await listSearches()).some((search) => search.query === 'saved search must remain')).toBe(true);
  });

  it('reports reviewed-anchor storage failure without claiming a clear', () => {
    recordReviewHistory({
      target: '#retained-review',
      name: '#retained-review',
      kind: 'channel',
      firstMessageId: 'retained-message',
      firstAt: '2026-07-16T00:00:00.000Z',
      reviewedAt: '2026-07-16T00:01:00.000Z',
      messageCount: 1,
      mentionCount: 0,
      preview: 'must remain',
    });
    const removeItem = localStorage.removeItem.bind(localStorage);
    vi.spyOn(localStorage, 'removeItem').mockImplementation((key) => {
      if (key === deviceMemoryStorageKey(REVIEW_HISTORY_KEY, MEMORY_OWNER)) {
        throw new DOMException('blocked');
      }
      removeItem(key);
    });
    renderPreferences('History & data');

    const card = screen.getByRole('heading', { name: 'Reviewed catch-up anchors' }).closest('section');
    const controls = within(card!);
    fireEvent.click(controls.getByRole('button', { name: 'Clear reviewed anchors' }));
    fireEvent.click(controls.getByRole('button', { name: 'Erase reviewed anchors' }));

    expect(controls.getByRole('alert')).toHaveTextContent('Could not verify that reviewed anchors were cleared');
    expect(controls.getByText('1 reviewed anchor')).toBeInTheDocument();
    expect(readReviewHistory()).toHaveLength(1);
    expect(localStorage.getItem(deviceMemoryStorageKey(REVIEW_HISTORY_KEY, MEMORY_OWNER)!)).not.toBeNull();
  });

  it('clears all saved searches with exact-count review, cancel focus, and local-data isolation', async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
    _resetSavedSearchesForTests();
    const target = '#saved-search-clear-isolation';
    const messageTime = new Date(Date.now());
    const vaultMessage = {
      id: 'saved-search-clear-message',
      time: messageTime,
      from: 'kain',
      text: 'vault row remains',
      type: 'msg',
      target,
    } as ChatMessage;
    await saveMessages(target, [vaultMessage]);
    markTopicRead(target, 'roadmap', { id: vaultMessage.id, time: vaultMessage.time });
    recordReviewHistory({
      target,
      name: target,
      kind: 'channel',
      firstMessageId: vaultMessage.id,
      firstAt: vaultMessage.time.toISOString(),
      reviewedAt: new Date(messageTime.getTime() + 60_000).toISOString(),
      messageCount: 1,
      mentionCount: 0,
      preview: 'review remains',
    });
    await saveSearch({ label: 'First private query', query: 'alpha secret', mode: 'exact' });
    await saveSearch({ label: 'Second private query', query: 'beta secret', mode: 'hybrid' });
    renderPreferences('History & data');

    const card = screen.getByRole('heading', { name: 'Saved searches' }).closest('section');
    expect(card).not.toBeNull();
    const controls = within(card!);
    await waitFor(() => expect(controls.getByText('2 saved searches')).toBeInTheDocument());
    const trigger = controls.getByRole('button', { name: 'Clear all saved searches' });
    trigger.focus();
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(controls.getByRole('group', { name: 'Confirm clear all saved searches' }))
        .toHaveTextContent('Permanently erase 2 saved searches and their saved query text from this device?');
      expect(controls.getByRole('button', { name: 'Erase all saved searches' })).toHaveFocus();
    });
    fireEvent.click(controls.getByRole('button', { name: 'Keep saved searches' }));
    await waitFor(() => expect(controls.getByRole('button', { name: 'Clear all saved searches' })).toHaveFocus());
    expect(await listSearches()).toHaveLength(2);

    fireEvent.click(controls.getByRole('button', { name: 'Clear all saved searches' }));
    await waitFor(() => expect(controls.getByRole('group', { name: 'Confirm clear all saved searches' })).toBeInTheDocument());
    await saveSearch({ label: 'Added after review', query: 'gamma secret', mode: 'semantic' });
    fireEvent.click(controls.getByRole('button', { name: 'Erase all saved searches' }));

    await waitFor(() => {
      expect(controls.getByRole('status')).toHaveTextContent(
        'Saved search count changed to 3. Review the updated count and confirm again.',
      );
    });
    expect(controls.getByRole('group', { name: 'Confirm clear all saved searches' }))
      .toHaveTextContent('Permanently erase 3 saved searches and their saved query text');
    expect(await listSearches()).toHaveLength(3);

    fireEvent.click(controls.getByRole('button', { name: 'Erase all saved searches' }));
    await waitFor(() => {
      expect(controls.getByRole('status')).toHaveTextContent(
        'Cleared 3 saved searches and removed the saved query text from this device.',
      );
      expect(controls.getByRole('button', { name: 'Clear all saved searches' })).toHaveFocus();
    });
    expect(await listSearches()).toEqual([]);
    expect((await loadRecent(target)).map((message) => message.id)).toContain(vaultMessage.id);
    expect(readReviewHistory().map((entry) => entry.firstMessageId)).toContain(vaultMessage.id);
    expect(readTopicReadMarker(target, 'roadmap')?.lastReadMessageId).toBe(vaultMessage.id);
  });

  it('refreshes the saved-search count after same-tab verified changes', async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetSavedSearchesForTests();
    renderPreferences('History & data');

    const card = screen.getByRole('heading', { name: 'Saved searches' }).closest('section');
    const controls = within(card!);
    await waitFor(() => expect(controls.getByText('0 saved searches')).toBeInTheDocument());

    const saved = await saveSearch({
      label: 'External private label',
      query: 'external private query',
      mode: 'exact',
    });
    await waitFor(() => expect(controls.getByText('1 saved search')).toBeInTheDocument());
    expect(card).not.toHaveTextContent('External private label');
    expect(card).not.toHaveTextContent('external private query');

    await deleteSearch(saved!.id);
    await waitFor(() => expect(controls.getByText('0 saved searches')).toBeInTheDocument());
  });

  it('keeps saved-search confirmation open and reports verified clear failure', async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetSavedSearchesForTests();
    await saveSearch({ label: 'Retained private query', query: 'do not lose me', mode: 'exact' });
    renderPreferences('History & data');

    const card = screen.getByRole('heading', { name: 'Saved searches' }).closest('section');
    const controls = within(card!);
    await waitFor(() => expect(controls.getByText('1 saved search')).toBeInTheDocument());
    fireEvent.click(controls.getByRole('button', { name: 'Clear all saved searches' }));
    await waitFor(() => expect(controls.getByRole('group', { name: 'Confirm clear all saved searches' })).toBeInTheDocument());

    const realClear = IDBObjectStore.prototype.clear;
    vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (
      this: IDBObjectStore,
    ): IDBRequest<undefined> {
      const request = realClear.call(this);
      this.transaction.abort();
      return request;
    });
    fireEvent.click(controls.getByRole('button', { name: 'Erase all saved searches' }));

    await waitFor(() => {
      expect(controls.getByRole('alert')).toHaveTextContent(
        'Could not verify that all saved searches and query text were cleared',
      );
    });
    expect(controls.getByRole('group', { name: 'Confirm clear all saved searches' })).toBeInTheDocument();
    expect(controls.getByText('1 saved search')).toBeInTheDocument();
    expect((await listSearches()).map((search) => search.query)).toEqual(['do not lose me']);
  });

  it('clears topic read positions with count re-confirmation, focus, and data isolation', async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
    _resetSavedSearchesForTests();
    const target = '#topic-clear-private-room';
    const messageTime = new Date(Date.now());
    const vaultMessage = {
      id: 'topic-clear-private-message',
      time: messageTime,
      from: 'kain',
      text: 'vault content remains private',
      type: 'msg',
      target,
    } as ChatMessage;
    await saveMessages(target, [vaultMessage]);
    await saveSearch({ label: 'Topic clear saved search', query: 'private query remains', mode: 'exact' });
    follow(target, 'private roadmap');
    recordReviewHistory({
      target,
      name: target,
      kind: 'channel',
      firstMessageId: vaultMessage.id,
      firstAt: vaultMessage.time.toISOString(),
      reviewedAt: new Date(messageTime.getTime() + 60_000).toISOString(),
      messageCount: 1,
      mentionCount: 0,
      preview: 'review anchor remains',
    });
    markTopicRead(target, 'private roadmap', { id: 'private-cursor-one', time: messageTime });
    markTopicRead(target, 'private release', { id: 'private-cursor-two', time: messageTime });
    renderPreferences('History & data');

    const card = screen.getByRole('heading', { name: 'Topic read positions' }).closest('section');
    expect(card).not.toBeNull();
    const controls = within(card!);
    expect(controls.getByText('2 topic read positions')).toBeInTheDocument();
    const trigger = controls.getByRole('button', { name: 'Clear topic read positions' });
    trigger.focus();
    fireEvent.click(trigger);
    const confirmation = controls.getByRole('group', { name: 'Confirm clear topic read positions' });
    expect(confirmation).toHaveTextContent('Remove 2 topic read positions from this device only?');
    expect(confirmation).not.toHaveTextContent(target);
    expect(confirmation).not.toHaveTextContent('private roadmap');
    expect(confirmation).not.toHaveTextContent('private-cursor-one');
    await waitFor(() => {
      expect(controls.getByRole('button', { name: 'Erase topic read positions' })).toHaveFocus();
    });

    fireEvent.click(controls.getByRole('button', { name: 'Keep topic read positions' }));
    await waitFor(() => expect(controls.getByRole('button', { name: 'Clear topic read positions' })).toHaveFocus());
    expect(readTopicReadLedger()).toHaveLength(2);

    fireEvent.click(controls.getByRole('button', { name: 'Clear topic read positions' }));
    markTopicRead(target, 'private third', { id: 'private-cursor-three', time: messageTime });
    fireEvent.click(controls.getByRole('button', { name: 'Erase topic read positions' }));

    expect(controls.getByRole('status')).toHaveTextContent(
      'Topic read position count changed to 3. Review the updated count and confirm again.',
    );
    expect(controls.getByRole('status')).not.toHaveTextContent('private');
    expect(controls.getByRole('group', { name: 'Confirm clear topic read positions' }))
      .toHaveTextContent('Remove 3 topic read positions from this device only?');
    fireEvent.click(controls.getByRole('button', { name: 'Erase topic read positions' }));

    expect(controls.getByRole('status')).toHaveTextContent(
      'Cleared 3 topic read positions from this device.',
    );
    await waitFor(() => {
      expect(controls.getByRole('button', { name: 'Clear topic read positions' })).toHaveFocus();
    });
    expect(controls.getByRole('status')).not.toHaveTextContent('private');
    expect(readTopicReadLedger()).toEqual([]);
    expect((await loadRecent(target)).map((message) => message.id)).toContain(vaultMessage.id);
    expect(isFollowed(target, 'private roadmap')).toBe(true);
    expect((await listSearches()).some((search) => search.query === 'private query remains')).toBe(true);
    expect(readReviewHistory().map((entry) => entry.firstMessageId)).toContain(vaultMessage.id);
  });

  it('retains topic read confirmation and metadata when verified removal fails', () => {
    const target = '#topic-clear-retained';
    markTopicRead(target, 'retained private topic', {
      id: 'retained-private-message-id',
      time: new Date(Date.now()),
    });
    const removeItem = localStorage.removeItem.bind(localStorage);
    vi.spyOn(localStorage, 'removeItem').mockImplementation((key) => {
      if (key === TOPIC_READ_STORAGE_KEY) throw new DOMException('blocked');
      removeItem(key);
    });
    renderPreferences('History & data');

    const card = screen.getByRole('heading', { name: 'Topic read positions' }).closest('section');
    const controls = within(card!);
    fireEvent.click(controls.getByRole('button', { name: 'Clear topic read positions' }));
    fireEvent.click(controls.getByRole('button', { name: 'Erase topic read positions' }));

    expect(controls.getByRole('alert')).toHaveTextContent(
      'Could not verify that all topic read positions were cleared',
    );
    expect(controls.getByRole('alert')).not.toHaveTextContent('retained private');
    expect(controls.getByRole('group', { name: 'Confirm clear topic read positions' })).toBeInTheDocument();
    expect(controls.getByText('1 topic read position')).toBeInTheDocument();
    expect(readTopicReadMarker(target, 'retained private topic')?.lastReadMessageId)
      .toBe('retained-private-message-id');
  });

  it('clears followed metadata with drift re-confirmation, focus, and local-data isolation', async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
    _resetSavedSearchesForTests();
    const target = '#followed-clear-private-room';
    const messageTime = new Date(Date.now());
    const vaultMessage = {
      id: 'followed-clear-vault-message',
      time: messageTime,
      from: 'kain',
      text: 'vault content remains private',
      type: 'msg',
      target,
    } as ChatMessage;
    await saveMessages(target, [vaultMessage]);
    await queueOutbox(target, 'queued plaintext remains');
    await saveSearch({ label: 'Followed isolation', query: 'saved query remains', mode: 'exact' });
    markTopicRead(target, 'followed isolation', { id: vaultMessage.id, time: vaultMessage.time });
    recordReviewHistory({
      target,
      name: target,
      kind: 'channel',
      firstMessageId: vaultMessage.id,
      firstAt: vaultMessage.time.toISOString(),
      reviewedAt: new Date(messageTime.getTime() + 60_000).toISOString(),
      messageCount: 1,
      mentionCount: 0,
      preview: 'reviewed anchor remains',
    });
    store.getState().setComposerDraft(target, 'room draft remains');
    saveChannelTopicDrafts({ [target]: 'topic draft remains' }, undefined, MEMORY_OWNER);
    localStorage.setItem('onyx:translation-target', 'fr');
    localStorage.setItem('onyx:calm', 'power');
    localStorage.setItem('onyx:channel-notify', JSON.stringify({ [target]: 'mentions' }));
    localStorage.setItem('onyx:credentials', 'credential payload remains');
    follow(target, 'private roadmap');
    follow('#followed-ops');
    renderPreferences('History & data');

    const card = screen.getByRole('heading', { name: 'Followed conversations' }).closest('section');
    expect(card).not.toBeNull();
    const controls = within(card!);
    expect(controls.getByText('2 followed conversations')).toBeInTheDocument();
    const trigger = controls.getByRole('button', { name: 'Clear followed conversations' });
    trigger.focus();
    fireEvent.click(trigger);
    const confirmation = controls.getByRole('group', { name: 'Confirm clear followed conversations' });
    expect(confirmation).toHaveTextContent('Remove 2 followed conversations from this device only?');
    expect(confirmation).not.toHaveTextContent(target);
    expect(confirmation).not.toHaveTextContent('private roadmap');
    await waitFor(() => {
      expect(controls.getByRole('button', { name: 'Erase followed conversations' })).toHaveFocus();
    });

    fireEvent.click(controls.getByRole('button', { name: 'Keep followed conversations' }));
    await waitFor(() => {
      expect(controls.getByRole('button', { name: 'Clear followed conversations' })).toHaveFocus();
    });
    expect(isFollowed(target, 'private roadmap')).toBe(true);

    fireEvent.click(controls.getByRole('button', { name: 'Clear followed conversations' }));
    follow('#followed-late');
    fireEvent.click(controls.getByRole('button', { name: 'Erase followed conversations' }));
    expect(controls.getByRole('status')).toHaveTextContent(
      'Followed conversation count changed to 3. Review the updated count and confirm again.',
    );
    expect(controls.getByRole('group', { name: 'Confirm clear followed conversations' }))
      .toHaveTextContent('Remove 3 followed conversations from this device only?');
    fireEvent.click(controls.getByRole('button', { name: 'Erase followed conversations' }));

    expect(controls.getByRole('status')).toHaveTextContent(
      'Cleared 3 followed conversations from this device.',
    );
    await waitFor(() => {
      expect(controls.getByRole('button', { name: 'Clear followed conversations' })).toHaveFocus();
    });
    expect(localStorage.getItem(FOLLOWED_OWNER_STORAGE_KEY)).toBeNull();
    expect(isFollowed(target, 'private roadmap')).toBe(false);
    expect((await loadRecent(target)).map((message) => message.id)).toContain(vaultMessage.id);
    expect((await loadOutbox()).map((entry) => entry.text)).toEqual(['queued plaintext remains']);
    expect(loadComposerDrafts(undefined, MEMORY_OWNER)).toEqual({ [target]: 'room draft remains' });
    expect(loadChannelTopicDrafts(undefined, MEMORY_OWNER)).toEqual({ [target]: 'topic draft remains' });
    expect(readReviewHistory().map((entry) => entry.firstMessageId)).toContain(vaultMessage.id);
    expect(readTopicReadMarker(target, 'followed isolation')?.lastReadMessageId).toBe(vaultMessage.id);
    expect((await listSearches()).some((search) => search.query === 'saved query remains')).toBe(true);
    expect(localStorage.getItem('onyx:translation-target')).toBe('fr');
    expect(localStorage.getItem('onyx:calm')).toBe('power');
    expect(localStorage.getItem('onyx:channel-notify')).toBe(JSON.stringify({ [target]: 'mentions' }));
    expect(localStorage.getItem('onyx:credentials')).toBe('credential payload remains');
  });

  it('keeps followed confirmation and state when verified removal fails', () => {
    follow('#followed-retained', 'private topic');
    renderPreferences('History & data');

    const card = screen.getByRole('heading', { name: 'Followed conversations' }).closest('section');
    const controls = within(card!);
    fireEvent.click(controls.getByRole('button', { name: 'Clear followed conversations' }));
    const removeItem = localStorage.removeItem.bind(localStorage);
    vi.spyOn(localStorage, 'removeItem').mockImplementation((key) => {
      if (key === FOLLOWED_OWNER_STORAGE_KEY) throw new DOMException('blocked');
      removeItem(key);
    });
    fireEvent.click(controls.getByRole('button', { name: 'Erase followed conversations' }));

    expect(controls.getByRole('alert')).toHaveTextContent(
      'Could not verify that followed conversations were cleared',
    );
    expect(controls.getByRole('alert')).not.toHaveTextContent('private topic');
    expect(controls.getByRole('group', { name: 'Confirm clear followed conversations' }))
      .toBeInTheDocument();
    expect(controls.getByText('1 followed conversation')).toBeInTheDocument();
    expect(isFollowed('#followed-retained', 'private topic')).toBe(true);
    expect(localStorage.getItem(FOLLOWED_OWNER_STORAGE_KEY)).not.toBeNull();
  });

  it('discards only room and topic drafts with count re-confirmation, focus, and data isolation', async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
    _resetSavedSearchesForTests();
    const target = '#draft-clear-private-room';
    const messageTime = new Date(Date.now());
    const vaultMessage = {
      id: 'draft-clear-vault-message',
      time: messageTime,
      from: 'kain',
      text: 'vault content remains private',
      type: 'msg',
      target,
    } as ChatMessage;
    await saveMessages(target, [vaultMessage]);
    await queueOutbox(target, 'queued plaintext remains');
    await saveSearch({ label: 'Draft clear saved search', query: 'saved query remains', mode: 'exact' });
    markTopicRead(target, 'draft isolation', { id: vaultMessage.id, time: vaultMessage.time });
    follow(target, 'draft isolation');
    recordReviewHistory({
      target,
      name: target,
      kind: 'channel',
      firstMessageId: vaultMessage.id,
      firstAt: vaultMessage.time.toISOString(),
      reviewedAt: new Date(messageTime.getTime() + 60_000).toISOString(),
      messageCount: 1,
      mentionCount: 0,
      preview: 'reviewed anchor remains',
    });
    saveCredentials({
      nick: 'draft-user',
      server: 'wss://draft-auth.example/ws',
      password: 'auth password remains',
    });
    storeSessionToken('session-token-remains', 2_100_000_000);
    storeMeshToken('mesh-token-remains', 2_100_000_000);
    const credentialsBefore = localStorage.getItem('onyx:credentials');
    store.getState().setComposerDraft(target, 'first room plaintext');
    store.getState().setComposerDraft('&draft-local', 'second room plaintext');
    store.getState().setComposerDraft('alice', 'direct-message plaintext remains');
    saveChannelTopicDrafts({ [target]: 'first topic plaintext' }, undefined, MEMORY_OWNER);

    renderPreferences('History & data');

    const card = screen.getByRole('heading', { name: 'Local drafts' }).closest('section');
    expect(card).not.toBeNull();
    const controls = within(card!);
    expect(controls.getByText('2 room drafts · 1 topic draft')).toBeInTheDocument();
    expect(controls.getByText(/Direct-message draft plaintext is excluded from portable transfer/))
      .toBeInTheDocument();
    const trigger = controls.getByRole('button', { name: 'Discard local drafts' });
    trigger.focus();
    fireEvent.click(trigger);
    const confirmation = controls.getByRole('group', { name: 'Confirm discard local drafts' });
    expect(confirmation).toHaveTextContent('Discard 2 room drafts · 1 topic draft?');
    expect(confirmation).not.toHaveTextContent('first room plaintext');
    expect(confirmation).not.toHaveTextContent('first topic plaintext');
    expect(confirmation).not.toHaveTextContent('direct-message plaintext remains');
    await waitFor(() => {
      expect(controls.getByRole('button', { name: 'Discard room and topic drafts' })).toHaveFocus();
    });

    fireEvent.click(controls.getByRole('button', { name: 'Keep local drafts' }));
    await waitFor(() => expect(controls.getByRole('button', { name: 'Discard local drafts' })).toHaveFocus());
    expect(loadComposerDrafts(undefined, MEMORY_OWNER)).toEqual({
      [target]: 'first room plaintext',
      '&draft-local': 'second room plaintext',
      alice: 'direct-message plaintext remains',
    });
    expect(loadChannelTopicDrafts(undefined, MEMORY_OWNER)).toEqual({ [target]: 'first topic plaintext' });

    fireEvent.click(controls.getByRole('button', { name: 'Discard local drafts' }));
    store.getState().setComposerDraft('#late-room', 'late room plaintext');
    saveChannelTopicDrafts({
      ...loadChannelTopicDrafts(undefined, MEMORY_OWNER),
      '#late-topic': 'late topic plaintext',
    }, undefined, MEMORY_OWNER);
    fireEvent.click(controls.getByRole('button', { name: 'Discard room and topic drafts' }));

    expect(controls.getByRole('status')).toHaveTextContent(
      'Draft counts changed to 3 room drafts · 2 topic drafts. Review the updated counts and confirm again.',
    );
    expect(controls.getByRole('status')).not.toHaveTextContent('plaintext');
    expect(controls.getByRole('group', { name: 'Confirm discard local drafts' }))
      .toHaveTextContent('Discard 3 room drafts · 2 topic drafts?');
    fireEvent.click(controls.getByRole('button', { name: 'Discard room and topic drafts' }));

    expect(controls.getByRole('status')).toHaveTextContent(
      'Discarded 3 room drafts · 2 topic drafts from this device. Direct-message drafts were not changed.',
    );
    await waitFor(() => {
      expect(controls.getByRole('button', { name: 'Discard local drafts' })).toHaveFocus();
    });
    expect(controls.getByRole('status')).not.toHaveTextContent('plaintext');
    expect(loadComposerDrafts(undefined, MEMORY_OWNER)).toEqual({ alice: 'direct-message plaintext remains' });
    expect(store.getState().composerDrafts).toEqual({ alice: 'direct-message plaintext remains' });
    expect(loadChannelTopicDrafts(undefined, MEMORY_OWNER)).toEqual({});
    expect((await loadRecent(target)).map((message) => message.id)).toContain(vaultMessage.id);
    expect((await loadOutbox()).map((entry) => entry.text)).toEqual(['queued plaintext remains']);
    expect(readReviewHistory().map((entry) => entry.firstMessageId)).toContain(vaultMessage.id);
    expect(readTopicReadMarker(target, 'draft isolation')?.lastReadMessageId).toBe(vaultMessage.id);
    expect((await listSearches()).some((search) => search.query === 'saved query remains')).toBe(true);
    expect(isFollowed(target, 'draft isolation')).toBe(true);
    expect(localStorage.getItem('onyx:credentials')).toBe(credentialsBefore);
    expect(loadCredentials('wss://draft-auth.example/ws', 'draft-user')).toMatchObject({
      password: 'auth password remains',
      sessionToken: 'session-token-remains',
      meshToken: 'mesh-token-remains',
    });
  });

  it('restores room drafts and keeps confirmation open when topic-draft clear fails', () => {
    store.getState().setComposerDraft('#retained-room-draft', 'retained room plaintext');
    store.getState().setComposerDraft('alice', 'retained dm plaintext');
    saveChannelTopicDrafts(
      { '#retained-topic-draft': 'retained topic plaintext' },
      undefined,
      MEMORY_OWNER,
    );
    renderPreferences('History & data');

    const card = screen.getByRole('heading', { name: 'Local drafts' }).closest('section');
    const controls = within(card!);
    fireEvent.click(controls.getByRole('button', { name: 'Discard local drafts' }));
    const removeItem = localStorage.removeItem.bind(localStorage);
    vi.spyOn(localStorage, 'removeItem').mockImplementation((key) => {
      if (key === deviceMemoryStorageKey(CHANNEL_TOPIC_DRAFTS_KEY, MEMORY_OWNER)) {
        throw new DOMException('blocked');
      }
      removeItem(key);
    });
    fireEvent.click(controls.getByRole('button', { name: 'Discard room and topic drafts' }));

    expect(controls.getByRole('alert')).toHaveTextContent(
      'Could not verify that topic drafts were discarded. Room drafts were restored',
    );
    expect(controls.getByRole('alert')).not.toHaveTextContent('retained room plaintext');
    expect(controls.getByRole('alert')).not.toHaveTextContent('retained topic plaintext');
    expect(controls.getByRole('group', { name: 'Confirm discard local drafts' })).toBeInTheDocument();
    expect(controls.getByText('1 room draft · 1 topic draft')).toBeInTheDocument();
    expect(loadComposerDrafts(undefined, MEMORY_OWNER)).toEqual({
      '#retained-room-draft': 'retained room plaintext',
      alice: 'retained dm plaintext',
    });
    expect(store.getState().composerDrafts).toEqual({
      '#retained-room-draft': 'retained room plaintext',
      alice: 'retained dm plaintext',
    });
    expect(loadChannelTopicDrafts(undefined, MEMORY_OWNER)).toEqual({
      '#retained-topic-draft': 'retained topic plaintext',
    });
  });

  it('discards queued sends with count re-confirmation, focus, and local-data isolation', async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
    _resetSavedSearchesForTests();
    const target = '#queued-clear-private-room';
    const messageTime = new Date(Date.now());
    const vaultMessage = {
      id: 'queued-clear-vault-message',
      time: messageTime,
      from: 'kain',
      text: 'remembered vault text remains',
      type: 'msg',
      target,
    } as ChatMessage;
    await saveMessages(target, [vaultMessage]);
    await queueOutbox(target, 'first queued plaintext secret');
    await queueOutbox(target, 'second queued plaintext secret');
    saveComposerDrafts({ [target]: 'draft text remains' });
    markTopicRead(target, 'queued isolation', { id: vaultMessage.id, time: vaultMessage.time });
    await saveSearch({ label: 'Queued clear saved search', query: 'saved query remains', mode: 'exact' });
    recordReviewHistory({
      target,
      name: target,
      kind: 'channel',
      firstMessageId: vaultMessage.id,
      firstAt: vaultMessage.time.toISOString(),
      reviewedAt: new Date(messageTime.getTime() + 60_000).toISOString(),
      messageCount: 1,
      mentionCount: 0,
      preview: 'reviewed anchor remains',
    });
    renderPreferences('History & data');

    const card = screen.getByRole('heading', { name: 'Queued sends' }).closest('section');
    expect(card).not.toBeNull();
    const controls = within(card!);
    await waitFor(() => expect(controls.getByText('2 queued sends')).toBeInTheDocument());
    const trigger = controls.getByRole('button', { name: 'Discard queued sends' });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(controls.getByRole('group', { name: 'Confirm discard queued sends' }))
        .toHaveTextContent('Discard 2 queued sends? Their unsent message text will be removed from this device and will not be sent.');
      expect(controls.getByRole('button', { name: 'Discard all queued sends' })).toHaveFocus();
    });
    expect(controls.getByRole('group', { name: 'Confirm discard queued sends' }))
      .not.toHaveTextContent('queued plaintext secret');

    fireEvent.click(controls.getByRole('button', { name: 'Keep queued sends' }));
    await waitFor(() => expect(controls.getByRole('button', { name: 'Discard queued sends' })).toHaveFocus());
    expect(await loadOutbox()).toHaveLength(2);

    fireEvent.click(controls.getByRole('button', { name: 'Discard queued sends' }));
    await waitFor(() => expect(controls.getByRole('group', { name: 'Confirm discard queued sends' })).toBeInTheDocument());
    await queueOutbox(target, 'third queued plaintext secret');
    fireEvent.click(controls.getByRole('button', { name: 'Discard all queued sends' }));

    await waitFor(() => {
      expect(controls.getByRole('status')).toHaveTextContent(
        'Queued send count changed to 3. Review the updated count and confirm again.',
      );
    });
    expect(controls.getByRole('status')).not.toHaveTextContent('plaintext');
    expect(controls.getByRole('group', { name: 'Confirm discard queued sends' }))
      .toHaveTextContent('Discard 3 queued sends?');
    fireEvent.click(controls.getByRole('button', { name: 'Discard all queued sends' }));

    await waitFor(() => {
      expect(controls.getByRole('status')).toHaveTextContent(
        'Discarded 3 queued sends. Their unsent message text was removed from this device and will not be sent.',
      );
      expect(controls.getByRole('button', { name: 'Discard queued sends' })).toHaveFocus();
    });
    expect(controls.getByRole('status')).not.toHaveTextContent('secret');
    expect(await loadOutbox()).toEqual([]);
    expect((await loadRecent(target)).map((message) => message.id)).toContain(vaultMessage.id);
    expect(loadComposerDrafts()).toEqual({ [target]: 'draft text remains' });
    expect(readReviewHistory().map((entry) => entry.firstMessageId)).toContain(vaultMessage.id);
    expect(readTopicReadMarker(target, 'queued isolation')?.lastReadMessageId).toBe(vaultMessage.id);
    expect((await listSearches()).some((search) => search.query === 'saved query remains')).toBe(true);
  });

  it('retains queued-send confirmation and plaintext when committed clear fails', async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
    await queueOutbox('#queued-clear-retained', 'retained queued plaintext secret');
    renderPreferences('History & data');

    const card = screen.getByRole('heading', { name: 'Queued sends' }).closest('section');
    const controls = within(card!);
    await waitFor(() => expect(controls.getByText('1 queued send')).toBeInTheDocument());
    fireEvent.click(controls.getByRole('button', { name: 'Discard queued sends' }));
    await waitFor(() => expect(controls.getByRole('group', { name: 'Confirm discard queued sends' })).toBeInTheDocument());
    const realClear = IDBObjectStore.prototype.clear;
    vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (
      this: IDBObjectStore,
    ): IDBRequest<undefined> {
      const request = realClear.call(this);
      if (this.name === 'outbox') this.transaction.abort();
      return request;
    });
    fireEvent.click(controls.getByRole('button', { name: 'Discard all queued sends' }));

    await waitFor(() => {
      expect(controls.getByRole('alert')).toHaveTextContent(
        'Could not verify that all queued sends were discarded',
      );
    });
    expect(controls.getByRole('alert')).not.toHaveTextContent('retained queued plaintext');
    expect(controls.getByRole('group', { name: 'Confirm discard queued sends' })).toBeInTheDocument();
    expect(controls.getByText('1 queued send')).toBeInTheDocument();
    expect((await loadOutbox()).map((entry) => entry.text)).toEqual(['retained queued plaintext secret']);
  });

  it('does not claim local history was cleared when device storage retains topic markers', async () => {
    markTopicRead('#room', 'roadmap', { id: 'm1', time: new Date(10) });
    const removeItem = localStorage.removeItem.bind(localStorage);
    vi.spyOn(localStorage, 'removeItem').mockImplementation((key) => {
      if (key === TOPIC_READ_STORAGE_KEY) throw new DOMException('blocked');
      removeItem(key);
    });
    renderPreferences('History & data');

    fireEvent.click(screen.getByRole('button', { name: 'Clear local history' }));
    fireEvent.click(screen.getByRole('button', { name: 'Erase history' }));

    expect(await screen.findByText('Could not clear all local history. Try again after freeing storage.')).toBeInTheDocument();
    expect(localStorage.getItem(TOPIC_READ_STORAGE_KEY)).not.toBeNull();
  });

  it('resets background motion and announces every completion without moving focus', async () => {
    setSceneMotion('off');
    renderPreferences('Accessibility');

    const reset = screen.getByRole('button', { name: 'Reset to defaults' });
    const status = screen.getByRole('status');
    const announcements: string[] = [];
    const observer = new MutationObserver(() => {
      if (status.textContent === 'Preferences reset to defaults.') {
        announcements.push(status.textContent);
      }
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close preferences' })).toHaveFocus());
    reset.focus();
    fireEvent.click(reset);

    expect(sceneMotion()).toBe('animated');
    expect(document.documentElement.dataset.sceneMotion).toBe('animated');
    await waitFor(() => expect(announcements).toHaveLength(1));
    expect(status).toHaveTextContent('Preferences reset to defaults.');
    expect(reset).toHaveFocus();

    setSceneMotion('off');
    fireEvent.click(reset);

    expect(sceneMotion()).toBe('animated');
    await waitFor(() => expect(announcements).toHaveLength(2));
    expect(reset).toHaveFocus();
    observer.disconnect();
  });
});
