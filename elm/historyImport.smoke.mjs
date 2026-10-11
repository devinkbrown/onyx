/* History import smoke test (v3/gap-import) — the on-device importers
   in historyImport.js against small synthetic fixtures
   (elm/tests/fixtures/import/, no real personal data): DiscordChatExporter
   JSON (pagination overlap, replies, attachments, system / envelope /
   control-character handling), Discord's data package (JSON + CSV, DMs),
   a real-layout Slack export (per-day files, users, DMs, markup), five
   IRC log dialects (WeeChat, irssi, mIRC, ZNC, HexChat), the portable
   vault (plain and gzip, plus a gzip bomb), hostile shapes, the
   selection limits, the bounded caps, the worker source, and the
   vault-side duplicate marking.
   Run with:
     node --test elm/historyImport.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

process.env.TZ = "UTC";
const require = createRequire(import.meta.url);
require("./historyImport.js");
const H = globalThis.OnyxHistoryImport;
const P = H.parsers;
const FIX = new URL("./tests/fixtures/import/", import.meta.url).pathname;

function fileOf(path, name = path.split("/").pop(), lastModified = Date.UTC(2024, 5, 1)) {
  return new File([readFileSync(join(FIX, path))], name, { lastModified });
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(join(FIX, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(FIX, rel)).isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out.sort();
}

async function run(kind, paths, files = paths.map((p) => fileOf(p))) {
  const progress = [];
  const result = await H.runImportJob(P, { kind, files, paths }, (m) => progress.push(m));
  return { result, progress };
}

const conv = (result, key) => result.conversations.find((c) => c.key === key);
const texts = (c) => c.rows.map((r) => r.text);

test("DiscordChatExporter: chat kept, system / empty / envelope / bad-time skipped", async () => {
  const { result, progress } = await run("discord", ["discord-general.json"]);
  assert.equal(result.kind, "discord");
  assert.equal(result.label, "Synthetic Guild");
  const general = conv(result, "discord:100000000000000001");
  assert.ok(general, "conversation keyed by channel id");
  assert.equal(general.suggested, "#general-chat");
  assert.equal(general.source, "Synthetic Guild · #General Chat");
  assert.equal(general.dm, false);
  assert.deepEqual(texts(general), [
    "Morning, synthetic world",
    "morning!",
    "screenshot attached\nhttps://cdn.example.test/a.png",
    "tab\tand bell and reversed",
  ]);
  assert.equal(general.rows[0].from, "Ana-Sample", "nickname wins, whitespace collapses to '-'");
  assert.equal(general.rows[0].id, "discord:100000000000000001:300000000000000001");
  assert.equal(result.systemSkipped, 1, "pinned-message notice is a system line");
  assert.equal(result.skipped, 4, "empty, envelope, bad timestamp, non-object");
  assert.ok(progress.some((m) => m.phase === "parsing"), "progress is posted");
  assert.ok(general.rows.every((r) => /^[0-9a-f]{8}$/.test(r.print)), "every row carries a fingerprint");
});

test("DiscordChatExporter: replies quote their parent, javascript: and credentialed links never append", async () => {
  const { result } = await run("discord", ["discord-general.json"]);
  const general = conv(result, "discord:100000000000000001");
  const reply = general.rows.find((r) => r.text === "morning!");
  assert.deepEqual(reply.replyTo, { id: "discord:100000000000000001:300000000000000001", from: "Ana-Sample", text: "Morning, synthetic world" });
  const shot = general.rows.find((r) => r.text.startsWith("screenshot"));
  assert.ok(!shot.text.includes("javascript:"));
  assert.ok(!shot.text.includes("evil.example.test"));
});

test("DiscordChatExporter: an overlapping second page does not duplicate rows", async () => {
  const { result } = await run("discord", ["discord-general.json", "discord-general-page2.json"]);
  const general = conv(result, "discord:100000000000000001");
  assert.equal(general.rows.length, 5);
  assert.equal(general.rows.at(-1).text, "page two starts here");
  assert.equal(result.duplicatesInFile, 1);
  assert.equal(result.files, 2);
});

test("DiscordChatExporter: DM exports map to a nick destination", async () => {
  const { result } = await run("discord", ["discord-dm.json"]);
  const dm = conv(result, "discord:100000000000000099");
  assert.equal(dm.dm, true);
  assert.equal(dm.suggested, "bo_test");
  assert.equal(dm.source, "DM with bo_test");
  assert.equal(result.label, "", "the Direct Messages pseudo-guild is not a label");
});

test("DiscordChatExporter: unrecognized JSON is rejected, not imported", async () => {
  const { result } = await run("discord", ["slack-export/users.json"]);
  assert.equal(result.messages, 0);
  assert.equal(result.rejectedFiles, 1);
});

test("hostile export: wrong types skip, labels strip controls and bidi, markup stays inert text", async () => {
  const { result } = await run("discord", ["hostile-discord.json"]);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(result.label, "evil guild");
  const c = result.conversations[0];
  assert.equal(c.suggested, "", "a punctuation-only name gives no destination (review asks)");
  assert.ok(!/\s/.test(c.key));
  const froms = c.rows.map((r) => r.from);
  assert.ok(froms.includes("Mallory-The-Great"));
  assert.ok(texts(c).includes("<img src=x onerror=alert(1)>"), "no HTML is produced or interpreted — text stays text");
  assert.equal(result.skipped, 1);
});

test("Discord data package: JSON + CSV, own name as author, DM from the index", async () => {
  const paths = walk("discord-package");
  const { result } = await run("discord-package", paths);
  const general = conv(result, "discord:200000000000000001");
  assert.equal(general.suggested, "#general");
  assert.equal(general.source, "Synthetic Guild · #general");
  assert.deepEqual(texts(general), ["my own message", "with a file\nhttps://cdn.example.test/f.txt\nhttps://cdn.example.test/g.txt"]);
  assert.equal(general.rows[0].from, "Ana-Sample");
  assert.equal(general.rows[0].time, Date.UTC(2024, 2, 1, 9, 0, 0), "space-separated package stamps are UTC");
  const dm = conv(result, "discord:200000000000000002");
  assert.equal(dm.dm, true);
  assert.equal(dm.suggested, "bo_test");
  assert.deepEqual(texts(dm), ['hello, "bo"', "two\nlines"]);
  assert.equal(result.skipped, 1);
  assert.equal(result.label, "Synthetic Guild");
});

test("Slack export: per-day files under channel folders, names resolved, markup decoded", async () => {
  const paths = walk("slack-export");
  const { result } = await run("slack", paths);
  const general = conv(result, "slack:C0000001");
  assert.ok(general, "channel id comes from channels.json");
  assert.equal(general.suggested, "#general");
  assert.deepEqual(texts(general), [
    "Hi @bo, see the doc (https://example.test/doc) & #general",
    "thread reply",
    "waves",
    "next day @here\nhttps://synthetic.slack.example/files/F1",
  ]);
  assert.equal(general.rows[0].from, "ana");
  assert.equal(general.rows[1].from, "bo", "empty display_name falls back to the user name");
  assert.equal(general.rows[2].type, "action", "me_message is an action");
  assert.deepEqual(general.rows[1].replyTo, { id: "slack:C0000001:1704189660.000200", from: "ana", text: general.rows[0].text });
  assert.equal(result.systemSkipped, 1, "channel_join is a system line");
  const dm = conv(result, "slack:D0DM00001");
  assert.equal(dm.dm, true);
  assert.equal(dm.suggested, "#dm-ana-bo");
  assert.equal(dm.source, "DM · ana, bo");
});

test("Slack: the SolidJS bundle shape still imports", async () => {
  const bundle = { workspace: { name: "Bundle WS" }, channel: { id: "C9", name: "random" }, users: [{ id: "U1", name: "zed" }],
    messages: [{ type: "message", user: "U1", text: "bundled", ts: "1704189600.000100" }] };
  const file = new File([JSON.stringify(bundle)], "random.json");
  const { result } = await run("slack", ["random.json"], [file]);
  assert.equal(result.label, "Bundle WS");
  assert.deepEqual(texts(conv(result, "slack:C9")), ["bundled"]);
});

test("WeeChat: tab-separated full dates, mode prefixes, actions, -->/<-- system lines, impossible dates", async () => {
  const { result } = await run("irc", ["irc/irc.synthnet.#lounge.weechatlog"]);
  const c = conv(result, "irc:#lounge");
  assert.equal(c.suggested, "#lounge", "room comes from the file name");
  assert.deepEqual(c.rows.map((r) => [r.from, r.text, r.type]), [
    ["ana", "hello lounge", "msg"],
    ["bo", "waves", "action"],
    ["bo", "reply here", "msg"],
  ]);
  assert.equal(c.rows[0].time, Date.UTC(2024, 0, 2, 10, 0, 5));
  assert.equal(result.systemSkipped, 2);
  assert.equal(result.skipped, 1, "2024-02-30 is rejected, not rolled into March");
  assert.equal(result.datesEstimated, false);
});

test("irssi: Log opened / Day changed markers date time-only lines", async () => {
  const { result } = await run("irc", ["irc/irssi-#dev.log"]);
  const c = conv(result, "irc:#dev");
  assert.deepEqual(c.rows.map((r) => [r.from, r.text, r.type, new Date(r.time).toISOString()]), [
    ["ana", "morning dev", "msg", "2024-01-02T10:00:00.000Z"],
    ["bo", "yawns", "action", "2024-01-02T23:59:00.000Z"],
    ["bo", "after midnight", "msg", "2024-01-03T00:01:00.000Z"],
    ["cy", "dances", "action", "2024-01-03T00:02:00.000Z"],
  ]);
  assert.equal(result.datesEstimated, false);
});

test("mIRC: Session Start dates, * Joins: / nick changes are system lines, not actions", async () => {
  const { result } = await run("irc", ["irc/mirc-#ops.SynthNet.log"]);
  const c = conv(result, "irc:#ops");
  assert.deepEqual(c.rows.map((r) => [r.from, r.text, r.type]), [["ana", "ops check", "msg"], ["ana", "stretches", "action"]]);
  assert.equal(new Date(c.rows[0].time).toISOString(), "2024-03-01T09:01:00.000Z");
  assert.equal(result.systemSkipped, 3);
});

test("ZNC: the file-name date anchors the day, midnight rolls over, *** lines are system", async () => {
  const { result } = await run("irc", ["irc/2024-03-05.log"]);
  const c = conv(result, "irc:logs");
  assert.equal(c.suggested, "", "no room in the name: the review asks for one");
  assert.deepEqual(c.rows.map((r) => new Date(r.time).toISOString()), [
    "2024-03-05T10:00:01.000Z", "2024-03-05T10:00:02.000Z", "2024-03-05T23:59:59.000Z", "2024-03-06T00:00:01.000Z",
  ]);
  assert.equal(c.rows[1].type, "action");
  assert.equal(result.systemSkipped, 1);
});

test("HexChat: BEGIN LOGGING year, tab-separated nick column, join hint names the room", async () => {
  const { result } = await run("irc", ["irc/hexchat-session.txt"]);
  const c = result.conversations[0];
  assert.deepEqual(c.rows.map((r) => [r.from, r.text, r.type]), [["ana", "hexchat hello", "msg"], ["ana", "hexes", "action"]]);
  assert.equal(new Date(c.rows[0].time).toISOString(), "2024-04-02T10:00:01.000Z");
  assert.equal(c.suggested, "#hex", "the join line names the room");
});

test("IRC: time-only logs with no day anywhere are flagged as estimated (file date)", async () => {
  const file = new File(["10:00 <ana> undated\n"], "plain.txt", { lastModified: Date.UTC(2023, 6, 9, 12) });
  const { result } = await run("irc", ["plain.txt"], [file]);
  assert.equal(result.datesEstimated, true);
  assert.equal(new Date(result.conversations[0].rows[0].time).toISOString(), "2023-07-09T10:00:00.000Z");
});

test("IRC: an oversized line is dropped without losing its neighbour, across chunk boundaries", async () => {
  const huge = "x".repeat(70 * 1024);
  const file = new File([`[10:00] <a> before\n[10:01] <b> ${huge}\n[10:02] <c> after\n`], "#big.log");
  const { result } = await run("irc", ["#big.log"], [file]);
  assert.deepEqual(texts(result.conversations[0]), ["before", "after"]);
  assert.equal(result.skipped, 1);
});

test("IRC: ids are per file and line, and identical logs in two files do not collide", async () => {
  const a = new File(["2024-01-02 10:00:00\tana\tsame\n"], "#x.log");
  const b = new File(["2024-01-02 10:00:00\tana\tsame\n"], "#x.weechatlog");
  const { result } = await run("irc", ["#x.log", "#x.weechatlog"], [a, b]);
  const ids = result.conversations[0].rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^irclog:[0-9a-f]{8}:\d+$/.test(id)));
});

test("portable vault: kind/version gate, rows keep ids, envelope text from this device survives", async () => {
  const { result } = await run("portable", ["portable-vault.json"]);
  assert.equal(result.label, "Onyx vault · 2024-05-01");
  const lounge = conv(result, "vault:#lounge");
  assert.deepEqual(lounge.rows.map((r) => r.id), ["#lounge:1", "#lounge:2", "#lounge:3"], "type validation is Elm's job");
  assert.equal(lounge.rows[1].time, Date.UTC(2024, 4, 1, 8, 1));
  const dm = conv(result, "vault:bo");
  assert.equal(dm.dm, true);
  assert.equal(dm.rows[0].text, "ONYXDM1 AAAA");
  assert.equal(conv(result, "vault:has space"), undefined);
  const wrong = new File([JSON.stringify({ kind: "other", version: 1, targets: [] })], "x.json");
  assert.equal((await run("portable", ["x.json"], [wrong])).result.rejectedFiles, 1);
});

test("portable vault: .json.gz is decompressed, and a gzip bomb stops at the limit", async () => {
  const gz = new File([gzipSync(readFileSync(join(FIX, "portable-vault.json")))], "vault.json.gz");
  const { result } = await run("portable", ["vault.json.gz"], [gz]);
  assert.equal(conv(result, "vault:#lounge").rows.length, 3);
  const bomb = new File([gzipSync(Buffer.alloc(65 * 1024 * 1024, 0x20))], "bomb.json.gz");
  await assert.rejects(() => H.runImportJob(P, { kind: "portable", files: [bomb], paths: ["bomb.json.gz"] }, () => {}), /gzip-too-large/);
});

test("caps: newest 1600 per conversation, 16384 per import", async () => {
  const messages = [];
  for (let i = 0; i < 2000; i++) {
    messages.push({ id: String(1e6 + i), type: "Default", timestamp: new Date(Date.UTC(2024, 0, 1) + i * 1000).toISOString(), content: "m" + i, author: { name: "a" } });
  }
  const file = new File([JSON.stringify({ guild: { name: "G" }, channel: { id: "1", name: "c" }, messages })], "big.json");
  const { result } = await run("discord", ["big.json"], [file]);
  const c = result.conversations[0];
  assert.equal(c.rows.length, 1600);
  assert.equal(c.rows[0].text, "m400", "the newest tail is kept");
  assert.equal(result.droppedOverCap, 400);

  const many = [];
  for (let ch = 0; ch < 12; ch++) {
    const msgs = [];
    for (let i = 0; i < 1500; i++) msgs.push({ id: String(i), type: "Default", timestamp: new Date(Date.UTC(2024, 0, 1) + (ch * 1500 + i) * 1000).toISOString(), content: "x", author: { name: "a" } });
    many.push({ channel: { id: "c" + ch, name: "c" + ch }, messages: msgs });
  }
  const bulk = new File([JSON.stringify(many)], "bulk.json");
  const bulkResult = (await run("discord", ["bulk.json"], [bulk])).result;
  assert.equal(bulkResult.messages, 16384);
  assert.equal(bulkResult.droppedOverCap, 12 * 1500 - 16384);
});

test("selection limits are checked before any read", () => {
  assert.equal(H.checkSelection("irc", [{ name: "a.log", size: 129 * 1024 * 1024 }]), "a.log is larger than the 128 MiB per-file limit. Split it, then try again.");
  assert.match(H.checkSelection("portable", [{ name: "a", size: 1 }, { name: "b", size: 1 }]), /no more than 1 files/);
  assert.match(H.checkSelection("discord", [{ name: "a", size: 60 * 1024 * 1024 }, { name: "b", size: 60 * 1024 * 1024 }, { name: "c", size: 60 * 1024 * 1024 }, { name: "d", size: 60 * 1024 * 1024 }]), /192 MiB total/);
  assert.match(H.checkSelection("discord", [{ name: "nan", size: NaN }]), /per-file limit/);
  assert.match(H.checkSelection("discord-package", []), /Discord data package/);
  assert.equal(H.checkSelection("slack", [{ name: "users.json", size: 10 }]), null);
  assert.equal(H.relevant("discord-package", "pkg/messages/c1/messages.json"), true);
  assert.equal(H.relevant("discord-package", "pkg/servers/1/avatar.png"), false);
  assert.equal(H.relevant("slack", "export/integration_logs.json"), false);
});

test("duplicate marking: same id or same (time, sender, text) fingerprint", async () => {
  const { result } = await run("discord", ["discord-general.json"]);
  const general = conv(result, "discord:100000000000000001");
  const ids = new Set([general.rows[0].id]);
  const second = general.rows[1];
  const prints = new Set([P.fingerprint(second.time, second.from.toUpperCase(), second.text)]);
  H.markDuplicates(result, ids, prints);
  assert.deepEqual(general.rows.map((r) => r.dup), [true, true, false, false]);
  assert.equal(result.alreadyInVault, 2);
});

test("suggestions: channel and nick shaping", () => {
  assert.equal(P.channelSuggestion("##Off Topic!"), "#off-topic");
  assert.equal(P.channelSuggestion("___"), "");
  assert.equal(P.channelSuggestion("x".repeat(500)).length, 50);
  assert.equal(P.nickSuggestion("bo test#0042"), "bo_test");
  assert.equal(P.nickSuggestion("42cats"), "cats");
  assert.equal(P.nickSuggestion("🙂"), "");
});

/* Hostile lines: long runs of whitespace / separators after every
   supported log head used to send the pipe-table and HexChat patterns
   cubic (6,000 spaces took ~96 s). Every shape must now stay linear. */
