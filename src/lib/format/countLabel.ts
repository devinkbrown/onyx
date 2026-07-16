// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * countLabel — pluralize a counted noun for human-facing status text.
 * `countLabel(1, 'message') === '1 message'`, `countLabel(3, 'message') === '3 messages'`.
 * Pass an explicit plural for words that cannot be pluralized with a trailing `s`.
 */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
