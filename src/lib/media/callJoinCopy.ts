// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Consumer copy for room-call join failures.
 *
 * Join errors stay sentence-case and never leak CAP tokens, codec names,
 * device-identity jargon, or raw engine messages into the primary surface.
 */

export const CALL_JOIN_FAILED_COPY = "Couldn't join. Try again.";

export type CallJoinFailedToast = {
  readonly title: typeof CALL_JOIN_FAILED_COPY;
  readonly description: typeof CALL_JOIN_FAILED_COPY;
};

/** User-facing toast for any failed join. Protocol detail stays out. */
export function callJoinFailedToast(_error?: unknown): CallJoinFailedToast {
  return {
    title: CALL_JOIN_FAILED_COPY,
    description: CALL_JOIN_FAILED_COPY,
  };
}

/** True when copy still contains wire/protocol tokens we must not show. */
export function callJoinCopyLeaksProtocol(text: string): boolean {
  return /onyx\.irc-media|CAP\b|SASL|MEDIA\b|E2EE-HANDSHAKE|UNENROLLED|AUTH_REQUIRED|device identity/i.test(text);
}
