// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HistoryImportControls.test.tsx — integration tests for the on-device history
 * import UI: choose a file → preview summary → confirm → merged into the vault.
 * Exercises the real importVault + IndexedDB path via fake-indexeddb.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import {
  DiscordImportControls,
  DiscordPackageImportControls,
  SlackImportControls,
  IrcLogImportControls,
} from './HistoryImportControls';
import { loadRecent, _resetVaultForTests } from '@/lib/vault/historyVault';
import { store } from '@/lib/store';
import {
  DISCORD_PACKAGE_MAX_AGGREGATE_BYTES,
  DISCORD_PACKAGE_MAX_FILE_BYTES,
  DISCORD_PACKAGE_MAX_SELECTED_FILES,
  GENERIC_JSON_MAX_AGGREGATE_BYTES,
  GENERIC_JSON_MAX_FILE_BYTES,
  GENERIC_JSON_MAX_FILES,
  IRC_LOG_MAX_FILE_BYTES,
} from './importFileLimits';

type TrackedFile = {
  file: File;
  text: ReturnType<typeof vi.fn>;
  slice: ReturnType<typeof vi.fn>;
};

function trackedFile(name: string, contents: string, size = new TextEncoder().encode(contents).byteLength): TrackedFile {
  const text = vi.fn(async () => contents);
  const blob = new Blob([contents]);
  const slice = vi.fn((start?: number, end?: number) => blob.slice(start, end));
  return { file: { name, size, text, slice } as unknown as File, text, slice };
}

/** A File-like stand-in with realistic byte metadata. */
function fakeFile(name: string, contents: string): File {
  return trackedFile(name, contents).file;
}

function chooseFile(labelText: string, file: File): void {
  chooseFiles(labelText, [file]);
}

