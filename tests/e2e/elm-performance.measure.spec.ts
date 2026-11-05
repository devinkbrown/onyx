// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Browser } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { DISK_TARGETS, FIXED_EPOCH, PER_TARGET, ROSTER_COUNT, ROOM_COUNT, SEED, installWire, joinConfiguredRooms, seedOwnedRows, signInFixtureAccount } from '../../elm/tools/perf/fixtures';
import { record } from '../../elm/tools/perf/receipt';

const percentile = (values: number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] ?? null : null;
const INGESTION_COHORT_TIMEOUT_MS = process.env.ONYX_ELM_PERF_TRACE ? 60_000 : 10_000;
const PERSISTENCE_SETTLEMENT_GUARD_MS = process.env.ONYX_ELM_PERF_TRACE ? 60_000 : 10_000;
const PERSISTENCE_EVALUATE_WATCHDOG_MS = PERSISTENCE_SETTLEMENT_GUARD_MS + 5_000;
const LANE_OPERATIONAL_TIMEOUT_MS = 600_000;

const checkpoint = (mode: 'desktop' | 'mobile', phase: string) => {
  test.info().annotations.push({ type: 'perf-checkpoint', description: `${mode}:${phase}` });
  process.stdout.write(`PERF-CHECKPOINT ${JSON.stringify({ mode, phase })}\n`);
};

