// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * discordPackageImport.ts — import Discord's OFFICIAL self-serve data package
 * (Roadmap v1.0 "Torii"). Unlike {@link parseDiscordExport} (which reads a
 * DiscordChatExporter run and needs that third-party tool), this reads the
 * export EVERY Discord user can request themselves with no tooling:
 * Settings → Privacy & Safety → "Request all of my Data".
 *
 * That package is a folder tree, not one self-describing file:
 *
 *   package/
 *     account/user.json          { "username", "global_name"?, ... }
 *     messages/
 *       index.json               { "<channelId>": "<name or 'Direct Message …'>" }
 *       c<channelId>/            (older packages; newer omit the leading 'c')
 *         channel.json           { "id", "type", "name"?, "guild"?: {"name"} }
 *         messages.json          [ { "ID", "Timestamp", "Contents", "Attachments" } ]
 *         messages.csv           (newer packages — same 4 columns, RFC-4180)
 *
 * A single `messages.json` names no channel and carries no author (the package
 * only contains the requesting user's OWN messages), so we must correlate the
 * sibling `channel.json`/`index.json` for the channel identity and
 * `account/user.json` for the author — which is why this takes the WHOLE file
 * set, keyed by relative path, rather than one blob.
 *
 * Design: this module does NOT re-implement the message transform. It maps each
 * package channel into the DiscordChatExporter shape and delegates to
 * {@link parseDiscordExport}, inheriting its validation, per-channel VAULT_KEEP
 * bounding, dedup (stable `discord:<channelId>:<id>` keys → idempotent vault
 * upsert), and honest summary. Everything runs on-device — no upload, no API.
 */
import { parseDiscordExport, type DiscordImportOptions, type DiscordImportResult } from './discordImport';

/** One file from the selected package folder: its relative path + raw text. */
export interface DiscordPackageFile {
  /** Relative path within the picked folder, e.g. `messages/c100/messages.json`. */
  path: string;
  /** Raw file contents (JSON or CSV text). */
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Case-insensitive test for a file whose path ends with `suffix`. */
function pathEndsWith(path: string, suffix: string): boolean {
  return path.toLowerCase().endsWith(suffix);
}

/** Directory portion of a relative path (`a/b/c.json` → `a/b`), '' if none. */
function dirOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** Last path segment (`a/b/c.json` → `c.json`). */
function baseOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

/**
 * Channel id from a folder segment: Discord names them `c<snowflake>` (older)
 * or bare `<snowflake>` (newer). Returns the digits, or '' if the segment is
 * not a channel directory.
 */
function channelIdFromDir(dir: string): string {
  const seg = baseOf(dir);
  const m = /^c?(\d{5,})$/.exec(seg);
  return m ? m[1]! : '';
}

/**
 * Normalize a Discord package timestamp to an ISO-8601 string the downstream
 * `new Date(...)` parses deterministically. Packages emit either
 * `2021-05-01 12:34:56` (space-separated, implicitly UTC) or a full ISO string
 * with offset; the former is otherwise parsed as machine-LOCAL time, which is
 * non-deterministic, so we pin it to UTC.
 */
function normalizeTimestamp(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (value.includes('T')) return value; // already ISO (with or without offset)
  // Space-separated `YYYY-MM-DD HH:MM:SS[.fff][±HH:MM|Z]`: pin to the stated
  // offset, or UTC when none is given (the offset-less package default).
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})?$/.exec(value);
  return m ? `${m[1]}T${m[2]}${m[3] ?? 'Z'}` : value;
}

/** Split a package `Attachments` value (space-separated URL string, or array). */
function splitAttachments(value: unknown): { url: string }[] {
  const urls: string[] = [];
  if (typeof value === 'string') {
    for (const part of value.split(/\s+/)) {
      const url = part.trim();
      if (url) urls.push(url);
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      const url = isRecord(entry) ? asString(entry.url).trim() : asString(entry).trim();
      if (url) urls.push(url);
    }
  }
  return urls.map((url) => ({ url }));
}

/**
 * Minimal RFC-4180 CSV reader (handles quoted fields, embedded commas/newlines,
 * and doubled `""` escapes) → array of rows of string cells. Used for the
 * `messages.csv` variant of the package. `charAt` keeps every index in-bounds
 * under `noUncheckedIndexedAccess`.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawAny = false;
  const n = text.length;
  for (let i = 0; i < n; i += 1) {
    const c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      sawAny = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
      sawAny = true;
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      sawAny = false;
    } else if (c !== '\r') {
      field += c;
      sawAny = true;
    }
  }
  if (sawAny || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** DiscordChatExporter-shaped message row that {@link parseDiscordExport} reads. */
interface DceRow {
  id: string;
  type: 'Default';
  timestamp: string;
  content: string;
  attachments: { url: string }[];
  author: { name: string };
}

function toDceRow(id: string, timestamp: string, content: string, attachments: unknown, selfName: string): DceRow {
  return {
    id,
    type: 'Default',
    timestamp: normalizeTimestamp(timestamp),
    content,
    attachments: splitAttachments(attachments),
    author: { name: selfName },
  };
}