function chooseFiles(labelText: string, files: File[]): void {
  const input = screen.getByLabelText(labelText) as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

const discordExport = JSON.stringify({
  guild: { id: '1', name: 'Cool Project' },
  channel: { id: '100', name: 'general' },
  messages: [
    { id: 'm1', type: 'Default', timestamp: '2025-01-01T10:00:00Z', content: 'hello', author: { name: 'alice' } },
    { id: 'm2', type: 'Default', timestamp: '2025-01-01T10:05:00Z', content: 'world', author: { name: 'bob' } },
  ],
});

const MEMORY_OWNER = { serverUrl: 'wss://history-import.example/ws', identity: 'alice' } as const;

function setMemoryOwner(identity: string): void {
  store.setState({
    ourNick: identity,
    server: {
      id: `history-import-${identity}`,
      name: 'History import',
      network: 'History import',
      url: MEMORY_OWNER.serverUrl,
      icon: '',
      nick: identity,
      account: identity,
      connected: true,
    },
  });
}

beforeEach(() => {
  // Fresh, isolated vault per test.
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  _resetVaultForTests();
  cleanup();
  setMemoryOwner(MEMORY_OWNER.identity);
});

describe('DiscordImportControls', () => {
  it('previews then merges a Discord export into the vault', async () => {
    render(() => <DiscordImportControls />);
    const chooser = screen.getByLabelText('Choose Discord JSON') as HTMLInputElement;
    chooser.focus();
    chooseFile('Choose Discord JSON', fakeFile('general.json', discordExport));

    // Review summary appears with the guild name and counts.
    const review = await screen.findByText(/Ready to import 2 messages across 1 channel from Cool Project/);
    expect(review).toBeInTheDocument();
    const reviewHeading = screen.getByRole('heading', { name: 'Review import' });
    await waitFor(() => expect(reviewHeading).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'Import into vault' }));

    await screen.findByText(/Imported 2 messages into 1 channel/);
    await waitFor(() => expect(chooser).toHaveFocus());
    const stored = await loadRecent('#general', 400, MEMORY_OWNER);
    expect(stored.map((m) => m.text)).toEqual(['hello', 'world']);
    expect(await loadRecent('#general')).toHaveLength(0);
  });

  it('discards a reviewed export when the device-memory owner changes', async () => {
    render(() => <DiscordImportControls />);
    chooseFile('Choose Discord JSON', fakeFile('general.json', discordExport));
    await screen.findByText(/Ready to import 2 messages/);

    setMemoryOwner('bob');

    await waitFor(() => expect(screen.queryByRole('group', { name: 'Review import' })).not.toBeInTheDocument());
    expect(await loadRecent('#general', 400, MEMORY_OWNER)).toHaveLength(0);
    expect(await loadRecent('#general', 400, { ...MEMORY_OWNER, identity: 'bob' })).toHaveLength(0);
  });

  it('rejects a non-Discord JSON file without offering an import', async () => {
    render(() => <DiscordImportControls />);
    chooseFile('Choose Discord JSON', fakeFile('nope.json', JSON.stringify({ hello: 'world' })));

    await screen.findByText(/No Discord export recognized/);
    expect(screen.queryByRole('button', { name: 'Import into vault' })).toBeNull();
  });

  it('cancels a pending import without touching the vault', async () => {
    render(() => <DiscordImportControls />);
    const chooser = screen.getByLabelText('Choose Discord JSON') as HTMLInputElement;
    chooseFile('Choose Discord JSON', fakeFile('general.json', discordExport));
    await screen.findByText(/Ready to import/);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    await screen.findByText(/Import cancelled/);
    await waitFor(() => expect(chooser).toHaveFocus());
    const stored = await loadRecent('#general', 400, MEMORY_OWNER);
    expect(stored).toHaveLength(0);
  });

  it('rejects too many JSON files before reading any selection', async () => {
    const text = vi.fn(async () => discordExport);
    const files = Array.from({ length: GENERIC_JSON_MAX_FILES + 1 }, (_, index) => ({
      name: `${index}.json`,
      size: 1,
      text,
    } as unknown as File));
    render(() => <DiscordImportControls />);

    chooseFiles('Choose Discord JSON', files);

    await screen.findByText(`Choose no more than ${GENERIC_JSON_MAX_FILES} JSON files at once. Split this import into smaller batches.`);
    expect(text).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Import into vault' })).not.toBeInTheDocument();
  });

  it('rejects an oversized Discord JSON file before reading it', async () => {
    const oversized = trackedFile('huge.json', discordExport, GENERIC_JSON_MAX_FILE_BYTES + 1);
    render(() => <DiscordImportControls />);

    chooseFile('Choose Discord JSON', oversized.file);

    await screen.findByText('huge.json exceeds the 64 MiB per-file JSON limit. Split or export it as smaller JSON files, then try again.');
    expect(oversized.text).not.toHaveBeenCalled();
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
    const chooser = screen.getByLabelText('Choose Slack JSON') as HTMLInputElement;
    chooseFile('Choose Slack JSON', fakeFile('dev.json', slackExport));

    await screen.findByText(/Ready to import 1 message across 1 channel from Acme/);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Review import' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Import into vault' }));

    await screen.findByText(/Imported 1 message into 1 channel/);
    await waitFor(() => expect(chooser).toHaveFocus());
    const stored = await loadRecent('#dev', 400, MEMORY_OWNER);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.text).toContain('ship it');
  });

  it('rejects a Slack JSON batch over the aggregate limit before any read', async () => {
    const files = Array.from({ length: 4 }, (_, index) =>
      trackedFile(`${index}.json`, '{}', GENERIC_JSON_MAX_AGGREGATE_BYTES / 3).file
    );
    render(() => <SlackImportControls />);

    chooseFiles('Choose Slack JSON', files);

    await screen.findByText('Those JSON files exceed the 192 MiB total import limit. Choose a smaller batch.');
    for (const file of files) expect(file.text).not.toHaveBeenCalled();
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
    fireEvent.input(screen.getByLabelText('Room'), { target: { value: '#dev' } });
    const chooser = screen.getByLabelText('Choose log file') as HTMLInputElement;
    const log = trackedFile(
      'log.txt',
      '2025-01-01 10:00:00\t<alice>\thi there\n2025-01-01 10:01:00\t<bob>\thello',
    );
    chooseFile(
      'Choose log file',
      log.file,
    );

    await screen.findByText(/Ready to import 2 messages into #dev/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Review import' })).toHaveTextContent('2 messages into #dev');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Review import' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Import into #dev' }));

    await screen.findByText(/Imported 2 messages into #dev/);
    await waitFor(() => expect(chooser).toHaveFocus());
    const stored = await loadRecent('#dev', 400, MEMORY_OWNER);
    expect(stored).toHaveLength(2);
    expect(log.slice).toHaveBeenCalled();
    expect(log.text).not.toHaveBeenCalled();
  });

  it('warns when normalization changes the requested label and confirms only the exact displayed target', async () => {
    render(() => <IrcLogImportControls />);
    fireEvent.input(screen.getByLabelText('Room'), { target: { value: '  #Ops Room!  ' } });
    chooseFile('Choose log file', fakeFile('ops.log', '2025-01-01 10:00:00\t<alice>\tship it'));

    await screen.findByText(/Ready to import 1 message into #ops-room/);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Room destination changed. Requested " #Ops Room! "; import destination: #ops-room. Confirm only if this is the intended room.',
    );
    expect(await loadRecent('#ops-room', 400, MEMORY_OWNER)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Import into #ops-room' }));

    await screen.findByText(/Imported 1 message into #ops-room/);
    expect((await loadRecent('#ops-room', 400, MEMORY_OWNER)).map(message => message.text)).toEqual(['ship it']);
    expect(await loadRecent('#ops room!', 400, MEMORY_OWNER)).toHaveLength(0);
  });

  it('makes a collision-looking label explicit before any merge', async () => {
    render(() => <IrcLogImportControls />);
    fireEvent.input(screen.getByLabelText('Room'), { target: { value: '#ops---room!' } });
    chooseFile('Choose log file', fakeFile('ops.log', '2025-01-01 10:00:00\t<alice>\tship it'));

    await screen.findByText(/Ready to import 1 message into #ops-room/);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Requested "#ops---room!"; import destination: #ops-room',
    );
    expect(screen.getByRole('button', { name: 'Import into #ops-room' })).toBeInTheDocument();
    expect(await loadRecent('#ops-room', 400, MEMORY_OWNER)).toHaveLength(0);
  });

  it('rejects a requested label that normalizes to an unsafe target before reading the log', async () => {
    const unsafe = trackedFile('unsafe.log', '2025-01-01 10:00:00\t<alice>\tignored');
    render(() => <IrcLogImportControls />);
    fireEvent.input(screen.getByLabelText('Room'), { target: { value: '___' } });

    chooseFile('Choose log file', unsafe.file);

    await screen.findByText('The requested room "___" does not normalize to a safe destination. Enter a room name containing letters or numbers (for example, #dev).');
    expect(unsafe.text).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Review import' })).not.toBeInTheDocument();
  });

  it('rejects an oversized IRC log before reading it', async () => {
    const oversized = trackedFile('huge.log', 'ignored', IRC_LOG_MAX_FILE_BYTES + 1);
    render(() => <IrcLogImportControls />);
    fireEvent.input(screen.getByLabelText('Room'), { target: { value: '#dev' } });

    chooseFile('Choose log file', oversized.file);

    await screen.findByText('huge.log exceeds the 128 MiB IRC log limit. Split the log and import each part separately.');
    expect(oversized.text).not.toHaveBeenCalled();
  });
});

/** A package File-like: name is the basename; webkitRelativePath is the tree path. */
function trackedPackageFile(
  path: string,
  contents: string,
  size = new TextEncoder().encode(contents).byteLength,
): TrackedFile {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const tracked = trackedFile(name, contents, size);
  return {
    file: { ...tracked.file, name, size, webkitRelativePath: path, text: tracked.text } as unknown as File,
    text: tracked.text,
    slice: tracked.slice,
  };
}

function fakePackageFile(path: string, contents: string): File {
  return trackedPackageFile(path, contents).file;
}

const packageFiles = [
  fakePackageFile('account/user.json', JSON.stringify({ username: 'devin', global_name: 'Devin' })),
  fakePackageFile('messages/index.json', JSON.stringify({ '100000000000000100': 'general' })),
  fakePackageFile(
    'messages/c100000000000000100/channel.json',
    JSON.stringify({ id: '100000000000000100', type: 0, name: 'general', guild: { id: '9', name: 'My Server' } }),
  ),
  fakePackageFile(
    'messages/c100000000000000100/messages.json',
    JSON.stringify([
      { ID: 'a1', Timestamp: '2025-01-01 10:00:00', Contents: 'hello', Attachments: '' },
      { ID: 'a2', Timestamp: '2025-01-01 10:05:00', Contents: 'world', Attachments: '' },
    ]),
  ),
];

describe('DiscordPackageImportControls — a11y contracts', () => {
  it('names the directory picker so a screen reader can announce it', () => {
    render(() => <DiscordPackageImportControls />);
    // The wrapping <label> supplies the accessible name for the webkitdirectory input.
    expect(screen.getByLabelText('Choose package folder')).toHaveAttribute('type', 'file');
  });

  it('keeps a polite status live region mounted before any interaction', () => {
    render(() => <DiscordPackageImportControls />);
    // SC 4.1.3: a status node created together with its text is not reliably
    // announced, so the region must already exist (and be empty) on load.
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('');
  });

  it('announces the ready-to-import preview through the same region', async () => {
    render(() => <DiscordPackageImportControls />);
    const input = screen.getByLabelText('Choose package folder') as HTMLInputElement;
    fireEvent.change(input, { target: { files: packageFiles } });

    const region = await screen.findByRole('status');
    await screen.findByText(/Ready to import 2 messages across 1 channel from My Server/);
    expect(region).toHaveTextContent(/Ready to import 2 messages/);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Review import' })).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('rejects excessive selected-file count before reading any package file', async () => {
    const text = vi.fn(async () => '{}');
    const files = Array.from({ length: DISCORD_PACKAGE_MAX_SELECTED_FILES + 1 }, (_, index) => ({
      name: `${index}.ignored`,
      size: 1,
      webkitRelativePath: `misc/${index}.ignored`,
      text,
    } as unknown as File));
    render(() => <DiscordPackageImportControls />);

    chooseFiles('Choose package folder', files);

    await screen.findByText(`That folder contains more than ${DISCORD_PACKAGE_MAX_SELECTED_FILES} selected files. Choose a smaller unzipped Discord package folder.`);
    expect(text).not.toHaveBeenCalled();
  });

  it('rejects an oversized recognized package file before reading any recognized file', async () => {
    const metadata = trackedPackageFile('messages/index.json', '{}');
    const oversized = trackedPackageFile(
      'messages/c100/messages.json',
      '[]',
      DISCORD_PACKAGE_MAX_FILE_BYTES + 1,
    );
    render(() => <DiscordPackageImportControls />);

    chooseFiles('Choose package folder', [metadata.file, oversized.file]);

    await screen.findByText('messages/c100/messages.json exceeds the 128 MiB per-file Discord package limit. Remove that channel export or choose a smaller package.');
    expect(metadata.text).not.toHaveBeenCalled();
    expect(oversized.text).not.toHaveBeenCalled();
  });

  it('rejects recognized package files over the aggregate limit before reading any', async () => {
    const files = [
      trackedPackageFile('a/messages.json', '[]', DISCORD_PACKAGE_MAX_AGGREGATE_BYTES / 2),
      trackedPackageFile('b/messages.csv', '', DISCORD_PACKAGE_MAX_AGGREGATE_BYTES / 2),
      trackedPackageFile('c/channel.json', '{}', 1),
    ];
    render(() => <DiscordPackageImportControls />);

    chooseFiles('Choose package folder', files.map(item => item.file));

    await screen.findByText('Recognized Discord package files exceed the 256 MiB total import limit. Choose a smaller package folder.');
    for (const file of files) expect(file.text).not.toHaveBeenCalled();
  });

  it('ignores unrecognized package files before byte accounting and never reads them', async () => {
    const unrecognized = trackedPackageFile(
      'activity/huge.bin',
      'not import data',
      DISCORD_PACKAGE_MAX_AGGREGATE_BYTES + 1,
    );
    render(() => <DiscordPackageImportControls />);

    chooseFiles('Choose package folder', [unrecognized.file, ...packageFiles]);

    await screen.findByText(/Ready to import 2 messages across 1 channel from My Server/);
    expect(unrecognized.text).not.toHaveBeenCalled();
  });
});
