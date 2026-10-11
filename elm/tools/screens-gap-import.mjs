// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-gap-import.mjs — screens.mjs scenarios for v3/gap-import:
 * the history-import pane (Preferences → Import & export) and BlockKit-lite
 * structured messages in a room.
 *
 *   node elm/tools/screens.mjs --vp all --extra elm/tools/screens-gap-import.mjs \
 *     --out /tmp/claude-1002/gap-import-shots [--only gi-review,gi-block]
 *
 * Imports use the repo's small synthetic fixtures (elm/tests/fixtures/import)
 * plus a generated wide export (many rooms, long names) written to the OS
 * temp dir — no real personal data anywhere. The page talks only to the
 * local fake IRC server; structured messages are injected through a
 * Playwright WebSocket route.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIX = new URL('../tests/fixtures/import/', import.meta.url).pathname;
const NET = 'onyx.test';

/** Join #lounge with the socket proxied; returns inject(...lines). */
async function boot(page, h) {
  let client = null;
  await page.routeWebSocket(/\/ws/, (ws) => {
    const server = ws.connectToServer();
    client = ws;
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(m));
  });
  await h.joinRoom(page, 'kn', '#lounge');
  return async (...lines) => {
    for (const l of lines) if (client) client.send(l);
    await h.settle(page, 500);
  };
}

async function openTransfer(page, h) {
  // Phone rooms hide the top bar: step back to the list, then use the bottom nav.
  if (await page.isVisible('[data-testid="you-open"]')) {
    await h.tryClick(page, '[data-testid="you-open"]');
  } else {
    await h.tryClick(page, '[data-testid="room-back"]');
    await h.tryClick(page, '[data-testid="nav-you"]:visible');
  }
  await h.tryClick(page, '[data-testid="you-settings-open-preferences"]');
  await h.tryClick(page, '#pref-category-tab-transfer');
  await h.settle(page, 300);
}

/** A wide synthetic Discord export: many rooms, long names, a DM. */
function wideExport() {
  const dir = mkdtempSync(join(tmpdir(), 'onyx-gi-'));
  const names = ['General Chat', 'Announcements', 'Design Critique and Moodboards for the Spring Launch', 'Off Topic', 'Release Notes', 'Help Desk', 'Music', 'Pets', 'Cooking Club'];
  const files = [];
  names.forEach((name, i) => {
    const messages = [];
    for (let k = 0; k < 6 + i * 3; k += 1) {
      messages.push({
        id: String(5000 + i * 100 + k),
        type: 'Default',
        timestamp: new Date(Date.UTC(2023, 8 + (i % 3), 1 + k, 9, k)).toISOString(),
        content: `Synthetic message ${k + 1} in ${name}`,
        author: { id: String(1 + (k % 3)), name: ['ana_sample', 'bo_test', 'cy'][k % 3] },
      });
    }
    const file = join(dir, `export-${i}.json`);
    writeFileSync(file, JSON.stringify({
      guild: { id: '900000000000000002', name: 'Synthetic Guild With A Rather Long Name' },
      channel: { id: String(7000 + i), type: 'GuildTextChat', name },
      messages,
    }));
    files.push(file);
  });
  const dm = join(dir, 'export-dm.json');
  writeFileSync(dm, JSON.stringify({
    guild: { id: '0', name: 'Direct Messages' },
    channel: { id: '7999', type: 'DirectTextChat', name: 'bo_test' },
    messages: [
      { id: '9001', type: 'Default', timestamp: '2024-02-01T08:00:00Z', content: 'hey, quick question', author: { id: '2', name: 'bo_test' } },
      { id: '9002', type: 'Default', timestamp: '2024-02-01T08:01:00Z', content: 'sure', author: { id: '1', name: 'ana_sample' } },
    ],
  }));
  files.push(dm);
  return files;
}

