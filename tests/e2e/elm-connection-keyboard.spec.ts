// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Page } from '@playwright/test';
import { parseIRCMessage } from '../../src/lib/irc/parser';

const MOCK_WS = 'wss://connection-keyboard.test/ws';
const MOCK_CLOSE_REASON = 'fixture_registration_failure';

/**
 * Test the mock wire's connection dialog and reconnect controls through
 * keyboard events only. This covers DOM and keyboard semantics; it does not
 * claim screen-reader or real-server acceptance.
 */
test('connection recovery remains keyboard operable after a failed mock registration', async ({ page, context, baseURL }) => {
  if (!baseURL) throw new Error('mock_page_origin_missing');

  const commandNames: string[][] = [];
  let socketAttempts = 0;
  let registrations = 0;
  let replacementNick: string | null = null;
  let sendFreshCurrentDm: ((recipientNick: string, body: string) => void) | null = null;

  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== baseURL) return route.abort('blockedbyclient');
    return route.continue();
  });

  await page.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if (`${url.origin}${url.pathname}` !== MOCK_WS) {
      socket.close();
      return;
    }

    const attempt = ++socketAttempts;
    const commands: string[] = [];
    commandNames.push(commands);
    let nick = 'KeyboardGuest';
    let lsAnswered = false;
    let capEnded = false;
    let terminalSent = false;

    const completeRegistration = () => {
      if (terminalSent || !lsAnswered || !capEnded || !commands.includes('NICK') || !commands.includes('USER')) return;
      terminalSent = true;

      if (attempt === 1) {
        socket.send(':mock.server ERROR * :Registration was refused by the fixture.');
        socket.close({ code: 1011, reason: MOCK_CLOSE_REASON });
        return;
      }

      registrations += 1;
      socket.send(`:mock.server 001 ${nick} :Welcome to the mock network.`);
      socket.send(`:mock.server 005 ${nick} CASEMAPPING=ascii CHANTYPES=#& PREFIX=(ov)@+ :are supported by this server`);
      replacementNick = nick;
      sendFreshCurrentDm = (recipientNick, body) => socket.send(`:InboxFixture!u@mock PRIVMSG ${recipientNick} :${body}`);
    };

    socket.onMessage(frame => {
      if (typeof frame !== 'string') return;
      const parsed = parseIRCMessage(frame);
      commands.push(parsed.command);
      if (parsed.command === 'NICK' && parsed.params[0]) nick = parsed.params[0];
      if (parsed.command === 'CAP' && parsed.params[0] === 'LS') {
        lsAnswered = true;
        socket.send(':mock.server CAP * LS :');
      }
      if (parsed.command === 'CAP' && parsed.params[0] === 'END') capEnded = true;
      completeRegistration();
    });
  });

  // This journey is specifically the returning-guest claim path. The
  // first-hour guest handoff intentionally suppresses the claim chip until
  // its welcome flow has been seen.
  await page.addInitScript(() => localStorage.setItem('onyx:first-hour-seen', '1'));
  await page.goto(`/app/?ws=${encodeURIComponent(MOCK_WS)}&nick=KeyboardGuest`);
  await expect.poll(() => socketAttempts).toBe(1);
  await expect.poll(() => commandNames[0]?.includes('CAP') && commandNames[0]?.includes('NICK') && commandNames[0]?.includes('USER')).toBe(true);
  await expect.poll(() => page.getByRole('region', { name: 'Connection recovery' }).getByText('Reconnect when you are ready.', { exact: true }).isVisible()).toBe(true);

  const inboxBell = page.getByTestId('inbox-bell');
  await tabUntil(page, active => active.testId === 'inbox-bell');
  await page.keyboard.press('Enter');
  const inbox = page.getByRole('dialog', { name: 'Notification inbox', exact: true });
  await expect(inbox).toBeVisible();
  await expect(inbox.getByText('Disconnected: connection closed', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(inbox).toBeHidden();
  await expect(inboxBell).toBeFocused();

  const connectionOpener = page.getByTestId('connection-open');
  await expect(connectionOpener).toHaveAccessibleName('Connect. Offline');
  await tabUntil(page, active => active.testId === 'connection-open');
  await expect(connectionOpener).toBeFocused();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Your connection', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(dialog.getByRole('status').getByText('Offline', { exact: true })).toBeVisible();

  await tabUntil(page, active => active.role === 'button' && active.name === 'Reconnect now');
  await page.keyboard.press('Enter');
  await expect.poll(() => socketAttempts).toBe(2);
  await expect.poll(() => registrations).toBe(1);
  await expect(dialog.getByRole('status').getByText('Connected', { exact: true })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(connectionOpener).toBeFocused();
  await expect(connectionOpener).toHaveAccessibleName('Connect. Live');

  // The replacement physical owner quarantines notifications from the first
  // socket. Verify that old-owner row is gone before creating a fresh row.
  await tabUntil(page, active => active.testId === 'inbox-bell');
  await page.keyboard.press('Enter');
  await expect(inbox).toBeVisible();
  await expect(inbox.getByText('Disconnected: connection closed', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(inbox).toBeHidden();
  await expect(inboxBell).toBeFocused();

  // Private account inputs must be mounted by the runtime outside the body
  // subtree that Browser.application replaces, and cancellation must not
  // submit any credential-bearing command.
  const keepName = page.getByTestId('guest-claim-open');
  await expect(keepName).toBeVisible();
  await keepName.click();
  const createAccount = page.getByRole('button', { name: 'Create your account', exact: true });
  await createAccount.click();
  const privateRegistration = page.getByRole('dialog', { name: 'account-register', exact: true });
  await expect(privateRegistration).toBeVisible();
  await expect(privateRegistration).toHaveJSProperty('isConnected', true);
  expect(await privateRegistration.evaluate(element => !element.closest('#app'))).toBe(true);
  const privatePassword = privateRegistration.locator('input[type="password"]').first();
  await privatePassword.fill('fixture-password-not-submitted');
  const passwordElement = await privatePassword.elementHandle();
  await privateRegistration.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(privateRegistration).toBeHidden();
  await expect(createAccount).toBeFocused();
  expect(await passwordElement?.evaluate(element => (element as HTMLInputElement).value)).toBe('');
  expect(commandNames[1]?.some(command => ['REGISTER', 'PASS', 'IDENTIFY'].includes(command))).toBe(false);
  await expect(page.getByTestId('guest-claim-sheet')).toBeVisible();

  const freshNotificationBody = `Current connection inbox fixture ${Date.now()}`;
  const currentReplacementNick = replacementNick;
  expect(currentReplacementNick).toBeTruthy();
  if (!sendFreshCurrentDm || !currentReplacementNick) throw new Error('replacement_socket_not_registered');
  sendFreshCurrentDm(currentReplacementNick, freshNotificationBody);

  await tabUntil(page, active => active.testId === 'inbox-bell');
  await page.keyboard.press('Enter');
  await expect(inbox).toBeVisible();
  await expect(inbox.getByText('Disconnected: connection closed', { exact: true })).toHaveCount(0);
  await expect(inbox.getByText(freshNotificationBody, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(inbox).toBeHidden();
  await expect(inboxBell).toBeFocused();

  expect(socketAttempts).toBe(2);
  expect(registrations).toBe(1);
  expect(commandNames[0]?.filter(command => command === 'CAP' || command === 'NICK' || command === 'USER')).toEqual(expect.arrayContaining(['CAP', 'NICK', 'USER']));
  expect(commandNames[1]?.filter(command => command === 'CAP' || command === 'NICK' || command === 'USER')).toEqual(expect.arrayContaining(['CAP', 'NICK', 'USER']));
});

type ActiveControl = {
  role: string;
  name: string;
  id: string;
  testId: string;
};

async function tabUntil(page: Page, predicate: (active: ActiveControl) => boolean, maxTabs = 100): Promise<void> {
  let backwards = false;
  for (let index = 0; index < maxTabs; index += 1) {
    const active = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return null;
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute('role')
        || (tag === 'button' ? 'button' : tag === 'input' ? 'textbox' : tag);
      const name = element.getAttribute('aria-label')
        || element.innerText
        || element.textContent
        || '';
      return {
        role,
        name: name.replace(/\s+/gu, ' ').trim(),
        id: element.id,
        testId: element.getAttribute('data-testid') || '',
      };
    });
    if (active && predicate(active)) return;
    // Chromium wraps focus from the last control back to the first; Firefox
    // moves focus out to browser chrome instead. Once focus leaves the
    // document, walk backwards so the target is still reached by keyboard.
    if (index > 0 && (!active || active.role === 'body')) backwards = true;
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
  }
  throw new Error('keyboard_focus_target_not_reached');
}