test("pathological log lines stay linear-time (no regex blow-up)", () => {
  const heads = ["2024-01-02 10:00:00\t", "2024-01-02 10:00  ", "10:00 ", "10:00  * ", "[10:00] ", "[10:00] <", "[10:00:00] ", "Jan 02 10:00:00 ",
    "[2024-01-02T10:00:00Z] ", "10:00 <@", "10:00 * ", "--- Log opened "];
  const fills = [" ", "\t", "<", "-", "[", "|", "* ", "a "];
  const started = Date.now();
  for (const head of heads) {
    for (const fill of fills) {
      const line = head + fill.repeat(Math.ceil(40000 / fill.length)) + "\n";
      const acc = P.accumulator("irc");
      const scanner = P.ircLog(acc, { name: "x.log", size: line.length, lastModified: 0 });
      const t0 = Date.now();
      scanner.push(line); scanner.push(""); scanner.end();
      assert.ok(Date.now() - t0 < 1500, `${JSON.stringify(head)} + ${JSON.stringify(fill)} took ${Date.now() - t0}ms`);
    }
  }
  assert.ok(Date.now() - started < 20000);
});

test("pathological Slack markup stays linear-time", async () => {
  const text = "<http://".repeat(14000) + " <@U1|".repeat(10000);
  const files = [
    new File([JSON.stringify([{ id: "C1", name: "general" }])], "channels.json"),
    new File([JSON.stringify([{ id: "U1", name: "ana" }])], "users.json"),
    new File([JSON.stringify([{ type: "message", user: "U1", text, ts: "1704189600.000100" }])], "general/2024-01-02.json"),
  ];
  const t0 = Date.now();
  const { result } = await run("slack", ["channels.json", "users.json", "general/2024-01-02.json"], files);
  assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0}ms`);
  assert.equal(result.messages, 1);
});

test("the worker source is self-contained and evaluates", () => {
  const src = H.workerSource();
  const posted = [];
  const self = { postMessage: (m) => posted.push(m) };
  new Function("self", src)(self);
  assert.equal(typeof self.onmessage, "function");
});

/* Evaluate a stringified worker source in a context that only has what a
   real worker has (no module closure): any free variable the source still
   needs throws here, exactly as it would in the browser. */
async function runWorkerSource(vmModule, source, job) {
  const messages = [];
  const self = { postMessage: (m) => messages.push(m) };
  const context = vmModule.createContext({ self, TextDecoder, Promise, setTimeout, Uint8Array, DecompressionStream: globalThis.DecompressionStream });
  vmModule.runInContext(source, context);
  assert.equal(typeof self.onmessage, "function");
  self.onmessage({ data: job });
  for (let i = 0; i < 200 && !messages.some((m) => m.type === "done" || m.type === "error"); i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return messages;
}

test("the worker runs a job end to end from its own source", async () => {
  const vm = await import("node:vm");
  const files = [fileOf("discord-general.json")];
  const messages = await runWorkerSource(vm, H.workerSource(), { kind: "discord", files, paths: ["discord-general.json"] });
  const done = messages.find((m) => m.type === "done");
  assert.ok(done, JSON.stringify(messages.filter((m) => m.type === "error")));
  assert.equal(done.result.messages, 4);
  assert.ok(messages.some((m) => m.type === "progress"), "progress is posted");
});

test("the minified build keeps the worker source self-contained (esbuild, es2017)", async (t) => {
  let esbuild = null;
  const store = new URL("../../node_modules/.pnpm/", import.meta.url).pathname;
  const roots = [store, "/home/kain/onyx/node_modules/.pnpm/"];
  for (const root of roots) {
    try {
      const hit = readdirSync(root).find((n) => n.startsWith("esbuild@"));
      if (hit) { esbuild = require(join(root, hit, "node_modules/esbuild")); break; }
    } catch (err) { /* try the next store */ }
  }
  if (!esbuild) { t.skip("esbuild not found"); return; }
  const vm = await import("node:vm");
  const minified = esbuild.transformSync(readFileSync(new URL("./historyImport.js", import.meta.url), "utf8"), { minify: true, target: "es2017" }).code;
  const sandbox = { File, Blob, TextDecoder, setTimeout, console };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(minified, context);
  const Min = context.OnyxHistoryImport;
  assert.ok(Min && typeof Min.workerSource === "function", "the minified module still exports its API");
  const files = [fileOf("discord-general.json")];
  const messages = await runWorkerSource(vm, Min.workerSource(), { kind: "discord", files, paths: ["discord-general.json"] });
  const done = messages.find((m) => m.type === "done");
  assert.ok(done, JSON.stringify(messages.filter((m) => m.type === "error")));
  assert.equal(done.result.messages, 4);
});

test("main-thread fallback runs a job end to end and honours cancel", async () => {
  const files = [fileOf("discord-general.json")];
  const done = await new Promise((resolve) => {
    H.startJob({ kind: "discord", files, paths: ["discord-general.json"], mainThread: true }, (m) => { if (m.type === "done" || m.type === "error") resolve(m); });
  });
  assert.equal(done.type, "done");
  assert.equal(done.result.messages, 4);
  const seen = [];
  const job = H.startJob({ kind: "discord", files, paths: ["discord-general.json"], mainThread: true }, (m) => seen.push(m));
  job.cancel();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(seen.filter((m) => m.type === "done").length, 0, "nothing is delivered after cancel");
});

test("ledger keys are minted in one place", () => {
  assert.equal(H.ledgerKey("b1"), "import-batch:b1");
});

test("fixture tree stays small and synthetic", () => {
  for (const rel of walk(".")) {
    assert.ok(statSync(join(FIX, rel)).size < 8 * 1024, `${relative(FIX, join(FIX, rel))} is small`);
  }
});

test("vault side: existing index, ledger round-trip, removal by id and by fingerprint", async () => {
  require("fake-indexeddb/auto");
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("history-import-smoke", 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore("messages", { keyPath: "id" });
      store.createIndex("by-target", "target", { unique: false });
      req.result.createObjectStore("vault_meta", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const put = (rows) => new Promise((resolve) => {
    const tx = db.transaction("messages", "readwrite");
    rows.forEach((r) => tx.objectStore("messages").put(r));
    tx.oncomplete = resolve;
  });
  const imported = { id: "discord:1:1", target: "#general", from: "ana", body: "imported hello", at: 1000, rowType: "msg" };
  const native = { id: "#general:5", target: "#general", from: "bo", body: "live line", at: 2000, rowType: "msg" };
  // A buffer re-persist of the imported row under a positional id.
  const copy = { id: "#general:0", target: "#general", from: "ana", body: "imported hello", at: 1000, rowType: "msg" };
  await put([imported, native, copy]);

  const [ids, prints] = await new Promise((resolve) => H.existingIndex(db, (i, p) => resolve([i, p])));
  assert.ok(ids.has("discord:1:1") && ids.has("#general:5"));
  assert.ok(prints.has(P.fingerprint(1000, "ANA", "imported hello")), "fingerprints ignore sender case");

  const batch = { id: "imp-1", kind: "discord", label: "Discord · G", at: 5, messages: 1, targets: ["#general"] };
  await new Promise((resolve) => H.ledgerPut(db, { id: H.ledgerKey("imp-1"), kind: "import-batch", batch, ids: ["discord:1:1"], prints: [P.fingerprint(1000, "ana", "imported hello")] }, resolve));
  assert.deepEqual(await new Promise((resolve) => H.ledgerList(db, resolve)), [batch]);

  const [removed, ok, targets, removedPrints] = await new Promise((resolve) => H.removeBatch(db, "imp-1", (...args) => resolve(args)));
  assert.equal(ok, true);
  assert.equal(removed, 2, "the imported row and its re-persisted copy");
  assert.deepEqual(targets, ["#general"]);
  assert.equal(removedPrints.length, 2);
  const left = await new Promise((resolve) => {
    const req = db.transaction("messages").objectStore("messages").getAll();
    req.onsuccess = () => resolve(req.result.map((r) => r.id));
  });
  assert.deepEqual(left, ["#general:5"], "native history survives");
  assert.deepEqual(await new Promise((resolve) => H.ledgerList(db, resolve)), [], "the ledger entry goes with it");
  db.close();
});
