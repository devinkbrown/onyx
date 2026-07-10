/**
 * ircLogImport.ts — local, credential-free IRC text-log import
 * (Roadmap Track 6: "IRC-log -> vault import").
 *
 * IRC clients have never agreed on one export shape. WeeChat, irssi, mIRC, and
 * hand-copied logs mostly share human-readable timestamp + sender lines, so we
 * parse the common forms directly on-device and transform them into the same
 * {@link VaultExportSnapshot} shape the local history vault already imports.
 *
 * Plain text logs usually do not carry the channel name. The caller must supply
 * it via {@link IrcLogImportOptions.channel}; this importer normalizes it into
 * the vault's lowercase, `#`-prefixed target key.
 *
 * Design constraints (mirroring historyVault and discordImport):
 *  - NEVER trust the input. Every parsed field is checked before a message is
 *    emitted.
 *  - BOUNDED. Huge logs are compacted to the newest `keepPerChannel` messages
 *    during the scan and once at the end.
 *  - Pure + synchronous: no IndexedDB, no I/O. The caller feeds the snapshot to
 *    `importVault`.
 *  - No HTML is produced. Imported text stays plain; rendering escapes it.
 *
 * Date note: full-date lines set the running calendar day. Time-only lines use
 * that day, or `baseDate` when supplied. If neither exists, a synthetic UTC day
 * is used so old logs can still be imported, but callers should prefer passing
 * `baseDate` for time-only logs.
 */
import type { ChatMessage, MessageType } from '@/lib/irc/types';
import type { VaultExportSnapshot, VaultExportTarget } from '@/lib/vault/historyVault';
import { VAULT_KEEP } from '@/lib/vault/historyVault';

/** Options controlling how an IRC text log is mapped into the vault. */
export interface IrcLogImportOptions {
  /** Required channel target because plain IRC logs usually omit it. */
  channel: string;
  /** Calendar day for time-only logs; Date or ISO string. */
  baseDate?: Date | string;
  /** Only keep messages newer than this many days (0/undefined = keep all). */
  sinceDays?: number;
  /** Retain at most this many messages for the channel (newest kept). */
  keepPerChannel?: number;
  /** Include join/part/quit/nick/mode/topic notices. Off by default. */
  includeSystem?: boolean;
}

/** Machine-readable summary of a completed transform, for honest UI messaging. */
export interface IrcLogImportSummary {
  /** Distinct channels that produced at least one message (0 or 1). */
  channels: number;
  /** Messages that made it into the snapshot. */
  messages: number;
  /** Lines skipped as unparseable, empty, filtered, or too old. */
  skipped: number;
  /** Messages dropped purely because the channel exceeded `keepPerChannel`. */
  droppedOverCap: number;
  /** ISO timestamp of the oldest imported message, if any. */
  oldest: string | null;
  /** ISO timestamp of the newest imported message, if any. */
  newest: string | null;
}

export interface IrcLogImportResult {
  snapshot: VaultExportSnapshot;
  summary: IrcLogImportSummary;
}

