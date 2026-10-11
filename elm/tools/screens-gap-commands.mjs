// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-gap-commands.mjs — screens.mjs scenarios for v3/gap-commands:
 * action rows (`/me`, inbound CTCP ACTION), the `/help` slash-commands
 * sheet, the palette's People / Recent / action rows, and the `?`
 * shortcuts overlay with its new chords and single-key switch.
 * Re-exports the shell scenarios so one --extra covers both.
 *
 *   node elm/tools/screens.mjs --vp all --extra elm/tools/screens-gap-commands.mjs \
 *     --only actions,actions-compact,help,palette-people,palette-recent,shortcuts,shortcuts-end
 */
import shell from './screens-shell.mjs';

const isPhone = (page) => (page.viewportSize()?.width ?? 1440) < 768;

async function dismissAsks(page, h) {
  for (let i = 0; i < 3 && (await page.$('[role="dialog"]')); i += 1) {
    await page.keyboard.press('Escape');
    await h.settle(page, 250);
  }
}

/** Inbound ACTION lines from other members, injected into the page's
    socket right after the room's NAMES burst (the fake server has no
    way to speak for them). */
async function injectActions(page) {
  await page.addInitScript(() => {
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      /* The fake server echoes without the label, so a labeled send
         would show twice; ask for echo-message only. */
      send(data) {
        if (typeof data === 'string' && /^CAP REQ /.test(data)) data = data.replace(/\s*labeled-response/, '');
        return super.send(data);
      }

      constructor(...args) {
        super(...args);
        let fired = false;
        this.addEventListener('message', (ev) => {
          if (fired || typeof ev.data !== 'string' || !/ 366 /.test(ev.data)) return;
          fired = true;
          const t = (m) => new Date(Date.now() - m * 60000).toISOString();
          const lines = [
            `@time=${t(1.5)};msgid=a1 :jun!j@onyx.test PRIVMSG #lounge :\u0001ACTION waves at everyone 👋\u0001`,
            `@time=${t(1.2)};msgid=a2 :iris!i@onyx.test PRIVMSG #lounge :\u0001ACTION is pouring coffee for the 6pm call ☕\u0001`,
            `@time=${t(1)};msgid=a3 :iris!i@onyx.test PRIVMSG #lounge :anyone want a cup?`,
            `@time=${t(0.8)};msgid=a4 :theo!t@onyx.test PRIVMSG #lounge :\u0001ACTION hands out a very long list of release notes that keeps going so we can see how an action line wraps on a narrow phone screen\u0001`,
          ];
          setTimeout(() => { for (const data of lines) this.dispatchEvent(new MessageEvent('message', { data })); }, 300);
        });
      }
    };
  });
}

async function actions(page, h, compact) {
  await injectActions(page);
  if (compact) {
    await page.addInitScript(() => {
      try { localStorage.setItem('onyx:preferences', JSON.stringify({ transcriptDensity: 'irc' })); } catch { /* private */ }
    });
  }
  await h.joinRoom(page);
  await dismissAsks(page, h);
  await page.fill('#shell-composer-input', '/me grabs a seat by the window');
  await page.keyboard.press('Enter');
  await h.settle(page, 900);
  await dismissAsks(page, h);
  await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-transcript-key] li');
    const last = rows[rows.length - 1];
    if (last) last.scrollIntoView({ block: 'end' });
  });
  await h.settle(page, 300);
}

/** `/help` from the composer (the first Enter may only accept the
    slash suggestion). */
async function sendHelp(page, h) {
  await page.fill('#shell-composer-input', '/help');
  for (let i = 0; i < 3 && !(await page.$('[data-testid="commands-help"]')); i += 1) {
    await page.focus('#shell-composer-input');
    await page.keyboard.press('Enter');
    await h.settle(page, 500);
  }
}

async function openPalette(page, h) {
  await page.keyboard.press('Control+k');
  await h.settle(page, 400);
  if (!(await page.$('[data-testid="command-palette"]'))) {
    for (const el of await page.$$('[data-testid="palette-launcher"]')) {
      if (await el.isVisible()) { await el.click(); break; }
    }
    await h.settle(page, 400);
  }
}

export default {
  ...shell,
  actions: async (page, h) => actions(page, h, false),
  'actions-compact': async (page, h) => actions(page, h, true),
  help: async (page, h) => {
    await h.joinRoom(page);
    await dismissAsks(page, h);
    await sendHelp(page, h);
  },
  'help-end': async (page, h) => {
    await h.joinRoom(page);
    await dismissAsks(page, h);
    await sendHelp(page, h);
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('.gap-help-groups, .gap-help-sheet, [data-shortcut-scope="commands-help"]')) el.scrollTop = el.scrollHeight;
    });
    await h.settle(page, 300);
  },
  'palette-people': async (page, h) => {
    await h.joinRoom(page);
    await dismissAsks(page, h);
    await openPalette(page, h);
    await page.keyboard.type('i');
    await h.settle(page, 400);
  },
  'palette-recent': async (page, h) => {
    await h.joinRoom(page);
    await dismissAsks(page, h);
    await openPalette(page, h);
    await page.keyboard.type('copy room');
    await page.keyboard.press('Enter');
    await h.settle(page, 500);
    await openPalette(page, h);
  },
  shortcuts: async (page, h) => {
    await h.joinRoom(page);
    await dismissAsks(page, h);
    await page.click('body', { position: { x: 1, y: 1 } }).catch(() => {});
    await page.keyboard.press('Shift+?');
    await h.settle(page, 500);
    if (!(await page.$('[data-testid="shortcuts-overlay"]'))) {
      await openPalette(page, h);
      await page.keyboard.type('keyboard shortcuts');
      await page.keyboard.press('Enter');
      await h.settle(page, 500);
    }
  },
  'shortcuts-end': async (page, h) => {
    await h.joinRoom(page);
    await dismissAsks(page, h);
    await openPalette(page, h);
    await page.keyboard.type('keyboard shortcuts');
    await page.keyboard.press('Enter');
    await h.settle(page, 500);
    await page.evaluate(() => {
      const sw = document.querySelector('[data-testid="single-keys-switch"]');
      if (sw) sw.scrollIntoView({ block: 'end' });
    });
    await h.settle(page, 300);
  },
};
