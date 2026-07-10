/**
 * discordImport.ts — sovereign, credential-free Discord history import
 * (Roadmap v1.0 "Torii": the highest-leverage switching-cost destroyer).
 *
 * A community leaving Discord exports its own channels with DiscordChatExporter
 * (https://github.com/Tyrrrz/DiscordChatExporter) in **JSON** mode and drops the
 * files here. We transform that export — purely on-device, no bot token, no
 * Discord API call, no CORS wall, nothing that touches Discord's servers — into
 * the exact {@link VaultExportSnapshot} shape the local history vault already
 * knows how to merge (`importVault`). The imported history becomes instantly
 * searchable, time-travellable scrollback that lives only on this device.
 *
 * Why file-based, not bot-token: it is ToS-clean (a user importing their own
 * export), needs zero credentials, works entirely offline, and — unlike a
 * browser hitting Discord's API — is not blocked by CORS. It is also fully
 * deterministic and unit-testable.
 *
 * Design constraints (mirroring historyVault):
 *  - NEVER trust the input. Every field is validated/narrowed from `unknown`.
 *  - BOUNDED. A hostile or huge export (millions of messages) must not OOM the
 *    tab: per-channel buffers are compacted to the newest `keepPerChannel`
 *    mid-scan, and the reply index is size-capped.
 *  - Pure + synchronous: no IndexedDB, no I/O — the caller feeds the resulting
 *    snapshot to `importVault`. This keeps the transform trivially testable.
 *  - No HTML is produced. `text` stays plain; the message renderer escapes it,
 *    so imported content cannot inject markup.
 */
import type { ChatMessage, MessageReaction, MessageType } from '@/lib/irc/types';
import type { VaultExportSnapshot, VaultExportTarget } from '@/lib/vault/historyVault';
import { VAULT_KEEP } from '@/lib/vault/historyVault';

/** Options controlling how a Discord export is mapped into the vault. */
export interface DiscordImportOptions {
  /** Only keep messages newer than this many days (0/undefined = keep all). */
  sinceDays?: number;
  /** Retain at most this many messages per channel (newest kept). */
  keepPerChannel?: number;
  /**
   * Include Discord "system" events (pins, joins, calls, thread notices).
   * Off by default — those are noise in a searchable archive.
   */
  includeSystem?: boolean;
}

/** Machine-readable summary of a completed transform, for honest UI messaging. */
export interface DiscordImportSummary {
  /** Guild/server name if the export carried one. */
  guild: string | null;
  /** Distinct channels that produced at least one message. */
  channels: number;
  /** Messages that made it into the snapshot. */
  messages: number;
  /** Messages dropped as invalid, empty, or filtered-out system events. */
  skipped: number;
  /** Messages dropped purely because a channel exceeded `keepPerChannel`. */
  droppedOverCap: number;
  /** ISO timestamp of the oldest imported message, if any. */
  oldest: string | null;
  /** ISO timestamp of the newest imported message, if any. */
  newest: string | null;
}

export interface DiscordImportResult {
  snapshot: VaultExportSnapshot;
  summary: DiscordImportSummary;
}

/** Discord message types (DiscordChatExporter's `type` field) we treat as chat. */
const CHAT_TYPES = new Set(['Default', 'Reply']);

/** Upper bound on stored reactor placeholders per reaction (keeps the vault lean). */
const MAX_REACTION_USERS = 99;

/**
 * Cap on the per-target reply-resolution index. Discord exports are ordered
 * oldest→newest and replies reference nearby (older) messages, so once a target
 * has this many known ids we stop recording — replies to anything older than
 * the most recent ~MAX_REF_ENTRIES messages simply render without a quote.
 */
const MAX_REF_ENTRIES = 50_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Coerce an option to a finite positive integer, or fall back. */
function finitePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

/**
 * Turn a Discord channel name into a legal, stable Onyx conversation key.
 * Discord channel names are already lowercase-kebab; we defensively normalize
 * (strip a leading '#', lowercase, collapse whitespace to '-', drop anything
 * that is not `[a-z0-9-_]`) and always return a `#`-prefixed target.
 */
export function normalizeChannelTarget(rawName: string): string {
  const cleaned = rawName
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return `#${cleaned || 'imported'}`;
}

/** Best-effort display name for a Discord author record. */
function authorName(author: unknown): string {
  if (!isRecord(author)) return 'unknown';
  const nickname = asString(author.nickname).trim();
  if (nickname) return nickname;
  const name = asString(author.name).trim();
  if (name) return name;
  return 'unknown';
}

