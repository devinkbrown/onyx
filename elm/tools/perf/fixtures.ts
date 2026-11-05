// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Page, WebSocketRoute } from '@playwright/test';

export const SEED = 0x0e90;
export const FIXED_EPOCH = Date.UTC(2026, 9, 9, 10, 0, 0);
export const ROOM_COUNT = 50;
export const ROSTER_COUNT = 1000;
export const DISK_TARGETS = 250;
export const PER_TARGET = 400;

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function diskRows() {
  const random = mulberry32(SEED);
  const rows = [];
  for (let target = 0; target < DISK_TARGETS; target++) {
    for (let index = 0; index < PER_TARGET; index++) {
      const length = 20 + Math.floor(random() * 281);
      const prefix = `fixture ${target}/${index} `;
      const body = prefix + 'x'.repeat(Math.max(0, length - prefix.length));
      rows.push({
        id: `perf-${target}-${index}`,
        target: target < ROOM_COUNT ? `#perf-${target}` : `#archive-${target - ROOM_COUNT}`,
        from: `fixture${target % 17}`,
        body,
        at: FIXED_EPOCH + target * PER_TARGET + index,
        rowType: 'msg',
      });
    }
  }
  return rows;
}

export async function seedOwnedRows(page: Page, input: { networkId: string; accountId: string }) {
  return page.evaluate(async ({ networkId, accountId, seed, fixedEpoch, targets, perTarget, roomCount }) => {
    const existing = await indexedDB.databases?.();
    if (!existing || !existing.some(database => database.name === 'onyx-vault' && database.version === 5)) {
      throw new Error('fixture-precondition: production vault schema v5 is not initialized');
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('onyx-vault');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error('fixture-precondition: refusing to create or upgrade the production vault')); };
    });
    const required = ['messages_owned', 'outbox_owned', 'drafts_owned', 'read_anchors_owned', 'settings_owned', 'private_backups_owned', 'quarantine_decisions', 'messages', 'outbox', 'scheduled', 'vault_meta'];
    if (db.version !== 5 || required.some(name => !db.objectStoreNames.contains(name))
      || !db.transaction('messages_owned').objectStore('messages_owned').indexNames.contains('by-owner-target')) {
      db.close(); throw new Error('fixture-precondition: production vault schema/indexes do not match migrations.ts v5');
    }
    const ownerKey = JSON.stringify([networkId, 'account', accountId]);
    const scheme = { name: 'rfc1459', revision: 'irc-casemapping-v1:rfc1459' };
    let randomState = seed >>> 0;
    const random = () => {
      randomState = (randomState + 0x6d2b79f5) >>> 0;
      let value = randomState;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    let inserted = 0;
    const storeName = 'messages_owned';
    for (let start = 0; start < targets * perTarget; start += 1000) {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const end = Math.min(start + 1000, targets * perTarget);
      for (let ordinal = start; ordinal < end; ordinal++) {
        const target = Math.floor(ordinal / perTarget); const index = ordinal % perTarget;
        const conversationId = target < roomCount ? `#perf-${target}` : `#archive-${target - roomCount}`;
        const targetKey = JSON.stringify([networkId, scheme.name, conversationId.toLowerCase()]);
        const recordId = `perf-${target}-${index}`;
        const messageId = `perf-msg-${target}-${index}`;
        const atMs = fixedEpoch + target * perTarget + index;
        const length = 20 + Math.floor(random() * 281);
        const prefix = `fixture ${target}/${index} `;
        const body = prefix + 'x'.repeat(Math.max(0, length - prefix.length));
        const row = { recordId, messageId, conversationId, from: `fixture${target % 17}`, body, atMs, serverTime: new Date(atMs).toISOString(), rowType: 'msg', deleted: false, redacted: false, replyTo: null, privacy: 'plain' };
        store.put({ id: JSON.stringify([ownerKey, recordId]), ownerKey, targetKey, scheme, row });
        inserted++;
      }
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
    }
    const check = db.transaction(storeName, 'readonly');
    const countOwned = await new Promise<number>((resolve, reject) => {
      const request = check.objectStore(storeName).index('by-owner').count(IDBKeyRange.only(ownerKey));
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const countTargetKey = JSON.stringify([networkId, scheme.name, '#perf-0']);
    const countTarget = await new Promise<number>((resolve, reject) => {
      const request = check.objectStore(storeName).index('by-owner-target').count(IDBKeyRange.only([ownerKey, countTargetKey]));
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => { check.oncomplete = () => resolve(); check.onerror = () => reject(check.error); check.onabort = () => reject(check.error); });
    db.close();
    return { inserted, countOwned, countTarget, ownerKey, storageVersion: 5, schemeRevision: scheme.revision };
  }, { ...input, seed: SEED, fixedEpoch: FIXED_EPOCH, targets: DISK_TARGETS, perTarget: PER_TARGET, roomCount: ROOM_COUNT });
}

export async function installWire(page: Page, name: string, options: { roster?: number; joinRooms?: number; disconnectOnPrivmsg?: boolean; deferInitialRows?: boolean } = {}) {
  type SocketState = {
    readonly socket: WebSocketRoute;
    nick: string | null;
    registered: boolean;
    readonly capabilities: Set<string>;
    readonly joined: Set<string>;
    batchCounter: number;
  };
  const offeredCapabilities = new Set(['message-tags', 'server-time', 'echo-message', 'draft/chathistory', 'batch']);
  const sent: string[] = [];
  const socketStates: SocketState[] = [];
  let socketOpens = 0;
  let active: SocketState | undefined;

  const nextBatchRef = (state: SocketState): string => {
    state.batchCounter = state.batchCounter >= 99_998 ? 1 : state.batchCounter + 1;
    return `perf${state.batchCounter}`;
  };
  const sendNames = (state: SocketState, channel: string): void => {
    const currentNick = state.nick;
    if (!currentNick || !state.joined.has(channel.toLowerCase())) return;
    const requestedRoster = channel.toLowerCase() === '#perf-0' ? options.roster ?? 0 : 0;
    const peers = Array.from({ length: Math.max(0, requestedRoster - 1) }, (_, index) => `user${index}`);
    const names = [currentNick, ...peers];
    for (let start = 0; start < names.length; start += 100) {
      state.socket.send(`:server 353 ${currentNick} = ${channel} :${names.slice(start, start + 100).join(' ')}`);
    }
    state.socket.send(`:server 366 ${currentNick} ${channel} :End of names`);
  };
  const sendEmptyHistoryBatch = (state: SocketState, target: string): void => {
    const ref = nextBatchRef(state);
    state.socket.send(`:server BATCH +${ref} chathistory ${target}`);
    state.socket.send(`:server BATCH -${ref}`);
  };

  await page.routeWebSocket(`wss://${name}.test/ws`, socket => {
    socketOpens++;
    const state: SocketState = {
      socket,
      nick: null,
      registered: false,
      capabilities: new Set(),
      joined: new Set(),
      batchCounter: 0,
    };
    socketStates.push(state);
    active = state;
    socket.onMessage(raw => {
      const line = String(raw).trim();
      // Authentication input is synthetic but remains private test data. Do
      // not retain or return it from the wire fixture.
      if (!line.startsWith('IDENTIFY ')) sent.push(line);
      const currentNick = state.nick;

      if (line.startsWith('CAP LS')) {
        socket.send(`:server CAP ${currentNick ?? '*'} LS :${[...offeredCapabilities].join(' ')}`);
      } else if (line.startsWith('CAP REQ ')) {
        const requestedText = line.slice('CAP REQ '.length).replace(/^:/u, '');
        const requested = requestedText.split(/\s+/u).filter(Boolean);
        if (requested.length > 0 && requested.every(capability => offeredCapabilities.has(capability))) {
          for (const capability of requested) state.capabilities.add(capability);
          socket.send(`:server CAP ${currentNick ?? '*'} ACK :${requested.join(' ')}`);
        } else if (requested.length > 0) {
          socket.send(`:server CAP ${currentNick ?? '*'} NAK :${requested.join(' ')}`);
        }
      } else if (line === 'CAP END') {
        // Registration is completed exactly once. A later CAP END after the
        // post-registration NICK reclaim is not a second welcome.
        if (!state.registered && state.nick) {
          state.registered = true;
          socket.send(`:server 001 ${state.nick} :Welcome to deterministic performance fixture`);
          socket.send(`:server 005 ${state.nick} CHANTYPES=# PREFIX=(qaohv)~&@%+ CASEMAPPING=rfc1459 :supported`);
        }
      } else if (line.startsWith('PING ')) {
        const marker = line.slice('PING '.length).trim().split(/\s+/u).at(-1)?.replace(/^:/u, '');
        if (marker) socket.send(`:server PONG server :${marker}`);
      } else if (line.startsWith('NICK ')) {
        const nextNick = line.slice('NICK '.length).trim();
        if (!/^[A-Za-z0-9_\[\]\\^{}|`-]{1,64}$/u.test(nextNick)) return;
        if (state.registered && currentNick && nextNick !== currentNick) {
          socket.send(`:${currentNick}!u@h NICK :${nextNick}`);
        }
        state.nick = nextNick;
      } else if (line.startsWith('USER ')) {
        // USER establishes the pre-registration identity; no server reply is
        // required by this fixture's source-shaped registration flow.
      } else if (line.startsWith('JOIN ')) {
        const joiningNick = state.nick;
        if (!state.registered || !joiningNick) return;
        for (const channel of line.slice('JOIN '.length).split(',').map(value => value.trim()).filter(Boolean)) {
          state.joined.add(channel.toLowerCase());
          socket.send(`:${joiningNick}!u@h JOIN ${channel}`);
          sendNames(state, channel);
          if (channel.toLowerCase() === '#perf-0' && options.deferInitialRows !== true) sendInitialRows(socket, channel);
        }
      } else if (line.startsWith('NAMES ')) {
        const channel = line.slice('NAMES '.length).trim();
        if (/^[#&][^\s,]+$/u.test(channel)) sendNames(state, channel);
      } else if (line.startsWith('LIST')) {
        const listNick = state.nick;
        if (state.registered && listNick) {
          const roomCount = Math.max(1, Math.min(options.joinRooms ?? ROOM_COUNT, ROOM_COUNT));
          socket.send(`:server 321 ${listNick} Channel :Users Name`);
          for (let room = 0; room < roomCount; room++) {
            socket.send(`:server 322 ${listNick} #perf-${room} 1 :Deterministic performance fixture room ${room}`);
          }
          socket.send(`:server 323 ${listNick} :End of /LIST`);
        }
      } else if (state.registered && currentNick && /^MODE\s+[#&][^\s]+$/iu.test(line)) {
        const channel = line.slice('MODE '.length).trim();
        if (state.joined.has(channel.toLowerCase())) socket.send(`:server 324 ${currentNick} ${channel} +nt`);
      } else if (state.registered && currentNick && /^PROP\s+[#&][^\s]+$/iu.test(line)) {
        const channel = line.slice('PROP '.length).trim();
        if (state.joined.has(channel.toLowerCase())) socket.send(`:server 819 ${currentNick} ${channel} :End of properties`);
      } else if (state.registered && currentNick && line.startsWith('CHATHISTORY ')) {
        const args = line.slice('CHATHISTORY '.length).split(/\s+/u);
        if (args[0]?.toUpperCase() === 'TARGETS') {
          const ref = nextBatchRef(state);
          socket.send(`:server BATCH +${ref} draft/chathistory-targets`);
          socket.send(`:server BATCH -${ref}`);
        } else if (args.length >= 3 && /^[#&A-Za-z0-9_\[\]\\^{}|`-]{1,128}$/u.test(args[1] ?? '')) {
          sendEmptyHistoryBatch(state, args[1]!);
        }
      } else if (line.startsWith('IDENTIFY ')) {
        const account = line.slice('IDENTIFY '.length).trim().split(/\s+/u)[0];
        if (state.registered && currentNick && account && /^[A-Za-z0-9_.-]{1,64}$/u.test(account)) {
          socket.send(`:server NOTICE ${currentNick} :You are now identified as ${account}`);
        }
      } else if (line === 'LOGOUT' && state.registered && currentNick) {
        socket.send(`:server 901 ${currentNick} ${currentNick}!u@h :You are now logged out`);
      }
      if (options.disconnectOnPrivmsg && line.startsWith('PRIVMSG ')) socket.close();
    });
  });
  const activeState = () => active;
  return {
    sent,
    socketCount: () => socketOpens,
    joinedRooms: () => [...(activeState()?.joined ?? [])],
    emitFromSocket: (index: number, line: string) => socketStates[index]?.socket.send(line),
    currentSocket: () => activeState()?.socket,
    emit: (line: string) => activeState()?.socket.send(line),
    emitInitialRows: (channel = '#perf-0') => {
      const current = activeState();
      return current ? sendInitialRows(current.socket, channel) : undefined;
    },
    serverMessage: (channel: string, id: string, body: string, atMs = FIXED_EPOCH) => activeState()?.socket.send(`@msgid=${id};time=${new Date(atMs).toISOString()} :fixture!u@h PRIVMSG ${channel} :${body}`),
  };
}

function sendInitialRows(socket: WebSocketRoute, channel = '#perf-0'): void {
  for (let index = 0; index < 120; index++) {
    socket.send(`@msgid=initial-${index};time=2026-10-09T10:00:00.000Z :fixture!u@h PRIVMSG ${channel} :Initial render fixture row ${index}`);
  }
}

export async function joinConfiguredRooms(page: Page, wire: { joinedRooms(): readonly string[] }, count = ROOM_COUNT) {
  if (count <= 0) return;
  const roomsToggle = page.locator('.onyx-mobile-nav [data-testid="nav-rooms"]');
  const roomsRail = page.locator('#client-rooms');
  if (!(await roomsRail.isVisible())) {
    await roomsToggle.click({ timeout: 5_000 });
    await roomsRail.waitFor({ state: 'visible', timeout: 5_000 });
  }

  // A channel cannot be joined through the composer before a conversation is
  // active. Establish the first membership through Browse/Join on a fresh
  // socket; on the same server-confirmed socket, select that existing room.
  const firstRoom = roomsRail.getByRole('button', { name: /#perf-0/ });
  if (wire.joinedRooms().includes('#perf-0') && await firstRoom.count()) {
    await firstRoom.click({ timeout: 5_000 });
  } else {
    await roomsRail.getByRole('button', { name: 'Browse rooms', exact: true }).click({ timeout: 8_000 });
    const browse = page.getByRole('dialog', { name: 'Browse rooms' });
    await browse.getByRole('searchbox', { name: 'Search rooms', exact: true }).fill('#perf-0', { timeout: 5_000 });
    const firstJoin = browse.getByRole('button', { name: 'Join #perf-0', exact: true });
    await firstJoin.waitFor({ state: 'visible', timeout: 8_000 });
    await firstJoin.click({ timeout: 5_000 });
    await browse.waitFor({ state: 'hidden', timeout: 8_000 });
  }
  await page.getByLabel('Message', { exact: true }).waitFor({ state: 'visible', timeout: 8_000 });

  const composer = page.getByLabel('Message', { exact: true });
  for (let room = 1; room < count; room++) {
    const channel = `#perf-${room}`;
    if (!wire.joinedRooms().includes(channel)) {
      await composer.fill(`/join #perf-${room}`, { timeout: 5_000 });
      await composer.press('Enter', { timeout: 5_000 });
    }

    // Wait for the server-shaped JOIN/NAMES response to reach the real room
    // rail before issuing the next command. Without this boundary, rapid
    // composer updates can outrun the UI's handling of earlier responses,
    // turning the fixture into a burst test instead of a 50-room workload.
    const escapedChannel = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const roomButton = roomsRail.getByRole('button', {
      name: new RegExp(`^${escapedChannel}(?:,|$)`),
      includeHidden: true,
    });
    await roomButton.waitFor({ state: 'attached', timeout: 5_000 });
    if (!wire.joinedRooms().includes(channel)) {
      throw new Error(`fixture-precondition: expected server-confirmed membership for ${channel}`);
    }
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (wire.joinedRooms().length >= count) return;
    await page.waitForTimeout(25);
  }
  throw new Error(`fixture-precondition: expected ${count} server-confirmed room memberships within 10 seconds`);
}

export async function signInFixtureAccount(page: Page, accountId: string) {
  await page.getByTestId('connection-open').click({ timeout: 8_000 });
  let dialog = page.getByRole('dialog', { name: 'Your connection' });
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  if (await dialog.getByRole('button', { name: 'Account settings', exact: true }).count()) {
    await dialog.getByRole('button', { name: 'Account settings', exact: true }).click({ timeout: 5_000 });
    const logout = page.getByTestId('account-logout');
    await logout.waitFor({ state: 'visible', timeout: 5_000 });
    await logout.click({ timeout: 5_000 });
    await logout.waitFor({ state: 'detached', timeout: 5_000 });
    await page.getByTestId('account-close').click({ timeout: 5_000 });
    await page.getByTestId('account-panel').waitFor({ state: 'hidden', timeout: 5_000 });
    await page.getByTestId('connection-open').click({ timeout: 5_000 });
    dialog = page.getByRole('dialog', { name: 'Your connection' });
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  }
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click({ timeout: 5_000 });
  await page.locator('#connection-account').fill(accountId, { timeout: 5_000 });
  await page.locator('#connection-password').fill('synthetic-perf-fixture-password', { timeout: 5_000 });
  await page.locator('form[data-private-auth-form="identify"]').getByRole('button', { name: 'Sign in', exact: true }).click({ timeout: 5_000 });
  await dialog.getByText(`Signed in as ${accountId}.`, { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Close connection dialog', exact: true }).click({ timeout: 5_000 });
  await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
}

export async function enterRoom(page: Page, channel = '#perf-0') {
  await page.goto(`/app/?ws=${encodeURIComponent('wss://perf.measure.test/ws')}&nick=guest`);
  const rooms = page.locator('#client-rooms');
  await rooms.getByRole('button', { name: new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click({ timeout: 8_000 });
}
