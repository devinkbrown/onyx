// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Capture-only Home Screen runtime for /app.
 *
 * Listens for `beforeinstallprompt` and records the visit. Never paints an
 * install UI — first-run Connect stays a join screen.
 */
import { onCleanup, onMount, type JSX } from 'solid-js';

import { rememberHomeScreenVisit, startBeforeInstallPromptCapture } from './addToHomeScreen';

export function AddToHomeScreenRuntime(): JSX.Element {
  onMount(() => {
    rememberHomeScreenVisit();
    onCleanup(startBeforeInstallPromptCapture());
  });
  return null;
}