async function withPersistenceSettlementGuard<T>(promise: Promise<T>, guardMs: number, messageId: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`persistence observation did not return within ${guardMs}ms for ${messageId}`)), guardMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function measureMode(browser: Browser, mode: 'desktop' | 'mobile') {
    checkpoint(mode, 'starting');
    const cpuProfileDiagnostic = process.env.ONYX_ELM_PERF_CPU_PROFILE === '1';
    const requestedProfileCohort = cpuProfileDiagnostic ? process.env.ONYX_ELM_PERF_CPU_PROFILE_COHORT : undefined;
    if (cpuProfileDiagnostic && requestedProfileCohort !== undefined
      && requestedProfileCohort !== '500' && requestedProfileCohort !== '1000') {
      throw new Error('ONYX_ELM_PERF_CPU_PROFILE_COHORT must be 500 or 1000 when CPU profiling is enabled.');
    }
    const cpuProfileCohort: 500 | 1000 = requestedProfileCohort === '1000' ? 1000 : 500;
    if (cpuProfileDiagnostic) {
      test.info().annotations.push({ type: 'performance-diagnostic', description: `CDP CPU profile only for the first ${cpuProfileCohort}-event cohort on ${mode}; this run is excluded from performance acceptance.` });
    }
    const context = await browser.newContext({ viewport: mode === 'mobile' ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mode === 'mobile', deviceScaleFactor: 1 });
    try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    if (mode === 'mobile') await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const heapSupported = await cdp.send('Performance.enable').then(() => true).catch(() => false);
    let postGcHeapSupported = await cdp.send('HeapProfiler.enable').then(() => true).catch(() => false);
    const routeName = `perf.measure.${mode}`;
    const wire = await installWire(page, routeName, { roster: ROSTER_COUNT, joinRooms: ROOM_COUNT, deferInitialRows: true });
    await page.addInitScript(() => {
      const perf = window as any;
      const vaultDrain: any = {
        runtimeSequence: 0,
        currentRuntime: null as any,
        nextCallId: 0,
        pendingByScope: new Map<string, Map<number, any>>(),
        latestByMessageId: new Map<string, any>(),
        listeners: new Set<() => void>(),
      };
      const ownerSnapshot = (owner: any) => owner && ({
        ownerRef: owner.ownerRef,
        networkId: owner.networkId,
        accountId: owner.accountId,
        accountGeneration: owner.accountGeneration,
        connectionGeneration: owner.connectionGeneration,
        physicalRef: owner.physicalRef,
      });
      const sameOwner = (left: any, right: any) => !!left && !!right
        && left.ownerRef === right.ownerRef && left.networkId === right.networkId && left.accountId === right.accountId
        && left.accountGeneration === right.accountGeneration && left.connectionGeneration === right.connectionGeneration
        && left.physicalRef === right.physicalRef;
      const snapshotFor = (messageId: string, expectedTarget: string) => {
        const call = vaultDrain.latestByMessageId.get(messageId);
        if (!call) return { found: false, ready: false, messageId, expectedTarget };
        const runtime = vaultDrain.currentRuntime;
        let currentOwner = null;
        try { currentOwner = runtime ? ownerSnapshot(runtime.ownerSnapshot()) : null; } catch { /* fail closed */ }
        const ownerCurrent = call.runtimeSequence === vaultDrain.runtimeSequence && sameOwner(call.owner, currentOwner)
          && !!runtime && runtime.isCurrent(call.owner);
        const pendingTargetCalls = call.scopeKey ? vaultDrain.pendingByScope.get(call.scopeKey)?.size ?? 0 : null;
        const targetMatches = call.target === expectedTarget && call.scopeKey !== null;
        const ready = call.settled && call.status === 'ready' && call.affected > 0 && ownerCurrent && targetMatches && pendingTargetCalls === 0;
        return {
          found: true,
          ready,
          messageId,
          callId: call.callId,
          runtimeSequence: call.runtimeSequence,
          owner: call.owner,
          ownerCurrent,
          target: call.target,
          targetMatches,
          offeredRows: call.offeredRows,
          status: call.status,
          affected: call.affected,
          pendingTargetCalls,
          settled: call.settled,
          settlementElapsedMs: call.settledAt === null ? null : call.settledAt - call.startedAt,
        };
      };
      const notifyVaultDrain = () => { for (const listener of [...vaultDrain.listeners]) listener(); };
      const waitForVaultDrain = (messageId: string, expectedTarget: string, guardMs: number) => new Promise<any>(resolve => {
        const startedAt = performance.now();
        let completed = false;
        let timer = 0;
        const finish = (guardExpired: boolean) => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);
          vaultDrain.listeners.delete(check);
          resolve({ ...snapshotFor(messageId, expectedTarget), guardExpired, persistenceSettlementMs: performance.now() - startedAt });
        };
        const check = () => {
          const snapshot = snapshotFor(messageId, expectedTarget);
          if (!snapshot.found) return;
          if (!snapshot.ownerCurrent || !snapshot.targetMatches || (snapshot.status !== 'pending' && snapshot.status !== 'ready')) { finish(false); return; }
          if (snapshot.status === 'ready' && snapshot.affected <= 0) { finish(false); return; }
          if (snapshot.ready) finish(false);
        };
        vaultDrain.listeners.add(check);
        timer = window.setTimeout(() => finish(true), guardMs);
        check();
      });
      vaultDrain.snapshot = snapshotFor;
      vaultDrain.waitForSettlement = waitForVaultDrain;
      perf.__perfVaultDrain = vaultDrain;
      let runtimeBundle: any;
      // Observe only the public vaultPut completion promise in this test facade; never retain row bodies.
      Object.defineProperty(window, 'OnyxRuntime', {
        configurable: true,
        enumerable: true,
        get: () => runtimeBundle,
        set: (value: any) => {
          if (!value || typeof value.createBrowserRuntime !== 'function') { runtimeBundle = value; return; }
          const createBrowserRuntime = value.createBrowserRuntime;
          runtimeBundle = Object.assign({}, value, {
            createBrowserRuntime: function (this: any, ...args: any[]) {
              const api = createBrowserRuntime.apply(this, args);
              const runtimeSequence = ++vaultDrain.runtimeSequence;
              const facade = Object.create(api);
              Object.defineProperty(facade, 'vaultPut', {
                configurable: false,
                enumerable: true,
                writable: false,
                value: (rows: unknown) => {
                  const inputRows = Array.isArray(rows) ? rows : [];
                  const owner = ownerSnapshot(api.ownerSnapshot());
                  const targets = [...new Set(inputRows.map((row: any) => typeof row?.target === 'string' ? row.target.toLowerCase() : null))];
                  const target = targets.length === 1 && typeof targets[0] === 'string' ? targets[0] : null;
                  const scopeKey = target === null || !owner ? null : JSON.stringify([
                    runtimeSequence, owner.ownerRef, owner.networkId, owner.accountId, owner.accountGeneration,
                    owner.connectionGeneration, owner.physicalRef, target,
                  ]);
                  const callId = ++vaultDrain.nextCallId;
                  const call = {
                    callId,
                    runtimeSequence,
                    owner,
                    target,
                    scopeKey,
                    offeredRows: inputRows.length,
                    startedAt: performance.now(),
                    settledAt: null as number | null,
                    settled: false,
                    status: 'pending',
                    affected: 0,
                  };
                  if (scopeKey) {
                    let pending = vaultDrain.pendingByScope.get(scopeKey);
                    if (!pending) { pending = new Map(); vaultDrain.pendingByScope.set(scopeKey, pending); }
                    pending.set(callId, call);
                  }
                  for (const row of inputRows) {
                    if (typeof row?.wireMessageId === 'string' && /^evt-\d+-999$/u.test(row.wireMessageId)) {
                      vaultDrain.latestByMessageId.set(row.wireMessageId, call);
                    }
                  }
                  notifyVaultDrain();
                  const settle = (status: string, affected: number) => {
                    call.status = status;
                    call.affected = Number.isSafeInteger(affected) && affected >= 0 ? affected : 0;
                    call.settledAt = performance.now();
                    call.settled = true;
                    if (scopeKey) {
                      const pending = vaultDrain.pendingByScope.get(scopeKey);
                      pending?.delete(callId);
                      if (pending?.size === 0) vaultDrain.pendingByScope.delete(scopeKey);
                    }
                    notifyVaultDrain();
                  };
                  let promise: Promise<any>;
                  try { promise = api.vaultPut.call(facade, rows as any); }
                  catch (error) { settle('rejected', 0); throw error; }
                  Promise.resolve(promise).then(
                    (result: any) => settle(typeof result?.status === 'string' ? result.status : 'unavailable', result?.affected),
                    () => settle('rejected', 0),
                  );
                  return promise;
                },
              });
              vaultDrain.currentRuntime = facade;
              return facade;
            },
          });
        },
      });
      perf.__perfInputs = [];
      perf.__perfInputEvents = 0;
      perf.__perfInputGeneration = 0;
      perf.__perfInputCohort = false;
      perf.__perfTasks = [];
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) perf.__perfTasks.push({ start: entry.startTime, duration: entry.duration });
        }).observe({ type: 'longtask', buffered: true });
      } catch { perf.__perfLongTaskUnavailable = true; }
      document.addEventListener('input', event => {
        const target = event.target as HTMLElement;
        if (target.getAttribute('aria-label') !== 'Message' || !perf.__perfInputCohort) return;
        const generation = perf.__perfInputGeneration;
        perf.__perfInputEvents += 1;
        const started = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!perf.__perfInputCohort || perf.__perfInputGeneration !== generation) return;
          perf.__perfInputs.push(performance.now() - started);
        }));
      }, true);
    });
    const coldStart = Date.now();
    await page.goto(`/app/?ws=${encodeURIComponent(`wss://perf.measure.${mode}.test/ws`)}`);
    await expect(page.locator('.onyx-conn-live')).toBeVisible({ timeout: 30_000 });
    const coldStartMs = Date.now() - coldStart;
    const datasetPreparationStarted = Date.now();
    await signInFixtureAccount(page, 'perfaccount');
    await joinConfiguredRooms(page, wire, ROOM_COUNT);
    await expect.poll(() => wire.joinedRooms().length).toBe(ROOM_COUNT);
    const seeded = await seedOwnedRows(page, { networkId: `custom:wss://perf.measure.${mode}.test/ws`, accountId: 'perfaccount' });
    const persistedRowsActual = seeded.countOwned;
    checkpoint(mode, 'dataset-ready');
    await page.goto(`/app/?ws=${encodeURIComponent(`wss://perf.measure.${mode}.test/ws`)}`);
    await expect(page.locator('.onyx-conn-live')).toBeVisible({ timeout: 30_000 });
    await signInFixtureAccount(page, 'perfaccount');
    await joinConfiguredRooms(page, wire, ROOM_COUNT);
    await expect.poll(() => wire.joinedRooms().length).toBe(ROOM_COUNT);
    wire.emitInitialRows('#perf-0');
    if (mode === 'mobile') await page.getByRole('button', { name: 'Rooms', exact: true }).click();
    await page.locator('#client-rooms').getByRole('button', { name: /#perf-0/ }).click();
    await expect(page.locator('.onyx-message')).toHaveCount(120);
    await expect.poll(() => page.locator('[data-loaded-message-count]').getAttribute('data-loaded-message-count')).not.toBeNull();
    const loadedRowsActual = Number(await page.locator('[data-loaded-message-count]').getAttribute('data-loaded-message-count'));
    const datasetPreparationMs = Date.now() - datasetPreparationStarted;
    const initialRenderedRows = await page.locator('.onyx-message').count();
    const rosterDomRows = await page.locator('#client-members .onyx-member-nick').count();
    const composer = page.getByLabel('Message', { exact: true });
    await composer.click();
    await page.evaluate(() => {
      const perf = window as any;
      perf.__perfInputGeneration += 1;
      perf.__perfInputs = [];
      perf.__perfInputEvents = 0;
      perf.__perfInputCohort = true;
    });
    for (let index = 0; index < 50; index++) await composer.press(String.fromCharCode(97 + (index % 26)));
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
      const perf = window as any;
      perf.__perfInputCohort = false;
      perf.__perfInputGeneration += 1;
      resolve();
    }))));
    const inputMeasurement = await page.evaluate(() => {
      const perf = window as any;
      return { eventCount: perf.__perfInputEvents as number, latencies: [...perf.__perfInputs] as number[] };
    });
    const inputLatencies = inputMeasurement.latencies;

    const ingestion = [];
    const liveCohortCounts: { readonly cycle: number; readonly offered: number; readonly loaded: number | null }[] = [];
    let totalIngestMaxLongTask = 0;
    for (let cycle = 0; cycle < 5; cycle++) {
      // Diagnostic only: ONYX_ELM_PERF_TRACE=<dir> records a Chromium timeline per lane to attribute long tasks.
      const traceDir = process.env.ONYX_ELM_PERF_TRACE;
      if (traceDir && mode === 'mobile' && cycle === 3) await browser.startTracing(page, { path: `${traceDir}/${mode}.json`, categories: ['toplevel', 'devtools.timeline', 'v8'] });
            const start = await page.evaluate(() => performance.now());
      if (cpuProfileDiagnostic && cycle === 0) {
        let profilerEnabled = false;
        let profilerStarted = false;
        try {
          await cdp.send('Profiler.enable');
          profilerEnabled = true;
          await cdp.send('Profiler.start');
          profilerStarted = true;
          for (let index = 0; index < cpuProfileCohort; index++) {
            wire.serverMessage('#perf-0', `evt-${cycle}-${index}`, `fixture event cycle ${cycle} item ${index}`, FIXED_EPOCH + 1_000_000 + cycle * 1_000 + index);
          }
          await expect(page.getByText(`fixture event cycle ${cycle} item ${cpuProfileCohort - 1}`, { exact: true })).toHaveCount(1, { timeout: 10_000 });
          if (process.env.ONYX_ELM_PERF_CPU_PROFILE_PERSISTENCE === '1') {
            // Diagnostic only: extend the profile through persistence settlement to attribute write-path cost.
            const settlement = await page.evaluate(([messageId, target, guard]) => (window as any).__perfVaultDrain.waitForSettlement(messageId, target, guard), [`evt-${cycle}-${cpuProfileCohort - 1}`, '#perf-0', 120_000] as const);
            test.info().annotations.push({ type: 'performance-diagnostic', description: `settlement ${JSON.stringify({ ready: settlement.ready, ms: settlement.persistenceSettlementMs, offeredRows: settlement.offeredRows, callId: settlement.callId })}` });
          }
        } finally {
          try {
            if (profilerStarted) {
              const { profile } = await cdp.send('Profiler.stop');
              const profilePath = test.info().outputPath(`elm-ingest-first-${cpuProfileCohort}-${mode}.cpuprofile`);
              await writeFile(profilePath, JSON.stringify(profile), 'utf8');
              await test.info().attach(`elm-ingest-first-${cpuProfileCohort}-${mode}`, { path: profilePath, contentType: 'application/json' });
            }
          } finally {
            if (profilerEnabled) await cdp.send('Profiler.disable').catch(() => undefined);
          }
        }
        test.skip(true, `CPU profiling adds runtime overhead; the first-${cpuProfileCohort} diagnostic profile is not a performance acceptance measurement.`);
        return;
      } else {
        for (let index = 0; index < 500; index++) {
          wire.serverMessage('#perf-0', `evt-${cycle}-${index}`, `fixture event cycle ${cycle} item ${index}`, FIXED_EPOCH + 1_000_000 + cycle * 1_000 + index);
        }
        await expect(page.getByText(`fixture event cycle ${cycle} item 499`, { exact: true })).toHaveCount(1, { timeout: INGESTION_COHORT_TIMEOUT_MS });
      }
      const loadedAfter500 = Number(await page.locator('[data-loaded-message-count]').getAttribute('data-loaded-message-count'));
      liveCohortCounts.push({ cycle, offered: 500, loaded: Number.isFinite(loadedAfter500) ? loadedAfter500 : null });
      for (let index = 500; index < 1000; index++) {
        wire.serverMessage('#perf-0', `evt-${cycle}-${index}`, `fixture event cycle ${cycle} item ${index}`, FIXED_EPOCH + 1_000_000 + cycle * 1_000 + index);
      }
      await expect(page.getByText(`fixture event cycle ${cycle} item 999`, { exact: true })).toHaveCount(1, { timeout: INGESTION_COHORT_TIMEOUT_MS });
      const loadedAfter1000 = Number(await page.locator('[data-loaded-message-count]').getAttribute('data-loaded-message-count'));
      liveCohortCounts.push({ cycle, offered: 1000, loaded: Number.isFinite(loadedAfter1000) ? loadedAfter1000 : null });
      const persistenceMessageId = `evt-${cycle}-999`;
      const expectedOwnerKey = JSON.stringify([`custom:wss://perf.measure.${mode}.test/ws`, 'account', 'perfaccount']);
      const targetKey = JSON.stringify([`custom:wss://perf.measure.${mode}.test/ws`, 'rfc1459', '#perf-0']);
      const sample: any = await withPersistenceSettlementGuard(page.evaluate(async ({ start, heapSupported, ownerKey, targetKey, messageId, target, guardMs }) => {
        const persistenceStartedAt = performance.now();
        const observer = (window as any).__perfVaultDrain;
        if (!observer || typeof observer.waitForSettlement !== 'function') {
          return { persistenceReady: false, persistenceStatus: 'observer-unavailable', persistenceGuardExpired: true,
            persistenceSettlementMs: performance.now() - persistenceStartedAt, persistenceSettlementGuardMs: guardMs };
        }
        const settlement = await observer.waitForSettlement(messageId, target, guardMs);
        const ownerKeyMatches = settlement.owner
          ? JSON.stringify([settlement.owner.networkId, settlement.owner.accountId === null ? 'guest' : 'account', settlement.owner.accountId ?? '']) === ownerKey
          : false;
        if (!settlement.ready || settlement.guardExpired || !ownerKeyMatches) {
          return {
            persistenceReady: false,
            persistenceStatus: settlement.status ?? 'not-offered',
            persistenceGuardExpired: settlement.guardExpired === true,
            persistenceSettlementMs: performance.now() - persistenceStartedAt,
            persistenceSettlementGuardMs: guardMs,
            persistenceOwnerCurrent: settlement.ownerCurrent === true,
            persistenceTargetMatches: settlement.targetMatches === true,
            persistenceTargetPendingCalls: settlement.pendingTargetCalls ?? null,
            persistenceOfferRows: settlement.offeredRows ?? null,
            persistenceAffectedRows: settlement.affected ?? null,
          };
        }
        const idb = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('onyx-vault'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
        });
        try {
          const retained = await new Promise<any[]>((resolve, reject) => {
            const req = idb.transaction('messages_owned').objectStore('messages_owned').index('by-owner-target').getAll(IDBKeyRange.only([ownerKey, targetKey]));
            req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
          });
          const metrics = await (window as any).__perfGetMetrics?.();
          const finalDrain = observer.snapshot(messageId, target);
          const durableMessagePresent = retained.some(item => item?.row?.messageId === messageId);
          const latestCallUnchanged = finalDrain.callId === settlement.callId;
          const persistenceReady = durableMessagePresent && retained.length <= 400 && finalDrain.ready && latestCallUnchanged;
          return {
            persistenceReady,
            persistenceStatus: settlement.status,
            persistenceGuardExpired: false,
            elapsedMs: performance.now() - start,
            domNodes: document.querySelectorAll('*').length,
            messageRows: document.querySelectorAll('.onyx-message').length,
            loadedRows: Number(document.querySelector('[data-loaded-message-count]')?.getAttribute('data-loaded-message-count') ?? NaN),
            retainedRows: retained.length,
            persistenceMessageId: messageId,
            persistenceSettlementMs: performance.now() - persistenceStartedAt,
            persistenceSettlementGuardMs: guardMs,
            persistenceOfferRows: settlement.offeredRows,
            persistenceAffectedRows: settlement.affected,
            persistenceRuntimeSequence: settlement.runtimeSequence,
            persistenceOwnerKeyMatches: ownerKeyMatches,
            persistenceTargetMatches: finalDrain.targetMatches,
            persistenceTargetPendingCalls: finalDrain.pendingTargetCalls,
            persistenceOwnerCurrent: finalDrain.ownerCurrent,
            persistenceLatestCallUnchanged: latestCallUnchanged,
            persistenceDurableMessagePresent: durableMessagePresent,
            persistenceCompletionCriterion: 'latest target snapshot ready, exact owner and target current, no target writes pending, final message present in owned target index, durable rows <= 400',
            heapUsedBytes: heapSupported ? metrics?.JSHeapUsedSize ?? null : null,
            activePagePostGcHeapUsedBytes: null as number | null,
            longTasks: (window as any).__perfTasks.filter((task: any) => task.start >= start).map((task: any) => task.duration),
          };
        } finally {
          idb.close();
        }
      }, { start, heapSupported, ownerKey: expectedOwnerKey, targetKey, messageId: persistenceMessageId, target: '#perf-0', guardMs: PERSISTENCE_SETTLEMENT_GUARD_MS }),
      PERSISTENCE_EVALUATE_WATCHDOG_MS, persistenceMessageId);
      if (!sample.persistenceReady) {
        throw new Error(`persistence completion evidence failed for ${persistenceMessageId}: ${JSON.stringify({
          status: sample.persistenceStatus ?? null,
          guardExpired: sample.persistenceGuardExpired ?? null,
          durableMessagePresent: sample.persistenceDurableMessagePresent ?? null,
          retainedRows: sample.retainedRows ?? null,
          pendingTargetCalls: sample.persistenceTargetPendingCalls ?? null,
          ownerCurrent: sample.persistenceOwnerCurrent ?? null,
          latestCallUnchanged: sample.persistenceLatestCallUnchanged ?? null,
          persistenceSettlementMs: sample.persistenceSettlementMs ?? null,
          guardMs: PERSISTENCE_SETTLEMENT_GUARD_MS,
        })}`);
      }
      const cdpMetrics = heapSupported ? await cdp.send('Performance.getMetrics').catch(() => ({ metrics: [] })) : { metrics: [] };
      const heap = cdpMetrics.metrics.find(item => item.name === 'JSHeapUsedSize')?.value ?? null;
      sample.heapUsedBytes = heap;
      let postGcActiveHeapUsedBytes: number | null = null;
      if (postGcHeapSupported) {
        try {
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          await cdp.send('HeapProfiler.collectGarbage');
          const settled = await cdp.send('Runtime.getHeapUsage');
          if (Number.isFinite(settled.usedSize) && settled.usedSize > 0) postGcActiveHeapUsedBytes = settled.usedSize;
          else postGcHeapSupported = false;
        } catch {
          postGcHeapSupported = false;
        }
      }
      sample.activePagePostGcHeapUsedBytes = postGcActiveHeapUsedBytes;
      const maxLong = sample.longTasks.length ? Math.max(...sample.longTasks) : null;
      if (typeof maxLong === 'number') totalIngestMaxLongTask = Math.max(totalIngestMaxLongTask, maxLong);
      ingestion.push(sample);
      if (cycle === 2) checkpoint(mode, 'ingestion-midpoint');
    }

    if (process.env.ONYX_ELM_PERF_TRACE && mode === 'mobile') await browser.stopTracing();
    const idbBatches = await page.evaluate(async (fixedEpoch) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('onyx-vault'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      });
      const writes: number[] = [], reads: number[] = [];
      for (let batch = 0; batch < 100; batch++) {
        const rows = Array.from({ length: 100 }, (_, index) => {
          const recordId = `batch-${batch}-${index}`;
          const atMs = fixedEpoch + batch * 100 + index;
          const row = { recordId, messageId: `batch-msg-${batch}-${index}`, conversationId: '#idb-benchmark', from: 'fixture', body: `batch ${batch} row ${index}`, atMs, serverTime: new Date(atMs).toISOString(), rowType: 'msg', deleted: false, redacted: false, replyTo: null, privacy: 'plain' };
          const ownerKey = JSON.stringify(['perf-idb-benchmark', 'account', 'perfaccount']);
          return { id: JSON.stringify([ownerKey, recordId]), ownerKey, targetKey: JSON.stringify(['perf-idb-benchmark', 'rfc1459', '#idb-benchmark']), scheme: { name: 'rfc1459', revision: 'irc-casemapping-v1:rfc1459' }, row };
        });
        let started = performance.now();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('messages_owned', 'readwrite'); rows.forEach(row => tx.objectStore('messages_owned').put(row));
          tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
        });
        writes.push(performance.now() - started);
        started = performance.now();
        await new Promise<void>((resolve, reject) => {
          const ownerKey = JSON.stringify(['perf-idb-benchmark', 'account', 'perfaccount']);
          const targetKey = JSON.stringify(['perf-idb-benchmark', 'rfc1459', '#idb-benchmark']);
          const request = db.transaction('messages_owned').objectStore('messages_owned').index('by-owner-target').getAll(IDBKeyRange.only([ownerKey, targetKey]));
          request.onsuccess = () => request.result.length >= (batch + 1) * 100 ? resolve() : reject(new Error('IDB batch read count mismatch'));
          request.onerror = () => reject(request.error);
        });
        reads.push(performance.now() - started);
      }
      await new Promise<void>((resolve, reject) => {
        const ownerKey = JSON.stringify(['perf-idb-benchmark', 'account', 'perfaccount']);
        const tx = db.transaction('messages_owned', 'readwrite');
        const targetKey = JSON.stringify(['perf-idb-benchmark', 'rfc1459', '#idb-benchmark']);
        const cursor = tx.objectStore('messages_owned').index('by-owner-target').openCursor(IDBKeyRange.only([ownerKey, targetKey]));
        cursor.onsuccess = () => { const item = cursor.result; if (!item) return; item.delete(); item.continue(); };
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      });
      db.close();
      return { writeP95Ms: Math.ceil([...writes].sort((a,b)=>a-b)[94] ?? 0), readP95Ms: Math.ceil([...reads].sort((a,b)=>a-b)[94] ?? 0), samples: 100, batchSize: 100 };
    }, FIXED_EPOCH);
    await page.waitForTimeout(650);
    const activeVaultRowsActual = await page.evaluate(async (mode) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('onyx-vault'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      const rows = await new Promise<number>((resolve, reject) => {
        const ownerKey = JSON.stringify([`custom:wss://perf.measure.${mode}.test/ws`, 'account', 'perfaccount']);
        const targetKey = JSON.stringify([`custom:wss://perf.measure.${mode}.test/ws`, 'rfc1459', '#perf-0']);
        const req = db.transaction('messages_owned').objectStore('messages_owned').index('by-owner-target').count(IDBKeyRange.only([ownerKey, targetKey]));
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      });
      db.close(); return rows;
    }, mode);
    const joinedRoomsMeasured = wire.joinedRooms().length;
    const heaps = ingestion.map(sample => sample.heapUsedBytes).filter((value): value is number => typeof value === 'number');
    const heapAtCycle3 = heaps[2];
    const heapAtCycle5 = heaps[4];
    const last3GrowthPercent = heapAtCycle3 != null && heapAtCycle5 != null && heapAtCycle3 > 0
      ? ((heapAtCycle5 - heapAtCycle3) / heapAtCycle3) * 100 : null;
    const postGcHeaps = ingestion.map(sample => sample.activePagePostGcHeapUsedBytes)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    const postGcHeapAtCycle3 = postGcHeaps.length === ingestion.length ? postGcHeaps[2] : null;
    const postGcHeapAtCycle5 = postGcHeaps.length === ingestion.length ? postGcHeaps[4] : null;
    const lastThreeCycleActivePostGcHeapGrowthPercent = postGcHeapAtCycle3 != null && postGcHeapAtCycle5 != null && postGcHeapAtCycle3 > 0
      ? ((postGcHeapAtCycle5 - postGcHeapAtCycle3) / postGcHeapAtCycle3) * 100 : null;
    const events = await page.evaluate(() => ({ longTaskApiAvailable: !(window as any).__perfLongTaskUnavailable }));
    await page.goto('/');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const domAfterCleanup = await page.evaluate(() => document.querySelectorAll('*').length);
    let gc: Record<string, unknown> = { available: false, reason: 'CDP heap collection unavailable' };
    try {
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.collectGarbage');
      const postGc = await cdp.send('Runtime.getHeapUsage');
      gc = { available: true, requested: true, usedSizeBytes: postGc.usedSize, totalSizeBytes: postGc.totalSize };
    } catch { /* Null/unavailable is reported; it is never treated as zero. */ }
    const warmStart = Date.now();
    await page.goto(`/app/?ws=${encodeURIComponent(`wss://perf.measure.${mode}.test/ws`)}`);
    await expect(page.locator('.onyx-conn-live')).toBeVisible({ timeout: 30_000 });
    const warmStartMs = Date.now() - warmStart;
    const metrics = {
      mode, viewport: mode === 'mobile' ? '390x844' : '1280x900', cpuThrottle: mode === 'mobile' ? 4 : 1,
      heapMeasurementMethodologyVersion: 'elm-active-page-post-gc-v3',
      seed: SEED, fixedEpoch: FIXED_EPOCH, coldStartMs, datasetPreparationMs, startupBoundary: 'navigation-to-connected', warmStartMs, warm: true, gc,
      diskTargetRequested: DISK_TARGETS, rowsPerDiskTargetRequested: PER_TARGET, persistedRowsActual,
      persistenceFixture: 'direct v5 owned-row seed after authenticated runtime initialization; raw storage cohort, hydration measured only through app UI',
      activeConversationLoadedRowsActual: loadedRowsActual,
      activeTargetDurableRowsActual: activeVaultRowsActual,
      joinedRoomsRequested: ROOM_COUNT, joinedRoomsActual: joinedRoomsMeasured, socketOpens: wire.socketCount(), rosterOffered: ROSTER_COUNT, rosterDomRowsActual: rosterDomRows,
      initialRenderedRowsTarget: 120, initialRenderedRowsActual: initialRenderedRows,
      liveRowsSupportedCap: 1000, liveCohortRequested: [500, 1000], liveCohortCounts,
      inputKeystrokes: 50, inputLatencyP50Ms: percentile(inputLatencies, .5), inputLatencyP95Ms: percentile(inputLatencies, .95), inputLatencyMaxMs: inputLatencies.length ? Math.max(...inputLatencies) : null,
      measurementInputEvents: inputMeasurement.eventCount,
      laneOperationalTimeoutMs: LANE_OPERATIONAL_TIMEOUT_MS,
      ingestionCohortAssertionTimeoutMs: INGESTION_COHORT_TIMEOUT_MS,
      ingestionCycles: ingestion, maxIngestLongTaskMs: events.longTaskApiAvailable ? totalIngestMaxLongTask : null, idbBatches,
      // Preserve the original non-collecting raw series as a diagnostic. The
      // acceptance comparison uses the separate active-page post-GC series.
      last3EqualWorkloadHeapGrowthPercent: last3GrowthPercent,
      lastThreeCycleActivePostGcHeapGrowthPercent,
      cleanupDomNodes: domAfterCleanup,
      actualCounts: { vaultRows: persistedRowsActual, joinedRooms: joinedRoomsMeasured, rosterMembersOffered: rosterDomRows, initialRenderedRows, activeConversationLoadedRows: loadedRowsActual, activeTargetDurableRows: activeVaultRowsActual, measuredInputEvents: inputMeasurement.eventCount, measuredInputSamples: inputLatencies.length, ingestionEvents: ingestion.length * 1000 },
      thresholdFailures: [
        ...(persistedRowsActual !== DISK_TARGETS * PER_TARGET ? ['persisted vault row count != 100000'] : []),
        ...(activeVaultRowsActual > 400 ? ['active target durable rows exceeded default VAULT_KEEP=400'] : []),
        ...(liveCohortCounts.some(item => item.loaded === null || item.loaded < item.offered) ? ['live active conversation failed to retain its actual 500/1000 offered cohort'] : []),
        ...(joinedRoomsMeasured !== ROOM_COUNT ? ['joined channel count != 50'] : []),
        ...(initialRenderedRows !== 120 ? ['initial rendered row count != 120'] : []),
        ...(inputMeasurement.eventCount !== 50 ? ['measurement input event count != 50'] : []),
        ...(inputLatencies.length !== 50 ? ['input sample count != 50'] : []),
        ...(percentile(inputLatencies, .95) == null || percentile(inputLatencies, .95)! > (mode === 'mobile' ? 200 : 100) ? [`${mode} input p95 threshold` ] : []),
        ...(events.longTaskApiAvailable && totalIngestMaxLongTask > 200 ? ['ingest long task > 200ms'] : []),
        ...(!events.longTaskApiAvailable ? ['longtask observer unavailable'] : []),
        ...(lastThreeCycleActivePostGcHeapGrowthPercent == null ? ['last-three-cycle active-page post-GC heap metric unavailable'] : []),
        ...(lastThreeCycleActivePostGcHeapGrowthPercent != null && lastThreeCycleActivePostGcHeapGrowthPercent > 10 ? ['last-three-cycle active-page post-GC heap growth > 10%'] : []),
      ],
      longTaskObserverAvailable: events.longTaskApiAvailable,
      blocked: [],
      limits: ['Chromium desktop and CPU-throttled viewport emulation only; no OS/mobile device, battery, or media acceptance evidence'],
    };
    record(metrics);
    checkpoint(mode, 'observation-recorded');
    } finally {
      await context.close();
    }
}

test('measure deterministic Elm client workload on desktop Chromium', async ({ browser }) => {
  // Operational watchdog for the complete lane, including the 100k-row seed
  // and active-page GC samples. It does not change any measured threshold;
  // per-cohort waits remain separate local guards.
  test.setTimeout(LANE_OPERATIONAL_TIMEOUT_MS);
  await measureMode(browser, 'desktop');
});

test('measure deterministic Elm client workload on emulated mobile Chromium', async ({ browser }) => {
  // Same operational lane watchdog on mobile; acceptance budgets remain the
  // input, long-task, retained-heap, and count thresholds above.
  test.setTimeout(LANE_OPERATIONAL_TIMEOUT_MS);
  await measureMode(browser, 'mobile');
});
