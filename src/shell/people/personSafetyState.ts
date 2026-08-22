// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Ephemeral people-card safety door. Not a store kernel change.
 */
import { createSignal } from 'solid-js';

export type PersonSafetyPending =
  | { kind: 'block'; nick: string; guest?: boolean }
  | { kind: 'report'; nick: string; guest?: boolean };

const [pending, setPending] = createSignal<PersonSafetyPending | null>(null);

export function openPersonBlockConfirm(nick: string, guest = false): void {
  const name = nick.trim();
  if (!name) return;
  setPending({ kind: 'block', nick: name, guest });
}

export function openPersonReport(nick: string, guest = false): void {
  const name = nick.trim();
  if (!name) return;
  setPending({ kind: 'report', nick: name, guest });
}

export function closePersonSafety(): void {
  setPending(null);
}

export function personSafetyPending(): PersonSafetyPending | null {
  return pending();
}