/** Render a Discord emoji record to a compact display token. */
function emojiToken(emoji: unknown): string {
  if (!isRecord(emoji)) return '';
  const name = asString(emoji.name).trim();
  if (name) return name; // unicode glyph, or a custom emoji's bare name
  const code = asString(emoji.code).trim();
  return code ? `:${code}:` : '';
}

function mapReactions(raw: unknown): MessageReaction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const reactions: MessageReaction[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const emoji = emojiToken(entry.emoji);
    if (!emoji) continue;
    // Prefer the real reactor list when the export carried it.
    const named: string[] = Array.isArray(entry.users)
      ? entry.users
          .map((u) => (isRecord(u) ? authorName(u) : typeof u === 'string' ? u : ''))
          .filter((u): u is string => u.length > 0)
      : [];
    // Preserve the reaction count even when the reactor list is absent or
    // partial: pad with anonymous placeholders so the facepile shows "N",
    // bounded so a `count: 100000` can't bloat the vault.
    const count = finitePositiveInt(entry.count, 0);
    const target = Math.min(Math.max(count, named.length), MAX_REACTION_USERS);
    const users = named.slice(0, target);
    while (users.length < target) users.push('');
    if (users.length > 0) reactions.push({ emoji, users });
  }
  return reactions.length > 0 ? reactions : undefined;
}

/** Append attachment URLs so links stay visible and searchable in the vault. */
function composeText(content: string, attachments: unknown): string {
  const base = content.trim();
  if (!Array.isArray(attachments) || attachments.length === 0) return base;
  const urls = attachments
    .map((a) => (isRecord(a) ? asString(a.url).trim() : ''))
    .filter((u) => u.length > 0);
  if (urls.length === 0) return base;
  return base ? `${base}\n${urls.join('\n')}` : urls.join('\n');
}

function readChannelName(root: Record<string, unknown>): string {
  const channel = isRecord(root.channel) ? root.channel : {};
  return asString(channel.name).trim() || asString(channel.id).trim() || 'imported';
}

function readChannelId(root: Record<string, unknown>, target: string): string {
  const channel = isRecord(root.channel) ? root.channel : {};
  return asString(channel.id).trim() || target;
}

/** Mutable per-target accumulation state, carried across paginated files. */
interface TargetBucket {
  target: string;
  messages: ChatMessage[];
  /** discordId → quote snippet, for resolving replies across pages. */
  refIndex: Map<string, { from: string; text: string }>;
  /** Emitted vault ids, to avoid IndexedDB `put` collisions clobbering rows. */
  emittedIds: Set<string>;
  /** Monotonic fallback counter for messages that carry no Discord id. */
  seq: number;
}

/** Normalize the accepted top-level shapes into a flat list of channel exports. */
function collectChannelExports(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.filter(isRecord);
  }
  if (isRecord(raw)) {
    if (Array.isArray(raw.exports)) return raw.exports.filter(isRecord);
    // A single DiscordChatExporter file is `{ guild, channel, messages: [...] }`.
    if (Array.isArray(raw.messages)) return [raw];
  }
  return [];
}

/** Allocate a collision-free vault id within a target. */
function uniqueId(bucket: TargetBucket, channelId: string, discordId: string): string {
  const base = `discord:${channelId || 'ch'}:${discordId || `idx${bucket.seq++}`}`;
  if (!bucket.emittedIds.has(base)) {
    bucket.emittedIds.add(base);
    return base;
  }
  let n = 2;
  let candidate = `${base}#${n}`;
  while (bucket.emittedIds.has(candidate)) {
    n += 1;
    candidate = `${base}#${n}`;
  }
  bucket.emittedIds.add(candidate);
  return candidate;
}

/**
 * Transform a DiscordChatExporter JSON export into a vault snapshot.
 *
 * Accepts a single channel export object, an array of them, or a
 * `{ exports: [...] }` bundle. Returns null only when the input has no
 * recognizable Discord channel export at all (so the caller can reject the
 * file); an export whose messages are all filtered out still returns a valid
 * empty snapshot with an honest summary.
 */
