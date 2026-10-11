/* v3/gap-convo — the ports-side half of the conversation gaps:
   photo cleaning (EXIF / GPS stripped from the bytes that are POSTed,
   fail closed when a photo cannot be cleaned), the owner-scoped drafts
   journal (Solid's `onyx:composer-drafts` key shape, debounced and
   write-verified), paste / drag-and-drop staging, and the menu / picker /
   search focus management.
   Run with:
     node --test elm/gapConvo.smoke.mjs
   (from the repo root). Needs the repo jsdom devDependency. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
require("./ports.js");
const gap = globalThis.OnyxPorts.gapConvo;

const B = (...parts) => Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))));
const bytes = (b) => new Uint8Array(b);
const has = (u8, text) => Buffer.from(u8).includes(Buffer.from(text, "latin1"));

/* ── JPEG ─────────────────────────────────────────────────────────── */
const seg = (marker, payload) => B([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255], payload);
function exifApp1(orientation, extra = "GPSLatitude=33.7490N GPSLongitude=84.3880W Make=ACME") {
  const tiff = B("MM", [0, 0x2a, 0, 0, 0, 8], [0, 1], [0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0], [0, 0, 0, 0], extra);
  return seg(0xe1, B("Exif\0\0", tiff));
}
function jpeg({ orientation = 6, trailing = "" } = {}) {
  return B(
    [0xff, 0xd8],
    seg(0xe0, B("JFIF\0", [1, 1, 0, 0, 1, 0, 1, 0, 0])),
    exifApp1(orientation),
    seg(0xe2, B("ICC_PROFILE\0", [1, 1], "profile-bytes")),
    seg(0xe2, B("MPF\0", "multi-picture-secret")),
    seg(0xed, B("Photoshop 3.0\0", "iptc-name-secret")),
    seg(0xfe, "secret comment"),
    seg(0xdb, Buffer.alloc(65, 7)),
    seg(0xc0, Buffer.alloc(15, 1)),
    seg(0xc4, Buffer.alloc(20, 2)),
    seg(0xda, Buffer.alloc(10, 3)),
    [0x12, 0x34, 0xff, 0x00, 0x56],
    [0xff, 0xd9],
    trailing,
  );
}

test("sniffs by bytes, never by name or type", () => {
  assert.equal(gap.sniff(bytes(jpeg())), "jpeg");
  assert.equal(gap.sniff(bytes(B([0x89], "PNG\r\n", [0x1a, 0x0a]))), "png");
  assert.equal(gap.sniff(bytes(B("RIFF", [4, 0, 0, 0], "WEBP"))), "webp");
  assert.equal(gap.sniff(bytes(B([0, 0, 0, 24], "ftypheic", [0, 0, 0, 0], "mif1heic"))), "heif");
  assert.equal(gap.sniff(bytes(B("II", [0x2a, 0, 8, 0, 0, 0]))), "tiff");
  assert.equal(gap.sniff(bytes(B("plain text file"))), null);
  assert.equal(gap.sniff(bytes(B("ab"))), null);
});

test("JPEG: EXIF/GPS, maker notes, comments, MPF and trailing bytes are dropped; ICC stays; orientation survives", () => {
  const src = jpeg({ orientation: 6, trailing: "TRAILING-GPS-SECRET" });
  assert.ok(has(bytes(src), "GPSLatitude"), "the fixture really carries GPS");
  const out = gap.stripJpeg(bytes(src));
  assert.ok(out && out.removed === true);
  for (const secret of ["GPSLatitude", "ACME", "multi-picture-secret", "iptc-name-secret", "secret comment", "TRAILING-GPS-SECRET"]) {
    assert.equal(has(out.bytes, secret), false, `${secret} must not survive`);
  }
  assert.ok(has(out.bytes, "JFIF"));
  assert.ok(has(out.bytes, "ICC_PROFILE"), "a colour profile is not metadata");
  assert.deepEqual([out.bytes[0], out.bytes[1]], [0xff, 0xd8]);
  assert.deepEqual([out.bytes[out.bytes.length - 2], out.bytes[out.bytes.length - 1]], [0xff, 0xd9]);
  /* The only EXIF left is a 36-byte orientation block, so the photo still
     displays upright. */
  const buf = Buffer.from(out.bytes);
  const at = buf.indexOf("Exif\0\0", 0, "latin1");
  assert.ok(at > 0);
  assert.equal(gap.exifOrientation(out.bytes, at + 6, at + 6 + 30), 6);
  assert.equal(buf.length < Buffer.from(src).length, true);
});

