import type { ExtensionManifest, ExtensionPermission } from './manifest';

export const EXTENSION_SANDBOX_MESSAGE_VERSION = 1;

export type ExtensionSandboxHostRequest =
  | {
    onyxExtension: typeof EXTENSION_SANDBOX_MESSAGE_VERSION;
    id: string;
    type: 'read-current-channel';
  }
  | {
    onyxExtension: typeof EXTENSION_SANDBOX_MESSAGE_VERSION;
    id: string;
    type: 'send-approved-command';
    command: string;
  };

export type ExtensionSandboxHostResponse =
  | {
    onyxExtension: typeof EXTENSION_SANDBOX_MESSAGE_VERSION;
    id: string;
    type: 'current-channel';
    channelName: string | null;
  }
  | {
    onyxExtension: typeof EXTENSION_SANDBOX_MESSAGE_VERSION;
    id: string;
    type: 'command-sent';
    command: string;
    accepted: true;
  }
  | {
    onyxExtension: typeof EXTENSION_SANDBOX_MESSAGE_VERSION;
    id: string;
    type: 'error';
    code: ExtensionSandboxErrorCode;
    message: string;
  };

export type ExtensionSandboxErrorCode =
  | 'bad-message'
  | 'permission-denied'
  | 'command-not-approved'
  | 'handler-failed';

export type ExtensionSandboxMessageEvent = {
  data: unknown;
};

export type ExtensionSandboxEndpoint = {
  postMessage(message: ExtensionSandboxHostResponse): void;
  addEventListener(type: 'message', listener: (event: ExtensionSandboxMessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: ExtensionSandboxMessageEvent) => void): void;
};

export type ExtensionSandboxHostOptions = {
  manifest: ExtensionManifest;
  endpoint: ExtensionSandboxEndpoint;
  approvedSlashCommands: readonly string[];
  readCurrentChannelName: () => string | null;
  sendApprovedSlashCommand: (command: string) => void | Promise<void>;
};

export type ExtensionSandboxHost = {
  dispose: () => void;
};

const MAX_ID_LENGTH = 64;
const MAX_CHANNEL_NAME_LENGTH = 80;
const MAX_COMMAND_LENGTH = 160;
const COMMAND_PATTERN = /^\/[A-Za-z][A-Za-z0-9_-]*(?: [^\r\n]*)?$/;

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasPermission(manifest: ExtensionManifest, permission: ExtensionPermission): boolean {
  return manifest.permissions.includes(permission);
}

function isSandboxErrorCode(value: unknown): value is ExtensionSandboxErrorCode {
  return value === 'bad-message'
    || value === 'permission-denied'
    || value === 'command-not-approved'
    || value === 'handler-failed';
}

function normalizeChannelName(value: string | null): string | null {
  if (value === null) return null;
  return cleanString(value, MAX_CHANNEL_NAME_LENGTH);
}

export function normalizeApprovedSlashCommands(commands: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const command of commands) {
    const cleaned = cleanString(command, MAX_COMMAND_LENGTH);
    if (!cleaned || !COMMAND_PATTERN.test(cleaned) || seen.has(cleaned)) continue;
    seen.add(cleaned);
    normalized.push(cleaned);
  }

  return normalized;
}

export function normalizeSandboxHostRequest(raw: unknown): ExtensionSandboxHostRequest | null {
  if (!isRecord(raw) || raw.onyxExtension !== EXTENSION_SANDBOX_MESSAGE_VERSION) return null;

  const id = cleanString(raw.id, MAX_ID_LENGTH);
  if (!id || !/^[A-Za-z0-9._:-]+$/.test(id)) return null;

  if (raw.type === 'read-current-channel') {
    return {
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id,
      type: 'read-current-channel',
    };
  }

  if (raw.type === 'send-approved-command') {
    const command = cleanString(raw.command, MAX_COMMAND_LENGTH);
    if (!command || !COMMAND_PATTERN.test(command)) return null;
    return {
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id,
      type: 'send-approved-command',
      command,
    };
  }

  return null;
}

