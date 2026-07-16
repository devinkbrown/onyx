// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readClientExtensionActions, recordClientExtensionActionRun } from '@/lib/extensions/clientActions';
import { closePreferences, openPreferences, resetPreferences } from '@/lib/prefs/preferences';
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
import {
  _resetSavedSearchesForTests,
  deleteSearch,
  listSearches,
  saveSearch,
} from '@/lib/vault/savedSearches';
import { RETENTION_POLICY_STORAGE_KEY } from '@/lib/vault/retentionPolicy';
import {
  markTopicRead,
  readTopicReadMarker,
  readTopicReadLedger,
  TOPIC_READ_LEDGER_KEY,
} from '@/lib/topics/topicReadLedger';
import {
  FOLLOWED_STORAGE_KEY,
  clearFollowed,
  follow,
  isFollowed,
} from '@/lib/notifications/followed';
import {
  readReviewHistory,
  recordReviewHistory,
  REVIEW_HISTORY_KEY,
} from '@/lib/notifications/reviewHistory';
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
import { PORTABLE_JSON_MAX_FILE_BYTES } from './importFileLimits';

describe('PreferencesPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    clearFollowed();
    resetPreferences();
    resetDefaultVaultSearchMode();
    setVaultMode('hybrid');
    setRetentionPolicy(null);
    closePreferences();
    store.setState({ showAppearance: false, composerDrafts: {} });
  });

  afterEach(() => {
    cleanup();
    closePreferences();
    resetDefaultVaultSearchMode();
    setVaultMode('hybrid');
    setRetentionPolicy(null);
    vi.restoreAllMocks();
    localStorage.clear();
    clearFollowed();
    store.setState({ showAppearance: false, composerDrafts: {} });
  });

  it('surfaces the client accessibility audit ledger', () => {
    openPreferences();
    render(() => <PreferencesPanel />);

    expect(screen.getByTestId('preferences-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Theme and background/i })).toBeInTheDocument();
    expect(screen.getByText('Open Appearance for themes, room atmosphere, shared theme import, and background selection.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Client access audit' })).toBeInTheDocument();
    expect(screen.getByText('Feature switches')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Show 24-hour activity strip/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /Show join voice\/video controls/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /Show topic, forum, and follow controls/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: /Show shared watch activity/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('heading', { name: 'Portable vault' })).toBeInTheDocument();
    expect(screen.getByText(/Saved query text is included/i)).toBeInTheDocument();
    expect(screen.getByText(/Read cursors contain only room\/topic, message ID, and timestamp metadata/i)).toBeInTheDocument();
    expect(screen.getByText(/decrypted DM plaintext are not exported automatically/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export vault' })).toBeInTheDocument();
    expect(screen.getByLabelText('Import portable JSON')).toHaveAttribute('type', 'file');
    const reviewedAnchors = screen.getByRole('heading', { name: 'Reviewed catch-up anchors' }).closest('section');
    expect(reviewedAnchors).not.toBeNull();
    expect(within(reviewedAnchors!).getByText('0 reviewed anchors')).toBeInTheDocument();
    expect(within(reviewedAnchors!).getByRole('button', { name: 'Clear reviewed anchors' })).toBeInTheDocument();
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

  it('exposes segmented settings as a valid roving-tabindex radio group', () => {
    openPreferences();
    render(() => <PreferencesPanel />);

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
    openPreferences();
    render(() => <PreferencesPanel />);

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
    openPreferences();
    render(() => <PreferencesPanel />);

    const reduceMotion = screen.getByRole('switch', { name: /Reduce motion/i });
    expect(reduceMotion).toHaveAttribute('aria-checked', 'false');
    // aria-pressed is not a supported state on role="switch" (SC 4.1.2).
    expect(reduceMotion).not.toHaveAttribute('aria-pressed');
  });

  it('names toggle switches by their title and moves help text to a description', () => {
    openPreferences();
    render(() => <PreferencesPanel />);

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
    openPreferences();
    render(() => <PreferencesPanel />);

    fireEvent.click(screen.getByRole('button', { name: /Theme and background/i }));

    expect(store.getState().showAppearance).toBe(true);
  });

  it('reviews portable vault imports before merging them', async () => {
    openPreferences();
    render(() => <PreferencesPanel />);

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
    expect(screen.getByRole('radio', { name: '1,000' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '30 days' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('radio', { name: '90 days' }));
    expect(getRetentionPolicy()).toEqual({ keep: 1000, maxAgeDays: 90 });
  });

  it('rejects an oversized portable JSON file before reading it', async () => {
    openPreferences();
    render(() => <PreferencesPanel />);
    const text = vi.fn(async () => '{"kind":"onyx-vault"}');
    const file = {
      name: 'huge-portable.json',
      size: PORTABLE_JSON_MAX_FILE_BYTES + 1,
      text,
    } as unknown as File;

    fireEvent.change(screen.getByLabelText('Import portable JSON'), { target: { files: [file] } });

    expect(await screen.findByText('huge-portable.json exceeds the 64 MiB portable JSON limit. Choose a smaller portable vault file.')).toBeInTheDocument();
    expect(text).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Review import' })).not.toBeInTheDocument();
  });

  it('surfaces and clears local extension action audit entries', () => {
    recordClientExtensionActionRun({
      id: 'open.build',
      title: 'Open build dashboard',
      capability: 'open-url',
      url: 'https://example.test/build?token=secret',
      keywords: [],
    });
    openPreferences();
    render(() => <PreferencesPanel />);

    expect(screen.getByRole('list', { name: 'Recent extension actions' })).toBeInTheDocument();
    expect(screen.getByText('Open build dashboard')).toBeInTheDocument();
    expect(screen.getByText('Opened https://example.test')).toBeInTheDocument();
    expect(screen.queryByText(/token=secret/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.queryByRole('list', { name: 'Recent extension actions' })).not.toBeInTheDocument();
    expect(screen.getByText('No extension actions recorded on this device.')).toBeInTheDocument();
  });

  it('stages a payload-safe extension action preview before explicit verified import', () => {
    openPreferences();
    render(() => <PreferencesPanel />);

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
    openPreferences();
    render(() => <PreferencesPanel />);
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
    openPreferences();
    render(() => <PreferencesPanel />);
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
    openPreferences();
    render(() => <PreferencesPanel />);
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
    openPreferences();
    render(() => <PreferencesPanel />);

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
    openPreferences();
    render(() => <PreferencesPanel />);

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
    openPreferences();
    render(() => <PreferencesPanel />);

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
    openPreferences();
    render(() => <PreferencesPanel />);

    expect(getRetentionPolicy()).toEqual({ keep: 5000, maxAgeDays: 365 });
    expect(screen.getByRole('radio', { name: '5,000' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '1 year' })).toHaveAttribute('aria-checked', 'true');
  });

  it('guards clearing local history behind an explicit confirm step', async () => {
    openPreferences();
    render(() => <PreferencesPanel />);

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
    openPreferences();
    render(() => <PreferencesPanel />);

    const card = screen.getByRole('heading', { name: 'Reviewed catch-up anchors' }).closest('section');
    expect(card).not.toBeNull();
    const controls = within(card!);
    expect(controls.getByText('1 reviewed anchor')).toBeInTheDocument();

    fireEvent.click(controls.getByRole('button', { name: 'Clear reviewed anchors' }));
    expect(controls.getByRole('group', { name: 'Confirm clear reviewed anchors' })).toBeInTheDocument();
    expect(readReviewHistory()).toHaveLength(1);

    fireEvent.click(controls.getByRole('button', { name: 'Keep reviewed anchors' }));
    expect(controls.queryByRole('group', { name: 'Confirm clear reviewed anchors' })).toBeNull();
    expect(readReviewHistory()).toHaveLength(1);

    fireEvent.click(controls.getByRole('button', { name: 'Clear reviewed anchors' }));
    fireEvent.click(controls.getByRole('button', { name: 'Erase reviewed anchors' }));

    expect(controls.getByRole('status')).toHaveTextContent('Cleared 1 reviewed anchor from this device.');
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
      if (key === REVIEW_HISTORY_KEY) throw new DOMException('blocked');
      removeItem(key);
    });
    openPreferences();
    render(() => <PreferencesPanel />);

    const card = screen.getByRole('heading', { name: 'Reviewed catch-up anchors' }).closest('section');
    const controls = within(card!);
    fireEvent.click(controls.getByRole('button', { name: 'Clear reviewed anchors' }));
    fireEvent.click(controls.getByRole('button', { name: 'Erase reviewed anchors' }));

    expect(controls.getByRole('alert')).toHaveTextContent('Could not verify that reviewed anchors were cleared');
    expect(controls.getByText('1 reviewed anchor')).toBeInTheDocument();
    expect(readReviewHistory()).toHaveLength(1);
    expect(localStorage.getItem(REVIEW_HISTORY_KEY)).not.toBeNull();
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
    openPreferences();
    render(() => <PreferencesPanel />);

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
    });
    expect(await listSearches()).toEqual([]);
    expect((await loadRecent(target)).map((message) => message.id)).toContain(vaultMessage.id);
    expect(readReviewHistory().map((entry) => entry.firstMessageId)).toContain(vaultMessage.id);
    expect(readTopicReadMarker(target, 'roadmap')?.lastReadMessageId).toBe(vaultMessage.id);
  });

  it('refreshes the saved-search count after same-tab verified changes', async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetSavedSearchesForTests();
    openPreferences();
    render(() => <PreferencesPanel />);

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
    openPreferences();
    render(() => <PreferencesPanel />);

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
    openPreferences();
    render(() => <PreferencesPanel />);

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
      if (key === TOPIC_READ_LEDGER_KEY) throw new DOMException('blocked');
      removeItem(key);
    });
    openPreferences();
    render(() => <PreferencesPanel />);

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
    saveChannelTopicDrafts({ [target]: 'topic draft remains' });
    localStorage.setItem('onyx:translation-target', 'fr');
    localStorage.setItem('onyx:calm', 'power');
    localStorage.setItem('onyx:channel-notify', JSON.stringify({ [target]: 'mentions' }));
    localStorage.setItem('onyx:credentials', 'credential payload remains');
    follow(target, 'private roadmap');
    follow('#followed-ops');
    openPreferences();
    render(() => <PreferencesPanel />);

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
    expect(localStorage.getItem(FOLLOWED_STORAGE_KEY)).toBeNull();
    expect(isFollowed(target, 'private roadmap')).toBe(false);
    expect((await loadRecent(target)).map((message) => message.id)).toContain(vaultMessage.id);
    expect((await loadOutbox()).map((entry) => entry.text)).toEqual(['queued plaintext remains']);
    expect(loadComposerDrafts()).toEqual({ [target]: 'room draft remains' });
    expect(loadChannelTopicDrafts()).toEqual({ [target]: 'topic draft remains' });
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
    openPreferences();
    render(() => <PreferencesPanel />);

    const card = screen.getByRole('heading', { name: 'Followed conversations' }).closest('section');
    const controls = within(card!);
    fireEvent.click(controls.getByRole('button', { name: 'Clear followed conversations' }));
    const removeItem = localStorage.removeItem.bind(localStorage);
    vi.spyOn(localStorage, 'removeItem').mockImplementation((key) => {
      if (key === FOLLOWED_STORAGE_KEY) throw new DOMException('blocked');
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
    expect(localStorage.getItem(FOLLOWED_STORAGE_KEY)).not.toBeNull();
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
    saveChannelTopicDrafts({ [target]: 'first topic plaintext' });

    openPreferences();
    render(() => <PreferencesPanel />);

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

    fireEvent.click(controls.getByRole('button', { name: 'Keep local drafts' }));
    await waitFor(() => expect(controls.getByRole('button', { name: 'Discard local drafts' })).toHaveFocus());
    expect(loadComposerDrafts()).toEqual({
      [target]: 'first room plaintext',
      '&draft-local': 'second room plaintext',
      alice: 'direct-message plaintext remains',
    });
    expect(loadChannelTopicDrafts()).toEqual({ [target]: 'first topic plaintext' });

    fireEvent.click(controls.getByRole('button', { name: 'Discard local drafts' }));
    store.getState().setComposerDraft('#late-room', 'late room plaintext');
    saveChannelTopicDrafts({
      ...loadChannelTopicDrafts(),
      '#late-topic': 'late topic plaintext',
    });
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
    expect(controls.getByRole('status')).not.toHaveTextContent('plaintext');
    expect(loadComposerDrafts()).toEqual({ alice: 'direct-message plaintext remains' });
    expect(store.getState().composerDrafts).toEqual({ alice: 'direct-message plaintext remains' });
    expect(loadChannelTopicDrafts()).toEqual({});
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
    saveChannelTopicDrafts({ '#retained-topic-draft': 'retained topic plaintext' });
    openPreferences();
    render(() => <PreferencesPanel />);

    const card = screen.getByRole('heading', { name: 'Local drafts' }).closest('section');
    const controls = within(card!);
    fireEvent.click(controls.getByRole('button', { name: 'Discard local drafts' }));
    const removeItem = localStorage.removeItem.bind(localStorage);
    vi.spyOn(localStorage, 'removeItem').mockImplementation((key) => {
      if (key === CHANNEL_TOPIC_DRAFTS_KEY) throw new DOMException('blocked');
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
    expect(loadComposerDrafts()).toEqual({
      '#retained-room-draft': 'retained room plaintext',
      alice: 'retained dm plaintext',
    });
    expect(store.getState().composerDrafts).toEqual({
      '#retained-room-draft': 'retained room plaintext',
      alice: 'retained dm plaintext',
    });
    expect(loadChannelTopicDrafts()).toEqual({
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
    openPreferences();
    render(() => <PreferencesPanel />);

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
    openPreferences();
    render(() => <PreferencesPanel />);

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
      if (key === TOPIC_READ_LEDGER_KEY) throw new DOMException('blocked');
      removeItem(key);
    });
    openPreferences();
    render(() => <PreferencesPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear local history' }));
    fireEvent.click(screen.getByRole('button', { name: 'Erase history' }));

    expect(await screen.findByText('Could not clear all local history. Try again after freeing storage.')).toBeInTheDocument();
    expect(localStorage.getItem(TOPIC_READ_LEDGER_KEY)).not.toBeNull();
  });

  it('resets background motion with the rest of preferences', () => {
    setSceneMotion('off');
    openPreferences();
    render(() => <PreferencesPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));

    expect(sceneMotion()).toBe('animated');
    expect(document.documentElement.dataset.sceneMotion).toBe('animated');
  });
});