test("JPEG: a JFXX thumbnail extension is dropped (it can carry its own EXIF); JFIF stays", () => {
  const src = B(
    [0xff, 0xd8],
    seg(0xe0, B("JFIF\0", [1, 1, 0, 0, 1, 0, 1, 0, 0])),
    seg(0xe0, B("JFXX\0", [0x10], "thumbnail-with-GPS-inside")),
    seg(0xda, Buffer.alloc(10, 3)),
    [1, 2, 3],
    [0xff, 0xd9],
  );
  const out = gap.stripJpeg(bytes(src));
  assert.ok(out.removed);
  assert.equal(has(out.bytes, "thumbnail-with-GPS-inside"), false);
  assert.ok(has(out.bytes, "JFIF"));
});

test("JPEG: an upright photo keeps no EXIF at all; a clean one is reported untouched", () => {
  const upright = gap.stripJpeg(bytes(jpeg({ orientation: 1 })));
  assert.equal(has(upright.bytes, "Exif"), false);
  const clean = B([0xff, 0xd8], seg(0xdb, Buffer.alloc(65, 7)), seg(0xda, Buffer.alloc(10, 3)), [1, 2, 3], [0xff, 0xd9]);
  const out = gap.stripJpeg(bytes(clean));
  assert.equal(out.removed, false);
});

test("JPEG: truncated, scan-less or malformed files FAIL CLOSED (null)", () => {
  const whole = jpeg();
  assert.equal(gap.stripJpeg(bytes(whole.subarray(0, 60))), null);
  assert.equal(gap.stripJpeg(bytes(B([0xff, 0xd8], exifApp1(1)))), null, "no scan = not a photo we can vouch for");
  assert.equal(gap.stripJpeg(bytes(B([0xff, 0xd8, 0x00, 0x01, 0x02]))), null);
  assert.equal(gap.stripJpeg(bytes(B("not a jpeg"))), null);
});

/* ── PNG ──────────────────────────────────────────────────────────── */
const chunk = (type, data = "") => B([(Buffer.byteLength(data) >>> 24) & 255, (Buffer.byteLength(data) >>> 16) & 255, (Buffer.byteLength(data) >>> 8) & 255, Buffer.byteLength(data) & 255], type, data, [0, 0, 0, 0]);
const PNG_SIG = B([0x89], "PNG\r\n", [0x1a, 0x0a]);

test("PNG: text, eXIf, time and unknown ancillary chunks and trailing bytes drop; rendering chunks stay", () => {
  const src = B(PNG_SIG, chunk("IHDR", Buffer.alloc(13)), chunk("tEXt", "Location\0GPS 33.7N 84.3W"), chunk("eXIf", "Exif-GPS-block"), chunk("iTXt", "XML:com.adobe.xmp secret"), chunk("tIME", "1234567"), chunk("zzZz", "private-ancillary"), chunk("gAMA", "1234"), chunk("IDAT", "pixels"), chunk("IEND"), "TRAILER-SECRET");
  const out = gap.stripPng(bytes(src));
  assert.ok(out && out.removed);
  for (const gone of ["GPS 33.7N", "Exif-GPS-block", "XML:com.adobe", "tIME", "private-ancillary", "TRAILER-SECRET"]) assert.equal(has(out.bytes, gone), false, gone);
  for (const kept of ["IHDR", "gAMA", "IDAT", "pixels", "IEND"]) assert.ok(has(out.bytes, kept), kept);
  assert.equal(gap.stripPng(bytes(B(PNG_SIG, chunk("IHDR", Buffer.alloc(13)), chunk("IDAT", "px")))), null, "no IEND = fail closed");
  assert.equal(gap.stripPng(bytes(B(PNG_SIG, "\0\0\0\xffIHDRshort"))), null, "a chunk longer than the file = fail closed");
});

