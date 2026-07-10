/**
 * slackImport.ts — sovereign, credential-free Slack workspace export import.
 *
 * A community can download its own Slack workspace export and drop the JSON
 * here. We transform that archive — purely on-device, no Slack API, no token,
 * no upload, no worker that sees the data — into the exact
 * {@link VaultExportSnapshot} shape the local history vault already knows how
 * to merge (`importVault`). The imported history becomes local searchable
 * scrollback that never leaves this device.
 *
 * Design constraints (mirroring historyVault and discordImport):
 *  - NEVER trust the input. Every field is validated/narrowed from `unknown`.
 *  - BOUNDED. A hostile or huge export must not OOM the tab: per-channel
 *    buffers are compacted to the newest `keepPerChannel` mid-scan, and the
 *    thread/reply index is size-capped.
 *  - Pure + synchronous: no IndexedDB, no I/O — the caller feeds the resulting
 *    snapshot to `importVault`. This keeps the transform trivially testable.
 *  - No HTML is produced. `text` stays plain; the message renderer escapes it,
 *    so imported content cannot inject markup.
 */
import type { ChatMessage, MessageReaction, MessageType } from '@/lib/irc/types';
import type { VaultExportSnapshot, VaultExportTarget } from '@/lib/vault/historyVault';
import { VAULT_KEEP } from '@/lib/vault/historyVault';

/** Options controlling how a Slack export is mapped into the vault. */
export interface SlackImportOptions {
  /** Only keep messages newer than this many days (0/undefined = keep all). */
  sinceDays?: number;
  /** Retain at most this many messages per channel (newest kept). */
  keepPerChannel?: number;
  /**
   * Include Slack system events (joins, leaves, bot adds, topic changes).
   * Off by default — those are noise in a searchable archive.
   */
  includeSystem?: boolean;
}

/** Machine-readable summary of a completed transform, for honest UI messaging. */
export interface SlackImportSummary {
  /** Workspace name if the export carried one. */
  workspace: string | null;
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

export interface SlackImportResult {
  snapshot: VaultExportSnapshot;
  summary: SlackImportSummary;
}

/** Upper bound on stored reactor placeholders per reaction (keeps the vault lean). */
const MAX_REACTION_USERS = 99;

/**
 * Cap on the per-target thread-resolution index. Slack exports are usually
 * oldest→newest and thread replies reference an older `thread_ts`, so once a
 * target has this many known timestamps we stop recording. Replies to anything
 * older than the most recent ~MAX_REF_ENTRIES messages simply render without a
 * quote.
 */
const MAX_REF_ENTRIES = 50_000;

const CHAT_SUBTYPES = new Set(['', 'bot_message', 'file_share', 'thread_broadcast']);

interface SlackChannelExport {
  root: Record<string, unknown>;
  users: Map<string, string>;
}

/** Mutable per-target accumulation state, carried across paginated files. */
interface TargetBucket {
  target: string;
  messages: ChatMessage[];
  /** Slack `ts` → quote snippet, for resolving thread replies across pages. */
  refIndex: Map<string, { id: string; from: string; text: string }>;
  /** Emitted vault ids, to avoid IndexedDB `put` collisions clobbering rows. */
  emittedIds: Set<string>;
  /** Monotonic fallback counter for messages that carry no Slack timestamp. */
  seq: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Coerce an option to a finite positive integer, or fall back. */
function finitePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

/**
 * Turn a Slack channel name into a legal, stable Onyx conversation key.
 * Slack channel names are usually lowercase-kebab; we defensively normalize
 * (strip a leading '#', lowercase, collapse whitespace to '-', drop anything
 * that is not `[a-z0-9-_]`) and always return a `#`-prefixed target.
 */
export function normalizeSlackChannelTarget(rawName: string): string {
  const cleaned = rawName
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return `#${cleaned || 'imported'}`;
}

function profileDisplayName(profile: unknown): string {
  if (!isRecord(profile)) return '';
  return asString(profile.display_name).trim() || asString(profile.real_name).trim();
}

function slackUserDisplay(user: Record<string, unknown>): string {
  return (
    profileDisplayName(user.profile) ||
    asString(user.name).trim() ||
    asString(user.real_name).trim()
  );
}

function collectUsers(raw: unknown): Map<string, string> {
  const users = new Map<string, string>();
  if (!Array.isArray(raw)) return users;
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = asString(entry.id).trim();
    if (!id) continue;
    const display = slackUserDisplay(entry);
    if (display) users.set(id, display);
  }
  return users;
}

function mergeUsers(base: Map<string, string>, extra: unknown): Map<string, string> {
  const merged = new Map(base);
  for (const [id, name] of collectUsers(extra)) merged.set(id, name);
  return merged;
}

/** Best-effort display name for a Slack message author. */
function authorName(message: Record<string, unknown>, users: Map<string, string>): string {
  const userId = asString(message.user).trim();
  if (userId) return users.get(userId) || userId;
  const username = asString(message.username).trim();
  if (username) return username;
  const botId = asString(message.bot_id).trim();
  if (botId) return botId;
  return 'unknown';
}

function rewriteMentions(text: string, users: Map<string, string>): string {
  return text.replace(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g, (match: string, userId: string): string => {
    const name = users.get(userId);
    return name ? `@${name}` : match;
  });
}

/** Append file URLs so links stay visible and searchable in the vault. */
function composeText(content: string, files: unknown, users: Map<string, string>): string {
  const base = rewriteMentions(content, users).trim();
  if (!Array.isArray(files) || files.length === 0) return base;
  const urls = files
    .map((file) => {
      if (!isRecord(file)) return '';
      return asString(file.permalink).trim() || asString(file.url_private).trim();
    })
    .filter((url) => url.length > 0);
  if (urls.length === 0) return base;
  return base ? `${base}\n${urls.join('\n')}` : urls.join('\n');
}

function mapReactions(raw: unknown, users: Map<string, string>): MessageReaction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const reactions: MessageReaction[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const name = asString(entry.name).trim();
    if (!name) continue;
    const named: string[] = Array.isArray(entry.users)
      ? entry.users
          .map((user) => {
            if (typeof user !== 'string') return '';
            return users.get(user) || user;
          })
          .filter((user): user is string => user.length > 0)
      : [];
    const count = finitePositiveInt(entry.count, 0);
    const target = Math.min(Math.max(count, named.length), MAX_REACTION_USERS);
    const reactionUsers = named.slice(0, target);
    while (reactionUsers.length < target) reactionUsers.push('');
    if (reactionUsers.length > 0) reactions.push({ emoji: `:${name}:`, users: reactionUsers });
  }
  return reactions.length > 0 ? reactions : undefined;
}

