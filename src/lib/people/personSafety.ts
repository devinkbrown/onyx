// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Consumer Block + Report copy and policy for the people card.
 *
 * Block reuses the device-local ignore list. Report is an honest composer
 * draft to the staffed #root room — there is no Trust & Safety inbox.
 */

export const PERSON_REPORT_ROOM = '#root';
export const MAX_PERSON_REPORT_NOTE = 500;

export const PERSON_REPORT_REASONS = [
  { id: 'harassment', label: 'Harassment' },
  { id: 'spam', label: 'Spam' },
  { id: 'illegal', label: 'Illegal' },
  { id: 'other', label: 'Other' },
] as const;

export type PersonReportReasonId = (typeof PERSON_REPORT_REASONS)[number]['id'];

const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/gu;

export function sanitizePersonToken(value: string, max: number): string {
  return value.replace(CONTROL_CHARACTERS, '').trim().slice(0, max);
}

/** Keep newlines in a local report draft; strip other control characters. */
export function sanitizePersonMultiline(value: string, max: number): string {
  return value.replace(/[\x00-\x09\x0b-\x1f\x7f]/gu, '').trim().slice(0, max);
}

export function personBlockTitle(nick: string): string {
  return `Block ${sanitizePersonToken(nick, 128)}?`;
}

export function personBlockBody(nick: string): string {
  return `You will not see ${sanitizePersonToken(nick, 128)} on this device. They are not told.`;
}

export function personUnblockToast(nick: string): { title: string; description: string } {
  const name = sanitizePersonToken(nick, 128);
  return {
    title: `Unblocked ${name}`,
    description: 'Messages and notifications from this name resume on this device.',
  };
}

export function blockedDmComposeCopy(nick: string): { title: string; description: string } {
  const name = sanitizePersonToken(nick, 128);
  return {
    title: `You blocked ${name}`,
    description: 'Unblock them on this device to send a message.',
  };
}

/** True when `target` is a DM nick on the local ignore/block list. */
export function isBlockedDmTarget(
  target: string,
  ignoredUsers: ReadonlySet<string>,
  channelTypes = '#&',
): boolean {
  const nick = target.trim();
  if (!nick) return false;
  const prefix = nick[0];
  if (prefix && channelTypes.includes(prefix)) return false;
  return ignoredUsers.has(nick.toLowerCase());
}

export function personReportTitle(nick: string): string {
  return `Report ${sanitizePersonToken(nick, 128)}`;
}

/** Honest destination copy. This path drafts a note; it does not open a review inbox. */
export function personReportHonesty(): string {
  return 'This drafts a note to #root. Send it if you want the people who run this place to see it. It is not a police report.';
}

export function isPersonReportReason(value: string): value is PersonReportReasonId {
  return PERSON_REPORT_REASONS.some((reason) => reason.id === value);
}

export function formatPersonReportDraft(input: {
  nick: string;
  reason: PersonReportReasonId;
  note?: string;
  from?: string;
  guest?: boolean;
}): string {
  const nick = sanitizePersonToken(input.nick, 128) || 'unknown';
  const from = sanitizePersonToken(input.from ?? '', 128);
  const note = sanitizePersonToken(input.note ?? '', MAX_PERSON_REPORT_NOTE);
  const lines = [
    'Report',
    `About: ${nick}`,
    `What: ${input.reason}`,
  ];
  if (from) lines.push(`From: ${from}`);
  if (input.guest) lines.push('Guest: yes');
  if (note) lines.push(`Note: ${note}`);
  return lines.join('\n');
}

export function personReportDraftToast(): { title: string; description: string } {
  return {
    title: 'Draft is in #root',
    description: 'Send it from the composer if you want the people who run this place to see it.',
  };
}