/* ── WebP ─────────────────────────────────────────────────────────── */
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const riffChunk = (type, data) => B(type, le32(data.length), data, data.length & 1 ? [0] : []);
function webp(flags) {
  const body = B("WEBP", riffChunk("VP8X", B([flags, 0, 0, 0], [0, 0, 0, 0, 0, 0])), riffChunk("VP8 ", "bitstream!"), riffChunk("EXIF", "Exif GPS secret!"), riffChunk("XMP ", "xmp secret"));
  return B("RIFF", le32(body.length), body);
}

test("WebP: EXIF and XMP chunks drop, their VP8X flags clear, and the RIFF size is repaired", () => {
  const out = gap.stripWebp(bytes(webp(0x08 | 0x04 | 0x10)));
  assert.ok(out && out.removed);
  assert.equal(has(out.bytes, "GPS secret"), false);
  assert.equal(has(out.bytes, "xmp secret"), false);
  assert.ok(has(out.bytes, "bitstream!"));
  const buf = Buffer.from(out.bytes);
  assert.equal(buf.readUInt32LE(4), buf.length - 8);
  const vp8x = buf.indexOf("VP8X", 0, "latin1");
  assert.equal(buf[vp8x + 8] & (0x08 | 0x04), 0, "metadata flags cleared");
  assert.equal(buf[vp8x + 8] & 0x10, 0x10, "alpha flag kept");
  assert.equal(gap.stripWebp(bytes(B("RIFF", le32(9999), "WEBPVP8 "))), null);
});

/* ── HEIF / HEIC ──────────────────────────────────────────────────── */
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >>> 8) & 255, n & 255];
const box = (type, ...content) => {
  const body = B(...content);
  return B(u32(body.length + 8), type, body);
};
function heic({ locateExif = true } = {}) {
  const exifBytes = B("Exif\0\0MM GPS 33.7490N secret");
  const picture = B("hevc-picture-bytes");
  const build = (exifOffset, pictureOffset) =>
    B(
      box("ftyp", "heic", u32(0), "mif1", "heic"),
      box(
        "meta",
        u32(0),
        box("iinf", u32(0).slice(0, 4), u16(2), box("infe", [2, 0, 0, 0], u16(1), u16(0), "hvc1", "pic\0"), box("infe", [2, 0, 0, 0], u16(2), u16(0), "Exif", "exif\0")),
        box(
          "iloc",
          u32(0),
          [0x44, 0x00],
          u16(locateExif ? 2 : 1),
          u16(1), u16(0), u16(1), u32(pictureOffset), u32(picture.length),
          locateExif ? B(u16(2), u16(0), u16(1), u32(exifOffset), u32(exifBytes.length)) : B(),
        ),
      ),
      box("mdat", picture, exifBytes),
    );
  const probe = build(0, 0);
  const mdatBody = probe.length - (picture.length + exifBytes.length);
  return build(mdatBody + picture.length, mdatBody);
}

test("HEIC: the Exif item is zero-filled in place; the picture is byte-identical", () => {
  const src = bytes(heic());
  assert.equal(gap.sniff(src), "heif");
  assert.equal(has(src, "GPS 33.7490N"), true);
  const out = gap.stripHeif(src);
  assert.ok(out && out.removed);
  assert.equal(out.bytes.length, src.length);
  assert.equal(has(out.bytes, "GPS 33.7490N"), false);
  assert.ok(has(out.bytes, "hevc-picture-bytes"));
});

test("HEIC: an Exif item that cannot be located fails closed", () => {
  assert.equal(gap.stripHeif(bytes(heic({ locateExif: false }))), null);
  assert.equal(gap.stripHeif(bytes(B([0, 0, 0, 24], "ftypheic", [0, 0, 0, 0], "mif1heic"))), null, "no meta box = cannot vouch");
});

