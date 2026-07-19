import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Passkeys (WebAuthn) management e2e — the PasskeysSection surface inside the
// Account panel. Covers the RENDER + state paths a user actually observes:
//
//   • server-unsupported  → the clear disabled notice (no manager)
//   • browser-unsupported → the "this browser can't do passkeys" notice
//   • supported           → the manager renders (register form + list header)
//   • loading             → the "Loading your passkeys…" spinner row
//   • empty (resolved)    → "No passkeys yet" once the probe settles
//   • populated list      → one row per credential, label + "Used N×" meta
//   • rename (inline)     → clicking Rename swaps the row into an edit form
//   • remove (confirm)    → clicking Remove reveals the inline "Remove?" confirm
//   • rename-unsupported  → the Rename affordance disappears when the server
//                            lacks WEBAUTHN RENAME
//   • error / notice      → the alert / status live-regions surface store text
//
// WHY drive the store directly (not a live ceremony):
//   The PasskeysSection is a pure function of store state + the browser's real
//   WebAuthn capability. Every branch above is deterministic given
//   { server.account, passkeySupported, passkeyListPending, passkeyCreds,
//     passkeyError, passkeyNotice, passkeyRenameUnsupported } — none of which
//   needs an authenticator ceremony or a live daemon. So we drive those store
//   fields via the DEV-only `__onyx` handle and assert the DOM the user sees.
//
//   A REAL register/sign-in ceremony (navigator.credentials.create/get) cannot
//   run in headless Chromium without a CDP virtual authenticator AND a live
//   Onyx Server daemon to answer WEBAUTHN REGISTER-CHALLENGE / AUTH-CHALLENGE. That
//   full path is intentionally left as a documented skip below.
//
// HARNESS (same rationale as voice.spec / chat.spec):
//   • window.__onyx is DEV-only (src/index.tsx), so the :4173 production preview
//     has NO store handle. We drive the DEV app (:5174) instead.
//   • We self-launch the FULL chromium binary: the default `chromium-headless-
//     shell` project also does not expose `window.PublicKeyCredential`, which the
//     "supported" paths depend on. Full chromium exposes the WebAuthn API.
//   • No WSS/media is required — this spec never connects a socket. It only needs
//     the DEV app served so the `__onyx` module handle is present.
//
// Configure via env (defaults match the sibling connected specs):
//   ONYX_APP  default http://localhost:5174/app
// ─────────────────────────────────────────────────────────────────────────────

const APP = process.env.ONYX_APP ?? 'http://localhost:5174/app';
const ONYX = '__onyx' as const;
const STORE_TIMEOUT = 25_000;

// ── Typed view of the store slice this spec drives ───────────────────────────
interface PasskeyCredential {
  id: string;
  label: string;
  signCount: number;
  createdAt: number | null;
}
interface Server {
  id: string;
  name: string;
  network: string;
  url: string;
  icon: string;
  nick: string;
  account: string | null;
  connected: boolean;
}
/** The exact passkey-relevant fields we push into the store, plus the modal gate. */
interface PasskeyDriveState {
  // The connected shell (which hosts the Account panel) only mounts when the
  // store reports a connected session — Connect.tsx gates it on
  // `connectionStatus === 'connected'`. No socket is opened; we assert the pure
  // render paths of PasskeysSection, not the transport.
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  showAccount: boolean;
  server: Server | null;
  passkeySupported: boolean | null;
  passkeyListPending: boolean;
  passkeyCreds: PasskeyCredential[];
  passkeyError: string | null;
  passkeyNotice: string | null;
  passkeyRenameUnsupported: boolean;
}
interface OnyxStore {
  store?: {
    getState(): unknown;
    setState(partial: Partial<PasskeyDriveState>): void;
  };
}
type WindowWithStore = Record<string, OnyxStore>;

/** A fully-formed signed-in Server so no AppShell consumer trips over a partial. */
function signedInServer(account: string): Server {
  return {
    id: 'e2e',
    name: 'E2E',
    network: 'e2e',
    url: 'wss://e2e.invalid',
    icon: '#888888',
    nick: account,
    account,
    connected: true,
  };
}

// One full-chromium instance shared across the file (WebAuthn-capable binary).
let browser: Browser;
test.beforeAll(async () => {
  browser = await chromium.launch();
});
test.afterAll(async () => {
  await browser?.close();
});

/**
 * Boot the DEV app in a fresh context and wait for the `__onyx` store handle.
 * `disableWebAuthn` deletes `window.PublicKeyCredential` BEFORE app scripts run,
 * so `isPasskeySupported()` resolves false at component mount (the browser-
 * unsupported branch) — a deterministic, real capability signal.
 */
