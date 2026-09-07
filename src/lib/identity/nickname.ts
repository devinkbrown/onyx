// SPDX-License-Identifier: AGPL-3.0-or-later

/** The client-side shape accepted by IRC-compatible entry points. Server authority remains final. */
const NICK_RE = /^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]*$/;
const NICK_MAX = 64;

export function parseNickname(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? '';
  return value.length > 0 && value.length <= NICK_MAX && NICK_RE.test(value) ? value : null;
}

export function nicknameError(raw: string, options: { allowEmpty?: boolean } = {}): string | undefined {
  const value = raw.trim();
  if (!value) return options.allowEmpty ? undefined : 'Name is required.';
  if (value.length > NICK_MAX) return 'Name must be 64 characters or fewer.';
  if (!NICK_RE.test(value)) {
    return 'Name must start with a letter or allowed special character and contain only letters, numbers, or -[]\\`_^{|}.';
  }
  return undefined;
}

export const NICKNAME_MAX_LENGTH = NICK_MAX;
