// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * discordSnapshotImport.ts — import a Discord server's history over a BOT TOKEN
 * (Roadmap v1.0 "Torii"). This is the credential-bearing sibling of the two
 * credential-free Discord importers: {@link parseDiscordExport} (a
 * DiscordChatExporter run) and {@link parseDiscordPackage} (the official
 * self-serve data package). Here the operator supplies a bot token and ONE
 * channel id, and we pull that channel's scrollback live.
 *
 * ── ARCHITECTURE (load-bearing) ──────────────────────────────────────────────
 * A browser CANNOT call discord.com/api directly: the Discord REST API sends no
 * CORS headers and rejects the `Authorization`-header preflight. So EVERY call
 * routes through a same-origin, read-only proxy (`GET /discord-import/<path>` in
 * /home/kain/website/upload_server.py) that forwards to
 * https://discord.com/api/v10/<path>, GET-only, host-locked, with snowflake-id
 * validation and verbatim rate-limit-header pass-through. This module owns the
 * CLIENT half: pacing, pagination, abort, normalization, and the fail-loud
 * MESSAGE-CONTENT-intent detection.
 *
 * ── TOKEN CONTRACT (security) ────────────────────────────────────────────────
 * The bot token lives ONLY in this client instance (a field, forwarded on the
 * Authorization header) for the import's duration. It is NEVER persisted
 * (no localStorage, no zustand slice, no IndexedDB), NEVER logged, and NEVER
 * placed in the produced snapshot — normalization only copies message fields.
 *
 * ── NORMALIZATION ────────────────────────────────────────────────────────────
 * REST JSON differs from the DiscordChatExporter shape, so we remap each message
 * into a DCE-shaped row and delegate to {@link parseDiscordExport}, inheriting
 * its validation, per-channel VAULT_KEEP bounding, dedup, reply resolution, and
 * honest summary. We do NOT re-implement the transform (see discordPackageImport
 * for the same adapter precedent).
 *
 * ── RATE LIMITS (do not "fix" by retrying 4xx) ───────────────────────────────
 * Requests are single-flight FIFO with a floor interval. We honor
 * X-RateLimit-Remaining==0 (wait Reset-After), sleep on 429
 * (max(Retry-After, body.retry_after)+jitter) and re-enqueue, and ABORT on
 * 401/403. We NEVER retry a 4xx — 10k invalid requests / 10 min earns a
 * Cloudflare IP ban.
 */
import {
  parseDiscordExport,
  type DiscordImportOptions,
  type DiscordImportResult,
} from './discordImport';

/** Same-origin proxy prefix; forwards to https://discord.com/api/v10/… */
const PROXY_BASE = '/discord-import';

/** Discord snowflake → epoch ms uses this constant (Discord epoch, 2015-01-01). */
const DISCORD_EPOCH_MS = 1420070400000n;

/** REST page size ceiling for GET /channels/{id}/messages. */
const PAGE_LIMIT = 100;

/** Default floor between requests (ms) — comfortably under Discord's budget. */
const DEFAULT_MIN_INTERVAL_MS = 320;

/** Hard ceiling on 429 re-enqueues before we give up (avoids a runaway loop). */
const MAX_429_RETRIES = 5;

/** Absolute ceiling on messages pulled in one run (memory bound / abuse guard). */
const MAX_TOTAL_MESSAGES = 100_000;

/** User-facing failure text (also the thrown Error.message — never leaks the token). */
export const DISCORD_AUTH_MESSAGE =
  'Discord rejected the request (401/403). Check the bot token, and that the bot was invited to the server with the "View Channels" and "Read Message History" permissions.';

export const DISCORD_MISSING_CONTENT_INTENT_MESSAGE =
  'Discord returned messages with no text. Your bot is missing the MESSAGE CONTENT INTENT. Enable the "MESSAGE CONTENT INTENT" toggle in your bot\'s dashboard (Discord Developer Portal → your app → Bot → Privileged Gateway Intents), then try again.';

export const DISCORD_CANCELLED_MESSAGE = 'Discord import cancelled.';

/** Discriminated failure kinds so the UI can branch without string matching. */
export type DiscordImportErrorKind = 'auth' | 'empty-content' | 'network' | 'aborted';

/**
 * Import failure carrying a user-safe message (never the token) and a machine
 * `kind`. The `message` is meant to be shown to the operator verbatim.
 */