async function bootApp(disableWebAuthn = false): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  if (disableWebAuthn) {
    await ctx.addInitScript(() => {
      // Remove the WebAuthn entry point the support probe keys on.
      try {
        // @ts-expect-error deleting a DOM global for the unsupported-browser path
        delete window.PublicKeyCredential;
      } catch {
        (window as unknown as Record<string, unknown>).PublicKeyCredential = undefined;
      }
    });
  }
  const page = await ctx.newPage();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  // DEV-only store handle (src/index.tsx). Absent ⇒ this isn't the dev build.
  await page.waitForFunction(
    (g) => !!(window as unknown as WindowWithStore)[g]?.store?.setState,
    ONYX,
    { timeout: STORE_TIMEOUT },
  );
  return { ctx, page };
}

/** Open the Account panel in a given passkey state by driving the store. */
async function openPasskeys(page: Page, state: Partial<PasskeyDriveState>): Promise<void> {
  await page.evaluate(
    ([g, s]) => {
      (window as unknown as WindowWithStore)[g]!.store!.setState(s as Partial<PasskeyDriveState>);
    },
    [ONYX, { connectionStatus: 'connected', showAccount: true, ...state }] as const,
  );
}

test.describe('Passkeys management UI (store-driven render paths)', () => {
  test('server-unsupported: signed-in user sees the clear disabled notice', async () => {
    const { ctx, page } = await bootApp();
    try {
      await openPasskeys(page, {
        server: signedInServer('e2e-tester'),
        passkeySupported: false, // server probed, no WEBAUTHN command
      });
      const disabled = page.getByTestId('passkeys-server-unsupported');
      await expect(disabled).toBeVisible();
      await expect(disabled).toContainText(/does not offer passkey sign-in yet/i);
      // The manager (register form) must NOT render in this state.
      await expect(page.getByRole('button', { name: 'Add a passkey' })).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('browser-unsupported: WebAuthn-less browser sees the browser notice', async () => {
    const { ctx, page } = await bootApp(true /* disableWebAuthn */);
    try {
      await openPasskeys(page, { server: signedInServer('e2e-tester') });
      const disabled = page.getByTestId('passkeys-browser-unsupported');
      await expect(disabled).toBeVisible();
      await expect(disabled).toContainText(/does not support passkeys/i);
      await expect(page.getByRole('button', { name: 'Add a passkey' })).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('supported: the manager renders its register form and list header', async () => {
    const { ctx, page } = await bootApp();
    try {
      await openPasskeys(page, {
        server: signedInServer('e2e-tester'),
        passkeySupported: true,
        passkeyListPending: false,
        passkeyCreds: [],
      });
      // Scope to the passkeys section — the Account panel hosts other controls
      // ("Refresh transparency root", "Save email") whose accessible names would
      // otherwise collide under Playwright strict mode.
      const section = page.locator('.acct-passkeys');
      // Register affordance.
      await expect(section.getByRole('button', { name: 'Add a passkey' })).toBeVisible();
      await expect(section.getByLabel('Passkey name (optional)')).toBeVisible();
      // List section header + refresh control.
      await expect(section.getByRole('heading', { name: 'Your passkeys' })).toBeVisible();
      await expect(section.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('loading: an in-flight LIST with no cached creds shows the spinner row', async () => {
    const { ctx, page } = await bootApp();
    try {
      await openPasskeys(page, {
        server: signedInServer('e2e-tester'),
        passkeySupported: true,
        passkeyListPending: true,
        passkeyCreds: [],
      });
      const loading = page.getByTestId('passkeys-loading');
      await expect(loading).toBeVisible();
      await expect(loading).toContainText(/loading your passkeys/i);
      // Refresh is disabled while a list is pending.
      await expect(page.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    } finally {
      await ctx.close();
    }
  });

  test('empty: a resolved probe with zero creds shows the empty-state copy', async () => {
    const { ctx, page } = await bootApp();
    try {
      await openPasskeys(page, {
        server: signedInServer('e2e-tester'),
        passkeySupported: true, // probed (non-null) → empty is "resolved"
        passkeyListPending: false,
        passkeyCreds: [],
      });
      const empty = page.getByTestId('passkeys-empty');
      await expect(empty).toBeVisible();
      await expect(empty).toContainText(/no passkeys yet/i);
    } finally {
      await ctx.close();
    }
  });

  test('populated: one row per credential with label and usage metadata', async () => {
    const { ctx, page } = await bootApp();
    try {
      await openPasskeys(page, {
        server: signedInServer('e2e-tester'),
        passkeySupported: true,
        passkeyListPending: false,
        passkeyCreds: [
          { id: 'cred-a', label: 'Work laptop', signCount: 4, createdAt: 1_700_000_000 },
          { id: 'cred-b', label: '', signCount: 0, createdAt: null },
        ],
      });
      const rows = page.getByTestId('passkey-row');
      await expect(rows).toHaveCount(2);
      // Labelled credential: name + usage counter.
      await expect(page.getByText('Work laptop')).toBeVisible();
      await expect(page.getByText(/Used\s*4×/)).toBeVisible();
      // Unlabelled credential falls back to a placeholder name.
      await expect(page.getByText('Unnamed passkey')).toBeVisible();
      // Row-level actions present.
      await expect(page.getByRole('button', { name: 'Rename Work laptop' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Remove Work laptop' })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('rename: clicking Rename swaps the row into an inline edit form', async () => {
    const { ctx, page } = await bootApp();
    try {
      await openPasskeys(page, {
        server: signedInServer('e2e-tester'),
        passkeySupported: true,
        passkeyListPending: false,
        passkeyCreds: [{ id: 'cred-a', label: 'Work laptop', signCount: 1, createdAt: null }],
      });
      await page.getByRole('button', { name: 'Rename Work laptop' }).click();
      // The inline rename form (aria-label "Rename Work laptop") appears with a
      // "New name" field prefilled to the current label, plus Save/Cancel.
      const renameForm = page.getByRole('form', { name: 'Rename Work laptop' });
      await expect(renameForm).toBeVisible();
      await expect(renameForm.getByLabel('New name')).toHaveValue('Work laptop');
      // Scope Save/Cancel to the rename form — the panel's email section also has
      // a "Save" (as "Save email"), which would collide under strict mode.
      await expect(renameForm.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
      await expect(renameForm.getByRole('button', { name: 'Cancel' })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('remove: clicking Remove reveals the inline "Remove?" confirmation', async () => {
    const { ctx, page } = await bootApp();
    try {
      await openPasskeys(page, {
        server: signedInServer('e2e-tester'),
        passkeySupported: true,
        passkeyListPending: false,
        passkeyCreds: [{ id: 'cred-a', label: 'Work laptop', signCount: 1, createdAt: null }],
      });
      await page.getByRole('button', { name: 'Remove Work laptop' }).click();
      const confirm = page.getByRole('group', { name: 'Confirm removal' });
      await expect(confirm).toBeVisible();
      await expect(confirm.getByRole('button', { name: 'Remove?' })).toBeVisible();
      await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('rename-unsupported: the Rename affordance disappears server-side', async () => {
    const { ctx, page } = await bootApp();
    try {
      await openPasskeys(page, {
        server: signedInServer('e2e-tester'),
        passkeySupported: true,
        passkeyListPending: false,
        passkeyRenameUnsupported: true,
        passkeyCreds: [{ id: 'cred-a', label: 'Work laptop', signCount: 1, createdAt: null }],
      });
      // The row still renders and Remove stays, but Rename is gone.
      await expect(page.getByTestId('passkey-row')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Rename Work laptop' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Remove Work laptop' })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('live-regions: error surfaces an alert, notice surfaces a status', async () => {
    const { ctx, page } = await bootApp();
    try {
      // Error path — a cancelled/failed ceremony sets passkeyError.
      await openPasskeys(page, {
        server: signedInServer('e2e-tester'),
        passkeySupported: true,
        passkeyListPending: false,
        passkeyCreds: [],
        passkeyError: 'Passkey prompt was dismissed.',
      });
      const alert = page.getByRole('alert');
      await expect(alert).toContainText(/passkey prompt was dismissed/i);

      // Success path — a completed action sets passkeyNotice.
      await openPasskeys(page, {
        server: signedInServer('e2e-tester'),
        passkeySupported: true,
        passkeyListPending: false,
        passkeyCreds: [],
        passkeyError: null,
        passkeyNotice: 'Passkey added.',
      });
      await expect(page.getByText('Passkey added.')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  // ── Full register ceremony — documented, NOT runnable here ─────────────────
  // Completing navigator.credentials.create requires BOTH:
  //   1. a CDP virtual authenticator
  //        const cdp = await context.newCDPSession(page);
  //        await cdp.send('WebAuthn.enable');
  //        await cdp.send('WebAuthn.addVirtualAuthenticator', {
  //          options: { protocol: 'ctap2', transport: 'internal',
  //                     hasResidentKey: true, hasUserVerification: true,
  //                     isUserVerified: true, automaticPresenceSimulation: true },
  //        });
  //   2. a LIVE Onyx Server daemon to answer `WEBAUTHN REGISTER-CHALLENGE` (and to
  //      persist the credential so a subsequent `WEBAUTHN LIST` returns it).
  // Without the daemon, registerPasskey() sends REGISTER and the store stays
  // `passkeyBusy` forever, so there is no honest assertion to make here. This
  // belongs in an integration run against a media/daemon-enabled server.
  test.skip('register ceremony (needs CDP virtual authenticator + live daemon)', () => {});
});
