// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-rx-sheets.mjs — every overlay the shell owns, opened the way a
 * person opens it, at every viewport of the screens.mjs matrix, plus an
 * accessibility/geometry audit of each one.
 *
 *   node elm/tools/screens.mjs --vp all --extra elm/tools/screens-rx-sheets.mjs \
 *     --out /tmp/onyx-sheets [--only rx-prefs,rx-notify]
 *
 * Each `rx-*` scenario boots #lounge on the local fake IRC server (the
 * page socket is proxied through Playwright so a scenario can inject
 * server lines: channel op, IRC oper, a logged-in account, a DM), opens
 * one overlay from its real opener and then AUDITS it:
 *
 *   - it is a named dialog (role + aria-label / aria-labelledby that
 *     resolves to text) carrying the overlay focus scope;
 *   - focus moved inside it;
 *   - it has a visible close affordance (an icon close or a Cancel /
 *     Not now) of at least 24px (44px on touch);
 *   - the panel fits the viewport (never taller or wider than it), its
 *     head stays pinned while the body scrolls, no control inside is
 *     under the target floor and no text is under the smallest type
 *     token (--text-xs);
 *   - Escape closes it and focus returns to the opener;
 *
 * then reopens it for the screenshot. A failed check is reported with
 * `console.error("AUDIT …")`, which screens.mjs prints as a PROBLEM line.
 *
 * Re-exports the shell scenarios (screens-shell.mjs) so one --extra run
 * covers the frame and the overlays.
 */
import shell from './screens-shell.mjs';

const NET = 'onyx.test';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const isPhone = (page) => (page.viewportSize()?.width ?? 1440) < 768;

/** Click the first VISIBLE element matching any selector. */
async function clickVisible(page, selectors, h) {
  for (const sel of selectors) {
    for (const el of await page.$$(sel)) {
      if (await el.isVisible()) {
        await el.click().catch(() => {});
        await h.settle(page, 350);
        return true;
      }
    }
  }
  return false;
}

/** Close the quiet asks a fresh session raises (notifications, A2HS). */
async function dismissAsks(page, h) {
  for (let i = 0; i < 3 && (await page.$('[data-shortcut-scope]')); i += 1) {
    await page.keyboard.press('Escape');
    await h.settle(page, 250);
  }
}

/** Join a room with the socket proxied; returns `inject(...lines)`. */
async function boot(page, h, opts = {}) {
  if (opts.prefs) {
    await page.addInitScript((p) => {
      try { localStorage.setItem('onyx:preferences', JSON.stringify(p)); } catch { /* private mode */ }
    }, opts.prefs);
  }
  let client = null;
  await page.routeWebSocket(/\/ws/, (ws) => {
    const server = ws.connectToServer();
    client = ws;
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(m));
  });
  await h.joinRoom(page, opts.nick || 'kn', opts.room === undefined ? '#lounge' : opts.room);
  const inject = async (...lines) => {
    for (const l of lines) if (client) client.send(l);
    await h.settle(page, 400);
  };
  if (opts.op) await inject(`:mara!m@${NET} MODE #lounge +o kn`);
  if (opts.oper) await inject(`:${NET} 381 kn :You are now an IRC operator`);
  if (opts.account) await inject(`:${NET} 900 kn kn!u@${NET} ${opts.account} :You are now logged in as ${opts.account}`);
  await dismissAsks(page, h);
  return inject;
}

/** Phones: back from the pushed conversation to its list page. */
async function backToList(page, h) {
  if (isPhone(page)) await clickVisible(page, ['[data-testid="room-back"]'], h);
}

/** Mark the expected focus-restore target: the first visible match of
    `selector`, else whatever has focus right now. */
async function markOpener(page, selector) {
  await page.evaluate((sel) => {
    for (const el of document.querySelectorAll('[data-audit-opener]')) el.removeAttribute('data-audit-opener');
    let el = null;
    if (sel) {
      for (const c of document.querySelectorAll(sel)) {
        const r = c.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { el = c; break; }
      }
    }
    el = el || document.activeElement || document.body;
    el.setAttribute('data-audit-opener', 'true');
  }, selector || null);
}

