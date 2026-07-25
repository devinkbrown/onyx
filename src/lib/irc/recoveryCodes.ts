// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * recoveryCodes.ts — pure parse helpers for RECOVERYCODES notices/FAIL replies.
 *
 * Wire (server NOTICE / FAIL):
 *   RECOVERYCODES: 3 unused codes
 *   RECOVERYCODES: generated 10 single-use codes — copy them now; ...
 *   RECOVERYCODES: 1. ABCDE-FGHIJ
 *   RECOVERYCODES: login ok — that code is now spent
 *   RECOVERYCODES: all recovery codes cleared
 *   FAIL RECOVERYCODES AUTH_FAILED :...
 */

export type RecoveryCodesStatus = {
  remaining: number;
};

export type RecoveryCodeLine = {
  index: number;
  /** Dashed form as shown by the server (e.g. ABCDE-FGHIJ). */
  code: string;
};

const STATUS_RE = /^RECOVERYCODES:\s*(\d+)\s+unused code/i;
const CODE_LINE_RE = /^RECOVERYCODES:\s*(\d+)\.\s*([0-9A-HJ-NP-Z]{5}-[0-9A-HJ-NP-Z]{5})\s*$/i;
const GENERATED_RE = /^RECOVERYCODES:\s*generated\s+(\d+)\s+single-use codes/i;
const LOGIN_OK_RE = /^RECOVERYCODES:\s*login ok/i;
const CLEARED_RE = /^RECOVERYCODES:\s*all recovery codes cleared/i;

export function parseRecoveryCodesStatus(text: string): RecoveryCodesStatus | null {
  const m = STATUS_RE.exec(text.trim());
  if (!m) return null;
  const remaining = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(remaining) || remaining < 0) return null;
  return { remaining };
}

export function parseRecoveryCodeLine(text: string): RecoveryCodeLine | null {
  const m = CODE_LINE_RE.exec(text.trim());
  if (!m) return null;
  const index = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(index) || index <= 0) return null;
  return { index, code: m[2]!.toUpperCase() };
}

export function isRecoveryCodesGenerated(text: string): boolean {
  return GENERATED_RE.test(text.trim());
}

export function isRecoveryCodesLoginOk(text: string): boolean {
  return LOGIN_OK_RE.test(text.trim());
}

export function isRecoveryCodesCleared(text: string): boolean {
  return CLEARED_RE.test(text.trim());
}

/** Normalize user input to undashed uppercase code body for LOGIN. */
export function normalizeRecoveryCodeInput(raw: string): string {
  return raw.replace(/[-\s]/g, '').toUpperCase();
}
