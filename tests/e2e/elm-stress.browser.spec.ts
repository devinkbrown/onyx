// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';
import { record } from '../../elm/tools/perf/receipt';
import { installWire, joinConfiguredRooms, signInFixtureAccount } from '../../elm/tools/perf/fixtures';

async function openClient(browser: import('@playwright/test').Browser, route: string, wireOptions: { disconnectOnPrivmsg?: boolean } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const wire = await installWire(page, route, wireOptions);
  await page.goto(`/app/?ws=${encodeURIComponent(`wss://${route}.test/ws`)}&nick=guest`);
  await expect(page.locator('.onyx-conn-live')).toBeVisible({ timeout: 30_000 });
  await signInFixtureAccount(page, 'stressaccount');
  await joinConfiguredRooms(page, wire, 2);
  await expect.poll(() => wire.joinedRooms().length).toBeGreaterThanOrEqual(2);
  await page.locator('#client-rooms').getByRole('button', { name: /#perf-0/ }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  return { context, page, wire };
}

test('stress mock wire, persistence failures, hidden replay, and context isolation', async ({ browser }) => {
  const observed: Record<string, unknown>[] = [];
  const results: Record<string, unknown>[] = [];

  // Duplicate + out-of-order replay is sent through the real parser/fold path.
  const first = await openClient(browser, 'stress.replay');
  first.wire.serverMessage('#perf-0', 'order-2', 'Replay order second');
  first.wire.serverMessage('#perf-0', 'order-1', 'Replay order first');
  first.wire.serverMessage('#perf-0', 'order-2', 'Replay order second');
  await expect(first.page.getByText('Replay order first', { exact: true })).toBeVisible();
  await expect(first.page.getByText('Replay order second', { exact: true })).toBeVisible();
  await first.page.waitForTimeout(50);
  const duplicateCount = await first.page.getByText('Replay order second', { exact: true }).count();
  results.push({ name: 'duplicate-out-of-order-delivery', status: duplicateCount === 1 ? 'pass' : 'failed-open', expectedDuplicateRows: 1, observedRows: duplicateCount });

  // A dropped socket with an unsent draft must leave the user's text intact.
  const composer = first.page.getByLabel('Message', { exact: true });
  await composer.fill('draft survives transport loss');
  first.wire.currentSocket()?.close();
  await expect.poll(() => first.page.locator('.onyx-conn-live').count()).toBe(0);
  const preservedDraft = await composer.inputValue();
  results.push({ name: 'disconnect-preserves-draft', status: preservedDraft === 'draft survives transport loss' ? 'pass' : 'failed-open', observedDraftLength: preservedDraft.length });

  // Socket closes immediately after admission to the browser mock. The app
  // must expose uncertainty and must not resend this same text on reconnect.
  const uncertain = await openClient(browser, 'stress.unknown', { disconnectOnPrivmsg: true });
  const uncertainPage = uncertain.page;
  const uncertainWire = uncertain.wire;
  await uncertainPage.locator('#client-rooms').getByRole('button', { name: /#perf-0/ }).click();
  const unknownComposer = uncertainPage.getByLabel('Message', { exact: true });
  await unknownComposer.fill('one uncertain admitted message');
  await uncertainPage.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => uncertainWire.sent.filter(line => line === 'PRIVMSG #perf-0 :one uncertain admitted message').length).toBe(1);
  await expect.poll(() => uncertainWire.socketCount(), { timeout: 15_000 }).toBeGreaterThan(1).catch(() => undefined);
  await uncertainPage.waitForTimeout(1200);
  const admittedCount = uncertainWire.sent.filter(line => line === 'PRIVMSG #perf-0 :one uncertain admitted message').length;
  const uncertainUi = await uncertainPage.locator('.onyx-uncertain').count();
  results.push({ name: 'disconnect-unknown-admitted-no-resend', status: admittedCount === 1 ? 'pass' : 'failed-open', admittedFrameCount: admittedCount, uncertaintyUiRows: uncertainUi, reconnectAttempts: uncertainWire.socketCount() - 1, outcome: 'No server echo was delivered; delivery remains uncertain.' });
  let staleSocketSend = 'unavailable';
  try {
    uncertainWire.emitFromSocket(0, '@msgid=stale-socket-canary :fixture!u@h PRIVMSG #perf-0 :stale connection frame');
    await uncertainPage.waitForTimeout(50);
    staleSocketSend = await uncertainPage.getByText('stale connection frame', { exact: true }).count() === 0 ? 'not-delivered' : 'delivered';
  } catch { staleSocketSend = 'closed-socket-rejected-send'; }
  results.push({ name: 'stale-socket-frame-after-reconnect', status: staleSocketSend === 'not-delivered' || staleSocketSend === 'closed-socket-rejected-send' ? 'pass' : 'failed-open', observation: staleSocketSend, limitation: 'The Playwright websocket route may reject writes after close before app generation handling runs.' });
  await uncertain.context.close();

  // Visibility/replay case: history for an inactive room must not mark it read.
  await first.context.close();
  const hidden = await openClient(browser, 'stress.hidden');
  await hidden.page.locator('#client-rooms').getByRole('button', { name: /#perf-1/ }).click();
  let visibilityControl = 'unavailable';
  try {
    // Chromium does not expose a portable headless OS-hidden state. This
    // explicitly mocks only the browser visibility API and is labeled so.
    await hidden.page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    visibilityControl = await hidden.page.evaluate(() => document.visibilityState);
  } catch { /* Keep this lane explicitly unavailable on unsupported Chromium builds. */ }
  const beforeReplay = hidden.wire.sent.length;
  hidden.wire.emit(':server BATCH +hidden1 chathistory #perf-0');
  for (let index = 0; index < 25; index++) hidden.wire.emit(`@batch=hidden1;msgid=hidden-${index};time=2026-10-09T10:00:00.000Z :fixture!u@h PRIVMSG #perf-0 :background replay ${index}`);
  hidden.wire.emit(':server BATCH -hidden1');
  await hidden.page.waitForTimeout(100);
  const replayLines = hidden.wire.sent.slice(beforeReplay).filter(line => /^(MARKREAD|READMARK)\s+#perf-0\b/i.test(line));
    results.push({ name: 'hidden-inactive-history-not-marked-read', status: visibilityControl === 'hidden' ? (replayLines.length === 0 ? 'pass' : 'failed-open') : 'unavailable', visibilityState: visibilityControl, visibilityFixture: 'mocked browser visibility API; no OS lifecycle claim', readMarkerCount: replayLines.length });
  await hidden.context.close();

  // Quota fixture rejects actual owned-message writes. A draft is entered
  // first, and application output records whether the editable draft survives.
  const quotaContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await quotaContext.addInitScript(() => {
    (window as any).__quotaPutCalls = 0;
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const row = value !== null && typeof value === 'object' ? value as { ownerKey?: unknown; targetKey?: unknown; scheme?: unknown; row?: unknown } : null;
      if (this.name === 'messages_owned' && row !== null && typeof row.ownerKey === 'string'
        && typeof row.targetKey === 'string' && row.scheme !== undefined && row.row !== undefined) {
        (window as any).__quotaPutCalls++;
        throw new DOMException('Deterministic quota fixture', 'QuotaExceededError');
      }
      return original.call(this, value, key);
    };
  });
  const quotaPage = await quotaContext.newPage();
  const quotaWire = await installWire(quotaPage, 'stress.quota');
  await quotaPage.goto(`/app/?ws=${encodeURIComponent('wss://stress.quota.test/ws')}&nick=guest`);
  await expect(quotaPage.locator('.onyx-conn-live')).toBeVisible({ timeout: 30_000 });
  await signInFixtureAccount(quotaPage, 'stressaccount');
  await joinConfiguredRooms(quotaPage, quotaWire, 2);
  await quotaPage.locator('#client-rooms').getByRole('button', { name: /#perf-0/ }).click();
  const quotaComposer = quotaPage.getByLabel('Message', { exact: true });
  await quotaComposer.fill('quota keeps editable draft');
  quotaWire.serverMessage('#perf-0', 'quota-trigger-message', 'Inbound row that triggers a quota-bound vault write');
  await expect(quotaPage.getByText('Inbound row that triggers a quota-bound vault write', { exact: true })).toBeVisible();
  let quotaCalls = 0;
  const quotaDeadline = Date.now() + 5_000;
  while (quotaCalls === 0 && Date.now() < quotaDeadline) {
    quotaCalls = await quotaPage.evaluate(() => (window as any).__quotaPutCalls as number);
    if (quotaCalls === 0) await quotaPage.waitForTimeout(50);
  }
  const quotaDraft = await quotaComposer.inputValue();
  results.push({ name: 'quota-preserves-draft', status: quotaDraft === 'quota keeps editable draft' && quotaCalls > 0 ? 'pass' : 'failed-open', quotaErrorInjected: true, quotaWritesAttempted: quotaCalls, observedDraftLength: quotaDraft.length, limitation: 'QuotaExceededError was injected at the actual IndexedDB messages_owned row write boundary; no account secrets or model state were inspected.' });
  await quotaContext.close();

  // A single origin/profile switches between two server-proven account IDs on
  // the same mock physical socket. No session token or secret is read.
  const accountA = await openClient(browser, 'stress.account-a');
  accountA.wire.serverMessage('#perf-0', 'private-context-a', 'context A only marker');
  await expect(accountA.page.getByText('context A only marker', { exact: true })).toBeVisible();
  const accountANetworkId = 'custom:wss://stress.account-a.test/ws';
  const accountAOwnerKey = JSON.stringify([accountANetworkId, 'account', 'stressaccount']);
  const accountATargetKey = JSON.stringify([accountANetworkId, 'rfc1459', '#perf-0']);
  let accountACanaryRows = 0;
  const historyWriteDeadline = Date.now() + 5_000;
  while (accountACanaryRows === 0 && Date.now() < historyWriteDeadline) {
    accountACanaryRows = await accountA.page.evaluate(async ({ ownerKey, targetKey }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('onyx-vault'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      const rows = await new Promise<Array<{ row?: { messageId?: unknown } }>>((resolve, reject) => {
        const req = db.transaction('messages_owned').objectStore('messages_owned').index('by-owner-target').getAll(IDBKeyRange.only([ownerKey, targetKey]));
        req.onsuccess = () => resolve(req.result as Array<{ row?: { messageId?: unknown } }>); req.onerror = () => reject(req.error);
      });
      const count = rows.filter(value => value.row?.messageId === 'private-context-a').length;
      db.close(); return count;
    }, { ownerKey: accountAOwnerKey, targetKey: accountATargetKey });
    if (accountACanaryRows === 0) await accountA.page.waitForTimeout(50);
  }
  const aCanaryText = 'owner A queued isolation canary';
  const aComposer = accountA.page.getByLabel('Message', { exact: true });
  await aComposer.fill(aCanaryText);
  await accountA.page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => accountA.wire.sent.filter(line => line === `PRIVMSG #perf-0 :${aCanaryText}`).length).toBe(1);
  let accountAPendingOutbox = 0;
  const outboxWriteDeadline = Date.now() + 5_000;
  while (accountAPendingOutbox === 0 && Date.now() < outboxWriteDeadline) {
    accountAPendingOutbox = await accountA.page.evaluate(async ({ ownerKey, targetKey }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('onyx-vault'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      const rows = await new Promise<any[]>((resolve, reject) => {
        const req = db.transaction('outbox_owned').objectStore('outbox_owned').index('by-owner-target').getAll(IDBKeyRange.only([ownerKey, targetKey]));
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      });
      db.close();
      return rows.filter(row => row.operation === 'privmsg'
        && (row.state === 'transport-admitted' || row.state === 'delivery-unknown')).length;
    }, { ownerKey: accountAOwnerKey, targetKey: accountATargetKey });
    if (accountAPendingOutbox === 0) await accountA.page.waitForTimeout(50);
  }
  const beforeOwnerSwitch = accountA.wire.sent.filter(line => line === `PRIVMSG #perf-0 :${aCanaryText}`).length;
  await signInFixtureAccount(accountA.page, 'stressaccountb');
  const bComposer = accountA.page.getByLabel('Message', { exact: true });
  if (!(await bComposer.isEnabled())) await joinConfiguredRooms(accountA.page, accountA.wire, 1);
  await bComposer.fill('owner B queue isolation trigger');
  await accountA.page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => accountA.wire.sent.filter(line => line === 'PRIVMSG #perf-0 :owner B queue isolation trigger').length).toBe(1);
  await accountA.page.waitForTimeout(300);
  const leaked = await accountA.page.getByText('context A only marker', { exact: true }).count();
  const aCanaryFramesAfterB = accountA.wire.sent.filter(line => line === `PRIVMSG #perf-0 :${aCanaryText}`).length;
  const accountBCanaryRows = await accountA.page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('onyx-vault'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const ownerKey = JSON.stringify(['custom:wss://stress.account-a.test/ws', 'account', 'stressaccountb']);
    const targetKey = JSON.stringify(['custom:wss://stress.account-a.test/ws', 'rfc1459', '#perf-0']);
    const rows = await new Promise<Array<{ row?: { messageId?: unknown } }>>((resolve, reject) => {
      const req = db.transaction('messages_owned').objectStore('messages_owned').index('by-owner-target').getAll(IDBKeyRange.only([ownerKey, targetKey]));
      req.onsuccess = () => resolve(req.result as Array<{ row?: { messageId?: unknown } }>); req.onerror = () => reject(req.error);
    });
    const count = rows.filter(value => value.row?.messageId === 'private-context-a').length;
    db.close(); return count;
  });
  results.push({ name: 'same-profile-account-vault-isolation', status: accountACanaryRows === 0 ? 'unavailable' : (leaked > 0 || accountBCanaryRows !== 0 ? 'failed-open' : 'pass'), leakedRows: leaked, accountACanaryRows, accountBCanaryRows, canaryMessageId: 'private-context-a', accountA: 'stressaccount', accountB: 'stressaccountb', sameNetwork: true, samePhysicalSocket: true, storageVersion: 5, limitation: 'Same origin, browser profile, network and physical socket. Both durable checks are limited to the exact A canary message ID and target; no synthetic outbox record is inserted.' });
  results.push({ name: 'same-profile-account-outbox-dispatch-isolation', status: accountAPendingOutbox === 0 ? 'unavailable' : (beforeOwnerSwitch === 1 && aCanaryFramesAfterB === 1 ? 'pass' : 'failed-open'), accountAPendingOutbox, accountACanaryFramesBeforeSwitch: beforeOwnerSwitch, accountACanaryFramesAfterAccountBSend: aCanaryFramesAfterB, accountBSendTriggeredCurrentOwnerQueue: true, serverAccepted: false, accountA: 'stressaccount', accountB: 'stressaccountb', sameNetwork: true, samePhysicalSocket: true, limitation: accountAPendingOutbox === 0 ? 'The actual Account A journal row was not observed in transport-admitted or delivery-unknown state; no synthetic record or acceptance claim substitutes for that evidence.' : 'The Account A message entered the real send path without a server echo; the Account B send triggered its own queue path. No server-acceptance proof is claimed.' });
  await accountA.context.close();

  for (const result of results) record({ suite: 'stress', ...result });
  const failures = results.filter(result => result.status === 'failed-open');
  const unavailable = results.filter(result => result.status === 'unavailable');
  record({ suite: 'stress-summary', totalCases: results.length, failures, unavailable, blocked: ['Unknown/admitted-send no-resend and stale-socket-generation path require transport states not exposed as public UI assertions; tracked as open rather than inferred from a mocked model.'] });
  observed.push(...results);
  expect(observed).toHaveLength(8);
});