/** Open from a visible opener (marked as the focus-restore target). */
async function openFrom(page, h, selectors) {
  for (const sel of selectors) {
    for (const el of await page.$$(sel)) {
      if (await el.isVisible()) {
        await el.focus().catch(() => {});
        await markOpener(page, null);
        await el.click().catch(() => {});
        await h.settle(page, 450);
        return true;
      }
    }
  }
  return false;
}

/** Run a palette action by query (Ctrl+K, type, Enter). */
async function palette(page, h, query) {
  await markOpener(page, null);
  await page.keyboard.press('Control+k');
  await h.settle(page, 250);
  await page.keyboard.type(query);
  await h.settle(page, 150);
  await page.keyboard.press('Enter');
  await h.settle(page, 500);
}

/** Open the You hub from the visible You control, then one entry. */
async function openYou(page, h) {
  await backToList(page, h);
  if (!(await openFrom(page, h, ['.onyx-mobile-nav [data-testid="nav-you"]', '[data-testid="you-open"]', '.onyx-primary-nav [data-testid="nav-you"]']))) {
    await palette(page, h, 'You');
  }
}
async function youEntry(page, h, testId) {
  await openYou(page, h);
  await clickVisible(page, [`[data-testid="${testId}"]`], h);
  await h.settle(page, 300);
}

/** Type a slash command in the composer and send it. */
async function slash(page, h, line) {
  const box = '#shell-composer-input, .onyx-composer textarea, .onyx-composer input';
  await page.fill(box, line);
  await h.settle(page, 150);
  await page.keyboard.press('Enter');
  await h.settle(page, 300);
  const left = await page.$eval(box, (el) => el.value).catch(() => '');
  if (left && left.trim()) { await page.keyboard.press('Enter'); await h.settle(page, 400); }
}

/** The member card for mara: the roster row on wide screens, else the
    members sheet (a top-layer popover) and then its row. */
async function openMemberCard(page, h) {
  if (await openFrom(page, h, ['.onyx-roster button[aria-label="View member card for mara"]'])) return;
  await openFrom(page, h, ['[data-testid="members-toggle"]']);
  for (const el of await page.$$('button[aria-label="View member card for mara"]')) {
    if (await el.isVisible()) {
      await el.focus().catch(() => {});
      await markOpener(page, null);
      await el.click().catch(() => {});
      await h.settle(page, 450);
      return;
    }
  }
}

// ---- the audit -------------------------------------------------------------

