// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Local-lab group E2EE journey: two signed-in Elm browsers against a real,
// isolated Onyx Server. Every failure throws a fixed `group_stage:<code>` so
// the lab runner can record a bounded reason without copying page text,
// credentials, message bodies, or key material into its receipt. Private
// frames (authentication, E2EEKEY, E2EEGROUP, E2EE.* relays, session tokens)
// are counted only and never retained.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { parseIRCMessage } from '../../src/lib/irc/parser';

const ROOM = '#elm-group-lab';
const LOBBY = '#elm-group-lobby';
const PLAINTEXT = 'elm-group-lab-plaintext-canary-7f3a';
const BACKUP_PASSWORD = `lab-${randomBytes(18).toString('base64url')}`;

type Role = 'founder' | 'member';
interface Actor {
  role: Role;
  account: string;
  password: string;
  nick: string;
  context: BrowserContext;
  page: Page;
  sent: string[];
  received: string[];
  privateSent: Map<string, number>;
  privateReceived: Map<string, number>;
  opened: number;
}

const actors: Partial<Record<Role, Actor>> = {};
const state = { memberDevice: null as string | null, epochBeforeRemoval: null as number | null };

function stage(code: string): Error { return new Error(`group_stage:${code}`); }
async function gate(code: string, check: () => Promise<unknown>): Promise<void> {
  try { await check(); } catch { throw stage(code); }
}

const GROUP_RELAY = /^(?:@\S+\s+)?:\S+\s+(E2EE\.(?:KEYPACKAGE|COMMIT|WELCOME))(?:\s|$)/u;
/** Classify a frame as private (counted only) or ordinary (kept in memory). */
function privateKind(frame: string): string | null {
  const relay = GROUP_RELAY.exec(frame);
  if (relay) return relay[1]!;
  let parsed: ReturnType<typeof parseIRCMessage>;
  try { parsed = parseIRCMessage(frame); } catch { return 'UNPARSED'; }
  const command = parsed.command.toUpperCase();
  if (['IDENTIFY', 'AUTHENTICATE', 'SESSION'].includes(command)) return command;
  const body = parsed.params.at(-1) ?? '';
  if (command === 'NOTICE' && /^(?:SESSION\s+(?:TOKEN|MTOKEN)|E2EEKEY\s)/u.test(body)) return body.startsWith('E2EEKEY') ? `NOTICE_E2EEKEY:${/^E2EEKEY\s+([A-Z]+)/u.exec(body)?.[1] ?? '?'}` : 'NOTICE_SESSION_TOKEN';
  if (command === 'E2EEKEY' || command === 'E2EEGROUP') return `${command}:${(parsed.params[0] ?? '').toUpperCase().replace(/[^A-Z-]/gu, '').slice(0, 16)}${command === 'E2EEGROUP' ? `:${(parsed.params[1] ?? '').replace(/[^a-z-]/gu, '').slice(0, 16)}` : ''}`;
  if ((command === 'FAIL' || command === 'WARN') && /E2EEGROUP|E2EEKEY/u.test(parsed.params.join(' '))) return `${command}_E2EE:${parsed.params[0] ?? ''}:${parsed.params[1] ?? ''}`;
  return null;
}
const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
const count = (map: Map<string, number>, prefix: string) => [...map].filter(([key]) => key.startsWith(prefix)).reduce((sum, [, n]) => sum + n, 0);
const parsedFrames = (frames: string[]) => frames.map(parseIRCMessage);

async function openActor(browser: Browser, role: Role, account: string, password: string, nick: string): Promise<Actor> {
  const localWs = process.env.ONYX_ELM_LAB_WS; const base = process.env.ONYX_ELM_LAB_BASE;
  if (!localWs || !base) throw stage('lab_endpoints_missing');
  const context = await browser.newContext({ baseURL: base, ignoreHTTPSErrors: process.env.ONYX_ELM_LAB_CERT_BYPASS === '1', serviceWorkers: 'block' });
  const page = await context.newPage();
  const actor: Actor = { role, account, password, nick, context, page, sent: [], received: [], privateSent: new Map(), privateReceived: new Map(), opened: 0 };
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== base) return route.abort('blockedbyclient');
    return route.continue();
  });
  await page.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).origin !== localWs.replace(/\/$/u, '')) { socket.close(); return; }
    const upstream = socket.connectToServer();
    actor.opened += 1;
    socket.onMessage(frame => {
      if (typeof frame === 'string') { const kind = privateKind(frame); if (kind) bump(actor.privateSent, kind); else actor.sent.push(frame); }
      upstream.send(frame);
    });
    upstream.onMessage(frame => {
      if (typeof frame === 'string') { const kind = privateKind(frame); if (kind) bump(actor.privateReceived, kind); else actor.received.push(frame); }
      socket.send(frame);
    });
  });
  await page.goto(`/app/?ws=${encodeURIComponent(localWs)}&nick=${encodeURIComponent(nick)}&join=${encodeURIComponent(LOBBY)}`);
  return actor;
}

