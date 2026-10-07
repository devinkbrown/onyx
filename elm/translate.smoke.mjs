/* Translation bridge smoke test — the `translateRequest` port mirrors
   `BrowserTranslatorAdapter` (the browser Translator API behind a
   request/result pair; an absent API reports unavailable so callers
   surface it instead of failing silently), and `translationConfig`
   reports availability plus the stored target and browser fallback.
   Run with:
     node --test elm/translate.smoke.mjs
   (from the repo root). Needs the repo jsdom devDependency. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
require("./ports.js");
const { wire } = globalThis.OnyxPorts;

const stub = () => ({ subscribe() {}, send() {} });

function harness({ translator, storedTarget } = {}) {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "https://example.test/", pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  if (translator === null) {
    delete dom.window.Translator;
  } else if (translator) {
    dom.window.Translator = translator;
  }
  if (storedTarget !== undefined) {
    dom.window.localStorage.setItem("onyx:translation-target", storedTarget);
  }
  let config = null;
  const requests = [];
  let resultHandler = null;
  const ports = {
    wsConnect: stub(),
    wsSend: stub(),
    wsClose: stub(),
    vaultPut: stub(),
    vaultGet: stub(),
    passkeyCreate: stub(),
    passkeyGet: stub(),
    passkeySettleRequest: stub(),
    dmSealRequest: stub(),
    dmOpenRequest: stub(),
    dmPublishKey: stub(),
    roomSealRequest: stub(),
    roomOpenRequest: stub(),
    groupControlInstall: stub(),
    groupDirectoryDerive: stub(),
    guidesProgressRequest: stub(),
    guidesProgressStore: stub(),
    blocklistsSave: stub(),
    transcriptDownload: stub(),
    mediaSave: stub(),
    translationConfig: { send(payload) { config = payload; } },
    translateRequest: { subscribe(fn) { requests.push(fn); } },
    translateResult: { send(payload) { if (resultHandler) resultHandler(payload); } },
  };
  wire({ ports });
  return { dom, requests, getConfig: () => config, onResult: (fn) => { resultHandler = fn; } };
}

function cleanup(h) {
  h.dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const fakeTranslator = (map) => ({
  create: async (options) => ({
    options,
    translate: async (text) => map[text] ?? `${text}::${options.targetLanguage}`,
  }),
});

test("config reports availability, stored target, and browser fallback", async () => {
  const h = harness({ translator: fakeTranslator({}), storedTarget: "pt-BR" });
  try {
    await tick();
    assert.equal(h.getConfig().available, true);
    assert.equal(h.getConfig().target, "pt");
    assert.equal(typeof h.getConfig().browserLang, "string");
  } finally {
    cleanup(h);
  }
});

test("absent API reports unavailable", async () => {
  const h = harness({ translator: null });
  try {
    await tick();
    assert.equal(h.getConfig().available, false);
  } finally {
    cleanup(h);
  }
});

test("requests translate through the browser API and echo the request", async () => {
  const h = harness({ translator: fakeTranslator({ hola: "hello" }) });
  try {
    let result = null;
    h.onResult((payload) => { result = payload; });
    assert.equal(h.requests.length, 1);
    h.requests[0]({ msgid: "m1", lang: "en", source: "hola", text: "hola", targetLang: "en" });
    await tick();
    await tick();
    assert.equal(result.ok, true);
    assert.equal(result.text, "hello");
    assert.equal(result.msgid, "m1");
    assert.equal(result.lang, "en");
    assert.equal(result.source, "hola");
  } finally {
    cleanup(h);
  }
});

test("requests without an API report failure with the echo intact", async () => {
  const h = harness({ translator: null });
  try {
    let result = null;
    h.onResult((payload) => { result = payload; });
    h.requests[0]({ msgid: "m9", lang: "en", source: "hola", text: "hola", targetLang: "en" });
    await tick();
    assert.equal(result.ok, false);
    assert.equal(result.msgid, "m9");
    assert.equal(result.source, "hola");
  } finally {
    cleanup(h);
  }
});