/** Geometry + naming + close affordance + focus, measured in the page. */
async function measure(page) {
  return page.evaluate(() => {
    const scopes = [...document.querySelectorAll('[data-shortcut-scope], [data-call-dialog]')];
    const panel = scopes[scopes.length - 1];
    if (!panel) return { open: false };
    const scope = panel.getAttribute('data-shortcut-scope') || panel.getAttribute('data-call-dialog');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const name = (() => {
      const lab = panel.getAttribute('aria-label');
      if (lab && lab.trim()) return lab.trim();
      const by = panel.getAttribute('aria-labelledby');
      if (!by) return '';
      return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
    })();
    const role = panel.getAttribute('role') || '';
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const closeRe = /^(close|cancel|not now|dismiss|done|no thanks|back)\b/i;
    const closes = [...panel.querySelectorAll('button')].filter((b) => {
      const label = (b.getAttribute('aria-label') || b.textContent || '').trim();
      return closeRe.test(label) && visible(b);
    });
    const close = closes[0] || null;
    const closeRect = close ? close.getBoundingClientRect() : null;
    const rect = panel.getBoundingClientRect();
    const head = panel.querySelector(':scope > .onyx-sheet-head, :scope > .jump-to-date-head, :scope > .onyx-you-head, :scope > .onyx-moddesk-bar, :scope > div > .onyx-spotlight-search, :scope > .onyx-spotlight-search');
    // The scroller: the panel, else its first scrolling descendant.
    const scrollers = [panel, ...panel.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2;
    });
    const scroller = scrollers[0] || null;
    let headPinned = true;
    let headTop = null;
    if (scroller && head) {
      const before = head.getBoundingClientRect().top;
      scroller.scrollTop = scroller.scrollHeight;
      const after = head.getBoundingClientRect().top;
      headTop = [Math.round(before), Math.round(after)];
      headPinned = Math.abs(after - before) < 2;
      scroller.scrollTop = 0;
    }
    const focusInside = panel.contains(document.activeElement);
    const floor = coarse ? 44 : 24;
    const small = [...panel.querySelectorAll('button, [role="tab"], a[href], select, input:not([type="hidden"])')]
      .filter((el) => visible(el))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => {
        if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'range' || el.type === 'color') return false;
        // inline text links inside prose are exempt (WCAG 2.5.8 inline)
        if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return false;
        return Math.min(r.width, r.height) < floor - 0.5;
      })
      .slice(0, 6)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}"${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    const tiny = [...panel.querySelectorAll('p, span, small, label, li, h2, h3, strong, button, dd, dt, a')]
      .filter((el) => visible(el) && el.childElementCount === 0 && (el.textContent || '').trim().length > 1)
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 10.25)
      .slice(0, 4)
      .map((el) => `"${el.textContent.trim().slice(0, 20)}" ${getComputedStyle(el).fontSize}`);
    const overflowX = [...panel.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!visible(el)) return false;
      // inside a horizontal scroller (chip rows) is fine
      for (let p = el.parentElement; p && p !== panel; p = p.parentElement) {
        if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowX)) return false;
      }
      return r.right > vw + 1 || r.left < -1;
    }).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(el.getBoundingClientRect().left)}..${Math.round(el.getBoundingClientRect().right)}`);
    return {
      open: true, scope, role, name, coarse, focusInside,
      hasClose: !!close, closeSize: closeRect ? [Math.round(closeRect.width), Math.round(closeRect.height)] : null,
      rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right), w: Math.round(rect.width), h: Math.round(rect.height) },
      vw, vh, headPinned, headTop, small, tiny, overflowX,
    };
  });
}

async function report(page, label, msgs) {
  if (msgs.length === 0) return;
  await page.evaluate((lines) => { for (const l of lines) console.error(l); }, msgs.map((m) => `AUDIT ${label}: ${m}`));
}

/**
 * Audit the topmost overlay, Escape it, check focus restore, then call
 * `reopen` so the screenshot shows it. `opts.escape === false` skips the
 * Escape check; `opts.openerMayGo` accepts an opener that unmounted with
 * a parent sheet (focus then returns to that sheet's opener).
 */
async function audit(page, h, label, reopen, opts = {}) {
  const vp = `${page.viewportSize().width}x${page.viewportSize().height}`;
  const tag = `${label}@${vp}`;
  const m = await measure(page);
  const errs = [];
  if (!m.open) { await report(page, tag, ['no overlay opened']); return; }
  if (!(opts.role || /dialog/).test(m.role)) errs.push(`role="${m.role}" (want ${opts.role || 'dialog'})`);
  if (!m.name) errs.push('dialog has no accessible name');
  if (!m.focusInside) errs.push('focus is not inside the dialog');
  if (!m.hasClose && !opts.noClose) errs.push('no visible close / cancel control');
  else if (m.hasClose) {
    const floor = m.coarse ? 44 : 24;
    if (Math.min(...m.closeSize) < floor - 0.5) errs.push(`close control ${m.closeSize.join('x')} < ${floor}px`);
  }
  if (m.rect.top < -1 || m.rect.bottom > m.vh + 1) errs.push(`panel ${m.rect.top}..${m.rect.bottom} outside viewport height ${m.vh}`);
  if (m.rect.left < -1 || m.rect.right > m.vw + 1) errs.push(`panel ${m.rect.left}..${m.rect.right} outside viewport width ${m.vw}`);
  if (!m.headPinned) errs.push(`head scrolled away (${m.headTop})`);
  if (m.small.length) errs.push(`small targets: ${m.small.join(', ')}`);
  if (m.tiny.length) errs.push(`tiny text: ${m.tiny.join(', ')}`);
  if (m.overflowX.length) errs.push(`content past the viewport edge: ${m.overflowX.join(', ')}`);
  if (opts.escape !== false) {
    const scope = m.scope;
    await page.keyboard.press('Escape');
    await h.settle(page, 400);
    const after = await page.evaluate((s) => {
      const still = [...document.querySelectorAll('[data-shortcut-scope], [data-call-dialog]')]
        .some((el) => (el.getAttribute('data-shortcut-scope') || el.getAttribute('data-call-dialog')) === s);
      const opener = document.querySelector('[data-audit-opener]');
      const active = document.activeElement;
      const desc = (el) => (el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ')[0]}` : 'none');
      return {
        still,
        restored: !!opener && (active === opener || opener.contains(active)),
        bodyFocus: !active || active === document.body,
        active: desc(active),
        opener: opener ? desc(opener) : 'gone',
      };
    }, scope);
    if (after.still) errs.push('Escape did not close it');
    else if (!after.restored && !(opts.openerMayGo && !after.bodyFocus)) errs.push(`focus not restored to opener ${after.opener} (now on ${after.active})`);
    if (reopen) await reopen();
  }
  await report(page, tag, errs);
}

