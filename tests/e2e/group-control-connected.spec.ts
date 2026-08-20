import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

import {
  deriveGroupDeviceId,
  encodeGroupDeviceDirectoryEntry,
  GROUP_DEVICE_DIRECTORY_ALGORITHM,
} from '../../src/lib/e2ee/groupDeviceDirectory';
import { signGroupControlPayload } from '../../src/lib/e2ee/groupControlPayload';
import { RawIrcActor } from './support/rawIrcActor';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

// Production bundle acceptance: no DEV store handle, no credentials in browser-side env.
test('group-control status stays inactive in the production authenticated shell', async ({ page }) => {
  const account = process.env.ONYX_D2_ACCOUNT_A;
  const password = process.env.ONYX_D2_PASSWORD_A;
  const accountB = process.env.ONYX_D2_ACCOUNT_B;
  const passwordB = process.env.ONYX_D2_PASSWORD_B;
  const room = process.env.ONYX_D2_ROOM;
  const ircPort = Number(process.env.ONYX_D2_IRC_PORT ?? '');
  const evidencePath = process.env.ONYX_D2_EVIDENCE;
  if (!account || !password || !accountB || !passwordB || !room || !Number.isSafeInteger(ircPort) || !evidencePath) {
    test.skip(true, 'D2 runner supplies disposable credentials at Playwright process runtime only.');
    return;
  }
  const actor = new RawIrcActor(ircPort);
  try {
    // Actor B owns the room and remains physically connected through directory,
    // signed-control, and KICK observations. Passwords and private keys never
    // leave this Playwright process.
    await actor.open(`b${process.pid}`, ['onyx/e2ee']);
    await actor.enableIrcx();
    await actor.identify(accountB, passwordB);
    await actor.requireReusableSession();
    await actor.join(room);

    const signing = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']) as CryptoKeyPair;
    const encryption = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'],
    ) as CryptoKeyPair;
    const entry = {
      signerPub: new Uint8Array(await crypto.subtle.exportKey('raw', signing.publicKey)),
      encryptionPub: new Uint8Array(await crypto.subtle.exportKey('raw', encryption.publicKey)),
    };
    const directory = encodeGroupDeviceDirectoryEntry(entry);
    const deviceId = await deriveGroupDeviceId(entry);
    expect(directory).not.toBeNull();
    expect(deviceId).not.toBeNull();
    await actor.addE2eeKey(deviceId!, GROUP_DEVICE_DIRECTORY_ALGORITHM, directory!);

    // Never interpolate either value into assertion text, page titles, or artifacts.
    await page.goto('/app');
    await expect(page.locator('body')).toBeVisible();
    await expect.poll(() => page.evaluate(() => '__onyx' in window)).toBe(false);
    await page.getByRole('tab', { name: 'Sign in' }).click();
    await page.locator('#conn-nick').fill(account);
    const passwordPath = page.getByTestId('conn-password-path-open');
    if (await passwordPath.isVisible()) await passwordPath.click();
    await page.locator('#conn-password').fill(password);
    await page.getByTestId('conn-submit').click();
    await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 45_000 });
    await page.locator('#shell-join-input').fill(room);
    await page.getByRole('button', { name: `Join ${room}` }).click();
    const composer = page.getByRole('textbox', { name: `Message ${room}` });
    await expect(composer).toBeVisible({ timeout: 30_000 });

    const payload = await signGroupControlPayload({
      routing: { channel: room, kind: 'key-package', fromDevice: deviceId!, fromAccount: accountB },
      epoch: 1,
      body: new TextEncoder().encode('d2-connected-key-package-v1'),
      signerPub: entry.signerPub,
      privateKey: signing.privateKey,
    });
    expect(payload).not.toBeNull();
    const controlLine = `E2EEGROUP ${room} key-package ${deviceId} :${payload}`;
    actor.send(controlLine);
    await actor.waitFor(new RegExp(` E2EE\\.KEYPACKAGE ${room.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} `));
    expect(actor.isConnected()).toBe(true);

    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 720 });
    const indicator = page.locator('[data-testid="group-control-room-indicator"]');
    await expect(indicator).toBeVisible({ timeout: 30_000 });
    await expect(indicator).toContainText('Message protection: not active');
    await expect(indicator).not.toContainText(/encrypted|ready|protected/i);
    await expect(indicator).not.toHaveAttribute('data-state', 'unavailable', { timeout: 30_000 });

    actor.send(`KICK ${room} ${account} :D2 complete`);
    await actor.waitFor(new RegExp(` KICK ${room.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} ${account} `));
    await expect(composer).not.toBeVisible({ timeout: 30_000 });
    expect(actor.isConnected()).toBe(true);

    await writeFile(evidencePath, JSON.stringify({
      actor: 'connected-through-kick',
      pid: process.pid,
      directory: actor.wireSummary(directory!),
      control: actor.wireSummary(controlLine),
      payload: actor.wireSummary(payload!),
      privateKeys: 'memory-only',
      activationClaim: 'none',
      sessionAppliedClaim: 'none',
    }), { mode: 0o600 });
  } finally {
    actor.close();
  }
});
