/**
 * HistoryImportControls.test.tsx — integration tests for the on-device history
 * import UI: choose a file → preview summary → confirm → merged into the vault.
 * Exercises the real importVault + IndexedDB path via fake-indexeddb.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { DiscordImportControls, SlackImportControls, IrcLogImportControls } from './HistoryImportControls';
import { loadRecent, _resetVaultForTests } from '@/lib/vault/historyVault';

/** A File-like stand-in: the controls only read `.name` and `.text()`. */
function fakeFile(name: string, contents: string): File {
  return { name, text: async () => contents } as unknown as File;
}

function chooseFile(labelText: string, file: File): void {
  const input = screen.getByLabelText(labelText) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

const discordExport = JSON.stringify({
  guild: { id: '1', name: 'Cool Project' },
  channel: { id: '100', name: 'general' },
  messages: [
    { id: 'm1', type: 'Default', timestamp: '2025-01-01T10:00:00Z', content: 'hello', author: { name: 'alice' } },
    { id: 'm2', type: 'Default', timestamp: '2025-01-01T10:05:00Z', content: 'world', author: { name: 'bob' } },
  ],
});

beforeEach(() => {
  // Fresh, isolated vault per test.
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  _resetVaultForTests();
  cleanup();
});

describe('DiscordImportControls', () => {
  it('previews then merges a Discord export into the vault', async () => {
    render(() => <DiscordImportControls />);
    chooseFile('Choose Discord JSON', fakeFile('general.json', discordExport));

    // Review summary appears with the guild name and counts.
    const review = await screen.findByText(/Ready to import 2 messages across 1 channel from Cool Project/);
    expect(review).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Import into vault' }));

    await screen.findByText(/Imported 2 messages into 1 channel/);
    const stored = await loadRecent('#general');
    expect(stored.map((m) => m.text)).toEqual(['hello', 'world']);
  });

  it('rejects a non-Discord JSON file without offering an import', async () => {
    render(() => <DiscordImportControls />);
    chooseFile('Choose Discord JSON', fakeFile('nope.json', JSON.stringify({ hello: 'world' })));

    await screen.findByText(/No Discord export recognized/);
    expect(screen.queryByRole('button', { name: 'Import into vault' })).toBeNull();
  });

  it('cancels a pending import without touching the vault', async () => {
    render(() => <DiscordImportControls />);
    chooseFile('Choose Discord JSON', fakeFile('general.json', discordExport));
    await screen.findByText(/Ready to import/);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    await screen.findByText(/Import cancelled/);
    const stored = await loadRecent('#general');
    expect(stored).toHaveLength(0);
  });
});

describe('SlackImportControls', () => {
  it('merges a Slack channel export, showing the workspace name', async () => {
    const slackExport = JSON.stringify({
      channels: [
        {
          channel: { name: 'dev' },
          messages: [
            { type: 'message', user: 'U1', text: 'ship it', ts: '1735725600.000100' },
          ],
        },
      ],
      users: [{ id: 'U1', name: 'alice' }],
      workspace: 'Acme',
    });
    render(() => <SlackImportControls />);
    chooseFile('Choose Slack JSON', fakeFile('dev.json', slackExport));

    await screen.findByText(/Ready to import 1 message across 1 channel from Acme/);
    fireEvent.click(screen.getByRole('button', { name: 'Import into vault' }));

    await screen.findByText(/Imported 1 message into 1 channel/);
    const stored = await loadRecent('#dev');
    expect(stored).toHaveLength(1);
    expect(stored[0]!.text).toContain('ship it');
  });
});

describe('IrcLogImportControls', () => {
  it('requires a channel before a file can be imported', async () => {
    render(() => <IrcLogImportControls />);
    chooseFile('Choose log file', fakeFile('log.txt', '2025-01-01 10:00:00\t<alice>\thi there'));
    await screen.findByText(/Enter the channel these logs belong to first/);
  });

  it('imports a plain-text IRC log into the named channel', async () => {
    render(() => <IrcLogImportControls />);
    fireEvent.input(screen.getByLabelText('Channel'), { target: { value: '#dev' } });
    chooseFile(
      'Choose log file',
      fakeFile('log.txt', '2025-01-01 10:00:00\t<alice>\thi there\n2025-01-01 10:01:00\t<bob>\thello'),
    );

    await screen.findByText(/Ready to import 2 messages into #dev/);
    fireEvent.click(screen.getByRole('button', { name: 'Import into vault' }));

    await screen.findByText(/Imported 2 messages into #dev/);
    const stored = await loadRecent('#dev');
    expect(stored).toHaveLength(2);
  });
});