/** Parse a `messages.json` payload into DCE rows. */
function rowsFromJson(data: unknown, selfName: string): DceRow[] {
  if (!Array.isArray(data)) return [];
  const out: DceRow[] = [];
  for (const entry of data) {
    if (!isRecord(entry)) continue;
    // Package uses capital keys; tolerate lowercase defensively.
    const id = asString(entry.ID) || asString(entry.id);
    const timestamp = asString(entry.Timestamp) || asString(entry.timestamp);
    const content = asString(entry.Contents) || asString(entry.content);
    const attachments = entry.Attachments ?? entry.attachments;
    out.push(toDceRow(id, timestamp, content, attachments, selfName));
  }
  return out;
}

/** Parse a `messages.csv` payload into DCE rows. */
function rowsFromCsv(text: string, selfName: string): DceRow[] {
  const table = parseCsv(text);
  if (table.length < 2) return [];
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const idCol = header.indexOf('id');
  const tsCol = header.indexOf('timestamp');
  const contentCol = header.indexOf('contents');
  const attachCol = header.indexOf('attachments');
  if (idCol < 0 || tsCol < 0) return [];
  const out: DceRow[] = [];
  for (let r = 1; r < table.length; r += 1) {
    const cells = table[r]!;
    const id = (cells[idCol] ?? '').trim();
    const timestamp = (cells[tsCol] ?? '').trim();
    const content = contentCol >= 0 ? (cells[contentCol] ?? '') : '';
    const attachments = attachCol >= 0 ? (cells[attachCol] ?? '') : '';
    out.push(toDceRow(id, timestamp, content, attachments, selfName));
  }
  return out;
}

/** Per-directory accumulation of a channel's package files. */
interface DirEntry {
  channel: Record<string, unknown> | null;
  rows: DceRow[];
}

/** Best-effort author name from `account/user.json`. */
function resolveSelfName(files: readonly DiscordPackageFile[]): string {
  for (const file of files) {
    if (!pathEndsWith(file.path, 'account/user.json')) continue;
    try {
      const data: unknown = JSON.parse(file.text);
      if (isRecord(data)) {
        const name = asString(data.global_name).trim() || asString(data.username).trim();
        if (name) return name;
      }
    } catch {
      /* malformed user.json — fall through to default */
    }
  }
  return 'me';
}

/** Build the channelId → display-name map from any `index.json`. */
function resolveIndexNames(files: readonly DiscordPackageFile[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const file of files) {
    if (baseOf(file.path).toLowerCase() !== 'index.json') continue;
    try {
      const data: unknown = JSON.parse(file.text);
      if (!isRecord(data)) continue;
      for (const [id, value] of Object.entries(data)) {
        if (typeof value === 'string' && value.trim()) names.set(id, value.trim());
      }
    } catch {
      /* not a usable index */
    }
  }
  return names;
}

/**
 * Import an official Discord data package. Pass every file from the picked
 * folder as `{ path, text }`; returns a vault-ready result, or null when the
 * selection contains no recognizable package message file (so the caller can
 * reject it). Only the requesting user's own messages exist in this export —
 * that is a property of Discord's package, surfaced honestly in the summary.
 */
export function parseDiscordPackage(
  files: readonly DiscordPackageFile[],
  options: DiscordImportOptions = {},
): DiscordImportResult | null {
  if (files.length === 0) return null;
  const selfName = resolveSelfName(files);
  const indexNames = resolveIndexNames(files);

  const byDir = new Map<string, DirEntry>();
  const entryFor = (dir: string): DirEntry => {
    let entry = byDir.get(dir);
    if (!entry) {
      entry = { channel: null, rows: [] };
      byDir.set(dir, entry);
    }
    return entry;
  };

  let sawMessages = false;
  for (const file of files) {
    const base = baseOf(file.path).toLowerCase();
    const dir = dirOf(file.path);
    if (base === 'channel.json') {
      try {
        const data: unknown = JSON.parse(file.text);
        if (isRecord(data)) entryFor(dir).channel = data;
      } catch {
        /* skip unreadable channel.json */
      }
    } else if (base === 'messages.json') {
      try {
        const rows = rowsFromJson(JSON.parse(file.text), selfName);
        if (rows.length > 0) {
          entryFor(dir).rows.push(...rows);
          sawMessages = true;
        }
      } catch {
        /* skip unreadable messages.json */
      }
    } else if (base === 'messages.csv') {
      const rows = rowsFromCsv(file.text, selfName);
      if (rows.length > 0) {
        entryFor(dir).rows.push(...rows);
        sawMessages = true;
      }
    }
  }

  if (!sawMessages) return null;

  // Map each channel directory into a DiscordChatExporter-shaped export, then
  // let parseDiscordExport do the real transform (bounding/dedup/summary).
  const exports: Record<string, unknown>[] = [];
  for (const [dir, entry] of byDir) {
    if (entry.rows.length === 0) continue;
    const channel = entry.channel ?? {};
    const id = asString(channel.id).trim() || channelIdFromDir(dir) || dir || 'imported';
    const name = asString(channel.name).trim() || indexNames.get(id) || id;
    const guild = isRecord(channel.guild) ? channel.guild : undefined;
    const channelExport: Record<string, unknown> = {
      channel: { id, name },
      messages: entry.rows,
    };
    if (guild) channelExport.guild = guild;
    exports.push(channelExport);
  }

  if (exports.length === 0) return null;
  return parseDiscordExport(exports, options);
}
