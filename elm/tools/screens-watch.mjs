// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-watch.mjs — screens.mjs scenarios for Watch Together (v3/gap-watch),
 * plus every scenario of screens-shell.mjs (screens.mjs takes one --extra).
 *
 *   node elm/tools/screens.mjs --vp all --extra elm/tools/screens-watch.mjs \
 *     --only watch-card,watch-details,watch-viewer,watch-editor,watch-review,watch-end
 *
 * The built-in fake IRC server knows nothing of IRCX, so the page's socket
 * is proxied (Playwright routeWebSocket): the proxy advertises IRCX in 005,
 * makes the local user a channel operator when the scenario asks, and
 * answers PROP like Onyx Server does (818 rows + 819 on LIST / SET, a bare
 * 819 on delete, 913 for non-operators). Still never the live network.
 */
import shell from './screens-shell.mjs';

const ROOM = '#lounge';

/** An `ocean.watch` value exactly as URLSearchParams writes it. */
function activity({
  host = 'mara',
  state = 'playing',
  position = 2472,
  at = Date.now() - 41_000,
  participants = ['mara', 'jun', 'iris', 'theo', 'kn'],
  handoff = null,
  title = 'Movie night: Spirited Away',
  url = 'https://www.youtube.com/watch?v=ByXuk9QqQkk',
  duration = 7500,
} = {}) {
  const p = new URLSearchParams();
  p.set('title', title);
  if (url) p.set('url', url);
  p.set('host', host);
  p.set('state', state);
  p.set('position', String(position));
  if (duration !== null) p.set('duration', String(duration));
  if (state === 'playing') p.set('at', String(at));
  p.set('participants', participants.join(','));
  if (handoff) p.set('handoff', handoff);
  return p.toString();
}

/** Proxy the page's IRC socket through an IRCX-speaking shim. */
async function ircxShim(page, { op = true, value = null } = {}) {
  let stored = value;
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    let nick = 'kn';
    const toPage = (...lines) => { for (const l of lines) ws.send(l); };
    ws.onMessage((frame) => {
      for (const raw of String(frame).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const words = line.replace(/^@\S+ /, '').split(' ');
        const cmd = words[0].toUpperCase();
        if (cmd === 'NICK') nick = words[1].replace(/^:/, '');
        if (cmd === 'IRCX') { toPage(`:onyx.test 800 ${nick} 1 0 ANON 512 *`); continue; }
        if (cmd === 'PROP') {
          const chan = words[1];
          if (words.length === 2) {
            if (stored) toPage(`:onyx.test 818 ${nick} ${chan} ocean.watch :${stored}`);
            toPage(`:onyx.test 819 ${nick} ${chan} :End of properties`);
          } else if (!op) {
            toPage(`:onyx.test 913 ${nick} ${chan} :Insufficient access to set property`);
          } else {
            const trailing = line.indexOf(' :');
            const v = trailing >= 0 ? line.slice(trailing + 2) : (words[3] ?? '');
            if (v === '') {
              stored = null;
              toPage(`:onyx.test 819 ${nick} ${chan} :End of properties`);
            } else {
              stored = v;
              toPage(`:onyx.test 818 ${nick} ${chan} ocean.watch :${v}`, `:onyx.test 819 ${nick} ${chan} :End of properties`);
            }
          }
          continue;
        }
        server.send(line);
      }
    });
    server.onMessage((frame) => {
      let text = String(frame).replace(/ 005 (\S+) /, ' 005 $1 IRCX ');
      if (op) text = text.replace(/ 353 (\S+) = (\S+) :(\S+)/, (_, n, ch, first) => ` 353 ${n} = ${ch} :@${first}`);
      ws.send(text);
    });
  });
}

const isPhone = (page) => (page.viewportSize()?.width ?? 1440) < 768;

async function clickVisible(page, selectors, h) {
  for (const sel of selectors) {
    for (const el of await page.$$(sel)) {
      if (await el.isVisible()) {
        await el.click().catch(() => {});
        await h.settle(page);
        return true;
      }
    }
  }
  return false;
}

async function dismissAsks(page, h) {
  for (let i = 0; i < 3 && (await page.$('[role="dialog"]')); i += 1) {
    await page.keyboard.press('Escape');
    await h.settle(page, 250);
  }
}

async function enter(page, h, { op = true, value = null, enabled = true } = {}) {
  await page.addInitScript((on) => {
    try { localStorage.setItem('onyx:preferences', JSON.stringify({ watchTogether: on })); } catch { /* private mode */ }
  }, enabled);
  await ircxShim(page, { op, value });
  await h.joinRoom(page, 'kn', ROOM);
  await dismissAsks(page, h);
  await h.settle(page, 400);
}

async function openEditor(page, h) {
  await clickVisible(page, ['[data-testid="room-more"]'], h);
  await clickVisible(page, ['[data-testid="room-watch-together"]'], h);
  await h.settle(page, 400);
}

async function fillEditor(page, h) {
  await page.fill('#watch-start-title', 'Movie night: Spirited Away');
  await page.fill('#watch-start-url', 'https://www.youtube.com/watch?v=ByXuk9QqQkk');
  await page.fill('#watch-start-duration', '2:05:00');
  await h.settle(page, 150);
}

export default {
  ...shell,
  // Host view, collapsed: sticky bar with play/pause, title, clock, host site.
  'watch-card': async (page, h) => {
    await enter(page, h, { op: true, value: activity({ host: 'kn' }) });
  },
  // Host view, details open with the roster.
  'watch-details': async (page, h) => {
    await enter(page, h, { op: true, value: activity({ host: 'kn' }) });
    await clickVisible(page, ['[data-testid="watch-details-toggle"]'], h);
    await clickVisible(page, ['[data-testid="watch-roster-toggle"]'], h);
  },
  // A participant who is not a room operator: follow-along only.
  'watch-viewer': async (page, h) => {
    await enter(page, h, { op: false, value: activity({ host: 'mara', state: 'paused', position: 3105 }) });
    await clickVisible(page, ['[data-testid="watch-details-toggle"]'], h);
  },
  // Start editor (room operator, no activity yet), filled in.
  'watch-editor': async (page, h) => {
    await enter(page, h, { op: true, value: null });
    await openEditor(page, h);
    await fillEditor(page, h);
  },
  // The review step before anything is published.
  'watch-review': async (page, h) => {
    await enter(page, h, { op: true, value: null });
    await openEditor(page, h);
    await fillEditor(page, h);
    await clickVisible(page, ['[data-testid="watch-start-review-button"]'], h);
  },
  // The host's inline end confirmation.
  'watch-end': async (page, h) => {
    await enter(page, h, { op: true, value: activity({ host: 'kn', state: 'paused', position: 1800 }) });
    await clickVisible(page, ['[data-testid="watch-details-toggle"]'], h);
    await clickVisible(page, ['[data-testid="watch-end-button"]'], h);
  },
  // Full round trip: start → confirm → card appears (proves the wire path).
  'watch-started': async (page, h) => {
    await enter(page, h, { op: true, value: null });
    await openEditor(page, h);
    await fillEditor(page, h);
    await clickVisible(page, ['[data-testid="watch-start-review-button"]'], h);
    await clickVisible(page, ['[data-testid="watch-start-confirm"]'], h);
    await h.settle(page, 500);
    await clickVisible(page, ['[data-testid="watch-play"]'], h);
    await h.settle(page, 2200);
    if (!(await page.$('[data-testid="watch-card"][data-state="playing"]'))) throw new Error('watch-started: card did not reach playing');
  },
};

export { activity, isPhone };
