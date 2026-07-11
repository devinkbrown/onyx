// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import type { ExtensionManifest } from './manifest';
import {
  EXTENSION_SANDBOX_MESSAGE_VERSION,
  createExtensionSandboxHost,
  normalizeApprovedSlashCommands,
  normalizeSandboxHostRequest,
  normalizeSandboxHostResponse,
  type ExtensionSandboxEndpoint,
  type ExtensionSandboxHostResponse,
  type ExtensionSandboxMessageEvent,
} from './sandboxHost';

class MockWorkerEndpoint implements ExtensionSandboxEndpoint {
  readonly sent: ExtensionSandboxHostResponse[] = [];

  private listener: ((event: ExtensionSandboxMessageEvent) => void) | null = null;

  postMessage(message: ExtensionSandboxHostResponse): void {
    this.sent.push(message);
  }

  addEventListener(_type: 'message', listener: (event: ExtensionSandboxMessageEvent) => void): void {
    this.listener = listener;
  }

  removeEventListener(_type: 'message', listener: (event: ExtensionSandboxMessageEvent) => void): void {
    if (this.listener === listener) this.listener = null;
  }

  receive(data: unknown): void {
    this.listener?.({ data });
  }
}

const fullManifest: ExtensionManifest = {
  name: 'Build Helper',
  version: '1.0.0',
  manifestVersion: 1,
  permissions: ['channel:read-current', 'command:send-approved'],
  entry: 'worker.mjs',
};

function flushPromises(): Promise<void> {
  return Promise.resolve();
}

