// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ChannelOrganizationSection — manage store channelFolders (Era 3 C5 UI).
 */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import type { DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';
import { useStore, getState } from '@/lib/store';
import { Button } from '@/primitives/index';

export interface ChannelOrganizationSectionProps {
  owner: DeviceMemoryOwner | null;
}

export function ChannelOrganizationSection(props: ChannelOrganizationSectionProps): JSX.Element {
  const channels = useStore((s) => s.channels);
  const folders = useStore((s) => s.channelFolders);
  const [newName, setNewName] = createSignal('');
  const [assignTarget, setAssignTarget] = createSignal('');
  const [assignFolder, setAssignFolder] = createSignal('');
  const [status, setStatus] = createSignal<string | null>(null);

  const channelNames = createMemo(() => {
    const names: string[] = [];
    channels().forEach((ch) => names.push(ch.name));
    return names.sort((a, b) => a.localeCompare(b));
  });

  const customFolders = createMemo(() =>
    folders().filter((f) => f.id !== 'default'),
  );

  function onCreate(): void {
    const name = newName().trim();
    if (!name) {
      setStatus('Enter a folder name.');
      return;
    }
    getState().createFolder(name);
    setNewName('');
    setStatus('Folder created on this device.');
  }

  function onAssign(): void {
    const folder = assignFolder();
    const channel = assignTarget();
    if (!folder || !channel) {
      setStatus('Pick a folder and a room.');
      return;
    }
    getState().addChannelToFolder(channel, folder);
    setStatus(`Assigned ${channel}.`);
  }

  return (
    <Show when={props.owner}>
      <section
        class="acct-section"
        aria-labelledby="acct-org-title"
        aria-describedby="acct-org-hint"
        data-testid="channel-organization-section"
      >
        <div class="acct-section-head">
          <h3 class="acct-section-title" id="acct-org-title">
            Room folders
          </h3>
          <p class="acct-section-hint" id="acct-org-hint">
            Local folders for the sidebar (this device). Star rooms in the sidebar for
            Favorites; folders group the rest. Server guild hierarchy is a later slice.
          </p>
        </div>
        <div class="acct-section-body">
          <div class="acct-cert-actions">
            <input
              type="text"
              data-testid="org-folder-name"
              placeholder="Folder name"
              maxlength={48}
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
              style={{
                flex: '1 1 auto',
                'min-width': '8rem',
                padding: '0.4rem 0.55rem',
                background: 'var(--stone-2)',
                border: '1px solid var(--seam)',
                color: 'var(--paper)',
                'border-radius': 'var(--r-sm)',
              }}
            />
            <Button type="button" variant="ghost" size="sm" data-testid="org-folder-create" onClick={onCreate}>
              Create folder
            </Button>
          </div>

          <div class="acct-cert-actions">
            <select
              data-testid="org-assign-folder"
              value={assignFolder()}
              onChange={(e) => setAssignFolder(e.currentTarget.value)}
            >
              <option value="">Folder…</option>
              <For each={customFolders()}>
                {(cat) => <option value={cat.id}>{cat.name}</option>}
              </For>
            </select>
            <select
              data-testid="org-assign-channel"
              value={assignTarget()}
              onChange={(e) => setAssignTarget(e.currentTarget.value)}
            >
              <option value="">Room…</option>
              <For each={channelNames()}>
                {(name) => <option value={name}>{name}</option>}
              </For>
            </select>
            <Button type="button" variant="ghost" size="sm" data-testid="org-assign" onClick={onAssign}>
              Assign
            </Button>
          </div>

          <Show
            when={customFolders().length > 0}
            fallback={<p class="acct-section-hint">No custom folders yet — create one above.</p>}
          >
            <ul class="acct-cert-list" aria-label="Room folders">
              <For each={customFolders()}>
                {(cat) => (
                  <li class="acct-cert-item" data-testid="org-folder-row">
                    <strong>{cat.name}</strong>
                    {' '}
                    <span class="acct-persona-src">{cat.channels.length} room(s)</span>
                    <Show when={cat.channels.length > 0}>
                      <ul>
                        <For each={cat.channels}>
                          {(ch) => <li>{ch}</li>}
                        </For>
                      </ul>
                    </Show>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete folder ${cat.name}`}
                      onClick={() => {
                        getState().deleteFolder(cat.id);
                        setStatus(`Deleted ${cat.name}.`);
                      }}
                    >
                      Delete folder
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <Show when={status()}>
            {(msg) => (
              <p class="acct-section-hint" role="status" data-testid="org-status">
                {msg()}
              </p>
            )}
          </Show>
        </div>
      </section>
    </Show>
  );
}

export default ChannelOrganizationSection;
