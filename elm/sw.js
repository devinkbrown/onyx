// SPDX-License-Identifier: AGPL-3.0-or-later
/* Build replaces this token with the shell reference and exact runtime metadata. */
const BUILD_ENVELOPE = __ONYX_SW_BUILD_CONFIG__;
const BUILD_CONFIG = BUILD_ENVELOPE?.buildCompatibility ? {
  schemaVersion: 1, storageSchemaVersion: 5, ...BUILD_ENVELOPE.buildCompatibility,
} : null;
const SCHEMA = 1;
const CACHE_PREFIX = 'onyx-elm-shell:';
const LEGACY_CACHE_PREFIX = 'onyx-shell-';
const BUILD_ID = BUILD_CONFIG?.buildId;
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID || 'invalid'}`;
const MAX_HANDSHAKE_MS = 1800;
const clientStates = new Map();
const jobs = new Map();
const allowedByPath = new Map();
const activatedClientBuilds = new Map();
const STORAGE_SCHEMAS = Object.freeze({ vault: 5, privateCrypto: 2, platform: 1, tabIntents: 1, localWorkspaces: 1 });

function validStorageSchemas(value) {
  return exactKeys(value, ['vault', 'privateCrypto', 'platform', 'tabIntents', 'localWorkspaces'])
    && value.vault === STORAGE_SCHEMAS.vault && value.privateCrypto === STORAGE_SCHEMAS.privateCrypto
    && value.platform === STORAGE_SCHEMAS.platform && value.tabIntents === STORAGE_SCHEMAS.tabIntents
    && value.localWorkspaces === STORAGE_SCHEMAS.localWorkspaces;
}

function validConfig(value) {
  if (!exactKeys(value, ['schemaVersion', 'storageSchemaVersion', 'buildId', 'protocolVersion', 'storageSchemas', 'shellAssets', 'publicNavigationPaths'])
    || value.schemaVersion !== SCHEMA || value.storageSchemaVersion !== 5 || typeof value.buildId !== 'string' || !value.buildId || value.buildId.length > 128
    || value.protocolVersion !== 1 || !validStorageSchemas(value.storageSchemas) || !Array.isArray(value.shellAssets)
    || !Array.isArray(value.publicNavigationPaths)) return false;
  for (const asset of value.shellAssets) {
    if (!asset || typeof asset.path !== 'string' || !asset.path.startsWith('/') || asset.path.startsWith('//')
      || asset.path.includes('?') || asset.path.includes('#') || asset.path.includes('\\')
      || /%(?:2f|5c|00)/i.test(asset.path) || /[\u0000-\u0020\u007f]/u.test(asset.path)
      || !/^[a-f0-9]{64}$/i.test(asset.sha256)) return false;
  }
  if (new Set(value.shellAssets.map((asset) => asset.path)).size !== value.shellAssets.length) return false;
  for (const path of value.publicNavigationPaths) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('?') || path.includes('#') || path.includes('\\') || /[\u0000-\u0020\u007f]/u.test(path)) return false;
    if (!value.shellAssets.some((asset) => asset.path === path)) return false;
  }
  if (new Set(value.publicNavigationPaths).size !== value.publicNavigationPaths.length) return false;
  return value.shellAssets.length > 0 && value.publicNavigationPaths.length > 0;
}

function validBuildEnvelope(value) {
  return exactKeys(value, ['shellRef', 'buildCompatibility']) && typeof value.shellRef === 'string'
    && /^[a-f0-9]{64}$/u.test(value.shellRef)
    && exactKeys(value.buildCompatibility, ['buildId', 'protocolVersion', 'storageSchemas', 'shellAssets', 'publicNavigationPaths'])
    && validConfig({ schemaVersion: 1, storageSchemaVersion: 5, ...value.buildCompatibility });
}

function exactKeys(value, keys) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function postStatus(port, requestId, targetBuildId, status, reason = null, pendingClients = 0, leaseIds = []) {
  try { port?.postMessage({ schemaVersion: SCHEMA, type: 'STATUS', requestId, targetBuildId, buildId: BUILD_ID, leaseIds, status, reason, pendingClients }); } catch { /* disconnected requester */ }
}

async function reportClientState(client, targetBuildId, requestId) {
  if (!client || client.type !== 'window' || !client.url || new URL(client.url).origin !== self.location.origin) return null;
  const channel = new MessageChannel();
  try {
    const state = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), MAX_HANDSHAKE_MS);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        const data = event.data;
        if (!exactKeys(data, ['schemaVersion', 'type', 'requestId', 'state', 'lease']) || data.schemaVersion !== SCHEMA || data.type !== 'CLIENT_STATE' || data.requestId !== requestId) return resolve(null);
        resolve({ state: data.state, lease: data.lease });
      };
      client.postMessage({ schemaVersion: SCHEMA, type: 'STATE_REQUEST', requestId, targetBuildId }, [channel.port2]);
    });
    if (!state?.state || !exactKeys(state.state, ['clientRef', 'buildId', 'protocolVersion', 'storageSchemas', 'hasUnsavedDraft', 'activeCall', 'pendingPrivateMutation', 'canActivate'])
      || !state.lease || !exactKeys(state.lease, ['id', 'validUntil']) || typeof state.lease.id !== 'string' || state.lease.id.length > 128
      || !Number.isSafeInteger(state.lease.validUntil) || state.lease.validUntil <= Date.now() || state.lease.validUntil > Date.now() + 30_000) return null;
    const clientState = state.state;
    if (!clientState || !exactKeys(clientState, ['clientRef', 'buildId', 'protocolVersion', 'storageSchemas', 'hasUnsavedDraft', 'activeCall', 'pendingPrivateMutation', 'canActivate'])
      || typeof clientState.clientRef !== 'string' || !clientState.clientRef || clientState.clientRef.length > 256
      || typeof clientState.buildId !== 'string' || !clientState.buildId || clientState.buildId.length > 128
      || clientState.protocolVersion !== BUILD_CONFIG.protocolVersion || !validStorageSchemas(clientState.storageSchemas)
      || typeof clientState.hasUnsavedDraft !== 'boolean' || typeof clientState.activeCall !== 'boolean'
      || typeof clientState.pendingPrivateMutation !== 'boolean' || typeof clientState.canActivate !== 'boolean') return null;
    return { ...clientState, leaseId: state.lease.id, leaseValidUntil: state.lease.validUntil };
  } finally { channel.port1.close(); channel.port2.close(); }
}

async function inspectClients(targetBuildId, requestId) {
  const first = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const states = new Map();
  const blocked = [];
  await Promise.all(first.map(async (client) => {
    const state = await reportClientState(client, targetBuildId, requestId);
    if (!state) { blocked.push(client.id); return; }
    states.set(client.id, state);
    if (state.hasUnsavedDraft || state.activeCall || state.pendingPrivateMutation || !state.canActivate || state.leaseValidUntil <= Date.now()) blocked.push(client.id);
  }));
  const second = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const ids = new Set(second.map((client) => client.id));
  const changed = first.some((client) => !ids.has(client.id)) || second.some((client) => !states.has(client.id));
  return { first, second, states, blocked, changed };
}

async function activateWhenSafe(requestId, targetBuildId, replyPort, requesterId) {
  if (!validConfig(BUILD_CONFIG) || targetBuildId !== BUILD_ID) {
    postStatus(replyPort, requestId, targetBuildId, 'failed', 'version-mismatch');
    return;
  }
  if (!requesterId) { postStatus(replyPort, requestId, targetBuildId, 'failed', 'unknown-clients'); return; }
  const jobKey = `${requesterId}\0${requestId}`;
  const job = { cancelled: false, requesterId, targetBuildId, leaseIds: [] };
  jobs.set(jobKey, job);
  const first = await inspectClients(targetBuildId, requestId);
  job.leaseIds = [...first.states.values()].map((state) => state.leaseId);
  if (job.cancelled || jobs.get(jobKey) !== job) {
    postStatus(replyPort, requestId, targetBuildId, 'cancelled', null, 0, job.leaseIds);
    await broadcastStatus('cancelled', requestId, targetBuildId, job.leaseIds);
    jobs.delete(jobKey);
    return;
  }
  const remaining = first.blocked.length + (first.changed ? 1 : 0);
  if (remaining > 0) { postStatus(replyPort, requestId, targetBuildId, 'blocked-by-clients', first.changed ? 'unknown-clients' : 'client-not-ready', remaining, job.leaseIds); await broadcastStatus('blocked-by-clients', requestId, targetBuildId, job.leaseIds); jobs.delete(jobKey); return; }
  const final = await inspectClients(targetBuildId, requestId);
  job.leaseIds = [...final.states.values()].map((state) => state.leaseId);
  if (job.cancelled || jobs.get(jobKey) !== job) {
    postStatus(replyPort, requestId, targetBuildId, 'cancelled', null, 0, job.leaseIds);
    await broadcastStatus('cancelled', requestId, targetBuildId, job.leaseIds);
    jobs.delete(jobKey);
    return;
  }
  const finalIds = new Set(final.second.map((client) => client.id));
  if (final.changed || final.blocked.length || final.second.length !== first.second.length || first.second.some((client) => !finalIds.has(client.id))) {
    postStatus(replyPort, requestId, targetBuildId, 'blocked-by-clients', 'unknown-clients', Math.max(1, final.blocked.length), job.leaseIds);
    await broadcastStatus('blocked-by-clients', requestId, targetBuildId, job.leaseIds);
    jobs.delete(jobKey);
    return;
  }
  const leaseIds = [];
  for (const [clientId, state] of final.states) { activatedClientBuilds.set(clientId, state.buildId); leaseIds.push(state.leaseId); }
  if ([...final.states.values()].some((state) => state.leaseValidUntil <= Date.now())) {
    postStatus(replyPort, requestId, targetBuildId, 'blocked-by-clients', 'unknown-clients', 1, leaseIds);
    await broadcastStatus('blocked-by-clients', requestId, targetBuildId, leaseIds);
    jobs.delete(jobKey);
    return;
  }
  postStatus(replyPort, requestId, targetBuildId, 'activating', null, 0, leaseIds);
  await broadcastStatus('activating', requestId, targetBuildId, leaseIds);
  if (job.cancelled || jobs.get(jobKey) !== job || [...final.states.values()].some((state) => state.leaseValidUntil <= Date.now())) {
    postStatus(replyPort, requestId, targetBuildId, 'blocked-by-clients', 'unknown-clients', 1, leaseIds);
    await broadcastStatus('blocked-by-clients', requestId, targetBuildId, leaseIds);
    jobs.delete(jobKey);
    return;
  }
  try { await self.skipWaiting(); }
  catch {
    postStatus(replyPort, requestId, targetBuildId, 'failed', 'activation-failed', 0, leaseIds);
    await broadcastStatus('failed', requestId, targetBuildId, leaseIds);
  }
  finally { jobs.delete(jobKey); }
}

async function broadcastStatus(status, requestId, targetBuildId, leaseIds = []) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage({ schemaVersion: SCHEMA, type: 'STATUS', status, buildId: BUILD_ID, requestId, targetBuildId, leaseIds });
}

function trustedClient(source) {
  if (!source || !('id' in source) || source.type !== 'window' || typeof source.url !== 'string') return null;
  try { return new URL(source.url).origin === self.location.origin ? source : null; } catch { return null; }
}

function validClientState(value) {
  return !!value && exactKeys(value, ['clientRef', 'buildId', 'protocolVersion', 'storageSchemas', 'hasUnsavedDraft', 'activeCall', 'pendingPrivateMutation', 'canActivate'])
    && typeof value.clientRef === 'string' && value.clientRef.length > 0 && value.clientRef.length <= 256
    && typeof value.buildId === 'string' && value.buildId.length > 0 && value.buildId.length <= 128
    && value.protocolVersion === BUILD_CONFIG.protocolVersion && validStorageSchemas(value.storageSchemas)
    && typeof value.hasUnsavedDraft === 'boolean' && typeof value.activeCall === 'boolean'
    && typeof value.pendingPrivateMutation === 'boolean' && typeof value.canActivate === 'boolean';
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    if (!validBuildEnvelope(BUILD_ENVELOPE) || !validConfig(BUILD_CONFIG)) throw new Error('Invalid build shell manifest');
    const cache = await caches.open(CACHE_NAME);
    for (const asset of BUILD_CONFIG.shellAssets) {
      const url = new URL(asset.path, self.location.origin);
      if (url.origin !== self.location.origin || url.search || url.hash) throw new Error('Invalid shell asset URL');
      const response = await fetch(url.href, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok || response.type === 'opaque') throw new Error(`Shell asset unavailable: ${asset.path}`);
      const bytes = await response.clone().arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      if (hex !== asset.sha256.toLowerCase()) throw new Error(`Shell asset hash mismatch: ${asset.path}`);
      await cache.put(url.href, response);
      allowedByPath.set(url.pathname, asset.path);
    }
    const metadataUrl = new URL('/runtime-build.json', self.location.origin);
    const metadataResponse = await fetch(metadataUrl.href, { cache: 'no-store', credentials: 'same-origin' });
    if (!metadataResponse.ok || metadataResponse.type === 'opaque') throw new Error('Runtime metadata unavailable');
    const metadataBytes = await metadataResponse.clone().arrayBuffer();
    const expectedMetadata = new TextEncoder().encode(JSON.stringify(BUILD_ENVELOPE));
    if (metadataBytes.byteLength !== expectedMetadata.byteLength
      || !expectedMetadata.every((byte, index) => new Uint8Array(metadataBytes)[index] === byte)) throw new Error('Runtime metadata mismatch');
    await cache.put(metadataUrl.href, metadataResponse);
    for (const path of BUILD_CONFIG.publicNavigationPaths) {
      if (!allowedByPath.has(path)) throw new Error(`Navigation path is not a staged shell asset: ${path}`);
    }
    // One-time migration: the pre-November worker cached every same-origin
    // GET cache-first under `onyx-shell-*` and has no activation protocol,
    // so returning visitors stayed on that old site forever. When its cache
    // is present, replace it immediately instead of waiting.
    if ((await caches.keys()).some((key) => key.startsWith(LEGACY_CACHE_PREFIX))) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (!validConfig(BUILD_CONFIG)) return;
    const legacyKeys = (await caches.keys()).filter((key) => key.startsWith(LEGACY_CACHE_PREFIX));
    await self.clients.claim();
    if (legacyKeys.length > 0) {
      await Promise.all(legacyKeys.map((key) => caches.delete(key)));
      // Pages still run the old cached build; load them once onto this one.
      const pages = await self.clients.matchAll({ type: 'window' });
      for (const page of pages) { try { await page.navigate(page.url); } catch { /* page closed */ } }
    }
    const live = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const retainedBuilds = new Set([BUILD_ID]);
    for (const client of live) {
      const buildId = activatedClientBuilds.get(client.id);
      if (buildId) retainedBuilds.add(buildId);
      else {
        // Unknown live clients may still need any previous app shell cache.
        const keys = await caches.keys();
        for (const key of keys) if (key.startsWith(CACHE_PREFIX)) retainedBuilds.add(key.slice(CACHE_PREFIX.length));
      }
    }
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && !retainedBuilds.has(key.slice(CACHE_PREFIX.length))).map((key) => caches.delete(key)));
    for (const client of live) client.postMessage({ schemaVersion: SCHEMA, type: 'STATUS', status: 'ready', buildId: BUILD_ID });
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.schemaVersion !== SCHEMA || typeof data.type !== 'string') return;
  const source = event.source;
  const port = event.ports[0];
  if (data.type === 'HELLO') {
    const client = trustedClient(source);
    if (!exactKeys(data, ['schemaVersion', 'type', 'buildCompatibility', 'clientRef', 'clientState']) || !client || !port
      || typeof data.clientRef !== 'string' || data.clientRef.length < 1 || data.clientRef.length > 256
      || !exactKeys(data.buildCompatibility, ['buildId', 'protocolVersion', 'storageSchemas', 'shellAssets', 'publicNavigationPaths'])
      || typeof data.buildCompatibility.buildId !== 'string' || data.buildCompatibility.buildId.length < 1 || data.buildCompatibility.buildId.length > 128
      || data.buildCompatibility.protocolVersion !== BUILD_CONFIG.protocolVersion
      || !validStorageSchemas(data.buildCompatibility.storageSchemas)
      || !Array.isArray(data.buildCompatibility.shellAssets) || !Array.isArray(data.buildCompatibility.publicNavigationPaths)
      || data.clientState !== null && (!validClientState(data.clientState) || data.clientState.clientRef !== data.clientRef || data.clientState.buildId !== data.buildCompatibility.buildId)) { port.close(); return; }
    if (data.clientState) clientStates.set(client.id, data.clientState);
    port.postMessage({ schemaVersion: SCHEMA, type: 'STATUS', status: 'ready', buildId: BUILD_ID, protocolVersion: BUILD_CONFIG.protocolVersion, storageSchemas: BUILD_CONFIG.storageSchemas });
    port.close();
    return;
  }
  if (data.type === 'CLIENT_STATE') {
    const client = trustedClient(source);
    if (!exactKeys(data, ['schemaVersion', 'type', 'state']) || !client || !validClientState(data.state)) return;
    clientStates.set(client.id, data.state);
    return;
  }
  if (data.type === 'REQUEST_ACTIVATION') {
    const client = trustedClient(source);
    if (!exactKeys(data, ['schemaVersion', 'type', 'requestId', 'targetBuildId']) || !client || !port
      || typeof data.requestId !== 'string' || data.requestId.length > 128 || typeof data.targetBuildId !== 'string') return;
    event.waitUntil(activateWhenSafe(data.requestId, data.targetBuildId, port, client.id));
    return;
  }
  if (data.type === 'CANCEL_ACTIVATION') {
    const client = trustedClient(source);
    if (!exactKeys(data, ['schemaVersion', 'type', 'requestId', 'targetBuildId']) || !client || typeof data.requestId !== 'string') return;
    const job = jobs.get(`${client.id}\0${data.requestId}`);
    if (job && job.requesterId === client.id && job.targetBuildId === data.targetBuildId) {
      job.cancelled = true;
      event.waitUntil(broadcastStatus('cancelled', data.requestId, data.targetBuildId, job.leaseIds));
    }
    return;
  }
  if (data.type === 'STATE_REQUEST') {
    if (!exactKeys(data, ['schemaVersion', 'type', 'requestId', 'targetBuildId']) || !port || typeof data.requestId !== 'string' || typeof data.targetBuildId !== 'string' || data.targetBuildId !== BUILD_ID) return;
    const client = trustedClient(source);
    const state = client ? clientStates.get(client.id) : null;
    port.postMessage({ schemaVersion: SCHEMA, type: 'CLIENT_STATE', requestId: data.requestId, state: state ?? null, lease: null });
    port.close();
    return;
  }
  if (data.type === 'CLAIM_NOTIFICATION_ROUTE') {
    const client = trustedApplicationClient(source);
    if (!exactKeys(data, ['schemaVersion', 'type', 'requestId', 'networkId', 'accountId']) || !client || !port
      || typeof data.requestId !== 'string' || data.requestId.length < 1 || data.requestId.length > 128
      || typeof data.networkId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/u.test(data.networkId)
      || data.accountId !== null && (typeof data.accountId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/u.test(data.accountId))) { port?.close(); return; }
    event.waitUntil((async () => {
      let result;
      try { result = await claimNotificationRoute(client, data.requestId, data.networkId, data.accountId); }
      catch { result = { schemaVersion: 1, type: 'NOTIFICATION_ROUTE_CLAIM_RESULT', requestId: data.requestId, status: 'unavailable', route: null }; }
      if (port && result) port.postMessage(result);
      port?.close();
    })());
    return;
  }
  if (data.type === 'SETTLE_NOTIFICATION_ROUTE') {
    const client = trustedApplicationClient(source);
    if (!exactKeys(data, ['schemaVersion', 'type', 'requestId', 'routeRef', 'claimRef', 'outcome']) || !client || !port
      || typeof data.requestId !== 'string' || data.requestId.length < 1 || data.requestId.length > 128
      || typeof data.routeRef !== 'string' || !/^[0-9a-f-]{36}$/iu.test(data.routeRef)
      || typeof data.claimRef !== 'string' || !/^[0-9a-f-]{36}$/iu.test(data.claimRef)
      || !['opened', 'authentication-required', 'unavailable'].includes(data.outcome)) { port?.close(); return; }
    event.waitUntil((async () => {
      let result;
      try { result = await settleNotificationRoute(client, data.requestId, data.routeRef, data.claimRef, data.outcome); }
      catch { result = { schemaVersion: 1, type: 'NOTIFICATION_ROUTE_SETTLE_RESULT', requestId: data.requestId, status: 'unavailable' }; }
      if (port && result) port.postMessage(result);
      port?.close();
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search || url.hash) return;
  if (!validConfig(BUILD_CONFIG)) return;
  const exactAsset = BUILD_CONFIG.shellAssets.some((asset) => asset.path === url.pathname);
  const metadata = url.pathname === '/runtime-build.json' && validBuildEnvelope(BUILD_ENVELOPE);
  const navigation = request.mode === 'navigate' && BUILD_CONFIG.publicNavigationPaths.includes(url.pathname);
  if (!exactAsset && !metadata && !navigation) return;
  const cacheUrl = new URL(url.pathname, self.location.origin).href;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(cacheUrl) ?? new Response('', { status: 503, statusText: 'Shell asset is unavailable' });
  })());
});

function validTarget(target, channel) {
  return typeof target === 'string' && new TextEncoder().encode(target).length <= 128
    && target.length > (channel ? 1 : 0) && !/[\u0000-\u0020\u007f,!:]/u.test(target)
    && (channel ? target.startsWith('#') : !target.startsWith('#'));
}

const ROUTE_PREFIX = 'notification-route:';
const ROUTE_TTL_MS = 10 * 60_000;
const ROUTE_CLAIM_TTL_MS = 30_000;
const ROUTE_MAX_PENDING = 16;
const ROUTE_SETTINGS_SCAN_MAX = 256;

function uuidRef() {
  try { return crypto.randomUUID(); } catch { return null; }
}

function validPendingRoute(value) {
  if (!value || !exactKeys(value, ['schemaVersion', 'kind', 'routeRef', 'networkId', 'accountId', 'bindingRef', 'routeKind', 'conversationId', 'createdAtMs', 'expiresAtMs', 'claim'])
    || value.schemaVersion !== 1 || value.kind !== 'pending-notification-route' || !/^[0-9a-f-]{36}$/iu.test(value.routeRef)
    || !['dm', 'mention', 'call', 'inbox'].includes(value.routeKind) || !Number.isSafeInteger(value.createdAtMs)
    || !Number.isSafeInteger(value.expiresAtMs) || value.expiresAtMs <= value.createdAtMs
    || value.expiresAtMs - value.createdAtMs > ROUTE_TTL_MS) return false;
  if (value.routeKind === 'inbox') return value.networkId === null && value.accountId === null && value.bindingRef === null && value.conversationId === null;
  return typeof value.networkId === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(value.networkId)
    && typeof value.accountId === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(value.accountId)
    && typeof value.bindingRef === 'string' && /^[0-9a-f-]{36}$/iu.test(value.bindingRef)
    && validTarget(value.conversationId, value.routeKind !== 'dm');
}

function validRouteClaim(value) {
  return value === null || exactKeys(value, ['clientId', 'claimRef', 'expiresAtMs'])
    && typeof value.clientId === 'string' && value.clientId.length > 0 && value.clientId.length <= 256
    && typeof value.claimRef === 'string' && /^[0-9a-f-]{36}$/iu.test(value.claimRef)
    && Number.isSafeInteger(value.expiresAtMs);
}

function boundedWorkerSettingsRows(store) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(rows); return; }
      rows.push(cursor.value);
      if (rows.length > ROUTE_SETTINGS_SCAN_MAX) { resolve(null); return; }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

function readNotificationRouteBinding(bindingRef) {
  return openPlatformDb().then(async (db) => {
    try {
      const tx = db.transaction('push_bindings', 'readonly');
      const rows = await new Promise((resolve, reject) => {
        const request = tx.objectStore('push_bindings').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const matches = rows.map((row) => row?.binding).filter((binding) => binding?.schemaVersion === 1
        && binding.explicitIntent === true && binding.endpointRef === bindingRef
        && typeof binding.ownerRef === 'string' && typeof binding.networkId === 'string'
        && /^[A-Za-z0-9._-]{1,128}$/u.test(binding.networkId) && typeof binding.accountId === 'string'
        && /^[A-Za-z0-9._-]{1,128}$/u.test(binding.accountId)
        && typeof binding.node === 'string' && ['private', 'sender-only', 'message-preview'].includes(binding.previewPolicy));
      return matches.length === 1 ? matches[0] : null;
    } finally { db.close(); }
  });
}

async function persistNotificationRoute(route) {
  const now = Date.now();
  const routeRef = uuidRef();
  if (!routeRef) return null;
  const value = { schemaVersion: 1, kind: 'pending-notification-route', routeRef,
    networkId: route.networkId, accountId: route.accountId, bindingRef: route.bindingRef,
    routeKind: route.kind, conversationId: route.conversationId, createdAtMs: now,
    expiresAtMs: now + ROUTE_TTL_MS, claim: null };
  if (!validPendingRoute(value)) return null;
  const db = await openPlatformDb();
  try {
    const tx = db.transaction('worker_settings', 'readwrite');
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); });
    const store = tx.objectStore('worker_settings');
    const rows = await boundedWorkerSettingsRows(store);
    if (!rows) { tx.abort(); await done.catch(() => {}); return null; }
    const pending = rows.filter((row) => typeof row?.key === 'string' && row.key.startsWith(ROUTE_PREFIX));
    const live = [];
    for (const row of pending) {
      const item = row?.route;
      if (!validPendingRoute(item) || item.expiresAtMs <= now || !validRouteClaim(item.claim)) { store.delete(row.key); continue; }
      if (item.claim && item.claim.expiresAtMs <= now) {
        const unclaimed = { ...item, claim: null };
        store.put({ key: row.key, route: unclaimed });
        live.push({ ...row, route: unclaimed });
      } else live.push(row);
    }
    live.sort((a, b) => a.route.createdAtMs - b.route.createdAtMs || a.key.localeCompare(b.key));
    while (live.length >= ROUTE_MAX_PENDING) store.delete(live.shift().key);
    store.put({ key: `${ROUTE_PREFIX}${routeRef}`, route: value });
    await done;
    return routeRef;
  } catch { return null; }
  finally { db.close(); }
}

function trustedApplicationClient(source) {
  const client = trustedClient(source);
  if (!client || typeof BUILD_CONFIG?.publicNavigationPaths === 'undefined') return null;
  try {
    const url = new URL(client.url);
    return BUILD_CONFIG.publicNavigationPaths.includes(url.pathname) ? client : null;
  } catch { return null; }
}

async function claimNotificationRoute(client, requestId, networkId, accountId) {
  const now = Date.now(); const db = await openPlatformDb();
  try {
    const tx = db.transaction('worker_settings', 'readwrite'); const store = tx.objectStore('worker_settings');
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); });
    const rows = await boundedWorkerSettingsRows(store);
    if (!rows) { tx.abort(); await done.catch(() => {}); throw new Error('notification route store exceeds bounded scan'); }
    const pending = rows.filter((row) => typeof row?.key === 'string' && row.key.startsWith(ROUTE_PREFIX));
    const live = [];
    for (const row of pending) {
      const route = row?.route;
      if (!validPendingRoute(route) || !validRouteClaim(route.claim) || route.expiresAtMs <= now) { store.delete(row.key); continue; }
      if (route.claim && route.claim.expiresAtMs <= now) {
        const unclaimed = { ...route, claim: null };
        store.put({ key: row.key, route: unclaimed });
        // Expiry makes the route available again, but does not change its
        // account/network scope. Apply the same selection fence below.
        if (unclaimed.routeKind === 'inbox' || unclaimed.networkId === networkId && unclaimed.accountId === accountId) {
          live.push({ row, route: unclaimed });
        }
        continue;
      }
      if (route.routeKind === 'inbox' || route.networkId === networkId && route.accountId === accountId) live.push({ row, route });
    }
    live.sort((a, b) => b.route.createdAtMs - a.route.createdAtMs || b.route.routeRef.localeCompare(a.route.routeRef));
    const found = live.find(({ route }) => !route.claim || route.claim.clientId === client.id);
    if (!found) {
      await done;
      return { schemaVersion: 1, type: 'NOTIFICATION_ROUTE_CLAIM_RESULT', requestId, status: 'empty', route: null };
    }
    const claim = found.route.claim && found.route.claim.clientId === client.id
      ? found.route.claim : { clientId: client.id, claimRef: uuidRef(), expiresAtMs: now + ROUTE_CLAIM_TTL_MS };
    if (!claim.claimRef) { tx.abort(); await done.catch(() => {}); return null; }
    const claimed = { ...found.route, claim };
    store.put({ key: found.row.key, route: claimed });
    await done;
    const { routeRef, networkId: savedNetworkId, accountId: savedAccountId, bindingRef, routeKind, conversationId, createdAtMs, expiresAtMs } = claimed;
    return { schemaVersion: 1, type: 'NOTIFICATION_ROUTE_CLAIM_RESULT', requestId, status: 'claimed', route: {
      schemaVersion: 1, routeRef, claimRef: claim.claimRef, networkId: savedNetworkId, accountId: savedAccountId,
      bindingRef, kind: routeKind, conversationId, createdAtMs, expiresAtMs,
    } };
  } finally { db.close(); }
}

async function settleNotificationRoute(client, requestId, routeRef, claimRef, outcome) {
  const now = Date.now(); const db = await openPlatformDb();
  try {
    const tx = db.transaction('worker_settings', 'readwrite'); const store = tx.objectStore('worker_settings');
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); });
    const key = `${ROUTE_PREFIX}${routeRef}`;
    const row = await new Promise((resolve, reject) => { const request = store.get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const route = row?.route;
    const matches = validPendingRoute(route) && route.expiresAtMs > now && validRouteClaim(route.claim) && route.claim?.clientId === client.id
      && route.claim.claimRef === claimRef && route.claim.expiresAtMs > now;
    if (!matches) {
      await done;
      return { schemaVersion: 1, type: 'NOTIFICATION_ROUTE_SETTLE_RESULT', requestId, status: 'stale' };
    }
    if (outcome === 'opened') store.delete(key);
    else store.put({ key, route: { ...route, claim: null } });
    await done;
    return { schemaVersion: 1, type: 'NOTIFICATION_ROUTE_SETTLE_RESULT', requestId, status: 'settled' };
  } finally { db.close(); }
}

function validPushPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (!['dm', 'mention', 'call'].includes(value.type) || typeof value.from !== 'string' || !value.from.trim()
    || new TextEncoder().encode(value.from).byteLength > 256 || typeof value.text !== 'string'
    || new TextEncoder().encode(value.text).byteLength > 640 || /[\u0000-\u001f\u007f]/u.test(value.from + value.text)) return null;
  const allowed = value.type === 'mention' || value.type === 'call' ? ['channel', 'from', 'text', 'type'] : ['from', 'text', 'type'];
  if (keys.join(',') !== allowed.sort().join(',')) return null;
  if ((value.type === 'mention' || value.type === 'call') && !validTarget(value.channel, true)) return null;
  if (value.type === 'dm' && !validTarget(value.from, false)) return null;
  if (new TextEncoder().encode(value.from).length > 128 || new TextEncoder().encode(value.text).length > 240
    || value.channel && new TextEncoder().encode(value.channel).length > 128) return null;
  return value;
}

function openPlatformDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('onyx-platform', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ['push_bindings', 'reconcile_tasks', 'worker_settings']) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('platform database blocked'));
  });
}

async function readPushBindingForSubscription(subscription) {
  if (!subscription?.endpoint) return null;
  const endpointBytes = new TextEncoder().encode(subscription.endpoint);
  const digest = await crypto.subtle.digest('SHA-256', endpointBytes);
  const endpointHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const db = await openPlatformDb();
  try {
    const tx = db.transaction(['push_bindings', 'worker_settings'], 'readonly');
    const [rows, settingRow] = await Promise.all([
      new Promise((resolve, reject) => { const req = tx.objectStore('push_bindings').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }),
      new Promise((resolve, reject) => { const req = tx.objectStore('worker_settings').get('worker'); req.onsuccess = () => resolve(req.result?.settings ?? null); req.onerror = () => reject(req.error); }),
    ]);
    const matches = rows.map((row) => row?.binding).filter((binding) => binding?.schemaVersion === 1
      && binding.explicitIntent === true && binding.endpointSha256 === endpointHash
      && typeof binding.ownerRef === 'string' && typeof binding.networkId === 'string' && typeof binding.accountId === 'string'
      && typeof binding.node === 'string' && ['private', 'sender-only', 'message-preview'].includes(binding.previewPolicy));
    if (matches.length !== 1) return null;
    const rank = (value) => value === 'private' ? 0 : value === 'sender-only' ? 1 : value === 'message-preview' ? 2 : 0;
    const configured = ['private', 'sender-only', 'message-preview'].includes(settingRow?.previewPolicy) ? settingRow.previewPolicy : 'private';
    const bound = matches[0].previewPolicy;
    return { binding: matches[0], previewPolicy: rank(configured) < rank(bound) ? configured : bound };
  } finally { db.close(); }
}

async function persistSubscriptionReconcile(binding, reason) {
  if (!binding) return;
  const task = { schemaVersion: 1, ownerRef: binding.ownerRef, networkId: binding.networkId, accountId: binding.accountId, node: binding.node, reason };
  const db = await openPlatformDb();
  try {
    const tx = db.transaction(['reconcile_tasks', 'push_bindings'], 'readwrite');
    tx.objectStore('reconcile_tasks').put({ key: JSON.stringify([binding.networkId, binding.accountId, binding.node]), task });
    const bindingKey = JSON.stringify([binding.networkId, binding.accountId, binding.node]);
    const store = tx.objectStore('push_bindings');
    const prior = await new Promise((resolve, reject) => {
      const request = store.get(bindingKey);
      request.onsuccess = () => resolve(request.result?.binding ?? null);
      request.onerror = () => reject(request.error);
    });
    if (prior?.ownerRef === binding.ownerRef && prior?.endpointSha256 === binding.endpointSha256) {
      store.put({ key: bindingKey, binding: { ...prior, serverState: 'unknown' } });
    }
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); });
  } finally { db.close(); }
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    if (!event.data) return;
    let payload;
    try {
      const raw = event.data.text();
      if (new TextEncoder().encode(raw).length > 2048) return;
      payload = validPushPayload(JSON.parse(raw));
    } catch { return; }
    if (!payload) return;
    const subscription = await self.registration.pushManager.getSubscription().catch(() => null);
    const resolved = await readPushBindingForSubscription(subscription).catch(() => null);
    const target = payload.type === 'dm' ? payload.from : payload.channel;
    const route = resolved && target ? {
      schemaVersion: 1, networkId: resolved.binding.networkId, bindingRef: resolved.binding.endpointRef,
      accountId: resolved.binding.accountId, kind: payload.type, conversationId: target,
    } : { schemaVersion: 1, kind: 'inbox' };
    const preference = resolved?.previewPolicy ?? 'private';
    const policy = preference === 'private' ? 'private' : preference === 'sender-only' ? 'sender-only' : 'message-preview';
    const privateDm = payload.type === 'dm';
    const title = policy === 'private' || privateDm ? 'Onyx notification'
      : payload.type === 'call' ? `Call from ${payload.from}` : `${payload.from} sent a notification`;
    // Room encryption policy is not present in server payloads or this private
    // projection yet, so mention/call previews fail closed to generic text.
    const body = 'You have a new notification.';
    await self.registration.showNotification(title, {
      body,
      tag: resolved ? `onyx:${resolved.binding.ownerRef}:${payload.type}` : `onyx:generic:${payload.type}`,
      data: { schemaVersion: SCHEMA, route },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data;
    const route = data?.schemaVersion === SCHEMA ? data.route : null;
    const routeKeys = route && typeof route === 'object' ? Object.keys(route).sort().join(',') : '';
    let safeRoute = { networkId: null, accountId: null, bindingRef: null, kind: 'inbox', conversationId: null };
    if (route?.schemaVersion === 1 && route.kind === 'inbox' && routeKeys === 'kind,schemaVersion') {
      // Generic inbox notifications carry no account context.
    } else if (route?.schemaVersion === 1 && ['dm', 'mention', 'call'].includes(route.kind)
      && routeKeys === 'accountId,bindingRef,conversationId,kind,networkId,schemaVersion'
      && typeof route.bindingRef === 'string' && /^[0-9a-f-]{36}$/iu.test(route.bindingRef)
      && typeof route.accountId === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(route.accountId)
      && typeof route.conversationId === 'string' && route.conversationId.length <= 256
      && typeof route.networkId === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(route.networkId)
      && validTarget(route.conversationId, route.kind !== 'dm')) {
      const binding = await readNotificationRouteBinding(route.bindingRef).catch(() => null);
      if (binding && binding.networkId === route.networkId && binding.accountId === route.accountId
        && binding.endpointRef === route.bindingRef) {
        safeRoute = { networkId: binding.networkId, accountId: binding.accountId, bindingRef: binding.endpointRef,
          kind: route.kind, conversationId: route.conversationId };
      }
    }
    const path = BUILD_CONFIG.publicNavigationPaths.includes('/app/') ? '/app/' : null;
    if (!path) return;
    const target = new URL(path, self.location.origin);
    const routeRef = await persistNotificationRoute(safeRoute).catch(() => null);
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clients.find((client) => !!trustedApplicationClient(client));
    if (existing) {
      if (routeRef) existing.postMessage({ schemaVersion: SCHEMA, type: 'PENDING_NOTIFICATION_ROUTE', routeRef });
      return existing.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const oldSubscription = event.oldSubscription ?? null;
    const bindingResult = await readPushBindingForSubscription(oldSubscription).catch(() => null);
    if (bindingResult) await persistSubscriptionReconcile(bindingResult.binding, 'subscription-changed').catch(() => {});
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (bindingResult) for (const client of clients) client.postMessage({ schemaVersion: SCHEMA, type: 'PUSH_RECONCILE_REQUIRED', ownerRef: bindingResult.binding.ownerRef, nodeRef: bindingResult.binding.node });
  })());
});
