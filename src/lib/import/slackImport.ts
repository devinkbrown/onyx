// SPDX-License-Identifier: AGPL-3.0-or-later
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
import { isPreviewableUrl } from '@/lib/preview/linkPreview';
import type { VaultExportSnapshot, VaultExportTarget } from '@/lib/vault/historyVault';
import {
  MAX_EXPORT_RAW_MESSAGES,
  MAX_EXPORT_TARGETS,
  MAX_EXPORT_TOTAL_RAW_MESSAGES,
  MAX_VAULT_MESSAGE_TEXT_LENGTH,
  MAX_VAULT_REACTIONS,
  MAX_VAULT_REACTION_FIELD_LENGTH,
  MAX_VAULT_SENDER_LENGTH,
  MAX_VAULT_TARGET_LENGTH,
  MAX_VAULT_TIMESTAMP_LENGTH,
  VAULT_KEEP,
} from '@/lib/vault/historyVault';

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
const MAX_ATTACHMENTS = 32;
const MAX_ATTACHMENT_URL_LENGTH = 2_048;
const MAX_WORKSPACE_NAME_LENGTH = 256;
const MAX_CHANNEL_ID_LENGTH = 128;
const MAX_SLACK_TIMESTAMP_LENGTH = 64;
const MAX_SLACK_USERS = 4_096;
const MAX_CHANNEL_EXPORT_SCAN = MAX_EXPORT_TARGETS * 4;

/**
 * Cap on the per-target thread-resolution index. Slack exports are usually
 * oldest→newest and thread replies reference an older `thread_ts`, so once a
 * target has this many known timestamps we stop recording. Replies to anything
 * older than the most recent ~MAX_REF_ENTRIES messages simply render without a
 * quote.
 */
const MAX_REF_ENTRIES = MAX_EXPORT_TOTAL_RAW_MESSAGES;

const CHAT_SUBTYPES = new Set(['', 'bot_message', 'file_share', 'thread_broadcast']);

interface SlackChannelExport {
  root: Record<string, unknown>;
  users: SlackUserDirectory;
}

interface SlackUserDirectory {
  shared: ReadonlyMap<string, string>;
  local: ReadonlyMap<string, string>;
}