/** A ~24 MB WeeChat-style log (350k lines) for the "big file" scenarios. */
function bigLog() {
  const dir = mkdtempSync(join(tmpdir(), 'onyx-gi-big-'));
  const file = join(dir, 'irc.synthnet.#biglog.weechatlog');
  const nicks = ['ana', 'bo', 'cy', 'dee', 'eli'];
  const parts = [];
  for (let i = 0; i < 350000; i += 1) {
    const t = new Date(Date.UTC(2023, 0, 1, 0, 0, 0) + i * 60000).toISOString().replace('T', ' ').slice(0, 19);
    parts.push(`${t}\t${nicks[i % 5]}\tsynthetic line number ${i} with some padding text to look like chat`);
  }
  writeFileSync(file, parts.join('\n') + '\n');
  return file;
}

/** Longest gap between animation frames while an import runs (UI freeze probe). */
async function probeFrames(page) {
  await page.evaluate(() => {
    window.__gaps = [];
    let last = performance.now();
    const tick = () => { const n = performance.now(); window.__gaps.push(n - last); last = n; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}

async function stage(page, h, source, paths) {
  await page.click(`#history-import-source-${source}`);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-testid="history-import-choose"]')]);
  await chooser.setFiles(paths);
  await page.waitForSelector('[data-testid="history-import-review"]', { timeout: 12000 });
  await h.settle(page, 500);
}

const T = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const ROOM = '#lounge';

const DEPLOY = {
  title: 'Deploy v3.2 to staging',
  text: 'The build passed checks. Pick a rollout, then approve when you are happy.',
  fields: [{ label: 'Build', value: '#4821' }, { label: 'Branch', value: 'main' }, { label: 'Owner', value: 'ash' }],
  selects: [{ label: 'Rollout', options: [{ label: 'Canary 5%', value: 'canary' }, { label: 'Everyone', value: 'all' }], action: { type: 'select-notify', target: ROOM, value: 'rollout' } }],
  buttons: [
    { label: 'Open dashboard', url: 'https://status.example.org/deploys/4821' },
    { label: 'Copy build id', value: 'build-4821' },
    { label: 'Approve', action: { type: 'send', target: ROOM, value: 'approve 4821' } },
  ],
};
const ELSEWHERE = {
  title: 'Sign-up desk',
  text: 'This control belongs to another room.',
  buttons: [{ label: 'Join the rota', action: { type: 'send', target: '#design', value: 'rota please' } }],
};
const DETAILS = {
  type: 'modal',
  title: 'Weekly sync',
  triggerLabel: 'Open agenda',
  text: 'Tuesday 18:00 UTC in the voice room.',
  fields: [{ label: 'When', value: 'Tue 18:00 UTC' }, { label: 'Where', value: 'Voice room' }, { label: 'Notes', value: '' }],
  buttons: [{ label: 'Calendar link', url: 'https://calendar.example.org/sync' }],
};
const block = (b) => `[onyx:block] ${JSON.stringify(b)}`;
const lines = () => [
  `@time=${T(3)};msgid=b1 :ash!a@${NET} PRIVMSG ${ROOM} :${block(DEPLOY)}`,
  `@time=${T(2.5)};msgid=b2 :nova!n@${NET} PRIVMSG ${ROOM} :${block(ELSEWHERE)}`,
  `@time=${T(2)};msgid=b3 :sol!s@${NET} PRIVMSG ${ROOM} :${block(DETAILS)}`,
  // hostile / invalid: stays plain text
  `@time=${T(1.5)};msgid=b4 :rue!r@${NET} PRIVMSG ${ROOM} :[onyx:block] {"title":"x","buttons":[{"label":"Go","url":"javascript:alert(1)"}]}`,
];

async function room(page, h) {
  const inject = await boot(page, h);
  await inject(...lines());
  await h.settle(page, 400);
  return inject;
}

async function scrollToCards(page) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="blockkit-card"]');
    if (el) el.scrollIntoView({ block: 'start' });
  });
}