function parseSlackTime(raw: unknown): Date | null {
  const value = asString(raw).trim();
  if (!value) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const time = new Date(seconds * 1000);
  return Number.isNaN(time.getTime()) ? null : time;
}

function readChannelObject(root: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(root.channel) ? root.channel : root;
}

function readChannelName(root: Record<string, unknown>): string {
  const channel = readChannelObject(root);
  if (!channel) return 'imported';
  return asString(channel.name).trim() || asString(channel.id).trim() || 'imported';
}

function readChannelId(root: Record<string, unknown>, target: string): string {
  const channel = readChannelObject(root);
  if (!channel) return target;
  return asString(channel.id).trim() || asString(channel.name).trim() || target;
}

function hasChannelMessages(root: Record<string, unknown>): boolean {
  if (!Array.isArray(root.messages)) return false;
  if (isRecord(root.channel)) return true;
  return typeof root.name === 'string' && root.name.trim().length > 0;
}

function workspaceName(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const direct = asString(raw.workspace).trim();
  if (direct) return direct;
  const workspace = isRecord(raw.workspace) ? asString(raw.workspace.name).trim() : '';
  if (workspace) return workspace;
  const team = isRecord(raw.team) ? asString(raw.team.name).trim() : '';
  if (team) return team;
  return null;
}

/** Normalize the accepted top-level shapes into a flat list of channel exports. */
function collectChannelExports(raw: unknown): { exports: SlackChannelExport[]; workspace: string | null } {
  const exports: SlackChannelExport[] = [];
  const topUsers = isRecord(raw) ? collectUsers(raw.users) : new Map<string, string>();
  const workspace = workspaceName(raw);

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (isRecord(entry) && hasChannelMessages(entry)) {
        exports.push({ root: entry, users: mergeUsers(topUsers, entry.users) });
      }
    }
    return { exports, workspace };
  }

  if (!isRecord(raw)) return { exports, workspace };

  if (Array.isArray(raw.exports)) {
    for (const entry of raw.exports) {
      if (isRecord(entry) && hasChannelMessages(entry)) {
        exports.push({ root: entry, users: mergeUsers(topUsers, entry.users) });
      }
    }
    return { exports, workspace };
  }

  if (Array.isArray(raw.channels)) {
    for (const channel of raw.channels) {
      if (isRecord(channel) && hasChannelMessages(channel)) {
        exports.push({ root: channel, users: mergeUsers(topUsers, channel.users) });
      }
    }
    return { exports, workspace };
  }

  if (hasChannelMessages(raw)) exports.push({ root: raw, users: topUsers });
  return { exports, workspace };
}