export class DiscordImportError extends Error {
  readonly kind: DiscordImportErrorKind;
  constructor(message: string, kind: DiscordImportErrorKind) {
    super(message);
    this.name = 'DiscordImportError';
    this.kind = kind;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A Discord snowflake id is 1–20 ASCII digits — matches the proxy's guard. */
export function isSnowflake(id: string): boolean {
  return /^\d{1,20}$/.test(id);
}

/**
 * Decode a Discord snowflake to its creation time in epoch milliseconds.
 * `(id >> 22) + DISCORD_EPOCH`. Returns NaN for a non-snowflake so callers can
 * treat an unparseable id as "unknown age" rather than crash.
 */
export function snowflakeToMs(id: string): number {
  if (!isSnowflake(id)) return Number.NaN;
  try {
    return Number((BigInt(id) >> 22n) + DISCORD_EPOCH_MS);
  } catch {
    return Number.NaN;
  }
}

// ── REST → DiscordChatExporter normalization ────────────────────────────────

/** Discord REST message `type` numerics we treat as chat (0 default, 19 reply). */
function restTypeToDce(rawType: unknown): 'Default' | 'Reply' | 'System' {
  if (rawType === 19) return 'Reply';
  if (rawType === 0) return 'Default';
  return 'System';
}

function restAttachments(raw: unknown): { url: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { url: string }[] = [];
  for (const a of raw) {
    const url = isRecord(a) ? asString(a.url).trim() : '';
    if (url) out.push({ url });
  }
  return out;
}

/** REST reaction `{count, emoji:{name,id}}` → DCE `{emoji:{name}, count}`. */
function restReactions(raw: unknown): { emoji: { name: string }; count: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: { emoji: { name: string }; count: number }[] = [];
  for (const r of raw) {
    if (!isRecord(r)) continue;
    const name = isRecord(r.emoji) ? asString(r.emoji.name) : '';
    const count = typeof r.count === 'number' && Number.isFinite(r.count) ? r.count : 0;
    out.push({ emoji: { name }, count });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Map ONE Discord REST message into the DiscordChatExporter row shape that
 * {@link parseDiscordExport} validates and transforms. Returns null for a
 * non-object. Every field is copied defensively from `unknown`.
 */
export function normalizeRestMessage(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  const author = isRecord(raw.author) ? raw.author : {};
  const name = asString(author.global_name).trim() || asString(author.username).trim() || 'unknown';

  const row: Record<string, unknown> = {
    id: asString(raw.id),
    type: restTypeToDce(raw.type),
    timestamp: asString(raw.timestamp),
    content: asString(raw.content),
    attachments: restAttachments(raw.attachments),
    author: { name },
  };

  const edited = asString(raw.edited_timestamp);
  if (edited) row.timestampEdited = edited;

  const reactions = restReactions(raw.reactions);
  if (reactions) row.reactions = reactions;

  const ref = isRecord(raw.message_reference) ? asString(raw.message_reference.message_id).trim() : '';
  if (ref) row.reference = { messageId: ref };

  return row;
}

/**
 * Build a single DiscordChatExporter-shaped channel export from a batch of REST
 * messages, ready to hand to {@link parseDiscordExport}.
 */
export function normalizeDiscordChannelExport(
  channelId: string,
  channelName: string,
  rawMessages: readonly unknown[],
): Record<string, unknown> {
  const messages: Record<string, unknown>[] = [];
  for (const raw of rawMessages) {
    const row = normalizeRestMessage(raw);
    if (row) messages.push(row);
  }
  return {
    channel: { id: channelId, name: channelName.trim() || channelId },
    messages,
  };
}

// ── MESSAGE CONTENT intent detection ────────────────────────────────────────

function restHasContent(m: unknown): boolean {
  return isRecord(m) && asString(m.content).trim().length > 0;
}
function restHasAttachments(m: unknown): boolean {
  return isRecord(m) && Array.isArray(m.attachments) && m.attachments.length > 0;
}
function restHasEmbeds(m: unknown): boolean {
  return isRecord(m) && Array.isArray(m.embeds) && m.embeds.length > 0;
}

/**
 * Detect the classic "bot lacks the MESSAGE CONTENT privileged intent" failure:
 * Discord returns 200 OK but strips `content`, `attachments`, AND `embeds` from
 * every message the bot did not author or get mentioned in. A page with at least
 * one message where EVERY message is stripped on all three axes is the
 * unmistakable signature — a real channel of image-only posts still carries
 * attachments, so this does not false-positive on legitimately text-free rooms.
 */
export function looksLikeMissingContentIntent(messages: readonly unknown[]): boolean {
  if (messages.length === 0) return false;
  return messages.every(
    (m) => !restHasContent(m) && !restHasAttachments(m) && !restHasEmbeds(m),
  );
}

// ── The paced, single-flight REST client ────────────────────────────────────

export interface DiscordRestClientOptions {
  /** Bot token — held ONLY here for the run; forwarded, never persisted/logged. */
  token: string;
  /** Injectable fetch (tests stub it); defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Cancels in-flight and queued requests. */
  signal?: AbortSignal;
  /** Floor between requests in ms (default 320). */
  minIntervalMs?: number;
  /** Injectable clock/sleep/jitter for deterministic tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/**
 * Read-only Discord REST client over the same-origin proxy. All requests pass
 * through a single-flight FIFO chain so pacing is consistent and a global 429
 * pause naturally holds back every queued request.
 */
export class DiscordRestClient {
  #token: string;
  readonly #fetch: typeof fetch;
  readonly #signal: AbortSignal | undefined;
  readonly #minIntervalMs: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #random: () => number;

  /** FIFO serialization chain — every request awaits the previous one's slot. */
  #chain: Promise<unknown> = Promise.resolve();
  /** Earliest wall-clock (via #now) at which the next request may fire. */
  #nextAllowedAt = 0;

  constructor(options: DiscordRestClientOptions) {
    this.#token = options.token;
    this.#fetch = options.fetchImpl ?? ((...args) => fetch(...args));
    this.#signal = options.signal;
    this.#minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.#now = options.now ?? (() => Date.now());
    this.#sleep = options.sleep ?? defaultSleep;
    this.#random = options.random ?? Math.random;
  }

  /**
   * Drop the token reference at end-of-run. JS strings cannot be truly zeroed,
   * but this removes the only retained handle so it is not kept alive past use.
   */
  dispose(): void {
    this.#token = '';
  }

  /** Fetch up to 100 messages of a channel, oldest-bounded by `before`. */
  async getChannelMessages(channelId: string, before?: string): Promise<unknown[]> {
    if (!isSnowflake(channelId)) {
      throw new DiscordImportError('Invalid Discord channel id.', 'network');
    }
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (before) params.set('before', before);
    const res = await this.#request(`channels/${channelId}/messages?${params.toString()}`);
    const data: unknown = await res.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  }

  /** Serialize a request through the FIFO chain (single-flight, global pause). */
  #request(path: string): Promise<Response> {
    const run = this.#chain.then(() => this.#doRequest(path));
    // Keep the chain alive regardless of this request's outcome.
    this.#chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #doRequest(path: string, attempt = 0): Promise<Response> {
    if (this.#signal?.aborted) throw new DiscordImportError(DISCORD_CANCELLED_MESSAGE, 'aborted');

    const wait = this.#nextAllowedAt - this.#now();
    if (wait > 0) await this.#sleep(wait);

    let res: Response;
    try {
      res = await this.#fetch(`${PROXY_BASE}/${path}`, {
        method: 'GET',
        headers: { Authorization: `Bot ${this.#token}`, Accept: 'application/json' },
        signal: this.#signal,
      });
    } catch (err) {
      if (this.#signal?.aborted) throw new DiscordImportError(DISCORD_CANCELLED_MESSAGE, 'aborted');
      throw new DiscordImportError('Could not reach Discord. Check your connection and try again.', 'network');
    }

    this.#updatePacing(res);

    if (res.status === 429) {
      if (attempt >= MAX_429_RETRIES) {
        throw new DiscordImportError('Discord rate limit exceeded — try again later.', 'network');
      }
      await this.#sleep(await this.#retryAfterMs(res));
      return this.#doRequest(path, attempt + 1);
    }
    if (res.status === 401 || res.status === 403) {
      throw new DiscordImportError(DISCORD_AUTH_MESSAGE, 'auth');
    }
    if (!res.ok) {
      throw new DiscordImportError(`Discord request failed (status ${res.status}).`, 'network');
    }
    return res;
  }

  /** Advance the pacing floor from the just-seen response's rate-limit headers. */
  #updatePacing(res: Response): void {
    const now = this.#now();
    let next = now + this.#minIntervalMs;
    const remaining = Number(res.headers.get('X-RateLimit-Remaining'));
    const resetAfter = Number(res.headers.get('X-RateLimit-Reset-After'));
    if (remaining === 0 && Number.isFinite(resetAfter) && resetAfter > 0) {
      next = Math.max(next, now + resetAfter * 1000);
    }
    this.#nextAllowedAt = next;
  }

  /** Milliseconds to sleep for a 429: max(Retry-After header, body.retry_after) + jitter. */
  async #retryAfterMs(res: Response): Promise<number> {
    const headerSec = Number(res.headers.get('Retry-After'));
    let bodySec = 0;
    try {
      const body: unknown = await res.json();
      if (isRecord(body) && typeof body.retry_after === 'number') bodySec = body.retry_after;
    } catch {
      /* no/invalid body — rely on the header */
    }
    const sec = Math.max(Number.isFinite(headerSec) ? headerSec : 0, bodySec, 0);
    const jitter = Math.floor(this.#random() * 250);
    return sec * 1000 + jitter;
  }
}

// ── Orchestration: paginate → normalize → parseDiscordExport ─────────────────

export interface DiscordChannelImportOptions {
  /** Bot token (session-only). */
  token: string;
  /** Numeric channel id to pull. */
  channelId: string;
  /** Friendly channel name for the vault target (falls back to the id). */
  channelName?: string;
  /** Stop paginating once the oldest fetched message is older than this many days. */
  sinceDays?: number;
  /** Cancels the run. */
  signal?: AbortSignal;
  /** Progress callback with the running raw-message count. */
  onProgress?: (fetched: number) => void;
  /** Injectables (forwarded to the client) for deterministic tests. */
  fetchImpl?: typeof fetch;
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface DiscordChannelImportResult {
  /** Snapshot + honest summary from {@link parseDiscordExport}. */
  result: DiscordImportResult;
  /** Raw messages pulled from the API before normalization/bounding. */
  fetched: number;
  /** True if pagination walked back to the start of the channel. */
  reachedStart: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pull one channel's scrollback over the proxy, normalize it, and transform it
 * into a vault snapshot via {@link parseDiscordExport}. Throws
 * {@link DiscordImportError} on auth failure (401/403), a missing MESSAGE
 * CONTENT intent, cancellation, or a network error. The caller previews the
 * summary, then merges the snapshot with `importVault`.
 */
export async function runDiscordChannelImport(
  options: DiscordChannelImportOptions,
): Promise<DiscordChannelImportResult> {
  if (!isSnowflake(options.channelId)) {
    throw new DiscordImportError('Invalid Discord channel id — copy the numeric channel id.', 'network');
  }
  const client = new DiscordRestClient(options);
  const cutoffMs =
    options.sinceDays && options.sinceDays > 0 ? Date.now() - options.sinceDays * DAY_MS : null;

  const collected: unknown[] = [];
  let before: string | undefined;
  let firstPageChecked = false;
  let reachedStart = false;

  try {
    for (;;) {
      if (options.signal?.aborted) throw new DiscordImportError(DISCORD_CANCELLED_MESSAGE, 'aborted');

      const batch = await client.getChannelMessages(options.channelId, before);

      if (!firstPageChecked && batch.length > 0) {
        firstPageChecked = true;
        if (looksLikeMissingContentIntent(batch)) {
          throw new DiscordImportError(DISCORD_MISSING_CONTENT_INTENT_MESSAGE, 'empty-content');
        }
      }

      for (const m of batch) collected.push(m);
      options.onProgress?.(collected.length);

      if (batch.length < PAGE_LIMIT) {
        reachedStart = true;
        break;
      }
      // Messages arrive newest-first, so the LAST element is the oldest; page
      // further back with before=<that id>.
      const oldest = batch[batch.length - 1];
      const oldestId = isRecord(oldest) ? asString(oldest.id).trim() : '';
      if (!oldestId) {
        reachedStart = true;
        break;
      }
      before = oldestId;

      if (cutoffMs !== null && snowflakeToMs(oldestId) < cutoffMs) break;
      if (collected.length >= MAX_TOTAL_MESSAGES) break;
    }
  } finally {
    client.dispose();
  }

  // Pages arrive newest-first (and we walk newest→oldest), so `collected` is
  // globally newest→oldest. parseDiscordExport resolves reply quotes in
  // array order — a reply only finds its parent if the parent was seen
  // EARLIER — so it must receive oldest→newest. Reverse before normalizing.
  const channelExport = normalizeDiscordChannelExport(
    options.channelId,
    options.channelName ?? '',
    [...collected].reverse(),
  );
  const parseOptions: DiscordImportOptions = {};
  if (options.sinceDays && options.sinceDays > 0) parseOptions.sinceDays = options.sinceDays;
  // parseDiscordExport returns null only when there is no recognizable channel
  // export at all; a `{channel, messages}` object (even empty) always parses.
  const result = parseDiscordExport(channelExport, parseOptions);
  if (!result) {
    throw new DiscordImportError('Discord returned no importable messages for that channel.', 'network');
  }

  return { result, fetched: collected.length, reachedStart };
}