async function signIn(actor: Actor): Promise<void> {
  const { page } = actor;
  await gate('signin_live_timeout', () => expect(page.locator('.onyx-conn-live')).toBeVisible({ timeout: 45_000 }));
  await gate('signin_lobby_join_missing', () => expect.poll(() => parsedFrames(actor.received).some(m => m.command === '366' && m.params[1] === LOBBY), { timeout: 20_000 }).toBe(true));
  await page.getByTestId('connection-open').click();
  const dialog = page.getByTestId('connection-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.locator('#connection-account').fill(actor.account);
  await dialog.locator('#connection-password').fill(actor.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await gate('signin_identify_not_confirmed', () => expect.poll(() => parsedFrames(actor.received).some(m => m.command === 'NOTICE' && m.params.at(-1) === `You are now identified as ${actor.account}`), { timeout: 20_000 }).toBe(true));
  await gate('signin_dialog_not_confirmed', () => expect(dialog.getByText(`Signed in as ${actor.account}.`, { exact: true })).toBeVisible());
  await dialog.getByRole('button', { name: 'Close connection dialog' }).click();
  await expect(dialog).toBeHidden();
  // Server group controls require a reusable session; issuance is an explicit user action.
  // The in-session guest-to-account owner change retires any earlier tab
  // intent, and credential issuance requires one. Acquire it explicitly.
  await openServices(actor);
  await services(actor).getByRole('button', { name: 'Start a fresh attachment', exact: true }).click();
  await gate('session_intent_unavailable', () => expect(services(actor).locator(':scope > div > p[aria-live="polite"]').first()).toHaveText(/^session\.new-attachment — accepted/u, { timeout: 15_000 }));
  const attach = page.locator('.onyx-session-recovery').getByRole('button', { name: 'Create a new attachment', exact: true });
  await gate('session_token_absent', () => expect(attach).toBeVisible({ timeout: 15_000 }));
  await attach.click();
  await gate('session_token_absent', () => expect.poll(() => count(actor.privateReceived, 'NOTICE_SESSION_TOKEN'), { timeout: 20_000 }).toBeGreaterThan(0));
}

async function openRoom(actor: Actor, room: string): Promise<void> {
  await actor.page.locator('#client-rooms').getByRole('button', { name: new RegExp(room) }).click();
  await expect(actor.page.getByRole('region', { name: 'Conversation', exact: true })).toHaveAttribute('data-conversation', room);
}

async function composerSend(actor: Actor, text: string): Promise<void> {
  const composer = actor.page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill(text);
  await actor.page.getByRole('button', { name: 'Send message', exact: true }).click();
}

function services(actor: Actor) { return actor.page.locator('section.runtime-services'); }
// Local services moved from a disclosure docked under every screen to the
// Advanced panel opened from You (UI overhaul slice 2).
async function openServices(actor: Actor): Promise<void> {
  if (await services(actor).isVisible()) return;
  await actor.page.locator('.onyx-primary-nav, .onyx-mobile-nav').getByTestId('nav-you').locator('visible=true').first().click();
  await actor.page.getByTestId('you-advanced').click();
  await expect(services(actor)).toBeVisible();
}
/** Click a group control and return the settled `group.<action> — <status>` line. */
async function groupAction(actor: Actor, buttonName: string, action: string, failure: string, scope: ReturnType<typeof services> | null = null): Promise<string> {
  await openServices(actor);
  const root = services(actor);
  const button = (scope ?? root).getByRole('button', { name: buttonName, exact: true }).first();
  await gate(`${failure}_control_unavailable`, () => expect(button).toBeEnabled({ timeout: 15_000 }));
  const status = root.locator(':scope > div > p[aria-live="polite"]').first();
  const pending = root.getByText('Request pending…', { exact: true });
  await expect(pending).toHaveCount(0, { timeout: 30_000 }).catch(() => undefined);
  const before = await status.count() ? await status.textContent() : null;
  await button.click();
  // A repeated action can settle to identical text; observe the busy state or a change first.
  await expect.poll(async () => await pending.count() > 0 || (await status.count() ? await status.textContent() : null) !== before, { timeout: 3_000 }).toBe(true).catch(() => undefined);
  let line = '';
  await gate(`${failure}_result_timeout`, () => expect.poll(async () => {
    // Key updates require a recoverable encrypted backup; answer the private
    // prompt with a per-run random password that is never recorded.
    const prompt = actor.page.getByRole('dialog', { name: 'Private group backup password', exact: true });
    if (await prompt.isVisible().catch(() => false)) {
      await prompt.getByLabel('Password', { exact: true }).fill(BACKUP_PASSWORD);
      await prompt.getByRole('button', { name: 'Continue', exact: true }).click();
      return '';
    }
    if (await root.getByText('Request pending…', { exact: true }).count()) return '';
    if (!await status.count()) return '';
    line = (await status.textContent()) ?? '';
    return line.startsWith(`group.${action} — `) ? line : '';
  }, { timeout: 30_000 }).not.toBe(''));
  return line;
}
async function itemTexts(actor: Actor): Promise<string[]> { return services(actor).locator(':scope > div > ul > li').allTextContents(); }
async function refreshedHead(actor: Actor): Promise<number | null> {
  await groupAction(actor, 'Refresh trusted-device directory', 'directory-refresh', 'directory');
  const head = (await itemTexts(actor)).map(text => /Verified room head at epoch (\d+)/u.exec(text)?.[1]).find(Boolean);
  return head ? Number(head) : null;
}

test.describe.configure({ mode: 'serial', timeout: 150_000 });

/**
 * Opt-in local diagnostics under /tmp: command verbs, targets, private-frame
 * counts and the Local services status/item labels. No bodies, credentials,
 * payloads or key material are written.
 */
const debugLines: string[] = [];
async function debugSnapshot(label: string): Promise<void> {
  const dir = process.env.ONYX_ELM_LAB_GROUP_DEBUG_DIR;
  if (!dir || !dir.startsWith('/tmp/')) return;
  for (const actor of Object.values(actors)) {
    if (!actor) continue;
    const verbs = (frames: string[]) => frames.map(frame => { try { const m = parseIRCMessage(frame); return [m.command, m.params[0] ?? '', m.command === 'FAIL' || m.command === 'WARN' ? `${m.params[1] ?? ''}` : '', /^\d{3}$/u.test(m.command) ? `${m.params[1] ?? ''}:${m.params[2] ?? ''}` : ''].join(' ').trim(); } catch { return '?'; } });
    const status = await services(actor).locator(':scope > div > p[aria-live="polite"], :scope > p[aria-live="polite"]').allTextContents().catch(() => []);
    debugLines.push(JSON.stringify({ label, role: actor.role, privateSent: Object.fromEntries(actor.privateSent), privateReceived: Object.fromEntries(actor.privateReceived),
      sent: verbs(actor.sent).slice(-80), received: verbs(actor.received).filter(v => !v.startsWith('PING') && !v.startsWith('PONG')).slice(-120), status, items: await itemTexts(actor).catch(() => []),
      banner: await actor.page.locator('.onyx-session-recovery').allTextContents().catch(() => []) }));
    if (process.env.ONYX_ELM_LAB_GROUP_SCREENSHOTS === '1') await actor.page.screenshot({ path: `${dir}/${label.replace(/[^a-z0-9]+/giu, '-').slice(0, 60)}-${actor.role}.png` }).catch(() => undefined);
  }
  const { writeFile } = await import('node:fs/promises');
  await writeFile(`${dir}/group-debug.jsonl`, `${debugLines.join('\n')}\n`, { mode: 0o600 });
}

test.afterEach(async ({ browserName: _browserName }, testInfo) => { await debugSnapshot(`${testInfo.title}:${testInfo.status}`); });
test.afterAll(async () => {
  for (const actor of Object.values(actors)) await actor?.context.close().catch(() => undefined);
});

test('group: two Elm accounts sign in over the isolated local WSS listener', async ({ browser }) => {
  const a = process.env.ONYX_ELM_LAB_ACCOUNT; const ap = process.env.ONYX_ELM_LAB_PASSWORD;
  const b = process.env.ONYX_ELM_LAB_ACCOUNT_B; const bp = process.env.ONYX_ELM_LAB_PASSWORD_B;
  if (!a || !ap || !b || !bp) throw stage('lab_accounts_missing');
  actors.founder = await openActor(browser, 'founder', a, ap, 'ElmGrpFounder');
  actors.member = await openActor(browser, 'member', b, bp, 'ElmGrpMember');
  await signIn(actors.founder);
  await signIn(actors.member);
});

test('group: founder creates an encryption-required room', async () => {
  const founder = actors.founder; if (!founder) throw stage('previous_stage_missing');
  await openRoom(founder, LOBBY);
  await composerSend(founder, `/create ${ROOM}`);
  await gate('create_not_sent', () => expect.poll(() => parsedFrames(founder.sent).some(m => m.command === 'CREATE' && m.params[0] === ROOM)).toBe(true));
  await gate('create_oid_reply_missing', () => expect.poll(() => parsedFrames(founder.received).some(m => m.command === 'CREATE' && m.params[0] === ROOM && /^0[0-9a-f]{8}$/u.test(m.params[1] ?? ''))).toBe(true));
  await openRoom(founder, ROOM);
  await composerSend(founder, `/prop ${ROOM} encryption-policy :required`);
  await gate('policy_not_sent', () => expect.poll(() => parsedFrames(founder.sent).some(m => m.command === 'PROP' && m.params[0] === ROOM && m.params[1] === 'encryption-policy' && m.params[2] === 'required')).toBe(true));
  await gate('policy_not_confirmed', () => expect.poll(() => parsedFrames(founder.received).some(m => m.command === '818' && m.params[1] === ROOM && m.params[2] === 'encryption-policy' && m.params[3] === 'required')).toBe(true));
});

test('group: founder enrolls this device for room encryption', async () => {
  const founder = actors.founder; if (!founder) throw stage('previous_stage_missing');
  const line = await groupAction(founder, 'Enroll this device for room encryption', 'enroll', 'enroll');
  if (!line.startsWith('group.enroll — accepted')) throw stage('enroll_founder_not_verified');
  expect(count(founder.privateSent, 'E2EEKEY:ADD')).toBe(1);
  expect(count(founder.privateReceived, 'NOTICE_E2EEKEY:ADDED')).toBe(1);
});

// A fresh-room genesis is bound to the founder's CREATE and to an unchanged
// membership, so it is authored before anyone else joins.
test('group: founder authors the room genesis key', async () => {
  const founder = actors.founder; if (!founder) throw stage('previous_stage_missing');
  await groupAction(founder, 'Refresh trusted-device directory', 'directory-refresh', 'genesis_directory');
  const plan = services(founder).getByRole('button', { name: 'Plan a room key update', exact: true });
  if (!await plan.count()) throw stage('genesis_author_entry_unavailable');
  const planned = await groupAction(founder, 'Plan a room key update', 'author-plan', 'genesis_plan');
  if (!planned.startsWith('group.author-plan — accepted')) throw stage('genesis_plan_refused');
  const committed = await groupAction(founder, 'Confirm key update and backup', 'author-commit', 'genesis_commit');
  if (!/^group\.author-commit — (?:accepted|transport admitted|outcome unknown)/u.test(committed)) throw stage('genesis_commit_refused');
  await gate('genesis_commit_not_relayed', () => expect.poll(() => count(founder.privateSent, 'E2EEGROUP')).toBeGreaterThan(0));
  await gate('genesis_head_not_installed', () => expect.poll(() => refreshedHead(founder), { timeout: 30_000 }).toBe(1));
});

function roomPrivmsgs(frames: string[]) { return parsedFrames(frames).filter(m => m.command === 'PRIVMSG' && m.params[0] === ROOM); }
function conversation(actor: Actor) { return actor.page.getByRole('region', { name: 'Conversation', exact: true }); }

test('group: founder message is ciphertext on the wire and rendered for its author', async () => {
  const founder = actors.founder; if (!founder) throw stage('previous_stage_missing');
  await openRoom(founder, ROOM);
  await composerSend(founder, `${PLAINTEXT}-author`);
  await gate('ciphertext_not_sent', () => expect.poll(() => roomPrivmsgs(founder.sent).length, { timeout: 20_000 }).toBeGreaterThan(0));
  await gate('ciphertext_echo_missing', () => expect.poll(() => roomPrivmsgs(founder.received).length, { timeout: 20_000 }).toBeGreaterThan(0));
  if ([...founder.sent, ...founder.received].some(frame => frame.includes(PLAINTEXT))) throw stage('plaintext_on_wire');
  await gate('author_render_missing', () => expect(conversation(founder).getByText(`${PLAINTEXT}-author`, { exact: true })).toBeVisible({ timeout: 20_000 }));
});

test('group: member joins, enrolls and approves the founder key update checkpoint', async () => {
  const founder = actors.founder; const member = actors.member;
  if (!founder || !member) throw stage('previous_stage_missing');
  await openRoom(member, LOBBY);
  await composerSend(member, `/join ${ROOM}`);
  await gate('member_join_missing', () => expect.poll(() => parsedFrames(member.received).some(m => m.command === '366' && m.params[1] === ROOM)).toBe(true));
  await gate('member_policy_not_observed', () => expect.poll(() => parsedFrames(member.received).some(m => m.command === '818' && m.params[1] === ROOM && m.params[2] === 'encryption-policy' && m.params[3] === 'required')).toBe(true));
  await openRoom(member, ROOM);
  const enrolled = await groupAction(member, 'Enroll this device for room encryption', 'enroll', 'enroll');
  if (!enrolled.startsWith('group.enroll — accepted')) throw stage('enroll_member_not_verified');
  // The founder explicitly reviews the member device fingerprint and trusts it
  // (no automatic trust), then rotates the room key so it becomes a recipient.
  let head = await refreshedHead(founder);
  if (head === null) throw stage('rotation_head_unavailable');
  const memberItem = () => services(founder).locator(':scope > div > ul > li').filter({ hasText: `on account ${member.account}` }).first();
  if (!await memberItem().count()) throw stage('trust_preview_control_unavailable');
  const previewed = await groupAction(founder, 'Review device fingerprint', 'trust-preview', 'trust_preview', memberItem() as unknown as ReturnType<typeof services>);
  if (!previewed.startsWith('group.trust-preview — accepted')) throw stage('trust_preview_refused');
  await gate('trust_preview_refused', () => expect(services(founder).getByText(/^Signer key fingerprint [0-9a-f]{64}\./u)).toBeVisible());
  const trusted = await groupAction(founder, 'Trust this device', 'trust-confirm', 'trust_confirm');
  if (!trusted.startsWith('group.trust-confirm — accepted')) throw stage('trust_confirm_refused');
  head = await refreshedHead(founder);
  if (head === null) throw stage('rotation_head_unavailable');
  const rotateFrom = head;
  const planned = await groupAction(founder, 'Plan a room key update', 'author-plan', 'rotation_plan');
  if (!planned.startsWith('group.author-plan — accepted')) throw stage('rotation_plan_refused');
  const committed = await groupAction(founder, 'Confirm key update and backup', 'author-commit', 'rotation_commit');
  if (!/^group\.author-commit — (?:accepted|transport admitted|outcome unknown)/u.test(committed)) throw stage('rotation_commit_refused');
  await gate('member_welcome_not_delivered', () => expect.poll(() => count(member.privateReceived, 'E2EE.WELCOME')).toBeGreaterThan(0));
  await gate('bootstrap_preview_unavailable', () => expect.poll(async () => {
    const line = await groupAction(member, 'Review a new room encryption checkpoint', 'bootstrap-preview', 'bootstrap_preview');
    return line.startsWith('group.bootstrap-preview — accepted');
  }, { timeout: 30_000, intervals: [1000, 2000, 3000] }).toBe(true));
  const approved = await groupAction(member, 'Trust this checkpoint for future messages', 'bootstrap-approve', 'bootstrap_approve');
  if (!approved.startsWith('group.bootstrap-approve — accepted')) throw stage('bootstrap_approve_refused');
  await gate('member_head_not_installed', () => expect.poll(() => refreshedHead(member), { timeout: 30_000 }).toBe(rotateFrom + 1));
  await gate('rotation_head_not_installed', () => expect.poll(() => refreshedHead(founder), { timeout: 30_000 }).toBe(rotateFrom + 1));
});

test('group: encrypted message is ciphertext on the wire and decrypted for the peer', async () => {
  const founder = actors.founder; const member = actors.member;
  if (!founder || !member) throw stage('previous_stage_missing');
  await openRoom(founder, ROOM); await openRoom(member, ROOM);
  const sentBefore = roomPrivmsgs(founder.sent).length; const receivedBefore = roomPrivmsgs(member.received).length;
  await composerSend(founder, `${PLAINTEXT}-peer`);
  await gate('ciphertext_not_sent', () => expect.poll(() => roomPrivmsgs(founder.sent).length, { timeout: 20_000 }).toBeGreaterThan(sentBefore));
  await gate('ciphertext_not_delivered', () => expect.poll(() => roomPrivmsgs(member.received).length, { timeout: 20_000 }).toBeGreaterThan(receivedBefore));
  if ([...founder.sent, ...founder.received, ...member.sent, ...member.received].some(frame => frame.includes(PLAINTEXT))) throw stage('plaintext_on_wire');
  await gate('peer_decryption_not_rendered', () => expect(conversation(member).getByText(`${PLAINTEXT}-peer`, { exact: true })).toBeVisible({ timeout: 20_000 }));
  // The member can send too: ciphertext on the wire, decrypted for the founder.
  const memberSentBefore = roomPrivmsgs(member.sent).length;
  await composerSend(member, `${PLAINTEXT}-member`);
  await gate('member_ciphertext_not_sent', () => expect.poll(() => roomPrivmsgs(member.sent).length, { timeout: 20_000 }).toBeGreaterThan(memberSentBefore));
  if ([...member.sent, ...founder.received].some(frame => frame.includes(PLAINTEXT))) throw stage('plaintext_on_wire');
  await gate('member_send_not_rendered', () => expect(conversation(founder).getByText(`${PLAINTEXT}-member`, { exact: true })).toBeVisible({ timeout: 20_000 }));
});

test('group: founder removes the member device and installs a new epoch', async () => {
  const founder = actors.founder; if (!founder) throw stage('previous_stage_missing');
  const before = await refreshedHead(founder);
  if (before === null) throw stage('remove_head_unavailable');
  state.epochBeforeRemoval = before;
  const items = services(founder).locator(':scope > div > ul > li').filter({ hasText: `on account ${actors.member!.account}` });
  if (!await items.count()) throw stage('remove_entry_unavailable');
  const item = items.first();
  await item.locator('details.runtime-services-device-removal > summary').click();
  const removed = await groupAction(founder, 'Remove device and rotate room key', 'remove-device', 'remove', item as unknown as ReturnType<typeof services>);
  if (!/^group\.remove-device — (?:accepted|transport admitted|outcome unknown)/u.test(removed)) throw stage('remove_refused');
  await gate('remove_epoch_not_advanced', () => expect.poll(() => refreshedHead(founder), { timeout: 30_000 }).toBe(before + 1));
  // The removed device still receives the room's ciphertext but must not decrypt the new epoch.
  const member = actors.member!;
  await openRoom(founder, ROOM); await openRoom(member, ROOM);
  const receivedBefore = roomPrivmsgs(member.received).length; const sentBefore = roomPrivmsgs(founder.sent).length;
  await composerSend(founder, `${PLAINTEXT}-after-removal`);
  await gate('post_removal_not_sent', () => expect.poll(() => roomPrivmsgs(founder.sent).length, { timeout: 20_000 }).toBeGreaterThan(sentBefore));
  await gate('post_removal_not_delivered', () => expect.poll(() => roomPrivmsgs(member.received).length, { timeout: 20_000 }).toBeGreaterThan(receivedBefore));
  await gate('author_render_missing', () => expect(conversation(founder).getByText(`${PLAINTEXT}-after-removal`, { exact: true })).toBeVisible({ timeout: 20_000 }));
  await member.page.waitForTimeout(5_000);
  if (await conversation(member).getByText(`${PLAINTEXT}-after-removal`, { exact: true }).count()) throw stage('removed_device_decrypted');
  if ([...founder.sent, ...member.received].some(frame => frame.includes(PLAINTEXT))) throw stage('plaintext_on_wire');
});