/** Allocate a collision-free vault id within a target. */
function uniqueId(bucket: TargetBucket, channelId: string, slackTs: string): string {
  const base = `slack:${channelId || 'ch'}:${slackTs || `idx${bucket.seq++}`}`;
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
 * Transform a Slack workspace export into a vault snapshot.
 *
 * Accepts a single channel bundle, an array of channel bundles, a
 * `{ exports: [...] }` bundle, or a workspace bundle shaped like
 * `{ channels: [{ name, messages }], users }`. Returns null only when the
 * input has no recognizable Slack channel export at all; an export whose
 * messages are all filtered out still returns a valid empty snapshot with an
 * honest summary.
 */
export function parseSlackExport(raw: unknown, options: SlackImportOptions = {}): SlackImportResult | null {
  const collected = collectChannelExports(raw);
  if (collected.exports.length === 0) return null;

  const includeSystem = options.includeSystem === true;
  const keepPerChannel = Math.min(finitePositiveInt(options.keepPerChannel, VAULT_KEEP), VAULT_KEEP);
  const compactAt = keepPerChannel * 2;
  const sinceDays = finitePositiveInt(options.sinceDays, 0);
  const cutoff = sinceDays > 0 ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : null;

  const byTarget = new Map<string, TargetBucket>();
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

  for (const channelExport of collected.exports) {
    const target = normalizeSlackChannelTarget(readChannelName(channelExport.root));
    const channelId = readChannelId(channelExport.root, target);
    const messages = Array.isArray(channelExport.root.messages) ? channelExport.root.messages : [];

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

      if (asString(rawMessage.type).trim() && asString(rawMessage.type).trim() !== 'message') {
        skipped += 1;
        continue;
      }

      const subtype = asString(rawMessage.subtype).trim();
      const isChat = CHAT_SUBTYPES.has(subtype);
      if (!isChat && !includeSystem) {
        skipped += 1;
        continue;
      }

      const slackTs = asString(rawMessage.ts).trim();
      const time = parseSlackTime(slackTs);
      if (!time) {
        skipped += 1;
        continue;
      }

      const text = composeText(asString(rawMessage.text), rawMessage.files, channelExport.users);
      if (!text) {
        skipped += 1;
        continue;
      }

      const from = authorName(rawMessage, channelExport.users);
      const vaultId = uniqueId(bucket, channelId, slackTs);

      // Record this timestamp BEFORE the cutoff check so later replies to an
      // out-of-window parent still resolve their quote.
      if (slackTs && bucket.refIndex.size < MAX_REF_ENTRIES) {
        bucket.refIndex.set(slackTs, { id: vaultId, from, text });
      }

      if (cutoff !== null && time.getTime() < cutoff) {
        skipped += 1;
        continue;
      }

      const message: ChatMessage = {
        id: vaultId,
        time,
        from,
        text,
        type: (isChat ? 'msg' : 'system') as MessageType,
        target,
      };

      if (isRecord(rawMessage.edited) && asString(rawMessage.edited.ts).trim()) message.edited = true;

      const reactions = mapReactions(rawMessage.reactions, channelExport.users);
      if (reactions) message.reactions = reactions;

      const threadTs = asString(rawMessage.thread_ts).trim();
      if (threadTs && threadTs !== slackTs) {
        const referenced = bucket.refIndex.get(threadTs);
        if (referenced) {
          message.replyTo = {
            id: referenced.id,
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
    for (const message of bucket.messages) {
      const time = message.time.getTime();
      if (oldest === null || time < oldest) oldest = time;
      if (newest === null || time > newest) newest = time;
    }
    targets.push({ target: bucket.target, messages: bucket.messages });
  }

  const messageCount = targets.reduce((sum, target) => sum + target.messages.length, 0);

  const snapshot: VaultExportSnapshot = {
    kind: 'onyx-vault',
    version: 1,
    exportedAt: new Date().toISOString(),
    targets,
  };

  return {
    snapshot,
    summary: {
      workspace: collected.workspace,
      channels: targets.length,
      messages: messageCount,
      skipped,
      droppedOverCap,
      oldest: oldest !== null ? new Date(oldest).toISOString() : null,
      newest: newest !== null ? new Date(newest).toISOString() : null,
    },
  };
}
