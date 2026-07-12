// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * AppRoute — /app shell.
 *
 * Renders the Connect screen when the user is not connected.
 * When connected, ConnectedShell (inside Connect) takes over with the
 * network name, channel list, and raw message feed.
 *
 * The full chat surface (message view, member list, DMs, settings) is a later
 * wave. This minimal slice proves the end-to-end IRC vertical: node picker →
 * CAP/SASL/registration → live message feed → channel list.
 */
import { onMount } from 'solid-js';
import { Connect } from '../app/Connect';
import { initVaultSync } from '../lib/vault/vaultSync';

export default function AppRoute() {
  // Wire the history vault → store bridge here rather than at boot in index.tsx.
  // vaultSync statically imports the zustand `runtime` chunk (store + media);
  // pulling it from the eager entry made that ~58kB-gz chunk a static
  // dependency of the marketing Landing route, which reads nothing from the
  // store. AppRoute is lazy(), so this import keeps the store chunk off the
  // landing critical path and loads it only when the /app shell mounts — the
  // first point any conversation state exists. initVaultSync() is idempotent.
  onMount(() => initVaultSync());
  return <Connect />;
}
