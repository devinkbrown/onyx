// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * attribution.ts — account-attribution controller (enroll + residence proof).
 *
 * The client half of the daemon's Design-C account attribution: once the
 * server advertises `ISUPPORT ACCOUNTRESIDENCE=<node-shortid-hex>` AND the
 * canonical account is known (900 RPL_LOGGEDIN), this controller
 *
 *   1. enrolls the device Ed25519 signing key once per account
 *      (`IDENTITY ADD <label> <pub-hex> <sig-hex>`, self-signed over the
 *      daemon's IDENTITY-v1 transcript; idempotent — skipped when the server
 *      already confirmed this exact key), then
 *   2. publishes a residence proof (`IDENTITY RESIDENCE <node-hex> <epoch>
 *      <expiry-ms> <sig-hex>`) binding {account, node, epoch, expiry} under
 *      the RESIDENCE-v1 domain, re-signing on node change (reconnect landed
 *      on a different mesh node), on epoch supersede (FAIL STALE_EPOCH, one
 *      bounded retry), and on a refresh timer before the proof lapses.
 *
 * Purely additive and fail-closed: no advertised token, no account, or any
 * keygen/sign failure means NOTHING is sent — the account simply stays on the
 * daemon's conservative UID path. A failure never downgrades to a weaker or
 * partial proof.
 */

import {
  buildIdentityTranscript,
  buildResidenceMessage,
  deviceLabel,
  deviceSigningKeys,
  signHex,
  type DeviceSigningKeys,
} from '../e2ee/deviceSign';
import type { IRCMessage } from './types';

/** Proof lifetime. The daemon hard-caps `expiry - now` at 1h; 50 min leaves
 *  a 10-min clock-skew margin while keeping the bearer window short. */
export const RESIDENCE_TTL_MS = 50 * 60_000;
/** Refresh cadence — TTL ≥ 2× refresh, so a missed beat never lapses the proof. */
export const RESIDENCE_REFRESH_MS = 20 * 60_000;
/** Epoch bump applied on FAIL STALE_EPOCH (another device published ahead of
 *  our wall clock); the epoch is an opaque monotonic counter, so jumping it
 *  is always safe. */
const STALE_EPOCH_BUMP_MS = 5 * 60_000;

const NODE_HEX_RE = /^[0-9a-f]{16}$/;
/** localStorage marker: the server confirmed this pubkey enrolled for the account. */
const ENROLLED_PREFIX = 'onyx:attribution-enrolled:';
const ADDED_NOTICE_PREFIX = 'IDENTITY ADDED label=';
const PUBLISHED_NOTICE_PREFIX = 'IDENTITY RESIDENCE PUBLISHED ';

export interface AttributionSender {
  sendRaw(command: string, ...params: string[]): void;
}

/** Test seam only — production uses the exported default cadence. */
export interface AttributionTiming {
  ttlMs?: number;
  refreshMs?: number;
}

function storageGet(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* quota/private mode — worst case we re-enroll next session (idempotent) */
  }
}

export class AccountAttribution {
  private account: string | null = null;
  private nodeHex: string | null = null;
  /** Node a live proof was last sent for on this connection. */
  private publishedNode: string | null = null;
  /** Highest epoch we ever signed — survives reset() so quick reconnects to
   *  the same node never trip the server's per-(account,node) epoch floor. */
  private lastEpoch = 0;
  /** One bounded STALE_EPOCH retry until a PUBLISHED confirmation arrives. */
  private staleRetried = false;
  /** ADD sent this connection, awaiting the server's ADDED confirmation. */
  private pendingEnroll: { account: string; label: string; publicHex: string } | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  /** Generation counter — reset()/stop() bump it so stale async runs abort. */
  private gen = 0;

  private readonly ttlMs: number;
  private readonly refreshMs: number;

  constructor(private readonly sender: AttributionSender, timing?: AttributionTiming) {
    this.ttlMs = timing?.ttlMs ?? RESIDENCE_TTL_MS;
    this.refreshMs = timing?.refreshMs ?? RESIDENCE_REFRESH_MS;
  }

  /** New connection attempt: forget per-connection state (keep the epoch floor). */
  reset(): void {
    this.gen++;
    this.account = null;
    this.nodeHex = null;
    this.publishedNode = null;
    this.pendingEnroll = null;
    this.staleRetried = false;
    this.clearRefresh();
  }

  /** Socket closed / client destroyed: stop timers and abort in-flight work. */
  stop(): void {
    this.gen++;
    this.clearRefresh();
  }

  /** ISUPPORT ACCOUNTRESIDENCE=<node-shortid-hex> — fail-closed on malformed. */
  setNode(raw: string): void {
    const hex = raw.toLowerCase();
    if (!NODE_HEX_RE.test(hex)) return; // anchored: exactly 16 hex, nothing else
    if (hex === this.nodeHex) return;
    this.nodeHex = hex;
    this.kick();
  }