export function normalizeSandboxHostResponse(raw: unknown): ExtensionSandboxHostResponse | null {
  if (!isRecord(raw) || raw.onyxExtension !== EXTENSION_SANDBOX_MESSAGE_VERSION) return null;

  const id = cleanString(raw.id, MAX_ID_LENGTH);
  if (!id || !/^[A-Za-z0-9._:-]+$/.test(id)) return null;

  if (raw.type === 'current-channel') {
    if (raw.channelName !== null && typeof raw.channelName !== 'string') return null;
    return {
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id,
      type: 'current-channel',
      channelName: normalizeChannelName(raw.channelName),
    };
  }

  if (raw.type === 'command-sent') {
    const command = cleanString(raw.command, MAX_COMMAND_LENGTH);
    if (!command || !COMMAND_PATTERN.test(command) || raw.accepted !== true) return null;
    return {
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id,
      type: 'command-sent',
      command,
      accepted: true,
    };
  }

  if (raw.type === 'error') {
    const message = cleanString(raw.message, 160);
    if (!isSandboxErrorCode(raw.code) || !message) return null;
    return {
      onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
      id,
      type: 'error',
      code: raw.code,
      message,
    };
  }

  return null;
}

function errorResponse(
  id: string,
  code: ExtensionSandboxErrorCode,
  message: string,
): ExtensionSandboxHostResponse {
  return {
    onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
    id,
    type: 'error',
    code,
    message,
  };
}

function postResponse(endpoint: ExtensionSandboxEndpoint, response: ExtensionSandboxHostResponse): void {
  const normalized = normalizeSandboxHostResponse(response);
  if (normalized) endpoint.postMessage(normalized);
}

function postBadMessage(endpoint: ExtensionSandboxEndpoint): void {
  postResponse(endpoint, errorResponse('unknown', 'bad-message', 'Malformed extension host request.'));
}

export function createExtensionSandboxHost(options: ExtensionSandboxHostOptions): ExtensionSandboxHost {
  const approvedCommands = new Set(normalizeApprovedSlashCommands(options.approvedSlashCommands));

  async function handleRequest(request: ExtensionSandboxHostRequest): Promise<void> {
    if (request.type === 'read-current-channel') {
      if (!hasPermission(options.manifest, 'channel:read-current')) {
        postResponse(options.endpoint, errorResponse(request.id, 'permission-denied', 'Extension cannot read the current channel.'));
        return;
      }

      const channelName = normalizeChannelName(options.readCurrentChannelName());
      postResponse(options.endpoint, {
        onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
        id: request.id,
        type: 'current-channel',
        channelName,
      });
      return;
    }

    if (!hasPermission(options.manifest, 'command:send-approved')) {
      postResponse(options.endpoint, errorResponse(request.id, 'permission-denied', 'Extension cannot send slash commands.'));
      return;
    }

    if (!approvedCommands.has(request.command)) {
      postResponse(options.endpoint, errorResponse(request.id, 'command-not-approved', 'Slash command is not approved for this extension.'));
      return;
    }

    try {
      await options.sendApprovedSlashCommand(request.command);
      postResponse(options.endpoint, {
        onyxExtension: EXTENSION_SANDBOX_MESSAGE_VERSION,
        id: request.id,
        type: 'command-sent',
        command: request.command,
        accepted: true,
      });
    } catch {
      postResponse(options.endpoint, errorResponse(request.id, 'handler-failed', 'Approved slash command handler failed.'));
    }
  }

  function onMessage(event: ExtensionSandboxMessageEvent): void {
    const request = normalizeSandboxHostRequest(event.data);
    if (!request) {
      postBadMessage(options.endpoint);
      return;
    }

    void handleRequest(request);
  }

  options.endpoint.addEventListener('message', onMessage);

  return {
    dispose: () => options.endpoint.removeEventListener('message', onMessage),
  };
}