/* ── The decision: clean / refuse ─────────────────────────────────── */
test("clean(): photos report removed / none / unsafe; other files pass through untouched", () => {
  const dirty = gap.clean(bytes(jpeg()));
  assert.equal(dirty.kind, "jpeg");
  assert.equal(dirty.metadata, "removed");
  assert.ok(dirty.bytes);
  const none = gap.clean(bytes(B([0xff, 0xd8], seg(0xda, Buffer.alloc(10, 3)), [1], [0xff, 0xd9])));
  assert.equal(none.metadata, "none");
  const tiff = gap.clean(bytes(B("II", [0x2a, 0, 8, 0, 0, 0], Buffer.alloc(64))));
  assert.deepEqual([tiff.kind, tiff.metadata, tiff.bytes], ["tiff", "unsafe", null], "a raw / TIFF container cannot be cleaned here");
  const broken = gap.clean(bytes(jpeg().subarray(0, 80)));
  assert.deepEqual([broken.kind, broken.metadata, broken.bytes], ["jpeg", "unsafe", null]);
  const doc = gap.clean(bytes(B("%PDF-1.7 hello")));
  assert.deepEqual([doc.kind, doc.metadata], ["file", "none"]);
});

function fakeApp() {
  const sent = [];
  return { sent, ports: { gapPhotoPrepared: { send: (m) => sent.push(m) } } };
}
const fileOf = (buf, name, type) => new File([buf], name, { type });

test("uploads: the CLEANED bytes are what leaves; the original only on explicit consent; unsafe is refused", async () => {
  const app = fakeApp();
  const up = gap.createUploads(app);
  const photo = fileOf(jpeg(), "me.jpg", "image/jpeg");
  const raw = fileOf(B("II", [0x2a, 0, 8, 0, 0, 0], Buffer.alloc(64)), "IMG.dng", "image/x-adobe-dng");
  const note = fileOf("hello", "notes.txt", "text/plain");
  up.prepare("k1", [photo, raw, note]);

  const first = await up.resolve("k1", 0, photo);
  assert.ok(first.file && !first.refused);
  const posted = new Uint8Array(await first.file.arrayBuffer());
  assert.equal(has(posted, "GPSLatitude"), false, "no GPS in the bytes that would be POSTed");
  assert.notEqual(first.file, photo);

  assert.deepEqual(await up.resolve("k1", 1, raw), { refused: true }, "an uncleanable photo is refused, not sent");
  const text = await up.resolve("k1", 2, note);
  assert.equal(text.file, note, "a non-image is posted as is");

  up.setVariant("k1", 1, "original");
  const consent = await up.resolve("k1", 1, raw);
  assert.equal(consent.file, raw, "explicit consent sends the original");
  up.setVariant("k1", 0, "original");
  assert.equal((await up.resolve("k1", 0, photo)).file, photo);
  up.setVariant("k1", 0, "clean");
  assert.notEqual((await up.resolve("k1", 0, photo)).file, photo);
  up.setVariant("k1", 0, "bogus");
  assert.notEqual((await up.resolve("k1", 0, photo)).file, photo, "an unknown variant never widens what is sent");

  await new Promise((r) => setTimeout(r, 20));
  const report = app.sent.find((m) => m.index === 0);
  assert.equal(report.kind, "jpeg");
  assert.equal(report.metadata, "removed");
  assert.equal(typeof report.cleanBytes, "number");
  assert.equal(app.sent.find((m) => m.index === 1).metadata, "unsafe");
  assert.equal(app.sent.some((m) => m.index === 2), false, "plain files report nothing");
});

test("uploads: a non-image is sniffed from its first bytes only, never read whole", async () => {
  const up = gap.createUploads(fakeApp());
  const movie = fileOf("not an image, imagine 4 GB of this", "clip.mov", "video/quicktime");
  let whole = 0;
  const arrayBuffer = movie.arrayBuffer.bind(movie);
  movie.arrayBuffer = () => { whole += 1; return arrayBuffer(); };
  up.prepare("big", [movie]);
  const got = await up.resolve("big", 0, movie);
  assert.equal(got.file, movie);
  assert.equal(whole, 0, "the whole file was never loaded into memory");
});