describe('extension sandbox host', () => {
  it('validates inbound request envelopes before handling them', () => {
    expect(normalizeSandboxHostRequest({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'request-1',
      type: 'read-current-channel',
    })).toEqual({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'request-1',
      type: 'read-current-channel',
    });

    expect(normalizeSandboxHostRequest({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'request-2',
      type: 'send-approved-command',
      command: '/me builds',
    })).toEqual({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'request-2',
      type: 'send-approved-command',
      command: '/me builds',
    });

    expect(normalizeSandboxHostRequest({ id: 'request-1', type: 'read-current-channel' })).toBeNull();
    expect(normalizeSandboxHostRequest({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: '../request',
      type: 'read-current-channel',
    })).toBeNull();
    expect(normalizeSandboxHostRequest({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'request-3',
      type: 'send-approved-command',
      command: 'raw text',
    })).toBeNull();
  });

  it('validates outbound response envelopes before posting them', () => {
    expect(normalizeSandboxHostResponse({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'read-1',
      type: 'current-channel',
      channelName: '#builds',
    })).toEqual({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'read-1',
      type: 'current-channel',
      channelName: '#builds',
    });

    expect(normalizeSandboxHostResponse({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'cmd-1',
      type: 'command-sent',
      command: '/me builds',
      accepted: true,
    })).toEqual({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'cmd-1',
      type: 'command-sent',
      command: '/me builds',
      accepted: true,
    });

    expect(normalizeSandboxHostResponse({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'bad-1',
      type: 'error',
      code: 'permission-denied',
      message: 'Denied',
    })).toMatchObject({
      id: 'bad-1',
      type: 'error',
      code: 'permission-denied',
    });

    expect(normalizeSandboxHostResponse({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'cmd-2',
      type: 'command-sent',
      command: '/me builds',
      accepted: false,
    })).toBeNull();
    expect(normalizeSandboxHostResponse({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'bad-2',
      type: 'error',
      code: 'raw-exception',
      message: 'Nope',
    })).toBeNull();
  });

  it('round-trips current channel reads when the manifest has the permission', async () => {
    const endpoint = new MockWorkerEndpoint();
    const sendApprovedSlashCommand = vi.fn();

    createExtensionSandboxHost({
      manifest: fullManifest,
      endpoint,
      approvedSlashCommands: [],
      readCurrentChannelName: () => '#builds',
      sendApprovedSlashCommand,
    });

    endpoint.receive({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'read-1',
      type: 'read-current-channel',
    });
    await flushPromises();

    expect(endpoint.sent).toEqual([{
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'read-1',
      type: 'current-channel',
      channelName: '#builds',
    }]);
    expect(sendApprovedSlashCommand).not.toHaveBeenCalled();
  });

  it('rejects current channel reads without the channel capability', async () => {
    const endpoint = new MockWorkerEndpoint();

    createExtensionSandboxHost({
      manifest: { ...fullManifest, permissions: ['command:send-approved'] },
      endpoint,
      approvedSlashCommands: ['/me builds'],
      readCurrentChannelName: () => '#builds',
      sendApprovedSlashCommand: vi.fn(),
    });

    endpoint.receive({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'read-denied',
      type: 'read-current-channel',
    });
    await flushPromises();

    expect(endpoint.sent[0]).toMatchObject({
      id: 'read-denied',
      type: 'error',
      code: 'permission-denied',
    });
  });

  it('sends only pre-approved allowlisted slash commands', async () => {
    const endpoint = new MockWorkerEndpoint();
    const sendApprovedSlashCommand = vi.fn();

    createExtensionSandboxHost({
      manifest: fullManifest,
      endpoint,
      approvedSlashCommands: ['/me builds', '/topic release'],
      readCurrentChannelName: () => '#builds',
      sendApprovedSlashCommand,
    });

    endpoint.receive({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'cmd-1',
      type: 'send-approved-command',
      command: '/me builds',
    });
    await flushPromises();

    expect(sendApprovedSlashCommand).toHaveBeenCalledWith('/me builds');
    expect(endpoint.sent).toEqual([{
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'cmd-1',
      type: 'command-sent',
      command: '/me builds',
      accepted: true,
    }]);
  });

  it('rejects non-allowlisted commands even with command permission', async () => {
    const endpoint = new MockWorkerEndpoint();
    const sendApprovedSlashCommand = vi.fn();

    createExtensionSandboxHost({
      manifest: fullManifest,
      endpoint,
      approvedSlashCommands: ['/me builds'],
      readCurrentChannelName: () => '#builds',
      sendApprovedSlashCommand,
    });

    endpoint.receive({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'cmd-denied',
      type: 'send-approved-command',
      command: '/join #secret',
    });
    await flushPromises();

    expect(sendApprovedSlashCommand).not.toHaveBeenCalled();
    expect(endpoint.sent[0]).toMatchObject({
      id: 'cmd-denied',
      type: 'error',
      code: 'command-not-approved',
    });
  });

  it('rejects command sends without the command capability', async () => {
    const endpoint = new MockWorkerEndpoint();
    const sendApprovedSlashCommand = vi.fn();

    createExtensionSandboxHost({
      manifest: { ...fullManifest, permissions: ['channel:read-current'] },
      endpoint,
      approvedSlashCommands: ['/me builds'],
      readCurrentChannelName: () => '#builds',
      sendApprovedSlashCommand,
    });

    endpoint.receive({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'cmd-permission-denied',
      type: 'send-approved-command',
      command: '/me builds',
    });
    await flushPromises();

    expect(sendApprovedSlashCommand).not.toHaveBeenCalled();
    expect(endpoint.sent[0]).toMatchObject({
      id: 'cmd-permission-denied',
      type: 'error',
      code: 'permission-denied',
    });
  });

  it('reports malformed messages through the outbound schema', () => {
    const endpoint = new MockWorkerEndpoint();

    createExtensionSandboxHost({
      manifest: fullManifest,
      endpoint,
      approvedSlashCommands: [],
      readCurrentChannelName: () => null,
      sendApprovedSlashCommand: vi.fn(),
    });

    endpoint.receive({ type: 'read-current-channel' });

    expect(endpoint.sent).toEqual([{
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'unknown',
      type: 'error',
      code: 'bad-message',
      message: 'Malformed extension host request.',
    }]);
  });

  it('disposes the message listener', () => {
    const endpoint = new MockWorkerEndpoint();

    const host = createExtensionSandboxHost({
      manifest: fullManifest,
      endpoint,
      approvedSlashCommands: [],
      readCurrentChannelName: () => '#builds',
      sendApprovedSlashCommand: vi.fn(),
    });

    host.dispose();
    endpoint.receive({
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id: 'after-dispose',
      type: 'read-current-channel',
    });

    expect(endpoint.sent).toEqual([]);
  });

  it('normalizes the host command allowlist defensively', () => {
    expect(normalizeApprovedSlashCommands([
      '/me builds',
      '/me builds',
      'not slash',
      '/bad\nnewline',
      '/topic release',
    ])).toEqual(['/me builds', '/topic release']);
  });
});
