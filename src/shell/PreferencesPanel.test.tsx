import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordClientExtensionActionRun } from '@/lib/extensions/clientActions';
import { closePreferences, openPreferences, resetPreferences } from '@/lib/prefs/preferences';
import { sceneMotion, setSceneMotion } from '@/lib/prefs/sceneMotion';
import { PreferencesPanel } from './PreferencesPanel';

describe('PreferencesPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPreferences();
    closePreferences();
  });

  afterEach(() => {
    cleanup();
    closePreferences();
    localStorage.clear();
  });

  it('surfaces the client accessibility audit ledger', () => {
    openPreferences();
    render(() => <PreferencesPanel />);

    expect(screen.getByTestId('preferences-panel')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Client access audit' })).toBeInTheDocument();
    expect(screen.getByText('Feature switches')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Show 24-hour activity strip/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /Show join voice\/video controls/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /Show topic, forum, and follow controls/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: /Show shared watch activity/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('heading', { name: 'Portable vault' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export vault' })).toBeInTheDocument();
    expect(screen.getByLabelText('Import portable JSON')).toHaveAttribute('type', 'file');
    expect(screen.getByRole('heading', { name: 'Installed app readiness' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Install guide' })).toHaveAttribute('href', '/install/');
    expect(screen.getByRole('list', { name: 'Installed app readiness checks' })).toBeInTheDocument();
    expect(screen.getByText('App window')).toBeInTheDocument();
    expect(screen.getByText('Service worker')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Local state')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Extension action audit' })).toBeInTheDocument();
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
    };

    const input = screen.getByLabelText('Import portable JSON') as HTMLInputElement;
    const file = new File([JSON.stringify(snapshot)], 'onyx-portable.json', {
      type: 'application/json',
    });
    await fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole('heading', { name: 'Review import' })).toBeInTheDocument();
    expect(screen.getByText(/onyx-portable\.json: 2 messages, 1 target, 1 review, 1 room draft, and 1 topic draft/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import reviewed file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel import' })).toBeInTheDocument();
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

  it('resets background motion with the rest of preferences', () => {
    setSceneMotion('off');
    openPreferences();
    render(() => <PreferencesPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));

    expect(sceneMotion()).toBe('animated');
    expect(document.documentElement.dataset.sceneMotion).toBe('animated');
  });
});