// ---- scenarios -------------------------------------------------------------

const sheets = {
  'rx-you': async (page, h) => {
    await boot(page, h);
    const open = () => openYou(page, h);
    await open();
    await audit(page, h, 'you', open);
  },
  'rx-you-end': async (page, h) => {
    await boot(page, h);
    await openYou(page, h);
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('[data-shortcut-scope]')].pop();
      if (p) p.scrollTop = p.scrollHeight;
    });
    await h.settle(page, 200);
  },
  'rx-inbox': async (page, h) => {
    await boot(page, h);
    await backToList(page, h);
    const open = () => openFrom(page, h, ['[data-testid="inbox-bell"]']);
    await open();
    await audit(page, h, 'inbox', open);
  },
  'rx-palette': async (page, h) => {
    await boot(page, h);
    const open = async () => { await markOpener(page, null); await page.keyboard.press('Control+k'); await h.settle(page, 300); };
    await open();
    await audit(page, h, 'palette', open);
  },
  'rx-palette-query': async (page, h) => {
    await boot(page, h);
    await page.keyboard.press('Control+k');
    await h.settle(page, 200);
    await page.keyboard.type('ro');
    await h.settle(page, 300);
  },
  'rx-shortcuts': async (page, h) => {
    await boot(page, h);
    const open = () => palette(page, h, 'keyboard shortcuts');
    await open();
    await audit(page, h, 'shortcuts', open);
  },
  'rx-prefs': async (page, h) => {
    await boot(page, h);
    const open = () => youEntry(page, h, 'you-settings-open-preferences');
    await open();
    await audit(page, h, 'prefs', open, { openerMayGo: true });
  },
  'rx-prefs-history': async (page, h) => {
    await boot(page, h);
    await youEntry(page, h, 'you-settings-open-preferences');
    await clickVisible(page, ['#pref-category-tab-history'], h);
  },
  'rx-notify': async (page, h) => {
    await boot(page, h);
    const open = () => palette(page, h, 'Notifications');
    await open();
    await audit(page, h, 'notify', open);
  },
  'rx-guest-claim': async (page, h) => {
    await boot(page, h, { room: '' });
    const open = () => openFrom(page, h, ['[data-testid="guest-claim-open"]']);
    if (!(await open())) await youEntry(page, h, 'you-keep-name');
    await audit(page, h, 'guest-claim', open);
  },
  'rx-account': async (page, h) => {
    await boot(page, h, { account: 'kn' });
    const open = () => youEntry(page, h, 'you-open-account');
    await open();
    await audit(page, h, 'account', open, { openerMayGo: true });
  },
  'rx-account-danger': async (page, h) => {
    await boot(page, h, { account: 'kn' });
    await youEntry(page, h, 'you-open-account');
    await clickVisible(page, ['[data-testid="account-drop-arm"]'], h);
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="account-drop-confirm-input"], [data-testid="account-drop-arm"]');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await h.settle(page, 250);
  },
  'rx-reclaim': async (page, h) => {
    await boot(page, h, { account: 'kain' });
    await backToList(page, h);
    // The identity chip (wide bars), else the You hub entry (phones).
    const open = async () => {
      if (await openFrom(page, h, ['button[aria-label^="Reclaim the nick"]'])) return true;
      await openYou(page, h);
      return clickVisible(page, ['[data-testid="you-reclaim"]'], h);
    };
    if (!(await open())) await report(page, 'reclaim', ['no visible reclaim opener']);
    await audit(page, h, 'reclaim', open, { openerMayGo: true });
  },
  'rx-people': async (page, h) => {
    await boot(page, h);
    const open = () => youEntry(page, h, 'you-open-people');
    await open();
    await audit(page, h, 'people', open, { openerMayGo: true });
  },
  'rx-theme-share': async (page, h) => {
    await boot(page, h);
    const open = () => youEntry(page, h, 'you-open-theme-share');
    await open();
    await audit(page, h, 'theme-share', open, { openerMayGo: true });
  },
  // The same sheet over the /appearance page (its other opener).
  'rx-theme-share-appearance': async (page, h) => {
    await page.goto(`${h.base}/appearance`);
    await h.settle(page, 800);
    // The opener sits in the collapsed "More looks" disclosure.
    await page.evaluate(() => { for (const d of document.querySelectorAll('details')) if (/More looks/.test(d.textContent || '')) d.open = true; });
    await h.settle(page, 250);
    const open = () => openFrom(page, h, ['[data-testid="appearance-theme-share"]']);
    if (!(await open())) await report(page, 'theme-share-appearance', ['no visible Share / import opener']);
    await audit(page, h, 'theme-share-appearance', open);
  },
  // The room header's More menu (an anchored menu; a bottom action
  // sheet under 600px): a named group in the focus scope, no close
  // button by design (Escape and the scrim close it).
  'rx-room-menu': async (page, h) => {
    await boot(page, h, { op: true });
    const open = () => openFrom(page, h, ['[data-testid="room-more"]']);
    await open();
    await audit(page, h, 'room-menu', open, { role: /group|menu/, noClose: true });
  },
  'rx-room-settings': async (page, h) => {
    await boot(page, h, { op: true });
    const open = async () => {
      await clickVisible(page, ['[data-testid="room-more"]'], h);
      await markOpener(page, '[data-testid="room-more"]');
      await clickVisible(page, ['[data-testid="room-more-menu"] button:has-text("Room settings")', '[data-testid="room-settings-open"]'], h);
    };
    await open();
    await audit(page, h, 'room-settings', open);
  },
  'rx-new-message': async (page, h) => {
    await boot(page, h);
    const open = () => palette(page, h, 'New conversation');
    await open();
    await audit(page, h, 'new-message', open);
  },
  'rx-browse': async (page, h) => {
    await boot(page, h);
    const open = async () => { await palette(page, h, 'Browse rooms'); await h.settle(page, 400); };
    await open();
    await audit(page, h, 'browse', open);
  },
  'rx-formation': async (page, h) => {
    await boot(page, h);
    const open = () => palette(page, h, 'Start a room');
    await open();
    await audit(page, h, 'formation', open);
  },
  'rx-profile': async (page, h) => {
    await boot(page, h);
    await markOpener(page, '#shell-composer-input');
    await slash(page, h, '/whois mara');
    await audit(page, h, 'profile', () => slash(page, h, '/whois mara'), { openerMayGo: true });
  },
  'rx-member-card': async (page, h) => {
    await boot(page, h);
    const open = () => openMemberCard(page, h);
    await open();
    await audit(page, h, 'member-card', open);
  },
  // From the member card: Report (the safety sheet).
  'rx-person-safety': async (page, h) => {
    await boot(page, h);
    const open = async () => {
      if (!(await page.$('.onyx-member-card'))) await openMemberCard(page, h);
      await openFrom(page, h, ['[data-testid="member-card-report"]']);
    };
    await open();
    await audit(page, h, 'person-safety', open);
  },
  // The room desk's member action → the review-first confirm (a ban).
  'rx-mod-review': async (page, h) => {
    await boot(page, h, { op: true });
    await clickVisible(page, ['[data-testid="room-more"]'], h);
    await clickVisible(page, ['[data-testid="moderation-open"]'], h);
    await page.selectOption('[data-testid="desk-member-select"]', 'mara').catch(() => {});
    await page.selectOption('[data-testid="desk-action-select"]', 'ban').catch(() => {});
    await h.settle(page, 250);
    const open = () => openFrom(page, h, ['[data-testid="desk-member-submit"]']);
    await open();
    await audit(page, h, 'mod-review', open);
  },
  'rx-moddesk': async (page, h) => {
    await boot(page, h, { op: true });
    const open = async () => {
      await clickVisible(page, ['[data-testid="room-more"]'], h);
      await markOpener(page, '[data-testid="room-more"]');
      await clickVisible(page, ['[data-testid="moderation-open"]'], h);
    };
    await open();
    await audit(page, h, 'moddesk', open);
  },
  'rx-moddesk-bans': async (page, h) => {
    const inject = await boot(page, h, { op: true });
    await inject(
      `:${NET} 367 kn #lounge *!*@spam.example mara 1760000000`,
      `:${NET} 367 kn #lounge troll!*@* jun 1760100000`,
      `:${NET} 368 kn #lounge :End of channel ban list`,
    );
    await clickVisible(page, ['[data-testid="room-more"]'], h);
    await clickVisible(page, ['[data-testid="moderation-open"]'], h);
    await page.evaluate(() => {
      const el = document.querySelector('.onyx-moddesk-sheet .moderation-bans, .onyx-moddesk-sheet [data-testid^="ban"]');
      if (el) el.scrollIntoView({ block: 'start' });
    });
    await h.settle(page, 250);
  },
  'rx-oper': async (page, h) => {
    await boot(page, h, { oper: true });
    await backToList(page, h);
    const open = () => openFrom(page, h, ['[data-testid="oper-desk-open"]']);
    if (!(await open())) await report(page, 'oper', ['no visible Operator opener']);
    await audit(page, h, 'oper', open);
  },
  'rx-steward': async (page, h) => {
    await boot(page, h, { op: true });
    const open = async () => {
      if (!(await openFrom(page, h, ['[data-testid="steward-open"]']))) {
        await openFrom(page, h, ['[data-testid="members-toggle"]']);
        await clickVisible(page, ['[data-testid="steward-open"]'], h);
      }
    };
    await open();
    await audit(page, h, 'steward', open, { openerMayGo: true });
  },
  // Room care as the room's owner: the close / delete danger zones.
  'rx-steward-owner': async (page, h) => {
    const inject = await boot(page, h, { op: true });
    await inject(`:mara!m@${NET} MODE #lounge -q+q mara kn`);
    if (!(await openFrom(page, h, ['[data-testid="steward-open"]']))) {
      await openFrom(page, h, ['[data-testid="members-toggle"]']);
      await clickVisible(page, ['[data-testid="steward-open"]'], h);
    }
    await clickVisible(page, ['[data-testid="steward-delete"]'], h);
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="steward-close-section"]');
      if (el) el.scrollIntoView({ block: 'start' });
    });
    await h.settle(page, 250);
  },
  'rx-invite': async (page, h) => {
    await boot(page, h);
    const open = async () => {
      if (!(await openFrom(page, h, ['.onyx-convohead [data-testid="room-invite-friends"]']))) {
        await clickVisible(page, ['[data-testid="room-more"]'], h);
        await markOpener(page, '[data-testid="room-more"]');
        await clickVisible(page, ['[data-testid="room-more-menu"] [data-testid="room-invite-friends"]'], h);
      }
    };
    await open();
    await audit(page, h, 'invite', open);
  },
  'rx-jump-date': async (page, h) => {
    await boot(page, h);
    const open = () => palette(page, h, 'Jump to date');
    await open();
    await audit(page, h, 'jump-date', open);
  },
  'rx-scheduled': async (page, h) => {
    await boot(page, h);
    await page.fill('#shell-composer-input', 'see you at six');
    await clickVisible(page, ['[data-testid="composer-more-tools"]'], h);
    await clickVisible(page, ['[data-testid="composer-schedule"]'], h);
    await openFrom(page, h, ['.onyx-schedule-view']);
    await audit(page, h, 'scheduled', null, { escape: false });
  },
  'rx-first-run-notify': async (page, h) => {
    await boot(page, h);
    await slash(page, h, 'hello everyone');
    await h.settle(page, 400);
    await audit(page, h, 'first-run-notify', null, { escape: false });
  },
  // The Add to Home Screen ask (iOS: after a first message, once the
  // notifications ask is answered). Elsewhere it may not be offered.
  'rx-a2hs': async (page, h) => {
    await boot(page, h);
    await slash(page, h, 'hello everyone');
    await h.settle(page, 400);
    await page.keyboard.press('Escape');
    await h.settle(page, 500);
    if (await page.$('[data-shortcut-scope="a2hs"]')) await audit(page, h, 'a2hs', null, { escape: false });
  },
  'rx-dm-safety': async (page, h) => {
    const inject = await boot(page, h, { prefs: { e2eeDms: false } });
    await inject(`@time=${new Date().toISOString()};msgid=d1 :mara!m@${NET} PRIVMSG kn :hey, got a sec?`);
    await palette(page, h, 'DM with mara');
    await clickVisible(page, ['.onyx-dmsafe-trigger'], h);
  },
  // Phones: the on-screen keyboard is open (simulated: --kb-inset / --vvh
  // as the shell's visualViewport listener sets them). The sheet and its
  // focused field sit above it.
  'rx-keyboard': async (page, h) => {
    await boot(page, h);
    await palette(page, h, 'New conversation');
    await page.keyboard.type('mar');
    if (!isPhone(page) && (page.viewportSize()?.height ?? 900) > 500) return;
    await page.evaluate(() => {
      const kb = window.innerHeight > window.innerWidth ? 336 : 170;
      const r = document.documentElement;
      r.style.setProperty('--kb-inset', kb + 'px');
      r.style.setProperty('--vv-top', '0px');
      r.style.setProperty('--vvh', (window.innerHeight - kb) + 'px');
      r.setAttribute('data-kb', 'open');
      const pad = document.createElement('div');
      pad.setAttribute('aria-hidden', 'true');
      pad.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:' + kb + 'px;background:#3a3f47;z-index:2147483647;display:grid;place-items:center;color:#cfd3d8;font:600 15px system-ui';
      pad.textContent = 'keyboard (simulated)';
      document.body.appendChild(pad);
    });
    await h.settle(page, 300);
  },
  'rx-toast': async (page, h) => {
    await boot(page, h);
    await slash(page, h, '/notify mute');
    await h.settle(page, 300);
  },
};

/* Browser zoom 200% on a 1280×720 laptop is a 640×360 CSS viewport
   (mouse, no touch); a large default font is the browser's standard
   size raised to 22px. Run these with --vp laptop. */
const zoom200 = (name) => async (page, h) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await sheets[name](page, h);
};
const bigFont = (name) => async (page, h) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: 22, fixed: 18 } }).catch(() => {});
  await sheets[name](page, h);
};
const variants = {};
for (const name of ['rx-you', 'rx-prefs', 'rx-account', 'rx-palette', 'rx-room-settings', 'rx-new-message', 'rx-notify', 'rx-browse']) {
  variants[name.replace('rx-', 'rx-zoom200-')] = zoom200(name);
}
for (const name of ['rx-you', 'rx-prefs', 'rx-notify', 'rx-account', 'rx-moddesk']) {
  variants[name.replace('rx-', 'rx-bigfont-')] = bigFont(name);
}

export default { ...shell, ...sheets, ...variants };
