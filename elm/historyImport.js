/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* historyImport.js — v3/gap-import: third-party history import (roadmap 4.5).

   Credential-free, on-device import of history exported from other
   chat tools into this browser's vault, plus the portable Onyx vault
   file (.json / .json.gz):

     discord          DiscordChatExporter JSON (one or more files)
     discord-package  Discord's own data package (unzipped folder)
     slack            Slack workspace export (unzipped folder; the
                      bundle shapes the SolidJS importer read also pass)
     irc              plain-text client logs: WeeChat, irssi, mIRC,
                      ZNC, HexChat, ISO-stamped lines
     portable         an Onyx vault export (`onyx-vault` v1)

   Shape of the work:

     1. `pick` validates the selection against byte/count limits
        BEFORE any file is read (oracle `importFileLimits.ts`).
     2. A Web Worker (built from this file's own parser factory) reads,
        decodes and parses — JSON.parse of a 64 MiB export and a 128 MiB
        log scan never touch the UI thread. Progress is posted per file /
        per 1 MiB chunk; Cancel terminates the worker. When no Worker can
        start, the same job runs on the main thread, yielding between
        files and chunks.
     3. Every parser is bounded: ≤4096 conversations, the newest 1600
        rows per conversation, ≤16384 rows and ≤24 MiB of message text
        per import, ≤64 KiB per message. Hostile shapes skip, never
        throw. No HTML is produced: text stays plain (the renderer
        escapes it); C0 controls and bidi overrides are stripped;
        E2EE-envelope-looking bodies from other apps are refused (they
        could never open, and would pin a DM's privacy proof).
     4. Back on the main thread every staged row is checked against the
        vault — same id, or same (time, sender, text) fingerprint — so
        the review can say how many are already here.
     5. Elm validates the staged payload again (strictly), shows the
        review, and on confirm writes through the normal `vaultPut`
        port. The batch ledger (ids + fingerprints) lands in the vault
        meta store so the import can be removed later.

   Fixes over the SolidJS importers: overlapping paginated exports no
   longer duplicate rows (same id = same message), real Slack exports
   (per-day files under one folder per channel) import, Slack link /
   channel / entity markup is decoded, irssi / mIRC / HexChat day
   markers date time-only lines (no more year-2000 fallbacks), mIRC /
   ZNC `* Joins:` lines are system lines rather than actions, WeeChat
   `-->` / `<--` markers are recognised, naive log times are local
   time, and a log's room is chosen at review instead of up front.

   The parser factory and the job runner are self-contained (no free
   variables) because their source is stringified into the worker. */
(function (global) {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Pure parsers (also the worker's code).                              */
  /* ------------------------------------------------------------------ */

  function createHistoryParsers() {
    var MAX_CONVERSATIONS = 4096;
    var MAX_PER_CONVERSATION = 1600;
    var MAX_TOTAL_ROWS = 16384;
    var MAX_TEXT = 64 * 1024;
    var MAX_TEXT_BUDGET = 24 * 1024 * 1024;
    var MAX_HELD_CHARS = 64 * 1024 * 1024;
    var MAX_SENDER = 64;
    var MAX_SOURCE_LABEL = 160;
    var MAX_CHANNEL_NAME = 50;
    var MAX_NICK = 30;
    var MAX_REPLY_TEXT = 300;
    var MAX_REF_ENTRIES = 16384;
    var MAX_ATTACHMENTS = 16;
    var MAX_URL = 2048;
    var MAX_IRC_LINE = MAX_TEXT + 1024;
    var ENVELOPE_PREFIXES = ["ONYXDM1 ", "ONYXDMN1 ", "ONYXROOM1 ", "TSUMUGI1 "];
    var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

    function isRecord(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
    function str(v, max) { return typeof v === "string" ? (v.length > max ? v.slice(0, max) : v) : ""; }

    /* FNV-1a 32-bit over UTF-16 units → 8 hex chars. */
    function fnv(text) {
      var h = 0x811c9dc5;
      for (var i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return ("0000000" + h.toString(16)).slice(-8);
    }

    /* Content fingerprint: the same message re-written under another id
       (a re-import, or a buffer re-persist) still matches. */
    function fingerprint(time, from, text) {
      return fnv(String(Math.floor(Number(time) || 0)) + "\u0000" + String(from).toLowerCase() + "\u0000" + String(text));
    }

    /* A sender / id token: the vault's bounded-wire-token rule (no
       whitespace, no controls); runs collapse to '-'. */
    function wireToken(v, max) {
      var s = str(v, max * 4).trim()
        .replace(/[\u0000-\u0020\u007f\u0085\u00a0\u1680\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]+/g, "-")
        .replace(/^-+|-+$/g, "");
      return s.length > max ? s.slice(0, max) : s;
    }

    function displayLabel(v, max) {
      return str(v, max * 4).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
    }

    /* Message text: CRLF → LF, C0 controls (but tab / newline) and bidi
       overrides dropped, trimmed, length-capped. */
    function cleanText(v) {
      var s = typeof v === "string" ? v : "";
      if (s.length > MAX_TEXT * 2) s = s.slice(0, MAX_TEXT * 2);
      s = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim();
      return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT).trim() : s;
    }

    function isEnvelope(text) {
      for (var i = 0; i < ENVELOPE_PREFIXES.length; i++) {
        if (text.indexOf(ENVELOPE_PREFIXES[i]) === 0) return true;
      }
      return false;
    }

    /* Public http(s) link without credentials, else ''. */
    function httpUrl(v) {
      var raw = str(v, MAX_URL + 1).trim();
      if (!raw || raw.length > MAX_URL || !/^https?:\/\/[^\s/?#]+/i.test(raw)) return "";
      if (/^https?:\/\/[^/?#]*@/i.test(raw)) return "";
      if (/[\u0000-\u0020\u007f]/.test(raw)) return "";
      return raw;
    }

    /* `#kebab-name` ≤ 50 chars, or '' when nothing usable is left. */
    function channelSuggestion(raw) {
      var cleaned = str(raw, 1024).trim().replace(/^[#&]+/, "").toLowerCase()
        .replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
      if (!/[a-z0-9]/.test(cleaned)) return "";
      return "#" + cleaned.slice(0, MAX_CHANNEL_NAME - 1).replace(/-+$/, "");
    }

    /* An IRC-shaped nick (≤ 30), or '' — the review then asks. */
    function nickSuggestion(raw) {
      var cleaned = str(raw, 512).trim().replace(/#\d{1,4}$/, "").replace(/\s+/g, "_")
        .replace(/[^A-Za-z0-9_\-[\]\\`^{}|]/g, "").replace(/^[-0-9]+/, "");
      return cleaned.slice(0, MAX_NICK);
    }

    function accumulator(kind) {
      return {
        kind: kind, label: "", files: 0, rejectedFiles: 0, skipped: 0, envelopes: 0, systemSkipped: 0,
        duplicates: 0, droppedOverCap: 0, overBudget: 0, datesEstimated: false,
        convs: new Map(), held: 0
      };
    }

    /* One conversation bucket; null once the conversation cap is spent. */
    function conversation(acc, key, source, suggested, dm) {
      var c = acc.convs.get(key);
      if (c) return c;
      if (acc.convs.size >= MAX_CONVERSATIONS) return null;
      c = { key: key, source: displayLabel(source, MAX_SOURCE_LABEL) || key, suggested: suggested, dm: !!dm, rows: new Map(), refs: new Map() };
      acc.convs.set(key, c);
      return c;
    }

    function byTime(a, b) {
      if (a.time !== b.time) return a.time - b.time;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }

    function compactConversation(acc, c) {
      if (c.rows.size <= MAX_PER_CONVERSATION) return;
      var list = Array.from(c.rows.values()).sort(byTime);
      var drop = list.length - MAX_PER_CONVERSATION;
      acc.droppedOverCap += drop;
      for (var i = 0; i < drop; i++) {
        acc.held -= list[i].text.length;
        c.rows.delete(list[i].id);
      }
    }

    /* Newest MAX_TOTAL_ROWS rows across every conversation, then the
       newest rows that fit the text budget. */
    function compactAll(acc) {
      acc.convs.forEach(function (c) { compactConversation(acc, c); });
      var all = [];
      acc.convs.forEach(function (c) { c.rows.forEach(function (row) { all.push({ c: c, row: row }); }); });
      if (all.length === 0) return;
      all.sort(function (a, b) { return byTime(b.row, a.row); });
      var budget = MAX_TEXT_BUDGET;
      for (var i = 0; i < all.length; i++) {
        var row = all[i].row;
        if (i >= MAX_TOTAL_ROWS) {
          acc.droppedOverCap += 1;
        } else if (row.text.length > budget) {
          acc.overBudget += 1;
        } else {
          budget -= row.text.length;
          continue;
        }
        acc.held -= row.text.length;
        all[i].c.rows.delete(row.id);
      }
    }

    /* Admit one shaped row. The same id twice inside an import is the
       same message seen twice (overlapping paginated exports): the
       later copy wins and counts as a duplicate. */
    function admit(acc, c, row) {
      if (!row.text) { acc.skipped += 1; return; }
      if (isEnvelope(row.text)) { acc.envelopes += 1; return; }
      if (!isFinite(row.time) || row.time <= 0) { acc.skipped += 1; return; }
      var prior = c.rows.get(row.id);
      if (prior) {
        acc.duplicates += 1;
        acc.held -= prior.text.length;
      }
      c.rows.set(row.id, row);
      acc.held += row.text.length;
      if (c.rows.size >= MAX_PER_CONVERSATION * 2) compactConversation(acc, c);
      if (acc.held > MAX_HELD_CHARS) compactAll(acc);
    }

    function remember(c, ref, entry) {
      if (ref && c.refs.size < MAX_REF_ENTRIES) c.refs.set(ref, entry);
    }

    function withAttachments(text, attachments, pick) {
      if (!Array.isArray(attachments)) return text;
      var out = text;
      for (var i = 0; i < attachments.length && i < MAX_ATTACHMENTS; i++) {
        var url = httpUrl(pick(attachments[i]));
        if (!url) continue;
        var next = out ? out + "\n" + url : url;
        if (next.length > MAX_TEXT) break;
        out = next;
      }
      return out;
    }

    /* ---------------- DiscordChatExporter JSON ---------------- */

    var DISCORD_CHAT = { Default: 1, Reply: 1 };

    function discordAuthor(author) {
      if (!isRecord(author)) return "unknown";
      return wireToken(author.nickname, MAX_SENDER) || wireToken(author.name, MAX_SENDER) || "unknown";
    }

    function discordExports(raw) {
      var source = Array.isArray(raw) ? raw : (isRecord(raw) && Array.isArray(raw.exports) ? raw.exports : null);
      if (source) return source.slice(0, MAX_CONVERSATIONS * 4).filter(function (e) { return isRecord(e) && Array.isArray(e.messages); });
      if (isRecord(raw) && Array.isArray(raw.messages) && (isRecord(raw.channel) || isRecord(raw.guild))) return [raw];
      return [];
    }

    /* False when the value holds no DiscordChatExporter export. */
    function addDiscordExport(acc, raw) {
      var exports = discordExports(raw);
      if (exports.length === 0) return false;
      exports.forEach(function (ex) {
        var guild = isRecord(ex.guild) ? displayLabel(ex.guild.name, 80) : "";
        if (!acc.label && guild && guild !== "Direct Messages") acc.label = guild;
        var channel = isRecord(ex.channel) ? ex.channel : {};
        var name = displayLabel(channel.name, 100) || wireToken(channel.id, 64) || "imported";
        var channelId = wireToken(channel.id, 64) || channelSuggestion(name).slice(1) || "ch";
        var dm = /^Direct/i.test(str(channel.type, 40)) || guild === "Direct Messages";
        var suggested = dm ? (nickSuggestion(name) || channelSuggestion("dm-" + name)) : channelSuggestion(name);
        var source = dm ? "DM with " + name : (guild ? guild + " · #" + name : "#" + name);
        var c = conversation(acc, "discord:" + channelId, source, suggested, dm);
        if (!c) { acc.skipped += ex.messages.length; return; }
        var seq = 0;
        ex.messages.forEach(function (m) {
          if (!isRecord(m)) { acc.skipped += 1; return; }
          var type = str(m.type, 40) || "Default";
          if (!DISCORD_CHAT[type]) { acc.systemSkipped += 1; return; }
          var time = Date.parse(str(m.timestamp, 64));
          var text = withAttachments(cleanText(m.content), m.attachments, function (a) { return isRecord(a) ? a.url : ""; });
          var msgId = wireToken(m.id, 64);
          var from = discordAuthor(m.author);
          var id = "discord:" + channelId + ":" + (msgId || "idx" + (seq++));
          remember(c, msgId, { id: id, from: from, text: text });
          var row = { id: id, from: from, text: text, type: "msg", time: time, replyTo: null };
          var ref = isRecord(m.reference) ? wireToken(m.reference.messageId, 64) : "";
          var parent = ref ? c.refs.get(ref) : null;
          if (parent && parent.text) row.replyTo = { id: parent.id, from: parent.from, text: parent.text.slice(0, MAX_REPLY_TEXT) };
          admit(acc, c, row);
        });
      });
      return true;
    }

    /* ---------------- Discord data package ---------------- */

    function leafName(path) { var i = path.lastIndexOf("/"); return i < 0 ? path : path.slice(i + 1); }
    function baseName(path) { return leafName(path).toLowerCase(); }
    function dirName(path) { var i = path.lastIndexOf("/"); return i < 0 ? "" : path.slice(0, i); }

    function isPackageFile(name) {
      var n = String(name).toLowerCase();
      return n === "channel.json" || n === "messages.json" || n === "messages.csv" || n === "index.json" || n === "user.json";
    }

    function isPackageMeta(path) {
      var b = baseName(String(path));
      return b === "user.json" || b === "index.json" || b === "channel.json";
    }

    /* `2021-05-01 12:34:56[.fff][±HH:MM]` (implicitly UTC) or ISO. */
    function packageTime(raw) {
      var v = str(raw, 64).trim();
      var m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})?$/.exec(v);
      return m ? Date.parse(m[1] + "T" + m[2] + (m[3] || "Z")) : Date.parse(v);
    }

    /* RFC-4180 reader, row-bounded (keeps the newest rows). */
    function parseCsv(text, maxRows) {
      var rows = [], row = [], field = "", quoted = false, header = null;
      function endField() { if (row.length < 16) row.push(field.length > MAX_TEXT ? field.slice(0, MAX_TEXT) : field); field = ""; }
      function endRow() {
        endField();
        if (header === null) header = row;
        else if (row.length > 1 || row[0] !== "") { rows.push(row); if (rows.length >= maxRows * 2) rows = rows.slice(-maxRows); }
        row = [];
      }
      for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        if (quoted) {
          if (ch === '"') { if (text.charAt(i + 1) === '"') { if (field.length < MAX_TEXT) field += '"'; i++; } else quoted = false; }
          else if (field.length < MAX_TEXT) field += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ",") endField();
        else if (ch === "\n") endRow();
        else if (ch !== "\r" && field.length < MAX_TEXT) field += ch;
      }
      if (field.length > 0 || row.length > 0) endRow();
      return { header: header || [], rows: rows.slice(-maxRows) };
    }

    /* Package metadata first (user / index / channel files), then one
       messages file at a time. */
    function discordPackage(acc) {
      var self = "me";
      var names = new Map();
      var channels = new Map();
      var sawMessages = false;
      return {
        isMeta: isPackageMeta,
        meta: function (path, text) {
          var base = baseName(path);
          var data;
          try { data = JSON.parse(text); } catch (err) { acc.rejectedFiles += 1; return; }
          if (!isRecord(data)) return;
          if (base === "user.json") {
            if (/(^|\/)account\/user\.json$/i.test(path)) {
              self = wireToken(data.global_name, MAX_SENDER) || wireToken(data.username, MAX_SENDER) || self;
            }
          } else if (base === "index.json") {
            Object.keys(data).slice(0, MAX_CONVERSATIONS).forEach(function (id) {
              if (typeof data[id] === "string" && id.length <= 64) names.set(id, displayLabel(data[id], 120));
            });
          } else if (base === "channel.json") {
            channels.set(dirName(path), data);
          }
        },
        file: function (path, text) {
          var dir = dirName(path);
          var meta = channels.get(dir) || {};
          var seg = baseName(dir);
          var segId = (/^c?(\d{5,})$/.exec(seg) || [])[1] || "";
          var channelId = wireToken(typeof meta.id === "number" ? String(meta.id) : meta.id, 64) || segId || wireToken(seg, 64) || "ch";
          var indexName = names.get(channelId) || "";
          var dmMatch = /^Direct Message with (.+)$/i.exec(indexName);
          var type = typeof meta.type === "number" ? meta.type : (meta.type === "DM" || meta.type === "GROUP_DM" ? 1 : -1);
          var dm = type === 1 || type === 3 || !!dmMatch;
          var name = displayLabel(meta.name, 100) || (dmMatch ? dmMatch[1] : indexName) || channelId;
          var guild = isRecord(meta.guild) ? displayLabel(meta.guild.name, 80) : "";
          if (!acc.label && guild) acc.label = guild;
          var peer = (dmMatch ? dmMatch[1] : name).replace(/#\d{1,4}$/, "");
          var suggested = dm ? (nickSuggestion(peer) || channelSuggestion("dm-" + peer)) : channelSuggestion(name);
          var source = dm ? "DM with " + peer : (guild ? guild + " · #" + name : "#" + name);
          var rows = [];
          if (baseName(path) === "messages.csv") {
            var table = parseCsv(text, MAX_PER_CONVERSATION);
            var head = table.header.map(function (h) { return String(h).trim().toLowerCase(); });
            var ci = head.indexOf("id"), ti = head.indexOf("timestamp"), xi = head.indexOf("contents"), ai = head.indexOf("attachments");
            if (ci < 0 || ti < 0) { acc.rejectedFiles += 1; return; }
            table.rows.forEach(function (cells) {
              rows.push({ id: cells[ci], ts: cells[ti], content: xi >= 0 ? cells[xi] : "", attachments: ai >= 0 ? cells[ai] : "" });
            });
          } else {
            var data;
            // Package ids are bare 18-digit numbers: quote them before
            // JSON.parse rounds neighbours onto one id.
            try { data = JSON.parse(text.replace(/("(?:ID|id)"\s*:\s*)(\d{16,})/g, '$1"$2"')); } catch (err) { acc.rejectedFiles += 1; return; }
            if (!Array.isArray(data)) { acc.rejectedFiles += 1; return; }
            data.slice(-MAX_PER_CONVERSATION).forEach(function (e) {
              if (!isRecord(e)) { acc.skipped += 1; return; }
              rows.push({
                id: e.ID !== undefined ? e.ID : e.id,
                ts: e.Timestamp !== undefined ? e.Timestamp : e.timestamp,
                content: e.Contents !== undefined ? e.Contents : e.content,
                attachments: e.Attachments !== undefined ? e.Attachments : e.attachments
              });
            });
          }
          if (rows.length === 0) return;
          var c = conversation(acc, "discord:" + channelId, source, suggested, dm);
          if (!c) { acc.skipped += rows.length; return; }
          sawMessages = true;
          var seq = 0;
          rows.forEach(function (r) {
            var urls = typeof r.attachments === "string" ? r.attachments.split(/\s+/) : (Array.isArray(r.attachments) ? r.attachments : []);
            var body = withAttachments(cleanText(r.content), urls, function (a) { return isRecord(a) ? a.url : a; });
            var msgId = wireToken(typeof r.id === "number" ? String(r.id) : r.id, 64);
            admit(acc, c, {
              id: "discord:" + channelId + ":" + (msgId || "idx" + (seq++)),
              from: self, text: body, type: "msg", time: packageTime(r.ts), replyTo: null
            });
          });
        },
        done: function () { return sawMessages; }
      };
    }

    /* ---------------- Slack workspace export ---------------- */

    var SLACK_CHAT = { "": "msg", bot_message: "msg", file_share: "msg", thread_broadcast: "msg", me_message: "action" };

    function isSlackMeta(path) {
      var b = baseName(String(path));
      return b === "users.json" || b === "org_users.json" || b === "channels.json" || b === "groups.json" || b === "dms.json" || b === "mpims.json";
    }

    function slackExport(acc) {
      var users = new Map();
      var channelIds = new Map();
      var sawMessages = false;
      function userName(id) { return users.get(id) || ""; }
      function addUsers(list) {
        if (!Array.isArray(list)) return;
        list.slice(0, 16384).forEach(function (u) {
          if (!isRecord(u)) return;
          var id = wireToken(u.id, 64);
          var profile = isRecord(u.profile) ? u.profile : {};
          var name = wireToken(profile.display_name, MAX_SENDER) || wireToken(u.name, MAX_SENDER)
            || wireToken(profile.real_name, MAX_SENDER) || wireToken(u.real_name, MAX_SENDER);
          if (id && name) users.set(id, name);
        });
      }
      function addChannels(list, dm) {
        if (!Array.isArray(list)) return;
        list.slice(0, MAX_CONVERSATIONS * 2).forEach(function (ch) {
          if (!isRecord(ch)) return;
          var id = wireToken(ch.id, 64);
          var name = displayLabel(ch.name, 100);
          var members = Array.isArray(ch.members) ? ch.members.slice(0, 16).map(function (m) { return wireToken(m, 64); }) : [];
          var entry = { id: id || wireToken(name, 64), name: name, dm: dm, members: members };
          if (id) channelIds.set(id, entry);
          if (name) channelIds.set(name, entry);
        });
      }
      function rewrite(text) {
        return text
          .replace(/<@([A-Z0-9]+)(?:\|([^>]*))?>/g, function (all, id, label) { var n = userName(id) || wireToken(label, MAX_SENDER); return n ? "@" + n : all; })
          .replace(/<#([A-Z0-9]+)(?:\|([^>]*))?>/g, function (all, id, label) { var e = channelIds.get(id); var n = (e && e.name) || label; return n ? "#" + n : all; })
          .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, "@$1")
          .replace(/<(https?:\/\/[^|>\s]+)\|([^>]*)>/g, function (all, url, label) { return label && label !== url ? label + " (" + url + ")" : url; })
          .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
          .replace(/<mailto:[^|>]+\|([^>]*)>/g, "$1")
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      }
      function messagesInto(c, channelId, list) {
        list.forEach(function (m) {
          if (!isRecord(m)) { acc.skipped += 1; return; }
          var type = str(m.type, 32).trim();
          if (type && type !== "message") { acc.skipped += 1; return; }
          var sub = str(m.subtype, 64).trim();
          if (!Object.prototype.hasOwnProperty.call(SLACK_CHAT, sub)) { acc.systemSkipped += 1; return; }
          var ts = wireToken(m.ts, 40);
          var seconds = Number(ts);
          var time = ts && isFinite(seconds) && seconds > 0 ? Math.floor(seconds * 1000) : NaN;
          var profile = isRecord(m.user_profile) ? m.user_profile : {};
          var userId = wireToken(m.user, 64);
          var from = (userId && userName(userId)) || wireToken(profile.display_name, MAX_SENDER) || wireToken(profile.real_name, MAX_SENDER)
            || wireToken(m.username, MAX_SENDER) || userId || wireToken(m.bot_id, MAX_SENDER) || "unknown";
          var body = withAttachments(cleanText(rewrite(str(m.text, MAX_TEXT * 2))), m.files, function (f) { return isRecord(f) ? (f.permalink || f.url_private) : ""; });
          var id = "slack:" + channelId + ":" + (ts || "idx" + c.rows.size);
          remember(c, ts, { id: id, from: from, text: body });
          var row = { id: id, from: from, text: body, type: SLACK_CHAT[sub], time: time, replyTo: null };
          var thread = wireToken(m.thread_ts, 40);
          var parent = thread && thread !== ts ? c.refs.get(thread) : null;
          if (parent && parent.text) row.replyTo = { id: parent.id, from: parent.from, text: parent.text.slice(0, MAX_REPLY_TEXT) };
          admit(acc, c, row);
        });
      }
      function conversationFor(name) {
        var entry = channelIds.get(name) || null;
        var id = (entry && entry.id) || wireToken(name, 64) || "ch";
        var dm = !!(entry && entry.dm);
        var label = (entry && entry.name) || name || id;
        var peers = entry && entry.members ? entry.members.map(userName).filter(Boolean) : [];
        var suggested = dm ? channelSuggestion("dm-" + (peers.join("-") || label)) : channelSuggestion(label);
        var source = dm ? "DM · " + (peers.join(", ") || label) : "#" + label;
        return conversation(acc, "slack:" + id, source, suggested, dm);
      }
      /* Oracle bundle shapes: a channel bundle, an array of them,
         `{ exports: [...] }`, or `{ channels: [{ name, messages }], users }`. */
      function bundle(raw) {
        if (isRecord(raw)) {
          addUsers(raw.users);
          var ws = isRecord(raw.workspace) ? raw.workspace.name : (isRecord(raw.team) ? raw.team.name : raw.workspace);
          if (!acc.label && typeof ws === "string") acc.label = displayLabel(ws, 80);
        }
        var list = Array.isArray(raw) ? raw
          : (isRecord(raw) && Array.isArray(raw.exports) ? raw.exports
            : (isRecord(raw) && Array.isArray(raw.channels) ? raw.channels : (isRecord(raw) ? [raw] : [])));
        var any = false;
        list.slice(0, MAX_CONVERSATIONS * 4).forEach(function (entry) {
          if (!isRecord(entry) || !Array.isArray(entry.messages)) return;
          addUsers(entry.users);
          var ch = isRecord(entry.channel) ? entry.channel : entry;
          var name = displayLabel(ch.name, 100);
          var id = wireToken(ch.id, 64) || wireToken(name, 64);
          if (!id) return;
          if (!channelIds.has(id)) channelIds.set(id, { id: id, name: name || id, dm: false, members: [] });
          var c = conversationFor(id);
          if (!c) { acc.skipped += entry.messages.length; return; }
          any = true;
          sawMessages = true;
          messagesInto(c, c.key.slice(6), entry.messages.slice(-MAX_PER_CONVERSATION * 4));
        });
        return any;
      }
      return {
        isMeta: isSlackMeta,
        meta: function (path, text) {
          var data;
          try { data = JSON.parse(text); } catch (err) { acc.rejectedFiles += 1; return; }
          var base = baseName(path);
          if (base === "users.json" || base === "org_users.json") addUsers(data);
          else if (base === "channels.json" || base === "groups.json") addChannels(data, false);
          else if (base === "dms.json" || base === "mpims.json") addChannels(data, true);
        },
        file: function (path, text) {
          var data;
          try { data = JSON.parse(text); } catch (err) { acc.rejectedFiles += 1; return; }
          var dayFile = Array.isArray(data) && /^\d{4}-\d{2}-\d{2}\.json$/.test(baseName(path))
            && data.some(function (m) { return isRecord(m) && (m.ts !== undefined || m.type === "message"); });
          if (dayFile) {
            // Real export layout: <channel>/<YYYY-MM-DD>.json, a bare array.
            var dir = dirName(path);
            var c = conversationFor(dir ? leafName(dir) : "slack-import");
            if (!c) { acc.skipped += data.length; return; }
            sawMessages = true;
            messagesInto(c, c.key.slice(6), data.slice(-MAX_PER_CONVERSATION * 4));
            return;
          }
          if (!bundle(data)) acc.rejectedFiles += 1;
        },
        done: function () { return sawMessages; }
      };
    }

    /* ---------------- Plain-text IRC logs ---------------- */

    function validDay(y, mo, d) {
      if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1970 && y <= 9999)) return null;
      var probe = new Date(y, mo - 1, d);
      return probe.getFullYear() === y && probe.getMonth() === mo - 1 && probe.getDate() === d ? { y: y, mo: mo, d: d } : null;
    }

    /* "Tue Jan 02 10:00:00 2024", "Wed Jan 03 2024", "Tue Jan  2 10:00:00 2024". */
    function dayFromWords(text) {
      var m = /\b([A-Za-z]{3})[a-z]*\s+(\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s+(\d{4})\b/.exec(text);
      if (!m) return null;
      return validDay(Number(m[3]), MONTHS[m[1].toLowerCase()] || 0, Number(m[2]));
    }

    function dayFromName(name) {
      var m = /(?:^|[^0-9])(\d{4})-?(\d{2})-?(\d{2})(?:[^0-9]|$)/.exec(name);
      return m ? validDay(Number(m[1]), Number(m[2]), Number(m[3])) : null;
    }

    function clock(h, mi, s) {
      var hh = Number(h), mm = Number(mi), ss = s ? Number(s) : 0;
      return hh <= 23 && mm <= 59 && ss <= 59 ? { h: hh, mi: mm, s: ss } : null;
    }

    function stripNick(raw) {
      return wireToken(String(raw).trim().replace(/^[~&@%+]+/, ""), MAX_SENDER) || "unknown";
    }

    function ctcpAction(text) {
      var m = /^\u0001ACTION\s+([\s\S]*?)\u0001?$/.exec(text);
      return m ? m[1].trim() : null;
    }

    var SYSTEM_LINE = /^(?:-!-|-->|<--|--|\*\*\*|=!=)(?:\s|$)|^\*\s+(?:Joins|Parts|Quits|Topic is|Set by|Now talking in|Disconnected|Attempting|Retrieving|Rejoined)\b|^\*\s+\S+\s+(?:is now known as|sets mode|changes topic to|has (?:joined|left|quit)|was kicked)\b/;
    var SYSTEM_MARKER = /^(?:-!-|-->|<--|--|=!=|\*\*\*)$/;

    /* → { from, text, type } | "system" | null. */
    function lineBody(marker, rest) {
      if (marker !== null) {
        var mk = marker.trim();
        var text = rest.trim();
        if (!mk || !text) return null;
        if (mk === "*" || mk.toLowerCase() === "action") return lineBody(null, "* " + text);
        if (SYSTEM_MARKER.test(mk)) return "system";
        var who = /^<([^>]+)>$/.exec(mk);
        var act = ctcpAction(text);
        if (act !== null) return act ? { from: stripNick(who ? who[1] : mk), text: act, type: "action" } : null;
        return { from: stripNick(who ? who[1] : mk), text: text, type: "msg" };
      }
      var chat = /^<([^>]+)>\s?([\s\S]*)$/.exec(rest);
      if (chat) {
        var t = chat[2].trim();
        if (!t) return null;
        var a = ctcpAction(t);
        if (a !== null) return a ? { from: stripNick(chat[1]), text: a, type: "action" } : null;
        return { from: stripNick(chat[1]), text: t, type: "msg" };
      }
      if (SYSTEM_LINE.test(rest)) return "system";
      var star = /^\*\s+([^\s]+)\s+([\s\S]+)$/.exec(rest);
      if (star) return { from: stripNick(star[1]), text: star[2].trim(), type: "action" };
      return null;
    }

    /* Incremental scanner over one log file: `push(text)` decoded chunks,
       then `end()`. Holds at most one bounded line. Logs that name no
       room share one conversation (per-day ZNC files of one channel);
       the review asks where it goes. */
    function ircLog(acc, file) {
      var fileName = String(file.name || "");
      var tag = fnv(fileName + "|" + String(file.size || 0));
      var named = /#[^\s.,]+/.exec(fileName);
      var suggested = named ? channelSuggestion(named[0]) : "";
      var key = "irc:" + (suggested || "logs");
      var source = suggested || "Logs without a room name";
      var c = null;
      var nameDay = dayFromName(fileName);
      var fileDay = null;
      if (!nameDay && isFinite(file.lastModified) && file.lastModified > 0) {
        var lm = new Date(file.lastModified);
        fileDay = { y: lm.getFullYear(), mo: lm.getMonth() + 1, d: lm.getDate() };
      }
      var day = nameDay;
      var lastTod = null;
      var carry = "";
      var overlong = false;
      var lineNo = 0;
      var joinHint = "";

      function advanceDay() {
        var next = new Date(day.y, day.mo - 1, day.d + 1);
        day = { y: next.getFullYear(), mo: next.getMonth() + 1, d: next.getDate() };
      }

      function scan(raw) {
        lineNo += 1;
        var line = raw.replace(/\r$/, "");
        if (!line.trim()) return;
        var marker = /^(?:---\s+(?:Log opened|Day changed)|Session (?:Start|Time):|\*\*\*\*\s+BEGIN LOGGING AT)\s+(.*)$/i.exec(line);
        if (marker) { var dm = dayFromWords(marker[1]); if (dm) { day = dm; lastTod = null; } return; }
        if (/^(?:---\s+Log closed|Session Close:|\*\*\*\*\s+ENDING LOGGING)/i.test(line)) return;
        var date = null, zone = "", t = null, sep = null, rest = null, m;
        if ((m = /^\[?(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?\]?\t([^\t]*)\t([\s\S]*)$/.exec(line))) {
          date = validDay(+m[1], +m[2], +m[3]); t = clock(m[4], m[5], m[6]); zone = m[7] || ""; sep = m[8]; rest = m[9];
          if (!date) { acc.skipped += 1; return; }
        } else if ((m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s{2,}(.+?)\s+\|\s([\s\S]*)$/.exec(line))) {
          date = validDay(+m[1], +m[2], +m[3]); t = clock(m[4], m[5], m[6]); sep = m[7]; rest = m[8];
          if (!date) { acc.skipped += 1; return; }
        } else if ((m = /^\[?(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?\]?\s+([\s\S]+)$/.exec(line))) {
          date = validDay(+m[1], +m[2], +m[3]); t = clock(m[4], m[5], m[6]); zone = m[7] || ""; rest = m[8];
          if (!date) { acc.skipped += 1; return; }
        } else if ((m = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+([^\t]*)\t([\s\S]*)$/.exec(line))) {
          // HexChat "Jan 02 10:00:00 <nick>\tmessage": the year comes from
          // the BEGIN LOGGING line (else the file date).
          var base = day || fileDay;
          if (!base) acc.datesEstimated = true;
          date = validDay(base ? base.y : 2000, MONTHS[m[1].toLowerCase()] || 0, +m[2]);
          t = clock(m[3], m[4], m[5]); sep = m[6]; rest = m[7];
          if (!date) { acc.skipped += 1; return; }
        } else if ((m = /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s+([\s\S]+)$/.exec(line))) {
          t = clock(m[1], m[2], m[3]); rest = m[4];
        } else if ((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+([\s\S]+)$/.exec(line))) {
          t = clock(m[1], m[2], m[3]); rest = m[4];
        } else {
          acc.skipped += 1;
          return;
        }
        if (!t) { acc.skipped += 1; return; }
        var body = sep !== null ? lineBody(sep, rest) : lineBody(null, rest.replace(/^\s+/, ""));
        if (body === "system") {
          if (!joinHint) { var j = /has joined (#[^\s,]+)/.exec(rest); if (j) joinHint = j[1]; }
          acc.systemSkipped += 1;
          return;
        }
        if (!body) { acc.skipped += 1; return; }
        var tod = (t.h * 60 + t.mi) * 60 + t.s;
        if (date) {
          day = date;
        } else if (!day) {
          day = fileDay || { y: 2000, mo: 1, d: 1 };
          acc.datesEstimated = true;
        } else if (lastTod !== null && tod < lastTod) {
          advanceDay();
        }
        lastTod = tod;
        var time = zone
          ? Date.parse(String(day.y) + "-" + ("0" + day.mo).slice(-2) + "-" + ("0" + day.d).slice(-2) + "T" + ("0" + t.h).slice(-2) + ":" + ("0" + t.mi).slice(-2) + ":" + ("0" + t.s).slice(-2) + (zone === "Z" ? "Z" : zone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")))
          : new Date(day.y, day.mo - 1, day.d, t.h, t.mi, t.s).getTime();
        if (!c) c = conversation(acc, key, source, suggested, false);
        if (!c) { acc.skipped += 1; return; }
        admit(acc, c, { id: "irclog:" + tag + ":" + lineNo, from: body.from, text: cleanText(body.text), type: body.type, time: time, replyTo: null });
      }

      return {
        push: function (text) {
          var offset = 0;
          while (offset < text.length) {
            var nl = text.indexOf("\n", offset);
            var end = nl < 0 ? text.length : nl;
            if (!overlong) {
              if (carry.length + (end - offset) > MAX_IRC_LINE) { carry = ""; overlong = true; }
              else carry += text.slice(offset, end);
            }
            if (nl < 0) break;
            if (overlong) { acc.skipped += 1; lineNo += 1; overlong = false; }
            else scan(carry);
            carry = "";
            offset = nl + 1;
          }
        },
        end: function () {
          if (overlong) { acc.skipped += 1; overlong = false; }
          else if (carry) scan(carry);
          carry = "";
          if (c && !c.suggested && joinHint) c.suggested = channelSuggestion(joinHint);
          return c !== null;
        }
      };
    }

    /* ---------------- Portable Onyx vault ---------------- */

    function addPortable(acc, raw) {
      if (!isRecord(raw) || raw.kind !== "onyx-vault" || raw.version !== 1 || !Array.isArray(raw.targets)) return false;
      acc.label = "Onyx vault" + (typeof raw.exportedAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw.exportedAt) ? " · " + raw.exportedAt.slice(0, 10) : "");
      raw.targets.slice(0, MAX_CONVERSATIONS).forEach(function (entry) {
        if (!isRecord(entry) || !Array.isArray(entry.messages) || typeof entry.target !== "string") { acc.skipped += 1; return; }
        var target = entry.target.trim().toLowerCase();
        if (!target || target.length > 512 || /[\s\u0000]/.test(target)) { acc.skipped += entry.messages.length; return; }
        var c = conversation(acc, "vault:" + target, target, target, !/^[#&]/.test(target));
        if (!c) { acc.skipped += entry.messages.length; return; }
        entry.messages.slice(-MAX_PER_CONVERSATION).forEach(function (m) {
          if (!isRecord(m) || typeof m.id !== "string" || typeof m.text !== "string" || typeof m.from !== "string" || m.text.length > MAX_TEXT) { acc.skipped += 1; return; }
          var time = typeof m.time === "number" ? m.time
            : (typeof m.time === "string" && m.time.length <= 64 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(m.time) ? Date.parse(m.time) : NaN);
          if (!m.text || !isFinite(time) || time <= 0) { acc.skipped += 1; return; }
          // Portable rows are this device's own history: envelope text
          // stays (its own encrypted DMs); only the bounds apply.
          var prior = c.rows.get(m.id);
          if (prior) { acc.duplicates += 1; acc.held -= prior.text.length; }
          c.rows.set(m.id, { id: m.id, from: m.from, text: m.text, type: typeof m.type === "string" ? m.type : "", time: time, replyTo: null });
          acc.held += m.text.length;
        });
        compactConversation(acc, c);
        if (acc.held > MAX_HELD_CHARS) compactAll(acc);
      });
      return true;
    }

    /* ---------------- Finish ---------------- */

    function finish(acc) {
      compactAll(acc);
      var seen = new Set();
      var oldest = null, newest = null, total = 0;
      var conversations = [];
      acc.convs.forEach(function (c) {
        var rows = Array.from(c.rows.values()).sort(byTime).filter(function (row) {
          if (seen.has(row.id)) { acc.duplicates += 1; return false; }
          seen.add(row.id);
          return true;
        });
        if (rows.length === 0) return;
        rows.forEach(function (row) {
          row.time = Math.floor(row.time);
          row.print = fingerprint(row.time, row.from, row.text);
          if (oldest === null || row.time < oldest) oldest = row.time;
          if (newest === null || row.time > newest) newest = row.time;
        });
        total += rows.length;
        conversations.push({ key: c.key, source: c.source, suggested: c.suggested, dm: c.dm, rows: rows });
      });
      return {
        kind: acc.kind, label: acc.label, files: acc.files, rejectedFiles: acc.rejectedFiles,
        skipped: acc.skipped + acc.envelopes, systemSkipped: acc.systemSkipped, duplicatesInFile: acc.duplicates,
        droppedOverCap: acc.droppedOverCap, overBudget: acc.overBudget, datesEstimated: acc.datesEstimated,
        messages: total, oldest: oldest, newest: newest, conversations: conversations
      };
    }

    return {
      limits: { conversations: MAX_CONVERSATIONS, perConversation: MAX_PER_CONVERSATION, totalRows: MAX_TOTAL_ROWS, text: MAX_TEXT, textBudget: MAX_TEXT_BUDGET },
      fnv: fnv,
      fingerprint: fingerprint,
      channelSuggestion: channelSuggestion,
      nickSuggestion: nickSuggestion,
      accumulator: accumulator,
      addDiscordExport: addDiscordExport,
      discordPackage: discordPackage,
      isPackageFile: isPackageFile,
      slackExport: slackExport,
      isSlackMeta: isSlackMeta,
      ircLog: ircLog,
      addPortable: addPortable,
      parseCsv: parseCsv,
      finish: finish
    };
  }

  /* ------------------------------------------------------------------ */
  /* One import job (worker or main thread).                             */
  /* ------------------------------------------------------------------ */

  /* job = { kind, files: [File], paths: [string], yieldEvery? }. Posts
     { type: "progress", phase, done, total } as work advances and
     resolves the finished result. Shared by the worker and the
     main-thread fallback: only arguments and platform globals. */
  async function runImportJob(P, job, post) {
    var GZIP_MAX = 64 * 1024 * 1024;
    var CHUNK = 1024 * 1024;
    var acc = P.accumulator(job.kind);
    var files = job.files || [];
    var paths = job.paths || [];
    var totalBytes = 0;
    var i;
    for (i = 0; i < files.length; i++) totalBytes += files[i].size || 0;
    var doneBytes = 0;
    function progress(phase, extra) {
      post({ type: "progress", phase: phase, done: Math.min(doneBytes + (extra || 0), totalBytes), total: totalBytes });
    }
    async function pause() { if (job.yieldEvery) await job.yieldEvery(); }
    async function readText(file) {
      var head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
      if (head.length === 2 && head[0] === 0x1f && head[1] === 0x8b) {
        if (typeof DecompressionStream === "undefined") throw new Error("gzip");
        var reader = file.stream().pipeThrough(new DecompressionStream("gzip")).getReader();
        var decoder = new TextDecoder();
        var parts = [];
        var size = 0;
        for (;;) {
          var step = await reader.read();
          if (step.done) break;
          size += step.value.byteLength;
          if (size > GZIP_MAX) {
            try { reader.cancel(); } catch (err) { /* closed */ }
            throw new Error("gzip-too-large");
          }
          parts.push(decoder.decode(step.value, { stream: true }));
        }
        parts.push(decoder.decode());
        return parts.join("");
      }
      return await file.text();
    }
    function nameOf(index) { return String(paths[index] || (files[index] && files[index].name) || ""); }

    progress("reading");
    if (job.kind === "irc") {
      for (i = 0; i < files.length; i++) {
        var file = files[i];
        var scanner = P.ircLog(acc, { name: nameOf(i).split("/").pop(), size: file.size, lastModified: file.lastModified });
        var decoder2 = new TextDecoder();
        for (var off = 0; off < file.size; off += CHUNK) {
          var end = Math.min(file.size, off + CHUNK);
          var bytes = await file.slice(off, end).arrayBuffer();
          scanner.push(decoder2.decode(bytes, { stream: end < file.size }));
          progress("parsing", end);
          await pause();
        }
        scanner.push(decoder2.decode());
        if (scanner.end()) acc.files += 1; else acc.rejectedFiles += 1;
        doneBytes += file.size;
      }
    } else if (job.kind === "discord-package" || job.kind === "slack") {
      var sink = job.kind === "slack" ? P.slackExport(acc) : P.discordPackage(acc);
      var order = [];
      for (i = 0; i < files.length; i++) order.push(i);
      order.sort(function (a, b) { return (sink.isMeta(nameOf(a)) ? 0 : 1) - (sink.isMeta(nameOf(b)) ? 0 : 1) || a - b; });
      for (var k = 0; k < order.length; k++) {
        var idx = order[k];
        var path = nameOf(idx);
        var text = await files[idx].text();
        if (sink.isMeta(path)) sink.meta(path, text);
        else { sink.file(path, text); acc.files += 1; }
        doneBytes += files[idx].size || 0;
        progress("parsing");
        await pause();
      }
      if (!sink.done()) acc.rejectedFiles = Math.max(acc.rejectedFiles, 1);
    } else {
      for (i = 0; i < files.length; i++) {
        var raw;
        try {
          raw = JSON.parse(await readText(files[i]));
        } catch (err) {
          if (err && /gzip/.test(err.message || "")) throw err;
          raw = undefined;
        }
        var ok = raw !== undefined && (job.kind === "portable" ? P.addPortable(acc, raw) : P.addDiscordExport(acc, raw));
        if (ok) acc.files += 1; else acc.rejectedFiles += 1;
        doneBytes += files[i].size || 0;
        progress("parsing");
        await pause();
      }
    }
    progress("finishing");
    return P.finish(acc);
  }

  function workerMain() {
    var P = createHistoryParsers();
    self.onmessage = function (event) {
      var job = event.data || {};
      runImportJob(P, job, function (m) { self.postMessage(m); }).then(
        function (result) { self.postMessage({ type: "done", result: result }); },
        function (err) { self.postMessage({ type: "error", reason: String((err && err.message) || "read") }); }
      );
    };
  }

  var parsers = createHistoryParsers();

  /* ------------------------------------------------------------------ */
  /* Selection limits (oracle importFileLimits.ts).                      */
  /* ------------------------------------------------------------------ */

  var MIB = 1024 * 1024;
  var LIMITS = {
    discord: { maxFiles: 256, maxFileBytes: 64 * MIB, maxAggregateBytes: 192 * MIB, accept: "application/json,.json", folder: false, multiple: true },
    "discord-package": { maxFiles: 4096, maxFileBytes: 128 * MIB, maxAggregateBytes: 256 * MIB, accept: "", folder: true, multiple: true },
    slack: { maxFiles: 8192, maxFileBytes: 64 * MIB, maxAggregateBytes: 256 * MIB, accept: "", folder: true, multiple: true },
    irc: { maxFiles: 400, maxFileBytes: 128 * MIB, maxAggregateBytes: 256 * MIB, accept: "text/plain,.log,.txt,.weechatlog", folder: false, multiple: true },
    portable: { maxFiles: 1, maxFileBytes: 64 * MIB, maxAggregateBytes: 64 * MIB, accept: "application/json,.json,.gz,application/gzip", folder: false, multiple: false }
  };

  function mib(bytes) { return Math.floor(bytes / MIB) + " MiB"; }

  /* Which picked files a source reads at all: unrelated package files
     (avatars, attachments, activity logs) are never read or charged. */
  function relevant(kind, path) {
    var base = String(path).split("/").pop().toLowerCase();
    if (kind === "discord-package") return parsers.isPackageFile(base);
    if (kind === "slack") return /\.json$/.test(base) && !/^(integration_logs|canvases|huddle_transcripts|apps|file_conversations)\.json$/.test(base);
    return true;
  }

  /* Validate a selection before any read: null, or the copy to show. */
  function checkSelection(kind, entries) {
    var lim = LIMITS[kind];
    if (!lim) return "That import source is not available.";
    if (entries.length === 0) {
      return kind === "discord-package" ? "No Discord data package found in that folder. Unzip the package Discord emails you and choose the folder that contains \"messages\"."
        : kind === "slack" ? "No Slack export found in that folder. Unzip the workspace export and choose the folder with users.json and one folder per channel."
          : "No files were chosen.";
    }
    if (entries.length > lim.maxFiles) return "Choose no more than " + lim.maxFiles + " files at once. Split this import into smaller batches.";
    var total = 0;
    for (var i = 0; i < entries.length; i++) {
      var size = isFinite(entries[i].size) && entries[i].size >= 0 ? entries[i].size : lim.maxFileBytes + 1;
      if (size > lim.maxFileBytes) return String(entries[i].name).slice(0, 120) + " is larger than the " + mib(lim.maxFileBytes) + " per-file limit. Split it, then try again.";
      total += size;
      if (total > lim.maxAggregateBytes) return "Those files exceed the " + mib(lim.maxAggregateBytes) + " total import limit. Choose a smaller batch.";
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Vault side: existing-row index, batch ledger, removal.              */
  /* ------------------------------------------------------------------ */

  var STORE = "messages";
  var META = "vault_meta";
  var LEDGER_PREFIX = "import-batch:";

  /* v3/gap-import — the ONE place a ledger key is minted (owner scoping
     lands here when the vault gains owner keys). */
  function ledgerKey(batchId) { return LEDGER_PREFIX + String(batchId); }

  function rowPrint(row) {
    return typeof row.body === "string" ? parsers.fingerprint(typeof row.at === "number" ? row.at : 0, String(row.from || ""), row.body) : "";
  }

  /* Every stored row's id and content fingerprint. */
  function existingIndex(db, done) {
    var ids = new Set();
    var prints = new Set();
    if (!db) { done(ids, prints); return; }
    try {
      var cursor = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      cursor.onsuccess = function () {
        var c = cursor.result;
        if (!c) { done(ids, prints); return; }
        var row = c.value || {};
        if (typeof row.id === "string") ids.add(row.id);
        var p = rowPrint(row);
        if (p) prints.add(p);
        c.continue();
      };
      cursor.onerror = function () { done(ids, prints); };
    } catch (err) { done(ids, prints); }
  }

  function markDuplicates(result, ids, prints) {
    var dups = 0;
    result.conversations.forEach(function (conv) {
      conv.rows.forEach(function (row) {
        row.dup = ids.has(row.id) || prints.has(row.print);
        if (row.dup) dups += 1;
      });
    });
    result.alreadyInVault = dups;
    return result;
  }

  function ledgerPut(db, record, done) {
    if (!db) { done(false); return; }
    try {
      var tx = db.transaction(META, "readwrite");
      tx.objectStore(META).put(record);
      tx.oncomplete = function () { done(true); };
      tx.onerror = function () { done(false); };
      tx.onabort = function () { done(false); };
    } catch (err) { done(false); }
  }

  function ledgerList(db, done) {
    if (!db) { done([]); return; }
    try {
      var out = [];
      var range = IDBKeyRange.bound(LEDGER_PREFIX, LEDGER_PREFIX + "\uffff");
      var cursor = db.transaction(META, "readonly").objectStore(META).openCursor(range);
      cursor.onsuccess = function () {
        var c = cursor.result;
        if (!c) {
          out.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
          done(out.slice(0, 200));
          return;
        }
        var v = c.value || {};
        if (v.batch && typeof v.batch === "object") out.push(v.batch);
        c.continue();
      };
      cursor.onerror = function () { done(out); };
    } catch (err) { done([]); }
  }

  /* Delete a batch's rows — by id, or by fingerprint inside the batch's
     conversations (catching copies re-persisted under other ids) — and
     its ledger entry, in one transaction; reports after commit. */
  function removeBatch(db, batchId, done) {
    if (!db) { done(0, false, [], []); return; }
    var removed = 0;
    var targets = [];
    var removedPrints = [];
    try {
      var tx = db.transaction([STORE, META], "readwrite");
      var meta = tx.objectStore(META);
      var store = tx.objectStore(STORE);
      var get = meta.get(ledgerKey(batchId));
      get.onsuccess = function () {
        var rec = get.result;
        if (!rec) return;
        var ids = new Set(Array.isArray(rec.ids) ? rec.ids : []);
        var prints = new Set(Array.isArray(rec.prints) ? rec.prints : []);
        var gone = new Set();
        targets = rec.batch && Array.isArray(rec.batch.targets) ? rec.batch.targets.filter(function (t) { return typeof t === "string"; }).slice(0, 4096) : [];
        var pending = targets.length;
        function finishSweep() {
          // Rows whose conversation moved since (none expected) still go.
          ids.forEach(function (id) { if (!gone.has(id)) store.delete(id); });
          meta.delete(ledgerKey(batchId));
        }
        if (pending === 0) { finishSweep(); return; }
        var index = store.index("by-target");
        targets.forEach(function (target) {
          var cursor = index.openCursor(IDBKeyRange.only(target));
          cursor.onsuccess = function () {
            var c = cursor.result;
            if (!c) {
              pending -= 1;
              if (pending === 0) finishSweep();
              return;
            }
            var row = c.value || {};
            var print = rowPrint(row);
            if (ids.has(row.id) || prints.has(print)) {
              c.delete();
              gone.add(row.id);
              removed += 1;
              if (print && removedPrints.length < 16384) removedPrints.push(print);
            }
            c.continue();
          };
        });
      };
      tx.oncomplete = function () { done(removed, true, targets, removedPrints); };
      tx.onerror = function () { done(0, false, [], []); };
      tx.onabort = function () { done(0, false, [], []); };
    } catch (err) { done(0, false, [], []); }
  }

  /* ------------------------------------------------------------------ */
  /* Runner: a worker when possible, the main thread otherwise.          */
  /* ------------------------------------------------------------------ */

  var workerUrl = null;
  function workerSource() {
    return '"use strict";\n' + createHistoryParsers.toString() + "\n" + runImportJob.toString() + "\n(" + workerMain.toString() + ")();\n";
  }

  /* Start one job; returns { cancel }. `on(msg)` gets progress, then
     exactly one done / error — never anything after cancel. */
  function startJob(job, on) {
    var cancelled = false;
    var worker = null;
    function deliver(m) { if (!cancelled) on(m); }
    try {
      if (!job.mainThread && typeof Worker === "function" && typeof Blob === "function" && typeof URL !== "undefined" && URL.createObjectURL) {
        if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
        worker = new Worker(workerUrl);
      }
    } catch (err) { worker = null; }
    if (worker) {
      worker.onmessage = function (event) {
        var m = event.data || {};
        deliver(m);
        if (m.type === "done" || m.type === "error") { try { worker.terminate(); } catch (err) { /* gone */ } }
      };
      worker.onerror = function (event) {
        try { if (event && event.preventDefault) event.preventDefault(); } catch (err) { /* noop */ }
        deliver({ type: "error", reason: "worker" });
        try { worker.terminate(); } catch (err) { /* gone */ }
      };
      worker.postMessage({ kind: job.kind, files: job.files, paths: job.paths });
    } else {
      var yieldEvery = function () {
        return new Promise(function (resolve, reject) {
          setTimeout(function () { if (cancelled) reject(new Error("cancelled")); else resolve(); }, 0);
        });
      };
      runImportJob(parsers, { kind: job.kind, files: job.files, paths: job.paths, yieldEvery: yieldEvery }, deliver).then(
        function (result) { deliver({ type: "done", result: result }); },
        function (err) { deliver({ type: "error", reason: String((err && err.message) || "read") }); }
      );
    }
    return {
      cancel: function () {
        cancelled = true;
        if (worker) { try { worker.terminate(); } catch (err) { /* gone */ } }
      }
    };
  }

  function failureCopy(kind, reason) {
    if (reason === "gzip") return "This browser cannot open compressed (.gz) files. Unzip it and choose the .json file.";
    if (reason === "gzip-too-large") return "That compressed file expands past the 64 MiB import limit.";
    if (reason === "worker") return "The import stopped unexpectedly while reading. Try a smaller batch.";
    return kind === "irc" ? "Could not read that log file." : "Could not read those files.";
  }

  function emptyCopy(kind) {
    switch (kind) {
      case "discord": return "No Discord export recognized. Export with DiscordChatExporter in JSON mode, then choose those .json files.";
      case "discord-package": return "No messages found in that Discord data package. Choose the unzipped folder that contains \"messages\".";
      case "slack": return "No Slack messages found. Choose the unzipped workspace export folder (users.json plus one folder per channel).";
      case "irc": return "No recognizable log lines found. Supported: WeeChat, irssi, mIRC, ZNC and HexChat text logs.";
      default: return "That file holds no Onyx vault export.";
    }
  }

  /* ------------------------------------------------------------------ */
  /* Port wiring (called from ports.js `wire` with its vault handle).    */
  /* ------------------------------------------------------------------ */

  function wire(app, env) {
    if (!app || !app.ports || !app.ports.historyImportPick) return;
    var vault = (env && env.vault) || function () { return null; };
    var running = {};
    function send(port, value) { try { if (app.ports[port]) app.ports[port].send(value); } catch (err) { /* port gone */ } }
    function fail(job, message) { delete running[job]; send("historyImportFailed", { job: job, message: message }); }

    function begin(job, kind, picked) {
      var entries = [];
      for (var i = 0; i < picked.length; i++) {
        var f = picked[i];
        var path = f.webkitRelativePath || f.name || "";
        if (relevant(kind, path)) entries.push({ file: f, path: path, name: f.name || path, size: f.size });
      }
      var problem = checkSelection(kind, entries);
      if (problem) { fail(job, problem); return; }
      var total = entries.reduce(function (s, e) { return s + (e.size || 0); }, 0);
      var lastSent = 0;
      send("historyImportProgress", { job: job, phase: "reading", done: 0, total: total, files: entries.length });
      running[job] = startJob({ kind: kind, files: entries.map(function (e) { return e.file; }), paths: entries.map(function (e) { return e.path; }) }, function (m) {
        if (!running[job]) return;
        if (m.type === "progress") {
          var now = Date.now();
          if (m.phase !== "finishing" && now - lastSent < 120) return;
          lastSent = now;
          send("historyImportProgress", { job: job, phase: m.phase, done: m.done || 0, total: m.total || 0, files: entries.length });
        } else if (m.type === "error") {
          fail(job, failureCopy(kind, m.reason));
        } else if (m.type === "done") {
          var result = m.result;
          if (!result || result.messages === 0) { fail(job, emptyCopy(kind)); return; }
          send("historyImportProgress", { job: job, phase: "checking", done: total, total: total, files: entries.length });
          existingIndex(vault(), function (ids, prints) {
            if (!running[job]) return;
            delete running[job];
            send("historyImportStaged", { job: job, result: markDuplicates(result, ids, prints) });
          });
        }
      });
    }

    app.ports.historyImportPick.subscribe(function (req) {
      var job = req && typeof req.job === "number" ? req.job : 0;
      var kind = req && typeof req.kind === "string" ? req.kind : "";
      var lim = LIMITS[kind];
      if (!lim) { fail(job, "That import source is not available."); return; }
      try {
        var picker = document.createElement("input");
        picker.type = "file";
        if (lim.accept) picker.accept = lim.accept;
        if (lim.multiple) picker.multiple = true;
        if (lim.folder && "webkitdirectory" in picker) picker.webkitdirectory = true;
        picker.style.display = "none";
        var settled = false;
        picker.onchange = function () {
          settled = true;
          var list = picker.files ? Array.prototype.slice.call(picker.files) : [];
          picker.remove();
          if (list.length === 0) { send("historyImportFailed", { job: job, message: "" }); return; }
          begin(job, kind, list);
        };
        picker.addEventListener("cancel", function () {
          if (settled) return;
          settled = true;
          picker.remove();
          send("historyImportFailed", { job: job, message: "" });
        });
        document.body.appendChild(picker);
        picker.click();
      } catch (err) {
        fail(job, "This browser cannot open a file picker here.");
      }
    });

    if (app.ports.historyImportCancel) {
      app.ports.historyImportCancel.subscribe(function (req) {
        var job = req && typeof req.job === "number" ? req.job : -1;
        var run = running[job];
        delete running[job];
        if (run) run.cancel();
      });
    }

    if (app.ports.historyImportRecord) {
      app.ports.historyImportRecord.subscribe(function (req) {
        var batch = req && req.batch;
        if (!batch || typeof batch.id !== "string") return;
        var record = {
          id: ledgerKey(batch.id),
          kind: "import-batch",
          batch: batch,
          ids: Array.isArray(req.ids) ? req.ids.slice(0, 16384) : [],
          prints: Array.isArray(req.prints) ? req.prints.slice(0, 16384) : []
        };
        ledgerPut(vault(), record, function () {
          ledgerList(vault(), function (list) { send("historyImportBatches", { batches: list }); });
        });
      });
    }

    if (app.ports.historyImportListRequest) {
      app.ports.historyImportListRequest.subscribe(function () {
        ledgerList(vault(), function (list) { send("historyImportBatches", { batches: list }); });
      });
    }

    if (app.ports.historyImportRemove) {
      app.ports.historyImportRemove.subscribe(function (req) {
        var id = req && typeof req.batch === "string" ? req.batch : "";
        if (!id) return;
        removeBatch(vault(), id, function (removed, ok, targets, prints) {
          // Deletions void the touched conversations' DM privacy proofs
          // exactly like writes do.
          try {
            var store = global.OnyxPorts && global.OnyxPorts.vaultStore;
            if (store && store.dmPrivacyInvalidate) targets.forEach(function (t) { store.dmPrivacyInvalidate(t); });
          } catch (err) { /* no ports */ }
          send("historyImportRemoved", { batch: id, removed: removed, ok: ok, targets: targets, prints: prints });
          ledgerList(vault(), function (list) { send("historyImportBatches", { batches: list }); });
        });
      });
    }
  }

  global.OnyxHistoryImport = {
    parsers: parsers,
    createHistoryParsers: createHistoryParsers,
    runImportJob: runImportJob,
    workerSource: workerSource,
    startJob: startJob,
    limits: LIMITS,
    relevant: relevant,
    checkSelection: checkSelection,
    existingIndex: existingIndex,
    markDuplicates: markDuplicates,
    ledgerKey: ledgerKey,
    ledgerPut: ledgerPut,
    ledgerList: ledgerList,
    removeBatch: removeBatch,
    wire: wire
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports.OnyxHistoryImport = global.OnyxHistoryImport;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
