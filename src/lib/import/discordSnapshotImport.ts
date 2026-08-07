// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * discordSnapshotImport.ts — import a Discord server's history over a BOT TOKEN
 * (product-entry roadmap). This is the credential-bearing sibling of the two
 * credential-free Discord importers: {@link parseDiscordExport} (a
 * DiscordChatExporter run) and {@link parseDiscordPackage} (the official
 * self-serve data package). Here the operator supplies a bot token and ONE
 * channel id, and we pull that channel's scrollback live.
 *
 * ── ARCHITECTURE (load-bearing) ──────────────────────────────────────────────
 * A browser CANNOT call discord.com/api directly: the Discord REST API sends no
 * CORS headers and rejects the `Authorization`-header preflight. So EVERY call
 * routes through a same-origin, read-only proxy (`GET /discord-import/<path>` in
 * the deployment's same-origin upload proxy) that forwards to
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
import { createBoundedAbort, type BoundedAbort } from '@/lib/net/boundedAbort';

/** Same-origin proxy prefix; forwards to https://discord.com/api/v10/… */
const PROXY_BASE = '/discord-import';

/** Discord snowflake → epoch ms uses this constant (Discord epoch, 2015-01-01). */
const DISCORD_EPOCH_MS = 1420070400000n;

/** REST page size ceiling for GET /channels/{id}/messages. */
const PAGE_LIMIT = 100;

/** Page size ceiling for GET /channels/{id}/messages/pins (Discord caps at 50). */
const PIN_PAGE_LIMIT = 50;

/** Hard ceilings on the pins pull so a hostile `has_more` can't loop forever. */
const MAX_PINS_PER_CHANNEL = 500;
const MAX_PIN_PAGES = 20;

/** Discord guild channel `type` numerics that hold a message scrollback. */
const GUILD_TEXT_CHANNEL_TYPES = new Set<number>([
  0, // GUILD_TEXT
  5, // GUILD_ANNOUNCEMENT
  15, // GUILD_FORUM
]);

/** Discord guild channel `type` for a category (a container, not a chat). */
const GUILD_CATEGORY_TYPE = 4;

/** Default floor between requests (ms) — comfortably under Discord's budget. */
const DEFAULT_MIN_INTERVAL_MS = 320;
/** Bound one proxy response, including body streaming, so FIFO cannot deadlock. */
export const DISCORD_REQUEST_TIMEOUT_MS = 20_000;
const MAX_DISCORD_REQUEST_TIMEOUT_MS = 120_000;

/** Hard ceiling on 429 re-enqueues before we give up (avoids a runaway loop). */
const MAX_429_RETRIES = 5;

/** Absolute ceiling on messages pulled in one run (memory bound / abuse guard). */
const MAX_TOTAL_MESSAGES = 100_000;

/** Bound every proxied JSON body before parsing so a hostile proxy cannot OOM the tab. */
const MAX_REST_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RETRY_RESPONSE_BYTES = 16 * 1024;

/** Per-record ceilings applied before the shared importer sees REST data. */
const MAX_GUILD_RESOURCE_ITEMS = 1_000;
const MAX_MESSAGE_CONTENT_CHARS = 65_536;
const MAX_MESSAGE_ATTACHMENTS = 32;
const MAX_MESSAGE_REACTIONS = 64;
const MAX_URL_CHARS = 2_048;
const MAX_NAME_CHARS = 256;
const MAX_TIMESTAMP_CHARS = 64;

/** User-facing failure text (also the thrown Error.message — never leaks the token). */
export const DISCORD_AUTH_MESSAGE =
  'Discord rejected the request (401/403). Check the bot token, and that the bot was invited to the server with the "View Channels" and "Read Message History" permissions.';

export const DISCORD_MISSING_CONTENT_INTENT_MESSAGE =
  'Discord returned messages with no text. Your bot is missing the MESSAGE CONTENT INTENT. Enable the "MESSAGE CONTENT INTENT" toggle in your bot\'s dashboard (Discord Developer Portal → your app → Bot → Privileged Gateway Intents), then try again.';

export const DISCORD_CANCELLED_MESSAGE = 'Discord import cancelled.';
export const DISCORD_TIMEOUT_MESSAGE =
  'Discord took too long to respond. Check your connection and try the import again.';

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

function boundedString(value: unknown, maxChars: number): string {
  return asString(value).slice(0, maxChars);
}

/**
 * Read JSON through a byte ceiling before calling JSON.parse. Real Fetch
 * responses expose a ReadableStream; the json-only fallback exists solely for
 * lightweight injected test doubles and is never used by a browser Response.
 */
async function readBoundedJson(res: Response, maxBytes = MAX_REST_RESPONSE_BYTES): Promise<unknown> {
  const declaredLength = Number(res.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new DiscordImportError('Discord returned an unexpectedly large response.', 'network');
  }

  if (!res.body) {
    try {
      return await res.json();
    } catch {
      return undefined;
    }
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new DiscordImportError('Discord returned an unexpectedly large response.', 'network');
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof DiscordImportError) throw err;
    throw new DiscordImportError('Could not read Discord\'s response.', 'network');
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
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

/** `<:name:id>` / `<a:name:id>` custom-emoji mentions in message content. */
const CUSTOM_EMOJI_RE = /<a?:([A-Za-z0-9_]{2,32}):\d{1,20}>/g;

/**
 * Replace Discord custom-emoji mentions (`<:fire:123>`, animated `<a:wave:456>`)
 * with the readable `:name:` shortcode. The numeric id is meaningless off-Discord
 * and would otherwise render as literal noise in the archived text.
 */
export function replaceCustomEmoji(text: string): string {
  return text.replace(CUSTOM_EMOJI_RE, ':$1:');
}

/** Discord REST message `type` numerics we treat as chat (0 default, 19 reply). */
function restTypeToDce(rawType: unknown): 'Default' | 'Reply' | 'System' {
  if (rawType === 19) return 'Reply';
  if (rawType === 0) return 'Default';
  return 'System';
}

function restAttachments(raw: unknown): { url: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { url: string }[] = [];
  for (const a of raw.slice(0, MAX_MESSAGE_ATTACHMENTS)) {
    const url = isRecord(a) ? boundedString(a.url, MAX_URL_CHARS).trim() : '';
    if (url) out.push({ url });
  }
  return out;
}

/** REST reaction `{count, emoji:{name,id}}` → DCE `{emoji:{name}, count}`. */
function restReactions(raw: unknown): { emoji: { name: string }; count: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: { emoji: { name: string }; count: number }[] = [];
  for (const r of raw.slice(0, MAX_MESSAGE_REACTIONS)) {
    if (!isRecord(r)) continue;
    const name = isRecord(r.emoji) ? boundedString(r.emoji.name, MAX_NAME_CHARS) : '';
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
  const name =
    boundedString(author.global_name, MAX_NAME_CHARS).trim() ||
    boundedString(author.username, MAX_NAME_CHARS).trim() ||
    'unknown';

  const row: Record<string, unknown> = {
    id: boundedString(raw.id, 20),
    type: restTypeToDce(raw.type),
    timestamp: boundedString(raw.timestamp, MAX_TIMESTAMP_CHARS),
    content: replaceCustomEmoji(boundedString(raw.content, MAX_MESSAGE_CONTENT_CHARS)),
    attachments: restAttachments(raw.attachments),
    author: { name },
  };

  const edited = boundedString(raw.edited_timestamp, MAX_TIMESTAMP_CHARS);
  if (edited) row.timestampEdited = edited;

  const reactions = restReactions(raw.reactions);
  if (reactions) row.reactions = reactions;

  const ref = isRecord(raw.message_reference)
    ? boundedString(raw.message_reference.message_id, 20).trim()
    : '';
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
  /** Per-response deadline, including streamed JSON body (default 20 seconds). */
  requestTimeoutMs?: number;
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
  readonly #requestTimeoutMs: number;
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
    const requestTimeoutMs = options.requestTimeoutMs ?? DISCORD_REQUEST_TIMEOUT_MS;
    this.#requestTimeoutMs = Number.isFinite(requestTimeoutMs)
      ? Math.max(1, Math.min(MAX_DISCORD_REQUEST_TIMEOUT_MS, Math.floor(requestTimeoutMs)))
      : DISCORD_REQUEST_TIMEOUT_MS;
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
    if (before && !isSnowflake(before)) {
      throw new DiscordImportError('Invalid Discord message cursor.', 'network');
    }
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (before) params.set('before', before);
    const request = await this.#request(`channels/${channelId}/messages?${params.toString()}`);
    const data = await this.#readResponseJson(request);
    // Bound a single (hostile or oversized) page by construction, not just the loop.
    return Array.isArray(data) ? data.slice(0, PAGE_LIMIT) : [];
  }

  /** Enumerate a guild's channels (GET /guilds/{id}/channels). */
  async getGuildChannels(guildId: string): Promise<unknown[]> {
    return this.#getGuildArray(guildId, 'channels');
  }

  /** Fetch a guild's roles (GET /guilds/{id}/roles) — counted, then dropped. */
  async getGuildRoles(guildId: string): Promise<unknown[]> {
    return this.#getGuildArray(guildId, 'roles');
  }

  /** Fetch a guild's custom emojis (GET /guilds/{id}/emojis) — counted, then dropped. */
  async getGuildEmojis(guildId: string): Promise<unknown[]> {
    return this.#getGuildArray(guildId, 'emojis');
  }

  async #getGuildArray(guildId: string, resource: 'channels' | 'roles' | 'emojis'): Promise<unknown[]> {
    if (!isSnowflake(guildId)) {
      throw new DiscordImportError('Invalid Discord server id.', 'network');
    }
    const request = await this.#request(`guilds/${guildId}/${resource}`);
    const data = await this.#readResponseJson(request);
    return Array.isArray(data) ? data.slice(0, MAX_GUILD_RESOURCE_ITEMS) : [];
  }

  /**
   * Fetch one page of the NEW paginated pins endpoint
   * (GET /channels/{id}/messages/pins). The response is
   * `{ items: [{ pinned_at, message }], has_more }`; the cursor `before` is the
   * ISO8601 `pinned_at` of the last item (NOT a snowflake).
   */
  async getChannelPins(
    channelId: string,
    before?: string,
  ): Promise<{ items: unknown[]; hasMore: boolean }> {
    if (!isSnowflake(channelId)) {
      throw new DiscordImportError('Invalid Discord channel id.', 'network');
    }
    if (before && (before.length > MAX_TIMESTAMP_CHARS || !Number.isFinite(Date.parse(before)))) {
      throw new DiscordImportError('Invalid Discord pin cursor.', 'network');
    }
    const params = new URLSearchParams({ limit: String(PIN_PAGE_LIMIT) });
    if (before) params.set('before', before);
    const request = await this.#request(`channels/${channelId}/messages/pins?${params.toString()}`);
    const data = await this.#readResponseJson(request);
    // Bound a single (hostile or oversized) page by construction, not just the loop.
    const items = isRecord(data) && Array.isArray(data.items) ? data.items.slice(0, PIN_PAGE_LIMIT) : [];
    const hasMore = isRecord(data) && data.has_more === true;
    return { items, hasMore };
  }

  /** Serialize a request through the FIFO chain (single-flight, global pause). */
  #request(path: string): Promise<{ response: Response; abort: BoundedAbort }> {
    const run = this.#chain.then(() => this.#doRequest(path));
    // Keep the chain alive regardless of this request's outcome.
    this.#chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #doRequest(
    path: string,
    attempt = 0,
  ): Promise<{ response: Response; abort: BoundedAbort }> {
    if (this.#signal?.aborted) throw new DiscordImportError(DISCORD_CANCELLED_MESSAGE, 'aborted');

    const wait = this.#nextAllowedAt - this.#now();
    if (wait > 0) await this.#sleep(wait);
    if (this.#signal?.aborted) throw new DiscordImportError(DISCORD_CANCELLED_MESSAGE, 'aborted');

    const abort = createBoundedAbort(this.#requestTimeoutMs, this.#signal);
    let res: Response;
    try {
      res = await this.#fetch(`${PROXY_BASE}/${path}`, {
        method: 'GET',
        headers: { Authorization: `Bot ${this.#token}`, Accept: 'application/json' },
        signal: abort.signal,
      });
    } catch (err) {
      const cause = abort.cause();
      abort.dispose();
      if (cause === 'caller' || this.#signal?.aborted) {
        throw new DiscordImportError(DISCORD_CANCELLED_MESSAGE, 'aborted');
      }
      if (cause === 'timeout') throw new DiscordImportError(DISCORD_TIMEOUT_MESSAGE, 'network');
      throw new DiscordImportError('Could not reach Discord. Check your connection and try again.', 'network');
    }

    this.#updatePacing(res);

    if (res.status === 429) {
      if (attempt >= MAX_429_RETRIES) {
        abort.dispose();
        throw new DiscordImportError('Discord rate limit exceeded — try again later.', 'network');
      }
      await this.#sleep(await this.#retryAfterMs({ response: res, abort }));
      return this.#doRequest(path, attempt + 1);
    }
    if (res.status === 401 || res.status === 403) {
      abort.dispose();
      throw new DiscordImportError(DISCORD_AUTH_MESSAGE, 'auth');
    }
    if (!res.ok) {
      abort.dispose();
      throw new DiscordImportError(`Discord request failed (status ${res.status}).`, 'network');
    }
    return { response: res, abort };
  }

  async #readResponseJson(
    request: { response: Response; abort: BoundedAbort },
    maxBytes = MAX_REST_RESPONSE_BYTES,
  ): Promise<unknown> {
    try {
      return await readBoundedJson(request.response, maxBytes);
    } catch (error) {
      const cause = request.abort.cause();
      if (cause === 'caller' || this.#signal?.aborted) {
        throw new DiscordImportError(DISCORD_CANCELLED_MESSAGE, 'aborted');
      }
      if (cause === 'timeout') throw new DiscordImportError(DISCORD_TIMEOUT_MESSAGE, 'network');
      throw error;
    } finally {
      request.abort.dispose();
    }
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
  async #retryAfterMs(request: { response: Response; abort: BoundedAbort }): Promise<number> {
    const headerSec = Number(request.response.headers.get('Retry-After'));
    let bodySec = 0;
    try {
      const body = await this.#readResponseJson(request, MAX_RETRY_RESPONSE_BYTES);
      if (isRecord(body) && typeof body.retry_after === 'number') bodySec = body.retry_after;
    } catch (error) {
      if (error instanceof DiscordImportError
        && (error.kind === 'aborted' || error.message === DISCORD_TIMEOUT_MESSAGE)) {
        throw error;
      }
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

interface PaginateOptions {
  /** Stop paging once the oldest fetched message is older than this ms, or null. */
  cutoffMs: number | null;
  /** Stop once this many raw messages have been collected for this channel. */
  budget: number;
  signal?: AbortSignal;
  /** Called with the running per-channel collected count after each page. */
  onCount?: (running: number) => void;
  /** Run the missing-MESSAGE-CONTENT-intent probe on the first non-empty page. */
  checkIntent: boolean;
}

/**
 * Walk one channel's scrollback newest→oldest over the proxy, page by page.
 * Returns the raw REST messages in the order Discord served them (newest-first)
 * plus whether pagination reached the start of the channel. Throws
 * {@link DiscordImportError} on cancellation, a missing MESSAGE CONTENT intent
 * (when `checkIntent`), auth failure, or a network error — the shared engine
 * behind both the single-channel and full-guild importers.
 */
async function paginateChannelMessages(
  client: DiscordRestClient,
  channelId: string,
  opts: PaginateOptions,
): Promise<{ collected: unknown[]; reachedStart: boolean }> {
  const collected: unknown[] = [];
  let before: string | undefined;
  let firstPageChecked = false;
  let reachedStart = false;

  for (;;) {
    if (opts.signal?.aborted) throw new DiscordImportError(DISCORD_CANCELLED_MESSAGE, 'aborted');

    const batch = await client.getChannelMessages(channelId, before);

    if (opts.checkIntent && !firstPageChecked && batch.length > 0) {
      firstPageChecked = true;
      if (looksLikeMissingContentIntent(batch)) {
        throw new DiscordImportError(DISCORD_MISSING_CONTENT_INTENT_MESSAGE, 'empty-content');
      }
    }

    for (const m of batch) {
      if (collected.length >= opts.budget) break;
      collected.push(m);
    }
    opts.onCount?.(collected.length);

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

    if (collected.length >= opts.budget) break;
    if (opts.cutoffMs !== null && snowflakeToMs(oldestId) < opts.cutoffMs) break;
  }

  return { collected, reachedStart };
}

/**
 * Pull every pinned message of a channel via the paginated pins endpoint,
 * following the ISO8601 `pinned_at` cursor. Returns the underlying message
 * objects (unwrapped from each `{ pinned_at, message }` item), bounded so a
 * hostile `has_more` cannot loop or grow without limit.
 */
async function pullChannelPins(
  client: DiscordRestClient,
  channelId: string,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const messages: unknown[] = [];
  let before: string | undefined;

  for (let page = 0; page < MAX_PIN_PAGES; page += 1) {
    if (signal?.aborted) throw new DiscordImportError(DISCORD_CANCELLED_MESSAGE, 'aborted');

    const { items, hasMore } = await client.getChannelPins(channelId, before);
    if (items.length === 0) break;

    let lastPinnedAt = '';
    for (const item of items) {
      if (!isRecord(item)) continue;
      if (isRecord(item.message)) messages.push(item.message);
      const pinnedAt = asString(item.pinned_at).trim();
      if (pinnedAt) lastPinnedAt = pinnedAt;
    }

    if (!hasMore || !lastPinnedAt || messages.length >= MAX_PINS_PER_CHANNEL) break;
    before = lastPinnedAt;
  }

  return messages;
}

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

  try {
    const { collected, reachedStart } = await paginateChannelMessages(client, options.channelId, {
      cutoffMs,
      budget: MAX_TOTAL_MESSAGES,
      signal: options.signal,
      onCount: (n) => options.onProgress?.(n),
      checkIntent: true,
    });

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
  } finally {
    client.dispose();
  }
}

// ── Full-guild snapshot: enumerate channels → per-channel messages + pins ─────

/** Progress tick for a guild import — drives the UI's "channel N of M" line. */
export interface DiscordGuildProgress {
  /** 1-based index of the channel currently being pulled. */
  channelIndex: number;
  /** Total text/announcement/forum channels to walk. */
  channelCount: number;
  /** Friendly name of the channel currently being pulled. */
  channelName: string;
  /** Running raw-message count across the whole guild so far. */
  fetched: number;
}

export interface DiscordGuildImportOptions {
  /** Bot token (session-only). */
  token: string;
  /** Numeric guild (server) id to snapshot. */
  guildId: string;
  /** Per-channel: stop paginating once the oldest message is older than this. */
  sinceDays?: number;
  /** Cancels the run. */
  signal?: AbortSignal;
  /** Progress callback (channel N of M + running message count). */
  onProgress?: (progress: DiscordGuildProgress) => void;
  /** Injectables (forwarded to the client) for deterministic tests. */
  fetchImpl?: typeof fetch;
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface DiscordGuildImportResult {
  /** Combined snapshot + honest summary from {@link parseDiscordExport}. */
  result: DiscordImportResult;
  /** Text/announcement/forum channels enumerated (categories excluded). */
  channelsScanned: number;
  /** Channels that produced at least one importable message. */
  channelsImported: number;
  /** Channels skipped because a per-channel read failed (e.g. no access). */
  channelsFailed: number;
  /** Category channels dropped (no vault home). */
  categoriesSkipped: number;
  /** Guild roles fetched then dropped (no vault home). */
  rolesSkipped: number;
  /** Guild custom emojis fetched then dropped (no vault home). */
  emojisSkipped: number;
  /** Pinned messages merged in (deduped against the scrollback). */
  pinsImported: number;
  /** Raw messages pulled across the guild before normalization/bounding. */
  fetched: number;
}

/** A guild channel record narrowed to the fields the walk needs. */
interface GuildChannel {
  id: string;
  name: string;
  type: number;
  position: number;
}

function readGuildChannel(raw: unknown): GuildChannel | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id).trim();
  if (!id) return null;
  const type = typeof raw.type === 'number' ? raw.type : -1;
  const name = asString(raw.name).trim() || id;
  const position = typeof raw.position === 'number' && Number.isFinite(raw.position) ? raw.position : 0;
  return { id, name, type, position };
}

/**
 * Sort raw REST messages oldest→newest so parseDiscordExport resolves reply
 * quotes in array order. Snowflake ids are monotonic by creation time and exact,
 * so they order same-millisecond messages correctly (a reply and its parent can
 * share a timestamp); fall back to the ISO timestamp only when an id is missing.
 */
function sortRawChronologically(raw: readonly unknown[]): unknown[] {
  return [...raw].sort((a, b) => {
    const idA = isRecord(a) ? asString(a.id).trim() : '';
    const idB = isRecord(b) ? asString(b.id).trim() : '';
    if (isSnowflake(idA) && isSnowflake(idB)) {
      const bigA = BigInt(idA);
      const bigB = BigInt(idB);
      return bigA < bigB ? -1 : bigA > bigB ? 1 : 0;
    }
    const timeA = isRecord(a) ? Date.parse(asString(a.timestamp)) : Number.NaN;
    const timeB = isRecord(b) ? Date.parse(asString(b.timestamp)) : Number.NaN;
    return (Number.isNaN(timeA) ? 0 : timeA) - (Number.isNaN(timeB) ? 0 : timeB);
  });
}

/** Count a decoration resource, swallowing a per-resource failure (still aborts). */
async function safeCount(fetcher: () => Promise<unknown[]>): Promise<number> {
  try {
    return (await fetcher()).length;
  } catch (err) {
    if (err instanceof DiscordImportError && err.kind === 'aborted') throw err;
    return 0;
  }
}

function emptyGuildResult(): DiscordImportResult {
  return {
    snapshot: { kind: 'onyx-vault', version: 1, exportedAt: new Date().toISOString(), targets: [] },
    summary: { guild: null, channels: 0, messages: 0, skipped: 0, droppedOverCap: 0, oldest: null, newest: null },
  };
}

/**
 * Snapshot a WHOLE Discord guild over the proxy: enumerate its channels, then
 * for each text/announcement/forum channel pull the scrollback + its pins,
 * normalize every channel into the DiscordChatExporter shape, and transform the
 * lot through {@link parseDiscordExport} in ONE call (reusing its per-channel
 * VAULT_KEEP bounding, dedup, reply resolution, and summary).
 *
 * Failure model (fail-loud where it matters, resilient where it doesn't):
 *  - The channel enumeration validates the token; an auth/network error there
 *    aborts the whole run.
 *  - A missing MESSAGE CONTENT intent (detected on the first non-empty page of
 *    the first readable channel) and cancellation are guild-wide → they abort.
 *  - A per-channel read error AFTER enumeration (e.g. a permission overwrite on
 *    one channel) skips that channel and continues — the token was already
 *    proven, so one unreadable channel must not sink the whole import.
 *
 * Roles and categories have no vault home: they are fetched/enumerated only to
 * be counted honestly in the summary. Custom emoji become `:name:` in text and
 * pins become ordinary messages (deduped by id) via normalization.
 */
export async function runDiscordGuildImport(
  options: DiscordGuildImportOptions,
): Promise<DiscordGuildImportResult> {
  if (!isSnowflake(options.guildId)) {
    throw new DiscordImportError('Invalid Discord server id — copy the numeric Server ID.', 'network');
  }
  const client = new DiscordRestClient(options);
  const cutoffMs =
    options.sinceDays && options.sinceDays > 0 ? Date.now() - options.sinceDays * DAY_MS : null;

  let categoriesSkipped = 0;
  let channelsImported = 0;
  let channelsFailed = 0;
  let pinsImported = 0;
  let totalFetched = 0;
  const channelExports: Record<string, unknown>[] = [];
  const channels: GuildChannel[] = [];

  try {
    // Enumeration first: this proves the token and the bot's guild membership.
    // An auth/network error here is fatal (nothing to walk).
    const rawChannels = await client.getGuildChannels(options.guildId);

    // Roles + emojis are decoration with no vault home; count them for an honest
    // summary but never let their failure sink a guild we can already read.
    const rolesSkipped = await safeCount(() => client.getGuildRoles(options.guildId));
    const emojisSkipped = await safeCount(() => client.getGuildEmojis(options.guildId));

    for (const raw of rawChannels) {
      const channel = readGuildChannel(raw);
      if (!channel) continue;
      if (channel.type === GUILD_CATEGORY_TYPE) {
        categoriesSkipped += 1;
        continue;
      }
      if (!GUILD_TEXT_CHANNEL_TYPES.has(channel.type)) continue;
      channels.push(channel);
    }
    channels.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

    let intentChecked = false;
    for (let i = 0; i < channels.length; i += 1) {
      const channel = channels[i]!;
      if (options.signal?.aborted) throw new DiscordImportError(DISCORD_CANCELLED_MESSAGE, 'aborted');

      const budget = MAX_TOTAL_MESSAGES - totalFetched;
      if (budget <= 0) break;

      const emitProgress = (fetched: number): void =>
        options.onProgress?.({
          channelIndex: i + 1,
          channelCount: channels.length,
          channelName: channel.name,
          fetched,
        });
      emitProgress(totalFetched);

      const collected: unknown[] = [];
      try {
        const page = await paginateChannelMessages(client, channel.id, {
          cutoffMs,
          budget,
          signal: options.signal,
          onCount: (n) => emitProgress(totalFetched + n),
          // Probe the MESSAGE CONTENT intent once, on the first channel that
          // actually returns messages — it's a bot-wide config, not per-channel.
          checkIntent: !intentChecked,
        });
        if (!intentChecked && page.collected.length > 0) intentChecked = true;
        for (const m of page.collected) collected.push(m);
      } catch (err) {
        // Guild-wide failures propagate; a per-channel read error is skipped.
        if (err instanceof DiscordImportError && (err.kind === 'empty-content' || err.kind === 'aborted')) {
          throw err;
        }
        channelsFailed += 1;
        continue;
      }

      totalFetched += collected.length;

      // Pins are decoration: a pins-endpoint failure must NOT drop this channel's
      // already-fetched scrollback. Isolate it and degrade to "no pins" on any
      // non-abort error (mirrors how roles/emojis are wrapped in safeCount).
      let pins: unknown[] = [];
      try {
        pins = await pullChannelPins(client, channel.id, options.signal);
      } catch (err) {
        if (err instanceof DiscordImportError && err.kind === 'aborted') throw err;
        pins = [];
      }

      // Merge pins as ordinary messages, deduped by id against the scrollback
      // (a pin is just a flagged message that also appears in the scrollback).
      const seen = new Set<string>();
      for (const m of collected) {
        const id = isRecord(m) ? asString(m.id).trim() : '';
        if (id) seen.add(id);
      }
      for (const pin of pins) {
        const id = isRecord(pin) ? asString(pin.id).trim() : '';
        // An id-less pin can neither dedup nor be honestly counted — skip it.
        if (!id || seen.has(id)) continue;
        seen.add(id);
        collected.push(pin);
        pinsImported += 1;
      }

      if (collected.length === 0) continue;

      // Feed oldest→newest so parseDiscordExport resolves reply quotes; pins may
      // have been appended out of order, so sort chronologically rather than reverse.
      channelExports.push(normalizeDiscordChannelExport(channel.id, channel.name, sortRawChronologically(collected)));
      channelsImported += 1;
    }

    const parseOptions: DiscordImportOptions = {};
    if (options.sinceDays && options.sinceDays > 0) parseOptions.sinceDays = options.sinceDays;
    // An array of channel exports parses in one pass; an empty array yields null,
    // in which case we still return an honest zero-message result.
    const result =
      (channelExports.length > 0 ? parseDiscordExport(channelExports, parseOptions) : null) ?? emptyGuildResult();

    return {
      result,
      channelsScanned: channels.length,
      channelsImported,
      channelsFailed,
      categoriesSkipped,
      rolesSkipped,
      emojisSkipped,
      pinsImported,
      fetched: totalFetched,
    };
  } finally {
    client.dispose();
  }
}