/** Mutable per-target accumulation state, carried across paginated files. */
interface TargetBucket {
  target: string;
  messages: ChatMessage[];
  /** Slack `ts` → quote snippet, for resolving thread replies across pages. */
  refIndex: Map<string, { id: string; from: string; text: string }>;
  /** Emitted vault ids, to avoid IndexedDB `put` collisions clobbering rows. */
  emittedIds: Set<string>;
  /** Next collision suffix by base id, avoiding quadratic duplicate scans. */
  nextSuffix: Map<string, number>;
  /** Monotonic fallback counter for messages that carry no Slack timestamp. */
  seq: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function boundedString(value: unknown, maxLength: number): string {
  return asString(value).slice(0, maxLength);
}

function boundedWireToken(value: unknown, maxLength: number, fallback = ''): string {
  const token = boundedString(value, maxLength)
    .trim()
    .replace(/[\u0000-\u0020\u007f]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return token || fallback;
}

function boundedDisplayText(value: unknown, maxLength: number): string {
  return boundedString(value, maxLength)
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .trim();
}

function publicHttpUrl(value: unknown): string {
  const raw = boundedString(value, MAX_ATTACHMENT_URL_LENGTH).trim();
  if (!isPreviewableUrl(raw)) return '';
  try {
    return new URL(raw).toString();
  } catch {
    return '';
  }
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
    .slice(0, MAX_VAULT_TARGET_LENGTH * 4)
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_VAULT_TARGET_LENGTH - 1);
  return `#${cleaned || 'imported'}`;
}

function profileDisplayName(profile: unknown): string {
  if (!isRecord(profile)) return '';
  return boundedWireToken(profile.display_name, MAX_VAULT_SENDER_LENGTH)
    || boundedWireToken(profile.real_name, MAX_VAULT_SENDER_LENGTH);
}

function slackUserDisplay(user: Record<string, unknown>): string {
  return (
    profileDisplayName(user.profile) ||
    boundedWireToken(user.name, MAX_VAULT_SENDER_LENGTH) ||
    boundedWireToken(user.real_name, MAX_VAULT_SENDER_LENGTH)
  );
}

function collectUsers(raw: unknown): Map<string, string> {
  const users = new Map<string, string>();
  if (!Array.isArray(raw)) return users;
  for (const entry of raw.slice(0, MAX_SLACK_USERS)) {
    if (!isRecord(entry)) continue;
    const id = boundedWireToken(entry.id, MAX_CHANNEL_ID_LENGTH);
    if (!id) continue;
    const display = slackUserDisplay(entry);
    if (display) users.set(id, display);
  }
  return users;
}

function userDirectory(shared: ReadonlyMap<string, string>, extra: unknown): SlackUserDirectory {
  return { shared, local: collectUsers(extra) };
}

function lookupUser(users: SlackUserDirectory, id: string): string | undefined {
  return users.local.get(id) ?? users.shared.get(id);
}

/** Best-effort display name for a Slack message author. */
function authorName(message: Record<string, unknown>, users: SlackUserDirectory): string {
  const userId = boundedWireToken(message.user, MAX_CHANNEL_ID_LENGTH);
  if (userId) return lookupUser(users, userId) || userId;
  const username = boundedWireToken(message.username, MAX_VAULT_SENDER_LENGTH);
  if (username) return username;
  const botId = boundedWireToken(message.bot_id, MAX_CHANNEL_ID_LENGTH);
  if (botId) return botId;
  return 'unknown';
}

function rewriteMentions(text: string, users: SlackUserDirectory): string {
  return text.replace(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g, (match: string, userId: string): string => {
    const name = lookupUser(users, userId);
    return name ? `@${name}` : match;
  });
}

/** Append file URLs so links stay visible and searchable in the vault. */
function composeText(content: string, files: unknown, users: SlackUserDirectory): string {
  const base = rewriteMentions(content.slice(0, MAX_VAULT_MESSAGE_TEXT_LENGTH), users)
    .slice(0, MAX_VAULT_MESSAGE_TEXT_LENGTH)
    .trim();
  if (!Array.isArray(files) || files.length === 0) return base;
  let text = base;
  for (const file of files.slice(0, MAX_ATTACHMENTS)) {
    if (!isRecord(file)) continue;
    const url = publicHttpUrl(file.permalink) || publicHttpUrl(file.url_private);
    if (!url) continue;
    const next = text ? `${text}\n${url}` : url;
    if (next.length > MAX_VAULT_MESSAGE_TEXT_LENGTH) continue;
    text = next;
  }
  return text;
}

function mapReactions(raw: unknown, users: SlackUserDirectory): MessageReaction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const reactions: MessageReaction[] = [];
  for (const entry of raw.slice(0, MAX_VAULT_REACTIONS)) {
    if (!isRecord(entry)) continue;
    const name = boundedWireToken(entry.name, MAX_VAULT_REACTION_FIELD_LENGTH - 2);
    if (!name) continue;
    const named: string[] = Array.isArray(entry.users)
      ? entry.users
          .slice(0, MAX_REACTION_USERS)
          .map((user) => {
            if (typeof user !== 'string') return '';
            const id = boundedWireToken(user, MAX_CHANNEL_ID_LENGTH);
            return lookupUser(users, id) || id;
          })
          .map((user) => boundedWireToken(user, MAX_VAULT_REACTION_FIELD_LENGTH))
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
  const value = boundedString(raw, MAX_SLACK_TIMESTAMP_LENGTH).trim();
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
  return boundedString(channel.name, MAX_VAULT_TARGET_LENGTH * 4).trim()
    || boundedString(channel.id, MAX_CHANNEL_ID_LENGTH).trim()
    || 'imported';
}

function readChannelId(root: Record<string, unknown>, target: string): string {
  const channel = readChannelObject(root);
  if (!channel) return target;
  return boundedWireToken(channel.id, MAX_CHANNEL_ID_LENGTH)
    || boundedWireToken(channel.name, MAX_CHANNEL_ID_LENGTH)
    || target;
}

function hasChannelMessages(root: Record<string, unknown>): boolean {
  if (!Array.isArray(root.messages)) return false;
  if (isRecord(root.channel)) return true;
  return boundedString(root.name, MAX_VAULT_TARGET_LENGTH).trim().length > 0;
}

function workspaceName(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const direct = boundedDisplayText(raw.workspace, MAX_WORKSPACE_NAME_LENGTH);
  if (direct) return direct;
  const workspace = isRecord(raw.workspace)
    ? boundedDisplayText(raw.workspace.name, MAX_WORKSPACE_NAME_LENGTH)
    : '';
  if (workspace) return workspace;
  const team = isRecord(raw.team)
    ? boundedDisplayText(raw.team.name, MAX_WORKSPACE_NAME_LENGTH)
    : '';
  if (team) return team;
  return null;
}

/** Normalize the accepted top-level shapes into a flat list of channel exports. */
function collectChannelExports(raw: unknown): { exports: SlackChannelExport[]; workspace: string | null } {
  const exports: SlackChannelExport[] = [];
  const topUsers = isRecord(raw) ? collectUsers(raw.users) : new Map<string, string>();
  const workspace = workspaceName(raw);

  const append = (source: readonly unknown[]): void => {
    const scan = Math.min(source.length, MAX_CHANNEL_EXPORT_SCAN);
    for (let index = 0; index < scan && exports.length < MAX_EXPORT_TARGETS; index += 1) {
      const entry = source[index];
      if (isRecord(entry) && hasChannelMessages(entry)) {
        exports.push({ root: entry, users: userDirectory(topUsers, entry.users) });
      }
    }
  };

  if (Array.isArray(raw)) {
    append(raw);
    return { exports, workspace };
  }

  if (!isRecord(raw)) return { exports, workspace };

  if (Array.isArray(raw.exports)) {
    append(raw.exports);
    return { exports, workspace };
  }

  if (Array.isArray(raw.channels)) {
    append(raw.channels);
    return { exports, workspace };
  }

  if (hasChannelMessages(raw)) {
    exports.push({ root: raw, users: { shared: topUsers, local: new Map() } });
  }
  return { exports, workspace };
}

/** Allocate a collision-free vault id within a target. */
function uniqueId(bucket: TargetBucket, channelId: string, slackTs: string): string {
  const base = `slack:${channelId || 'ch'}:${slackTs || `idx${bucket.seq++}`}`;
  if (!bucket.emittedIds.has(base)) {
    bucket.emittedIds.add(base);
    bucket.nextSuffix.set(base, 2);
    return base;
  }
  let n = bucket.nextSuffix.get(base) ?? 2;
  let candidate = `${base}#${n}`;
  while (bucket.emittedIds.has(candidate)) {
    n += 1;
    candidate = `${base}#${n}`;
  }
  bucket.emittedIds.add(candidate);
  bucket.nextSuffix.set(base, n + 1);
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
  let remainingMessageWork = MAX_EXPORT_TOTAL_RAW_MESSAGES;

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
    const rawMessages = Array.isArray(channelExport.root.messages) ? channelExport.root.messages : [];
    const messageWork = Math.min(MAX_EXPORT_RAW_MESSAGES, remainingMessageWork);
    const messages = messageWork > 0 ? rawMessages.slice(-messageWork) : [];
    droppedOverCap += rawMessages.length - messages.length;
    remainingMessageWork -= messages.length;

    let bucket = byTarget.get(target);
    if (!bucket) {
      bucket = {
        target,
        messages: [],
        refIndex: new Map(),
        emittedIds: new Set(),
        nextSuffix: new Map(),
        seq: 0,
      };
      byTarget.set(target, bucket);
    }

    for (const rawMessage of messages) {
      if (!isRecord(rawMessage)) {
        skipped += 1;
        continue;
      }

      const messageType = boundedString(rawMessage.type, 32).trim();
      if (messageType && messageType !== 'message') {
        skipped += 1;
        continue;
      }

      const subtype = boundedString(rawMessage.subtype, 64).trim();
      const isChat = CHAT_SUBTYPES.has(subtype);
      if (!isChat && !includeSystem) {
        skipped += 1;
        continue;
      }

      const slackTs = boundedWireToken(rawMessage.ts, MAX_SLACK_TIMESTAMP_LENGTH);
      const time = parseSlackTime(slackTs);
      if (!time) {
        skipped += 1;
        continue;
      }

      const text = composeText(
        boundedString(rawMessage.text, MAX_VAULT_MESSAGE_TEXT_LENGTH),
        rawMessage.files,
        channelExport.users,
      );
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

      if (
        isRecord(rawMessage.edited)
        && boundedString(rawMessage.edited.ts, MAX_VAULT_TIMESTAMP_LENGTH).trim()
      ) message.edited = true;

      const reactions = mapReactions(rawMessage.reactions, channelExport.users);
      if (reactions) message.reactions = reactions;

      const threadTs = boundedWireToken(rawMessage.thread_ts, MAX_SLACK_TIMESTAMP_LENGTH);
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
