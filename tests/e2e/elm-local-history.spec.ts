// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';
import { assertLocalElmLive } from './elm-local-support';

test('Elm browser establishes a real WSS connection for the selected history cohort', async ({ page, context }) => {
  await assertLocalElmLive(page, context);
  await expect(page.locator('.onyx-conn-live')).toBeVisible();
});