test("uploads: release drops a finished file's copies; a retry re-cleans from the original", async () => {
  const up = gap.createUploads(fakeApp());
  const photo = fileOf(jpeg(), "me.jpg", "image/jpeg");
  up.prepare("r", [photo]);
  const first = await up.resolve("r", 0, photo);
  up.release("r", 0);
  const again = await up.resolve("r", 0, photo);
  assert.equal(has(new Uint8Array(await again.file.arrayBuffer()), "GPSLatitude"), false);
  assert.notEqual(again.file, first.file, "a fresh clean copy, not the released one");
});

test("uploads: a file nobody prepared is still cleaned (never posted raw by default)", async () => {
  const up = gap.createUploads(fakeApp());
  const photo = fileOf(jpeg(), "late.jpg", "image/jpeg");
  const got = await up.resolve("never-prepared", 0, photo);
  assert.equal(has(new Uint8Array(await got.file.arrayBuffer()), "GPSLatitude"), false);
});

/* ── Drafts journal ───────────────────────────────────────────────── */
function memoryStorage(opts = {}) {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { if (opts.throws) throw new Error("quota"); if (!opts.drops) map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

test("drafts key is the oracle's own: onyx:composer-drafts:owner:<encoded [server, lower identity]>", () => {
  const key = gap.draftsKey("wss://onyx.test/ws", "Kai");
  assert.equal(key, "onyx:composer-drafts:owner:" + encodeURIComponent(JSON.stringify(["wss://onyx.test/ws", "kai"])));
  assert.equal(gap.draftsKey(" wss://x", "kai"), null);
  assert.equal(gap.draftsKey("wss://x", " kai"), null);
  assert.equal(gap.draftsKey("", "kai"), null);
  assert.equal(gap.draftsKey("wss://x", ""), null);
  assert.equal(gap.draftsKey("wss://x", "k".repeat(257)), null);
});

test("drafts sanitize like the oracle: bounded count and length, no bad keys, no empties", () => {
  const big = {};
  for (let i = 0; i < 60; i += 1) big["#room" + i] = "x";
  assert.equal(Object.keys(gap.sanitizeDrafts(big)).length, 50);
  assert.deepEqual(gap.sanitizeDrafts({ " #OK ": "a", "bad key": "b", "#empty": "", "a,b": "c", "#n": 5 }), { "#ok": "a" });
  assert.equal(gap.sanitizeDrafts({ "#a": "z".repeat(9000) })["#a"].length, 8192);
  assert.deepEqual(gap.sanitizeDrafts(["a"]), {});
  assert.deepEqual(gap.sanitizeDrafts(null), {});
});

test("drafts save is debounced, coalesced, and write-verified", () => {
  const storage = memoryStorage();
  const saved = [];
  let pending = null;
  const drafts = gap.createDrafts(storage, (s) => saved.push(s), (fn) => { pending = fn; return 1; });
  const owner = ["wss://onyx.test/ws", "kai"];
  drafts.save({ serverUrl: owner[0], identity: owner[1], drafts: { "#a": "one" } });
  drafts.save({ serverUrl: owner[0], identity: owner[1], drafts: { "#a": "two", "#b": "b" } });
  assert.equal(storage.map.size, 0, "nothing is written before the debounce");
  assert.ok(pending);
  pending();
  assert.deepEqual(saved, ["saved"]);
  const key = gap.draftsKey(owner[0], owner[1]);
  assert.deepEqual(JSON.parse(storage.map.get(key)), { "#a": "two", "#b": "b" });

  const loaded = drafts.load(owner[0], owner[1]);
  assert.equal(loaded.status, "saved");
  assert.deepEqual(loaded.drafts, { "#a": "two", "#b": "b" });

  drafts.save({ serverUrl: owner[0], identity: owner[1], drafts: {} });
  drafts.flush();
  assert.equal(storage.map.has(key), false, "an empty journal removes its key");
  assert.equal(saved[saved.length - 1], "saved");
});

test("drafts: storage that drops or throws reports only-in-tab; malformed journals report malformed", () => {
  for (const opts of [{ drops: true }, { throws: true }]) {
    const saved = [];
    const drafts = gap.createDrafts(memoryStorage(opts), (s) => saved.push(s), () => 1);
    drafts.save({ serverUrl: "wss://x", identity: "kai", drafts: { "#a": "text" } });
    drafts.flush();
    assert.deepEqual(saved, ["only-in-tab"]);
  }
  const bad = memoryStorage();
  const key = gap.draftsKey("wss://x", "kai");
  bad.map.set(key, "{not json");
  const drafts = gap.createDrafts(bad, () => {}, () => 1);
  assert.deepEqual([drafts.load("wss://x", "kai").status, drafts.load("wss://x", "kai").drafts], ["malformed", {}]);
  assert.equal(gap.createDrafts(null, () => {}, () => 1).load("wss://x", "kai").status, "only-in-tab");
  assert.equal(drafts.load(" x", "kai").status, "only-in-tab");
});

test("drafts load never trusts the stored shape", () => {
  const storage = memoryStorage();
  const key = gap.draftsKey("wss://x", "kai");
  storage.map.set(key, JSON.stringify({ "#ok": "hi", "bad key": "x", "#num": 4, "#nested": { a: 1 } }));
  const drafts = gap.createDrafts(storage, () => {}, () => 1);
  assert.deepEqual(drafts.load("wss://x", "kai").drafts, { "#ok": "hi" });
  storage.map.set(key, "x".repeat(3 * 1024 * 1024 + 1));
  assert.equal(drafts.load("wss://x", "kai").status, "malformed");
});

/* ── Paste / drop ─────────────────────────────────────────────────── */
test("filesFrom reads clipboard / drag data (files first, items as the fallback)", () => {
  const a = fileOf("a", "a.png", "image/png");
  const b = fileOf("b", "b.png", "image/png");
  assert.deepEqual(gap.filesFrom({ files: [a, b] }), [a, b]);
  assert.deepEqual(gap.filesFrom({ files: [], items: [{ kind: "string" }, { kind: "file", getAsFile: () => a }, { kind: "file", getAsFile: () => null }] }), [a]);
  assert.deepEqual(gap.filesFrom(null), []);
  assert.deepEqual(gap.filesFrom({}), []);
});

function composerSetup({ enabled = true } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><body><textarea id="shell-composer-input"${enabled ? "" : " disabled"}></textarea><p id="elsewhere">x</p></body>`, { pretendToBeVisual: true });
  const doc = dom.window.document;
  const picked = [];
  const drop = [];
  const app = { ports: { uploadPicked: { send: (m) => picked.push(m) }, gapDropActive: { send: (v) => drop.push(v) } } };
  const held = {};
  const uploads = gap.createUploads(app);
  gap.wireComposer(app, doc, held, uploads);
  const ev = (type, extra = {}, target = doc.getElementById("shell-composer-input")) => {
    const e = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [k, v] of Object.entries(extra)) Object.defineProperty(e, k, { value: v });
    target.dispatchEvent(e);
    return e;
  };
  return { dom, doc, picked, drop, held, ev };
}

test("paste: files are staged (never sent), the paste is claimed; text paste is left alone", () => {
  const { picked, held, ev, dom } = composerSetup();
  const shot = fileOf("png-bytes", "image.png", "image/png");
  const claimed = ev("paste", { clipboardData: { files: [shot] } });
  assert.equal(claimed.defaultPrevented, true);
  assert.equal(picked.length, 1);
  assert.deepEqual(picked[0].files, [{ name: "image.png", size: 9, mime: "image/png" }]);
  assert.deepEqual(held[picked[0].key], [shot]);
  const text = ev("paste", { clipboardData: { files: [], items: [] } });
  assert.equal(text.defaultPrevented, false);
  assert.equal(picked.length, 1);
  const elsewhere = ev("paste", { clipboardData: { files: [shot] } }, dom.window.document.getElementById("elsewhere"));
  assert.equal(elsewhere.defaultPrevented, false, "only the composer field takes pastes");
  assert.equal(picked.length, 1);
});

test("drop: a file drag shows the target, a drop stages and clears it, leaving the window clears it", () => {
  const { picked, drop, ev, doc } = composerSetup();
  const f = fileOf("x", "a.jpg", "image/jpeg");
  const over = ev("dragover", { dataTransfer: { types: ["Files"], files: [f] } }, doc.body);
  assert.equal(over.defaultPrevented, true);
  assert.deepEqual(drop, [true]);
  ev("dragleave", { dataTransfer: { types: ["Files"] }, relatedTarget: null }, doc.body);
  assert.deepEqual(drop, [true, false]);
  ev("dragover", { dataTransfer: { types: ["Files"], files: [f] } }, doc.body);
  const dropped = ev("drop", { dataTransfer: { types: ["Files"], files: [f] } }, doc.body);
  assert.equal(dropped.defaultPrevented, true);
  assert.equal(drop[drop.length - 1], false);
  assert.equal(picked.length, 1, "staged once");
  const plain = ev("dragover", { dataTransfer: { types: ["text/plain"] } }, doc.body);
  assert.equal(plain.defaultPrevented, false, "text drags are not ours");
});

test("drop with no usable composer claims the drag (no navigation) but stages nothing", () => {
  const { picked, ev, doc } = composerSetup({ enabled: false });
  const f = fileOf("x", "a.jpg", "image/jpeg");
  const dropped = ev("drop", { dataTransfer: { types: ["Files"], files: [f] } }, doc.body);
  assert.equal(dropped.defaultPrevented, true);
  assert.equal(picked.length, 0);
});

/* ── Focus: menu roving, picker, search, return ───────────────────── */
function focusSetup() {
  const dom = new JSDOM(
    `<!DOCTYPE html><body>
      <div data-row-key="m:s5"><button class="onyx-msg-menu-trigger" id="t1">more</button></div>
      <input id="shell-composer-input"></body>`,
    { pretendToBeVisual: true },
  );
  const doc = dom.window.document;
  const focus = gap.installFocus(doc, null);
  return { dom, doc, focus };
}
const key = (dom, doc, k, init = {}) => {
  const e = new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  (doc.activeElement || doc.body).dispatchEvent(e);
  return e;
};
function openMenu(doc, labels = ["Reply", "React", "Copy"]) {
  const menu = doc.createElement("div");
  menu.className = "onyx-msg-menu";
  menu.setAttribute("role", "menu");
  for (const l of labels) {
    const b = doc.createElement("button");
    b.setAttribute("role", "menuitem");
    b.textContent = l;
    if (l === "Disabled") b.disabled = true;
    menu.appendChild(b);
  }
  doc.querySelector("[data-row-key]").appendChild(menu);
  return menu;
}

test("message menu: opens on its first item, roves with arrows / Home / End, wraps up", () => {
  const { dom, doc, focus } = focusSetup();
  doc.getElementById("t1").focus();
  const menu = openMenu(doc, ["Reply", "Disabled", "React", "Copy"]);
  focus.settle();
  const items = [...menu.querySelectorAll('[role="menuitem"]:not([disabled])')];
  assert.equal(doc.activeElement, items[0]);
  assert.equal(key(dom, doc, "ArrowDown").defaultPrevented, true);
  assert.equal(doc.activeElement, items[1], "the disabled item is skipped");
  key(dom, doc, "End");
  assert.equal(doc.activeElement, items[2]);
  key(dom, doc, "ArrowDown");
  assert.equal(doc.activeElement, items[2], "no wrap past the end");
  key(dom, doc, "Home");
  assert.equal(doc.activeElement, items[0]);
  key(dom, doc, "ArrowUp");
  assert.equal(doc.activeElement, items[2], "ArrowUp from the first item wraps to the last");
  const ctrl = key(dom, doc, "ArrowDown", { ctrlKey: true });
  assert.equal(ctrl.defaultPrevented, false, "modified arrows are left to the browser");
});

test("message menu: closing returns focus to the opener even though its row re-rendered", () => {
  const { dom, doc, focus } = focusSetup();
  const trigger = doc.getElementById("t1");
  trigger.focus();
  trigger.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
  /* Opening re-renders the row: the old trigger leaves the DOM (focus drops
     to <body>) and a fresh one takes its place, exactly like the Elm view. */
  const row = doc.querySelector("[data-row-key]");
  const menu = openMenu(doc);
  trigger.remove();
  const fresh = doc.createElement("button");
  fresh.className = "onyx-msg-menu-trigger";
  fresh.id = "t2";
  row.insertBefore(fresh, row.firstChild);
  focus.settle();
  assert.equal(doc.activeElement.textContent, "Reply");
  menu.remove();
  focus.settle();
  assert.equal(doc.activeElement, fresh, "focus lands on the row's new trigger");
});

test("message menu: focus the user already moved elsewhere is not stolen back", () => {
  const { doc, focus } = focusSetup();
  doc.getElementById("t1").focus();
  const menu = openMenu(doc);
  focus.settle();
  menu.remove();
  doc.getElementById("shell-composer-input").focus();
  focus.settle();
  assert.equal(doc.activeElement.id, "shell-composer-input");
});

test("reaction picker: opens on its search field, ArrowDown enters the grid, arrows move, ArrowUp returns to search", () => {
  const { dom, doc, focus } = focusSetup();
  doc.getElementById("t1").focus();
  const picker = doc.createElement("div");
  picker.className = "onyx-react-picker";
  const search = doc.createElement("input");
  search.className = "onyx-react-search";
  picker.appendChild(search);
  const choices = ["a", "b", "c"].map((t) => {
    const b = doc.createElement("button");
    b.className = "onyx-react-choice";
    b.textContent = t;
    picker.appendChild(b);
    return b;
  });
  doc.querySelector("[data-row-key]").appendChild(picker);
  focus.settle();
  assert.equal(doc.activeElement, search);
  key(dom, doc, "ArrowDown");
  assert.equal(doc.activeElement, choices[0]);
  key(dom, doc, "ArrowRight");
  assert.equal(doc.activeElement, choices[1]);
  key(dom, doc, "ArrowLeft");
  assert.equal(doc.activeElement, choices[0]);
  key(dom, doc, "End");
  assert.equal(doc.activeElement, choices[2]);
});

test("search panel: opens on its field and gives focus back when it closes with nothing focused", () => {
  const { doc, focus } = focusSetup();
  const opener = doc.getElementById("shell-composer-input");
  opener.focus();
  const panel = doc.createElement("section");
  panel.className = "onyx-message-search";
  const input = doc.createElement("input");
  input.id = "onyx-message-search-input";
  panel.appendChild(input);
  doc.body.appendChild(panel);
  focus.settle();
  assert.equal(doc.activeElement, input);
  panel.remove();
  focus.settle();
  assert.equal(doc.activeElement, opener);
});

test("search panel: when its opener is gone (a phone sheet closed) focus goes to the composer, never <body>", () => {
  const { doc, focus } = focusSetup();
  const sheetButton = doc.createElement("button");
  doc.body.appendChild(sheetButton);
  sheetButton.focus();
  const panel = doc.createElement("section");
  panel.className = "onyx-message-search";
  const input = doc.createElement("input");
  input.id = "onyx-message-search-input";
  panel.appendChild(input);
  doc.body.appendChild(panel);
  sheetButton.remove();
  focus.settle();
  assert.equal(doc.activeElement, input);
  panel.remove();
  focus.settle();
  assert.equal(doc.activeElement.id, "shell-composer-input");
});

test("drop with a modal dialog open claims the drag but stages nothing behind it", () => {
  const { picked, drop, ev, doc } = composerSetup();
  const dialog = doc.createElement("section");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  doc.body.appendChild(dialog);
  const f = fileOf("x", "a.jpg", "image/jpeg");
  const over = ev("dragover", { dataTransfer: { types: ["Files"], files: [f] } }, doc.body);
  assert.equal(over.defaultPrevented, true);
  assert.deepEqual(drop, [], "no drop target is shown over a dialog");
  const dropped = ev("drop", { dataTransfer: { types: ["Files"], files: [f] } }, doc.body);
  assert.equal(dropped.defaultPrevented, true);
  assert.equal(picked.length, 0);
});