  /** Observe inbound messages: 900 (account), ADDED/PUBLISHED confirmations,
   *  and FAIL IDENTITY STALE_EPOCH. Called for every parsed line — cheap. */
  observe(m: IRCMessage): void {
    // Every line this controller reacts to is SERVER-originated (900, the
    // IDENTITY NOTICEs, FAIL). A user-originated line carries nick!user@host
    // and parses nick !== null — reject it so a hostile user cannot forge
    // `NOTICE x :IDENTITY ADDED label=…` to poison the enrolled marker or a
    // FAIL to drive extra publishes. Fail-closed at the boundary.
    if (m.nick !== null) return;
    switch (m.command) {
      case '900': {
        // RPL_LOGGEDIN: `900 nick nick!u@h account :You are now logged in`.
        // The 2-param form is IRCX ERR_BADCOMMAND — not a login.
        const account = m.params.length >= 4 ? m.params[2] : undefined;
        if (account && account !== this.account) {
          this.account = account;
          this.kick();
        }
        break;
      }
      case 'NOTICE': {
        const text = m.params[1] ?? '';
        if (text.startsWith(ADDED_NOTICE_PREFIX)) {
          const label = text.slice(ADDED_NOTICE_PREFIX.length).trim();
          const pending = this.pendingEnroll;
          if (pending && label === pending.label) {
            storageSet(ENROLLED_PREFIX + pending.account, pending.publicHex);
            this.pendingEnroll = null;
          }
        } else if (text.startsWith(PUBLISHED_NOTICE_PREFIX)) {
          this.staleRetried = false;
        }
        break;
      }
      case 'FAIL': {
        if (m.params[0] === 'IDENTITY' && m.params[1] === 'STALE_EPOCH' && !this.staleRetried) {
          if (!this.account || !this.nodeHex) break;
          this.staleRetried = true;
          this.lastEpoch += STALE_EPOCH_BUMP_MS;
          this.publishedNode = null;
          this.kick();
        }
        break;
      }
    }
  }

  // ── internals ──────────────────────────────────────────────────────────

  private kick(): void {
    void this.run();
  }

  private async run(): Promise<void> {
    if (this.running) return; // the loop below re-checks state each pass
    this.running = true;
    const gen = this.gen;
    try {
      while (gen === this.gen) {
        const account = this.account;
        const nodeHex = this.nodeHex;
        if (!account || !nodeHex || this.publishedNode === nodeHex) return;

        const keys = await deviceSigningKeys();
        if (gen !== this.gen) return;
        if (!keys) return; // fail-closed: no key ⇒ no trusted path, no downgrade

        if (!(await this.enrollIfNeeded(gen, keys, account))) return;
        if (gen !== this.gen) return;

        if (!(await this.publish(gen, account, nodeHex))) return;
        if (gen !== this.gen) return;
        this.publishedNode = nodeHex;
        this.scheduleRefresh();
        // Loop: if the node/account changed while we were signing, publish again.
      }
    } finally {
      this.running = false;
    }
  }

  /** True = enrolled (or already was); false = enrollment impossible ⇒ abort. */
  private async enrollIfNeeded(gen: number, keys: DeviceSigningKeys, account: string): Promise<boolean> {
    if (storageGet(ENROLLED_PREFIX + account) === keys.publicHex) return true;
    // Already sent on THIS connection (awaiting the ADDED confirmation) — a
    // refresh/retry must not spam duplicate ADDs.
    const pending = this.pendingEnroll;
    if (pending && pending.account === account && pending.publicHex === keys.publicHex) return true;
    const label = deviceLabel(keys.publicHex);
    const transcript = buildIdentityTranscript(account, label, keys.publicRaw);
    if (!transcript) return false;
    const sig = await signHex(transcript);
    if (!sig) return false;
    // reset()/stop() landed while signing — never emit on a torn-down state.
    if (gen !== this.gen) return false;
    this.sender.sendRaw('IDENTITY', 'ADD', label, keys.publicHex, sig);
    // Marked enrolled only on the server's ADDED confirmation (observe()) —
    // an unconfirmed ADD is re-sent next session, a harmless idempotent overwrite.
    this.pendingEnroll = { account, label, publicHex: keys.publicHex };
    return true;
  }

  private async publish(gen: number, account: string, nodeHex: string): Promise<boolean> {
    const epoch = Math.max(Date.now(), this.lastEpoch + 1);
    const expiryMs = Date.now() + this.ttlMs;
    const message = buildResidenceMessage({ account, nodeHex, epoch, expiryMs });
    if (!message) return false;
    const sig = await signHex(message);
    if (!sig) return false;
    // reset()/stop() landed while signing — never emit on a torn-down state.
    if (gen !== this.gen) return false;
    this.sender.sendRaw('IDENTITY', 'RESIDENCE', nodeHex, String(epoch), String(expiryMs), sig);
    this.lastEpoch = epoch;
    return true;
  }

  private scheduleRefresh(): void {
    this.clearRefresh();
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.publishedNode = null; // force a re-sign of the same node
      this.kick();
    }, this.refreshMs);
  }

  private clearRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
