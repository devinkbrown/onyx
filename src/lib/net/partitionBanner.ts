// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * partitionBanner.ts — network / mesh partition banner model for the shell.
 */

export type ConnectionBannerKind =
  | 'hidden'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected'
  | 'mesh-partition'
  | 'readonly';

export type ConnectionBanner = {
  kind: ConnectionBannerKind;
  title: string;
  detail: string;
  tone: 'info' | 'warn' | 'danger' | 'neutral';
};

export function connectionBanner(input: {
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  autoReconnect?: boolean;
  reconnectIn?: number;
  meshLinksActive?: number | null;
  meshLinksExpected?: number | null;
  readOnly?: boolean;
}): ConnectionBanner {
  if (input.readOnly) {
    return {
      kind: 'readonly',
      title: 'Read-only session',
      detail: 'You can browse history but cannot send right now.',
      tone: 'warn',
    };
  }
  switch (input.connectionStatus) {
    case 'connecting':
      return {
        kind: 'connecting',
        title: 'Connecting…',
        detail: 'Opening a secure session to Onyx Server.',
        tone: 'info',
      };
    case 'reconnecting':
      return {
        kind: 'reconnecting',
        title: 'Reconnecting…',
        detail: input.reconnectIn && input.reconnectIn > 0
          ? `Retrying in ${input.reconnectIn}s.`
          : 'Trying to restore your session.',
        tone: 'warn',
      };
    case 'disconnected':
      return {
        kind: 'disconnected',
        title: 'Disconnected',
        detail: input.autoReconnect === false
          ? 'Reconnect when you are ready.'
          : 'Connection lost — Onyx will retry automatically.',
        tone: 'danger',
      };
    case 'connected': {
      const expected = input.meshLinksExpected ?? null;
      const active = input.meshLinksActive ?? null;
      if (
        expected !== null
        && active !== null
        && expected > 0
        && active < expected
      ) {
        return {
          kind: 'mesh-partition',
          title: 'Mesh partially connected',
          detail: `S2S links ${active}/${expected} — some remote rooms may lag.`,
          tone: 'warn',
        };
      }
      return {
        kind: 'hidden',
        title: '',
        detail: '',
        tone: 'neutral',
      };
    }
    default:
      return { kind: 'hidden', title: '', detail: '', tone: 'neutral' };
  }
}