interface TimeParts {
  hour: number;
  minute: number;
  second: number;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

interface ParsedLine {
  date: DateParts | null;
  time: TimeParts | null;
  body: string;
  separatedFrom?: string;
}

interface ParsedBody {
  from: string;
  text: string;
  type: MessageType;
  system: boolean;
}

interface TargetBucket {
  target: string;
  messages: ChatMessage[];
  emittedIds: Set<string>;
  seq: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SYNTHETIC_START_DAY = Date.UTC(2000, 0, 1);

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
 * Turn a caller-supplied IRC channel into a legal, stable vault target.
 * The import flow requires a non-empty source channel before calling this.
 */
export function normalizeIrcChannelTarget(rawName: string): string {
  const cleaned = rawName
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned ? `#${cleaned}` : '';
}

function stripNickPrefix(raw: string): string {
  return raw.trim().replace(/^[~&@%+]+/, '').trim() || 'unknown';
}

function datePartsFromIsoDay(raw: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function timeParts(hourRaw: string, minuteRaw: string, secondRaw: string | undefined): TimeParts | null {
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = secondRaw ? Number(secondRaw) : 0;
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }
  return { hour, minute, second };
}

function baseDayFromOption(value: unknown): number | null {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dayFromParts(parts: DateParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function partsToMs(dayStart: number, parts: TimeParts): number {
  return dayStart + ((parts.hour * 60 + parts.minute) * 60 + parts.second) * 1000;
}

function parseLine(line: string): ParsedLine | null {
  const trimmed = line.trimEnd();
  if (!trimmed.trim()) return null;

  const tabbed = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\t([^\t]+)\t(.*)$/.exec(trimmed);
  if (tabbed) {
    const date = datePartsFromIsoDay(tabbed[1] ?? '');
    const time = timeParts(tabbed[2] ?? '', tabbed[3] ?? '', tabbed[4]);
    const separatedFrom = asString(tabbed[5]).trim();
    const body = asString(tabbed[6]);
    if (date && time && separatedFrom && body.trim()) return { date, time, body, separatedFrom };
    return null;
  }

  const pipe = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s{2,}(.+?)\s+\|\s(.*)$/.exec(trimmed);
  if (pipe) {
    const date = datePartsFromIsoDay(pipe[1] ?? '');
    const time = timeParts(pipe[2] ?? '', pipe[3] ?? '', pipe[4]);
    const separatedFrom = asString(pipe[5]).trim();
    const body = asString(pipe[6]);
    if (date && time && separatedFrom && body.trim()) return { date, time, body, separatedFrom };
    return null;
  }

  const bracketed = /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s+(.+)$/.exec(trimmed);
  if (bracketed) {
    const time = timeParts(bracketed[1] ?? '', bracketed[2] ?? '', bracketed[3]);
    const body = asString(bracketed[4]);
    if (time && body.trim()) return { date: null, time, body };
    return null;
  }

  const timed = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(.+)$/.exec(trimmed);
  if (timed) {
    const time = timeParts(timed[1] ?? '', timed[2] ?? '', timed[3]);
    const body = asString(timed[4]);
    if (time && body.trim()) return { date: null, time, body };
    return null;
  }

  if (/^\*\s+\S+\s+.+$/.test(trimmed)) {
    return { date: null, time: null, body: trimmed };
  }

  return null;
}

function stripCtcpAction(raw: string): string | null {
  const match = /^\x01ACTION\s+([\s\S]*?)\x01?$/.exec(raw.trim());
  if (!match) return null;
  return asString(match[1]).trim();
}

function parseSystemNotice(body: string): ParsedBody | null {
  const text = body.replace(/^-!-\s*/, '').trim();
  if (!text) return null;

  let match = /^([^\s]+).*?\bhas joined\b/i.exec(text);
  if (match) return { from: stripNickPrefix(match[1] ?? ''), text, type: 'join', system: true };

  match = /^([^\s]+).*?\bhas (?:left|parted)\b/i.exec(text);
  if (match) return { from: stripNickPrefix(match[1] ?? ''), text, type: 'part', system: true };

  match = /^([^\s]+).*?\bhas quit\b/i.exec(text);
  if (match) return { from: stripNickPrefix(match[1] ?? ''), text, type: 'quit', system: true };

  match = /^([^\s]+)\s+is now known as\s+(.+)$/i.exec(text);
  if (match) return { from: stripNickPrefix(match[1] ?? ''), text, type: 'nick', system: true };

  if (/^(?:mode\/|mode\s|.*\bsets mode\b)/i.test(text)) {
    const by = /\bby\s+([^\s]+)$/i.exec(text);
    return { from: stripNickPrefix(by?.[1] ?? 'system'), text, type: 'mode', system: true };
  }

  if (/^(?:topic\b|topic for\b|.*\bchanged the topic\b)/i.test(text)) {
    return { from: 'system', text, type: 'topic', system: true };
  }

  return null;
}

function parseSeparatedBody(fromRaw: string, textRaw: string): ParsedBody | null {
  const marker = fromRaw.trim();
  const text = textRaw.trim();
  if (!marker || !text) return null;

  if (marker === '*' || marker.toLowerCase() === 'action') {
    const action = parseBody(`* ${text}`);
    return action?.type === 'action' ? action : null;
  }

  if (marker === '-!-' || marker === '--') return parseSystemNotice(text);

  const bracketed = /^<([^>]+)>$/.exec(marker);
  const from = stripNickPrefix(bracketed?.[1] ?? marker);
  const action = stripCtcpAction(text);
  if (action !== null) {
    if (!action) return null;
    return { from, text: action, type: 'action', system: false };
  }
  return { from, text, type: 'msg', system: false };
}

function parseBody(body: string): ParsedBody | null {
  const chat = /^<([^>]+)>\s*([\s\S]*)$/.exec(body);
  if (chat) {
    const text = asString(chat[2]).trim();
    if (!text) return null;
    const action = stripCtcpAction(text);
    if (action !== null) {
      if (!action) return null;
      return { from: stripNickPrefix(chat[1] ?? ''), text: action, type: 'action', system: false };
    }
    return { from: stripNickPrefix(chat[1] ?? ''), text, type: 'msg', system: false };
  }

  const action = /^\*\s+([^\s]+)\s+([\s\S]+)$/.exec(body);
  if (action) {
    const text = asString(action[2]).trim();
    if (!text) return null;
    return { from: stripNickPrefix(action[1] ?? ''), text, type: 'action', system: false };
  }

  if (/^-!-\s+/.test(body)) return parseSystemNotice(body);

  return null;
}

function parseLineBody(line: ParsedLine): ParsedBody | null {
  if (line.separatedFrom !== undefined) {
    return parseSeparatedBody(line.separatedFrom, line.body);
  }
  return parseBody(line.body);
}

function uniqueId(bucket: TargetBucket, time: Date, lineNumber: number): string {
  const base = `irclog:${bucket.target}:${time.getTime()}:${lineNumber}`;
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

function timestampForLine(
  parsed: ParsedLine,
  state: { runningDay: number | null; lastTimeOfDay: number | null; lastTimestamp: number | null; baseDay: number | null },
): Date {
  if (parsed.date) {
    state.runningDay = dayFromParts(parsed.date);
    state.lastTimeOfDay = null;
  }

  if (parsed.time) {
    if (state.runningDay === null) state.runningDay = state.baseDay ?? SYNTHETIC_START_DAY;
    const timeOfDay = ((parsed.time.hour * 60 + parsed.time.minute) * 60 + parsed.time.second) * 1000;
    if (!parsed.date && state.lastTimeOfDay !== null && timeOfDay < state.lastTimeOfDay) {
      state.runningDay += DAY_MS;
    }
    state.lastTimeOfDay = timeOfDay;
    const next = partsToMs(state.runningDay, parsed.time);
    state.lastTimestamp = next;
    return new Date(next);
  }

  if (state.lastTimestamp !== null) {
    const next = state.lastTimestamp + 1;
    state.lastTimestamp = next;
    return new Date(next);
  }

  if (state.runningDay === null) state.runningDay = state.baseDay ?? SYNTHETIC_START_DAY;
  state.lastTimestamp = state.runningDay;
  return new Date(state.runningDay);
}

/**
 * Transform a raw WeeChat/irssi/mIRC-style IRC text log into a vault snapshot.
 *
 * Returns null only when the input is empty/whitespace or no usable channel was
 * supplied. A non-empty log whose lines all fail parsing still returns a valid
 * empty snapshot with `summary.skipped` explaining what happened.
 */
export function parseIrcLog(raw: string, options: IrcLogImportOptions): IrcLogImportResult | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  if (!isRecord(options)) return null;

  const target = normalizeIrcChannelTarget(options.channel);
  if (!target) return null;

  const includeSystem = options.includeSystem === true;
  const keepPerChannel = Math.min(finitePositiveInt(options.keepPerChannel, VAULT_KEEP), VAULT_KEEP);
  const compactAt = keepPerChannel * 2;
  const sinceDays = finitePositiveInt(options.sinceDays, 0);
  const cutoff = sinceDays > 0 ? Date.now() - sinceDays * DAY_MS : null;
  const bucket: TargetBucket = { target, messages: [], emittedIds: new Set(), seq: 0 };
  const dateState = {
    runningDay: null as number | null,
    lastTimeOfDay: null as number | null,
    lastTimestamp: null as number | null,
    baseDay: baseDayFromOption(options.baseDate),
  };

  let skipped = 0;
  let droppedOverCap = 0;

  const compact = (): void => {
    if (bucket.messages.length <= keepPerChannel) return;
    bucket.messages.sort((a, b) => a.time.getTime() - b.time.getTime());
    droppedOverCap += bucket.messages.length - keepPerChannel;
    bucket.messages = bucket.messages.slice(-keepPerChannel);
  };

  const lines = raw.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const parsed = parseLine(line);
    if (!parsed) {
      skipped += 1;
      continue;
    }

    const body = parseLineBody(parsed);
    if (!body) {
      skipped += 1;
      continue;
    }

    if (body.system && !includeSystem) {
      skipped += 1;
      continue;
    }

    const time = timestampForLine(parsed, dateState);
    if (Number.isNaN(time.getTime())) {
      skipped += 1;
      continue;
    }

    if (cutoff !== null && time.getTime() < cutoff) {
      skipped += 1;
      continue;
    }

    bucket.seq += 1;
    bucket.messages.push({
      id: uniqueId(bucket, time, index + 1),
      time,
      from: body.from,
      text: body.text,
      type: body.type,
      target,
    });

    if (bucket.messages.length >= compactAt) compact();
  }

  compact();
  bucket.messages.sort((a, b) => a.time.getTime() - b.time.getTime());

  let oldest: number | null = null;
  let newest: number | null = null;
  for (const message of bucket.messages) {
    const time = message.time.getTime();
    if (oldest === null || time < oldest) oldest = time;
    if (newest === null || time > newest) newest = time;
  }

  const targets: VaultExportTarget[] = bucket.messages.length > 0 ? [{ target, messages: bucket.messages }] : [];
  const snapshot: VaultExportSnapshot = {
    kind: 'onyx-vault',
    version: 1,
    exportedAt: new Date().toISOString(),
    targets,
  };

  return {
    snapshot,
    summary: {
      channels: targets.length,
      messages: bucket.messages.length,
      skipped,
      droppedOverCap,
      oldest: oldest !== null ? new Date(oldest).toISOString() : null,
      newest: newest !== null ? new Date(newest).toISOString() : null,
    },
  };
}
