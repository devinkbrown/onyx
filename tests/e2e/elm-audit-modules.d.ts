// SPDX-License-Identifier: AGPL-3.0-or-later
// Types for the plain ESM helpers shared between the audit specs and the
// exploration harness (they stay .mjs so node can run them directly).
declare module '*elm-audit-wire.mjs' {
  export const WS: string;
  export const LONG_NICK: string;
  export function createWire(options?: Record<string, unknown>): {
    sent: string[];
    push: (...lines: string[]) => void;
    close: () => void;
    historyFailed: boolean;
    handler: (socket: unknown) => void;
  };
  export function rootTranscript(nick: string, options?: { huge?: boolean }): string[];
}
declare module '*elm-audit-lib.mjs' {
  export const PUBLIC_ROUTES: string[];
  export function auditPage(phone: boolean): unknown;
  export function describeFocus(): unknown;
}