export default {
  'gi-transfer': async (page, h) => { await boot(page, h); await openTransfer(page, h); },
  'gi-picking': async (page, h) => {
    await boot(page, h); await openTransfer(page, h);
    await page.click('[data-testid="history-import-choose"]');
    await h.settle(page, 400);
  },
  'gi-review': async (page, h) => {
    await boot(page, h); await openTransfer(page, h);
    await stage(page, h, 'discord', [FIX + 'discord-general.json', FIX + 'discord-dm.json']);
  },
  'gi-review-wide': async (page, h) => {
    await boot(page, h); await openTransfer(page, h);
    await stage(page, h, 'discord', wideExport());
  },
  'gi-review-wide-end': async (page, h) => {
    await boot(page, h); await openTransfer(page, h);
    await stage(page, h, 'discord', wideExport());
    await h.tryClick(page, '.hi-more');
    await page.evaluate(() => { const c = document.querySelector('.pref-category-content'); if (c) c.scrollTop = c.scrollHeight; });
    await h.settle(page, 300);
  },
  'gi-review-error': async (page, h) => {
    await boot(page, h); await openTransfer(page, h);
    await stage(page, h, 'discord', [FIX + 'discord-general.json']);
    await page.fill('.hi-dest-input', 'not a room!');
    await h.settle(page, 300);
  },
  'gi-review-irc': async (page, h) => {
    await boot(page, h); await openTransfer(page, h);
    await stage(page, h, 'irc', [FIX + 'irc/irssi-#dev.log', FIX + 'irc/mirc-#ops.SynthNet.log', FIX + 'irc/hexchat-session.txt']);
  },
  'gi-imported': async (page, h) => {
    await boot(page, h); await openTransfer(page, h);
    await stage(page, h, 'discord', [FIX + 'discord-general.json', FIX + 'discord-dm.json']);
    await page.click('[data-testid="history-import-confirm"]');
    await page.waitForSelector('[data-testid="history-import-batch"]', { timeout: 8000 });
    await h.settle(page, 400);
  },
  'gi-remove-ask': async (page, h) => {
    await boot(page, h); await openTransfer(page, h);
    await stage(page, h, 'discord', [FIX + 'discord-general.json', FIX + 'discord-dm.json']);
    await page.click('[data-testid="history-import-confirm"]');
    await page.waitForSelector('[data-testid="history-import-batch"]', { timeout: 8000 });
    await page.click('[data-testid="history-import-batch"] button');
    await h.settle(page, 300);
  },
  'gi-big': async (page, h) => {
    await boot(page, h); await openTransfer(page, h);
    await page.click('#history-import-source-irc');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-testid="history-import-choose"]')]);
    await chooser.setFiles([bigLog()]);
    await page.waitForSelector('[role="progressbar"]', { timeout: 8000 }).catch(() => {});
    await h.settle(page, 120);
  },
  'gi-big-review': async (page, h) => {
    await boot(page, h); await openTransfer(page, h);
    await probeFrames(page);
    const started = Date.now();
    await stage(page, h, 'irc', [bigLog()]);
    const gaps = await page.evaluate(() => window.__gaps);
    console.log(`BIG-IMPORT ${page.viewportSize().width}px: review in ${Date.now() - started}ms, longest frame gap ${Math.round(Math.max(...gaps))}ms over ${gaps.length} frames`);
  },
  'gi-block': async (page, h) => { await room(page, h); await scrollToCards(page); await h.settle(page, 200); },
  'gi-block-copied': async (page, h) => {
    await room(page, h);
    await h.tryClick(page, '.bk-btn[aria-label="Copy value for Copy build id"]');
    await scrollToCards(page); await h.settle(page, 200);
  },
  'gi-block-review': async (page, h) => {
    await room(page, h);
    await h.tryClick(page, 'button.bk-btn--action:has-text("Approve")');
    await h.settle(page, 300);
  },
  'gi-block-inspect': async (page, h) => {
    await room(page, h);
    await h.tryClick(page, '[data-testid="blockkit-inspect"]');
    await h.settle(page, 300);
  },
  'gi-block-modal': async (page, h) => {
    await room(page, h);
    await h.tryClick(page, '[data-testid="blockkit-open"]');
    await h.settle(page, 300);
  },
};