export function parseDiscordExport(raw: unknown, options: DiscordImportOptions = {}): DiscordImportResult | null {
  const channelExports = collectChannelExports(raw);
  if (channelExports.length === 0) return null;

  const includeSystem = options.includeSystem === true;
  const keepPerChannel = Math.min(finitePositiveInt(options.keepPerChannel, VAULT_KEEP), VAULT_KEEP);
  const compactAt = keepPerChannel * 2;
  const sinceDays = finitePositiveInt(options.sinceDays, 0);
  const cutoff = sinceDays > 0 ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : null;

  const byTarget = new Map<string, TargetBucket>();
  let guild: string | null = null;
  let skipped = 0;
  let droppedOverCap = 0;

  // Sort a bucket chronologically and drop everything older than the newest
  // `keepPerChannel`. Called mid-scan (memory bound) and once at the end.
  const compact = (bucket: TargetBucket): void => {
    if (bucket.messages.length <= keepPerChannel) return;
    bucket.messages.sort((a, b) => a.time.getTime() - b.time.getTime());
    droppedOverCap += bucket.messages.length - keepPerChannel;
    bucket.messages = bucket.messages.slice(-keepPerChannel);
  };

  for (const channelExport of channelExports) {
    if (!guild && isRecord(channelExport.guild)) {
      const name = asString(channelExport.guild.name).trim();
      if (name) guild = name;
    }

    const target = normalizeChannelTarget(readChannelName(channelExport));
    const channelId = readChannelId(channelExport, target);
    const messages = Array.isArray(channelExport.messages) ? channelExport.messages : [];

    let bucket = byTarget.get(target);
    if (!bucket) {
      bucket = { target, messages: [], refIndex: new Map(), emittedIds: new Set(), seq: 0 };
      byTarget.set(target, bucket);
    }

    for (const rawMessage of messages) {
      if (!isRecord(rawMessage)) {
        skipped += 1;
        continue;
      }

      const discordType = asString(rawMessage.type) || 'Default';
      const isChat = CHAT_TYPES.has(discordType);
      if (!isChat && !includeSystem) {
        skipped += 1;
        continue;
      }

      const time = new Date(asString(rawMessage.timestamp));
      if (Number.isNaN(time.getTime())) {
        skipped += 1;
        continue;
      }

      const text = composeText(asString(rawMessage.content), rawMessage.attachments);
      if (!text) {
        skipped += 1;
        continue;
      }

      const discordId = asString(rawMessage.id).trim();
      const from = authorName(rawMessage.author);

      // Record this id BEFORE the cutoff check so later replies to an
      // out-of-window parent still resolve their quote.
      if (discordId && bucket.refIndex.size < MAX_REF_ENTRIES) {
        bucket.refIndex.set(discordId, { from, text });
      }

      if (cutoff !== null && time.getTime() < cutoff) {
        skipped += 1;
        continue;
      }

      const message: ChatMessage = {
        id: uniqueId(bucket, channelId, discordId),
        time,
        from,
        text,
        type: (isChat ? 'msg' : 'system') as MessageType,
        target,
      };

      if (asString(rawMessage.timestampEdited)) message.edited = true;

      const reactions = mapReactions(rawMessage.reactions);
      if (reactions) message.reactions = reactions;

      const reference = isRecord(rawMessage.reference) ? rawMessage.reference : null;
      const refId = reference ? asString(reference.messageId).trim() : '';
      if (refId) {
        const referenced = bucket.refIndex.get(refId);
        if (referenced) {
          message.replyTo = {
            id: `discord:${channelId || 'ch'}:${refId}`,
            from: referenced.from,
            text: referenced.text.slice(0, 300),
          };
        }
      }

      bucket.messages.push(message);
      if (bucket.messages.length >= compactAt) compact(bucket);
    }
  }

  const targets: VaultExportTarget[] = [];
  let oldest: number | null = null;
  let newest: number | null = null;
  for (const bucket of byTarget.values()) {
    compact(bucket);
    bucket.messages.sort((a, b) => a.time.getTime() - b.time.getTime());
    if (bucket.messages.length === 0) continue;
    for (const m of bucket.messages) {
      const t = m.time.getTime();
      if (oldest === null || t < oldest) oldest = t;
      if (newest === null || t > newest) newest = t;
    }
    targets.push({ target: bucket.target, messages: bucket.messages });
  }

  const messageCount = targets.reduce((sum, t) => sum + t.messages.length, 0);

  const snapshot: VaultExportSnapshot = {
    kind: 'onyx-vault',
    version: 1,
    exportedAt: new Date().toISOString(),
    targets,
  };

  return {
    snapshot,
    summary: {
      guild,
      channels: targets.length,
      messages: messageCount,
      skipped,
      droppedOverCap,
      oldest: oldest !== null ? new Date(oldest).toISOString() : null,
      newest: newest !== null ? new Date(newest).toISOString() : null,
    },
  };
}
