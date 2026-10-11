/* v3/gap-auth ports smoke test — the pre-001 CHALLENGE proof of work
   (BLAKE3), the held-password IDENTIFY composer and the SETPASS credential
   staging.

   BLAKE3 is checked against the official test vectors
   (BLAKE3-team/BLAKE3 test_vectors/test_vectors.json; input = the 251-byte
   0,1,2,… pattern). The 22 extended-output (131-byte) vectors are copied
   from the copy embedded in the Zig standard library
   (lib/std/crypto/blake3.zig — the very hash the Onyx Server uses in
   src/daemon/challenge.zig `powOk`), the 13 short-input vectors are the
   first 32 bytes of the official vectors for lengths 2-8 and 63-129
   (single-chunk, multi-block edge cases the Zig table omits).

   The proof of work itself is the server's: BLAKE3(seed ‖ answer)[0] == 0
   where seed is the raw bytes behind the NOTICE hex (challenge.zig `powOk`,
   its own test uses the seed 01 02 … 10 and decimal nonces).

   Run with:
     node --test elm/challenge.smoke.mjs
   (from the repo root). Zero dependencies beyond node itself. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./ports.js");
const { challenge, sasl, wireAuthGate } = globalThis.OnyxPorts;

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const pattern = (n) => Uint8Array.from({ length: n }, (_, i) => i % 251);

/* [input length, 131-byte (262 hex chars) extended hash] */
const OFFICIAL_XOF = [
  [0, "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262e00f03e7b69af26b7faaf09fcd333050338ddfe085b8cc869ca98b206c08243a26f5487789e8f660afe6c99ef9e0c52b92e7393024a80459cf91f476f9ffdbda7001c22e159b402631f277ca96f2defdf1078282314e763699a31c5363165421cce14d"],
  [1, "2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213c3a6cb8bf623e20cdb535f8d1a5ffb86342d9c0b64aca3bce1d31f60adfa137b358ad4d79f97b47c3d5e79f179df87a3b9776ef8325f8329886ba42f07fb138bb502f4081cbcec3195c5871e6c23e2cc97d3c69a613eba131e5f1351f3f1da786545e5"],
  [1023, "10108970eeda3eb932baac1428c7a2163b0e924c9a9e25b35bba72b28f70bd11a182d27a591b05592b15607500e1e8dd56bc6c7fc063715b7a1d737df5bad3339c56778957d870eb9717b57ea3d9fb68d1b55127bba6a906a4a24bbd5acb2d123a37b28f9e9a81bbaae360d58f85e5fc9d75f7c370a0cc09b6522d9c8d822f2f28f485"],
  [1024, "42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af71cf8107265ecdaf8505b95d8fcec83a98a6a96ea5109d2c179c47a387ffbb404756f6eeae7883b446b70ebb144527c2075ab8ab204c0086bb22b7c93d465efc57f8d917f0b385c6df265e77003b85102967486ed57db5c5ca170ba441427ed9afa684e"],
  [1025, "d00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444f4c4a22b4b399155358a994e52bf255de60035742ec71bd08ac275a1b51cc6bfe332b0ef84b409108cda080e6269ed4b3e2c3f7d722aa4cdc98d16deb554e5627be8f955c98e1d5f9565a9194cad0c4285f93700062d9595adb992ae68ff12800ab67a"],
  [2048, "e776b6028c7cd22a4d0ba182a8bf62205d2ef576467e838ed6f2529b85fba24a9a60bf80001410ec9eea6698cd537939fad4749edd484cb541aced55cd9bf54764d063f23f6f1e32e12958ba5cfeb1bf618ad094266d4fc3c968c2088f677454c288c67ba0dba337b9d91c7e1ba586dc9a5bc2d5e90c14f53a8863ac75655461cea8f9"],
  [2049, "5f4d72f40d7a5f82b15ca2b2e44b1de3c2ef86c426c95c1af0b687952256303096de31d71d74103403822a2e0bc1eb193e7aecc9643a76b7bbc0c9f9c52e8783aae98764ca468962b5c2ec92f0c74eb5448d519713e09413719431c802f948dd5d90425a4ecdadece9eb178d80f26efccae630734dff63340285adec2aed3b51073ad3"],
  [3072, "b98cb0ff3623be03326b373de6b9095218513e64f1ee2edd2525c7ad1e5cffd29a3f6b0b978d6608335c09dc94ccf682f9951cdfc501bfe47b9c9189a6fc7b404d120258506341a6d802857322fbd20d3e5dae05b95c88793fa83db1cb08e7d8008d1599b6209d78336e24839724c191b2a52a80448306e0daa84a3fdb566661a37e11"],
  [3073, "7124b49501012f81cc7f11ca069ec9226cecb8a2c850cfe644e327d22d3e1cd39a27ae3b79d68d89da9bf25bc27139ae65a324918a5f9b7828181e52cf373c84f35b639b7fccbb985b6f2fa56aea0c18f531203497b8bbd3a07ceb5926f1cab74d14bd66486d9a91eba99059a98bd1cd25876b2af5a76c3e9eed554ed72ea952b603bf"],
  [4096, "015094013f57a5277b59d8475c0501042c0b642e531b0a1c8f58d2163229e9690289e9409ddb1b99768eafe1623da896faf7e1114bebeadc1be30829b6f8af707d85c298f4f0ff4d9438aef948335612ae921e76d411c3a9111df62d27eaf871959ae0062b5492a0feb98ef3ed4af277f5395172dbe5c311918ea0074ce0036454f620"],
  [4097, "9b4052b38f1c5fc8b1f9ff7ac7b27cd242487b3d890d15c96a1c25b8aa0fb99505f91b0b5600a11251652eacfa9497b31cd3c409ce2e45cfe6c0a016967316c426bd26f619eab5d70af9a418b845c608840390f361630bd497b1ab44019316357c61dbe091ce72fc16dc340ac3d6e009e050b3adac4b5b2c92e722cffdc46501531956"],
  [5120, "9cadc15fed8b5d854562b26a9536d9707cadeda9b143978f319ab34230535833acc61c8fdc114a2010ce8038c853e121e1544985133fccdd0a2d507e8e615e611e9a0ba4f47915f49e53d721816a9198e8b30f12d20ec3689989175f1bf7a300eee0d9321fad8da232ece6efb8e9fd81b42ad161f6b9550a069e66b11b40487a5f5059"],
  [5121, "628bd2cb2004694adaab7bbd778a25df25c47b9d4155a55f8fbd79f2fe154cff96adaab0613a6146cdaabe498c3a94e529d3fc1da2bd08edf54ed64d40dcd6777647eac51d8277d70219a9694334a68bc8f0f23e20b0ff70ada6f844542dfa32cd4204ca1846ef76d811cdb296f65e260227f477aa7aa008bac878f72257484f2b6c95"],
  [6144, "3e2e5b74e048f3add6d21faab3f83aa44d3b2278afb83b80b3c35164ebeca2054d742022da6fdda444ebc384b04a54c3ac5839b49da7d39f6d8a9db03deab32aade156c1c0311e9b3435cde0ddba0dce7b26a376cad121294b689193508dd63151603c6ddb866ad16c2ee41585d1633a2cea093bea714f4c5d6b903522045b20395c83"],
  [6145, "f1323a8631446cc50536a9f705ee5cb619424d46887f3c376c695b70e0f0507f18a2cfdd73c6e39dd75ce7c1c6e3ef238fd54465f053b25d21044ccb2093beb015015532b108313b5829c3621ce324b8e14229091b7c93f32db2e4e63126a377d2a63a3597997d4f1cba59309cb4af240ba70cebff9a23d5e3ff0cdae2cfd54e070022"],
  [7168, "61da957ec2499a95d6b8023e2b0e604ec7f6b50e80a9678b89d2628e99ada77a5707c321c83361793b9af62a40f43b523df1c8633cecb4cd14d00bdc79c78fca5165b863893f6d38b02ff7236c5a9a8ad2dba87d24c547cab046c29fc5bc1ed142e1de4763613bb162a5a538e6ef05ed05199d751f9eb58d332791b8d73fb74e4fce95"],
  [7169, "a003fc7a51754a9b3c7fae0367ab3d782dccf28855a03d435f8cfe74605e781798a8b20534be1ca9eb2ae2df3fae2ea60e48c6fb0b850b1385b5de0fe460dbe9d9f9b0d8db4435da75c601156df9d047f4ede008732eb17adc05d96180f8a73548522840779e6062d643b79478a6e8dbce68927f36ebf676ffa7d72d5f68f050b119c8"],
  [8192, "aae792484c8efe4f19e2ca7d371d8c467ffb10748d8a5a1ae579948f718a2a635fe51a27db045a567c1ad51be5aa34c01c6651c4d9b5b5ac5d0fd58cf18dd61a47778566b797a8c67df7b1d60b97b19288d2d877bb2df417ace009dcb0241ca1257d62712b6a4043b4ff33f690d849da91ea3bf711ed583cb7b7a7da2839ba71309bbf"],
  [8193, "bab6c09cb8ce8cf459261398d2e7aef35700bf488116ceb94a36d0f5f1b7bc3bb2282aa69be089359ea1154b9a9286c4a56af4de975a9aa4a5c497654914d279bea60bb6d2cf7225a2fa0ff5ef56bbe4b149f3ed15860f78b4e2ad04e158e375c1e0c0b551cd7dfc82f1b155c11b6b3ed51ec9edb30d133653bb5709d1dbd55f4e1ff6"],
  [16384, "f875d6646de28985646f34ee13be9a576fd515f76b5b0a26bb324735041ddde49d764c270176e53e97bdffa58d549073f2c660be0e81293767ed4e4929f9ad34bbb39a529334c57c4a381ffd2a6d4bfdbf1482651b172aa883cc13408fa67758a3e47503f93f87720a3177325f7823251b85275f64636a8f1d599c2e49722f42e93893"],
  [31744, "62b6960e1a44bcc1eb1a611a8d6235b6b4b78f32e7abc4fb4c6cdcce94895c47860cc51f2b0c28a7b77304bd55fe73af663c02d3f52ea053ba43431ca5bab7bfea2f5e9d7121770d88f70ae9649ea713087d1914f7f312147e247f87eb2d4ffef0ac978bf7b6579d57d533355aa20b8b77b13fd09748728a5cc327a8ec470f4013226f"],
  [102400, "bc3e3d41a1146b069abffad3c0d44860cf664390afce4d9661f7902e7943e085e01c59dab908c04c3342b816941a26d69c2605ebee5ec5291cc55e15b76146e6745f0601156c3596cb75065a9c57f35585a52e1ac70f69131c23d611ce11ee4ab1ec2c009012d236648e77be9295dd0426f29b764d65de58eb7d01dd42248204f45f8e"],
];

/* [input length, first 32 bytes] */
const OFFICIAL_SHORT = [
  [2, "7b7015bb92cf0b318037702a6cdd81dee41224f734684c2c122cd6359cb1ee63"],
  [3, "e1be4d7a8ab5560aa4199eea339849ba8e293d55ca0a81006726d184519e647f"],
  [4, "f30f5ab28fe047904037f77b6da4fea1e27241c5d132638d8bedce9d40494f32"],
  [5, "b40b44dfd97e7a84a996a91af8b85188c66c126940ba7aad2e7ae6b385402aa2"],
  [6, "06c4e8ffb6872fad96f9aaca5eee1553eb62aed0ad7198cef42e87f6a616c844"],
  [7, "3f8770f387faad08faa9d8414e9f449ac68e6ff0417f673f602a646a891419fe"],
  [8, "2351207d04fc16ade43ccab08600939c7c1fa70a5c0aaca76063d04c3228eaeb"],
  [63, "e9bc37a594daad83be9470df7f7b3798297c3d834ce80ba85d6e207627b7db7b"],
  [64, "4eed7141ea4a5cd4b788606bd23f46e212af9cacebacdc7d1f4c6dc7f2511b98"],
  [65, "de1e5fa0be70df6d2be8fffd0e99ceaa8eb6e8c93a63f2d8d1c30ecb6b263dee"],
  [127, "d81293fda863f008c09e92fc382a81f5a0b4a1251cba1634016a0f86a6bd640d"],
  [128, "f17e570564b26578c33bb7f44643f539624b05df1a76c81f30acd548c44b45ef"],
  [129, "683aaae9f3c5ba37eaaf072aed0f9e30bac0865137bae68b1fde4ca2aebdcb12"],
];

test("BLAKE3 matches the official extended-output vectors", () => {
  assert.equal(OFFICIAL_XOF.length, 22);
  for (const [len, want] of OFFICIAL_XOF) {
    const input = pattern(len);
    assert.equal(hex(challenge.blake3(input, 131)), want, `xof len ${len}`);
    assert.equal(hex(challenge.blake3(input)), want.slice(0, 64), `default len ${len}`);
  }
});

test("BLAKE3 matches the official vectors for short and block-boundary inputs", () => {
  for (const [len, want] of OFFICIAL_SHORT) {
    assert.equal(hex(challenge.blake3(pattern(len))), want, `len ${len}`);
  }
});

test("BLAKE3 accepts plain byte arrays and rejects nothing silently", () => {
  assert.equal(hex(challenge.blake3([])), hex(challenge.blake3(new Uint8Array(0))));
  assert.equal(challenge.blake3(new Uint8Array(3), 0).length, 32);
  assert.equal(challenge.blake3(new Uint8Array(3), 7).length, 7);
});

const SERVER_SEED = "0102030405060708090a0b0c0d0e0f10"; /* challenge.zig GAP-P8 test seed */

test("seed hex decodes to the raw bytes the server hashes", () => {
  assert.deepEqual(Array.from(challenge.seedBytes(SERVER_SEED)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.deepEqual(Array.from(challenge.seedBytes("0A0b")), [10, 11]);
  for (const bad of ["", "abc", "zz", "00".repeat(33), "0g", " 00", null, undefined]) {
    assert.equal(challenge.seedBytes(bad), null, JSON.stringify(bad));
  }
});

test("the solver finds the server's first decimal nonce, and the server rule accepts it", () => {
  const answer = challenge.solve(SERVER_SEED, 0, 4096);
  assert.equal(answer, "23");
  assert.equal(challenge.powOk(SERVER_SEED, answer), true);
  /* Independent restatement of challenge.zig `powOk`. */
  const msg = Buffer.concat([Buffer.from(SERVER_SEED, "hex"), Buffer.from(answer)]);
  assert.equal(challenge.blake3(msg, 32)[0], 0);
  /* Every smaller nonce fails the rule (so "23" really is the first). */
  for (let n = 0; n < 23; n++) assert.equal(challenge.powOk(SERVER_SEED, String(n)), false, String(n));
  assert.equal(challenge.powOk(SERVER_SEED, "nope"), false);
});

test("the answer rule mirrors challenge.zig admit (1..64 bytes, no control bytes)", () => {
  assert.equal(challenge.powOk(SERVER_SEED, ""), false);
  assert.equal(challenge.powOk(SERVER_SEED, "x".repeat(65)), false);
  assert.equal(challenge.powOk(SERVER_SEED, "23\n"), false);
  assert.equal(challenge.powOk(SERVER_SEED, "23\u007f"), false);
  assert.equal(challenge.powOk("zz", "23"), false);
});

test("solving works for seeds of every server length and returns '' for a bad seed", () => {
  for (const len of [1, 2, 8, 16, 31, 32]) {
    const seed = Buffer.from(Array.from({ length: len }, (_, i) => (i * 37 + 5) & 255)).toString("hex");
    const answer = challenge.solve(seed, 0, 200000);
    assert.notEqual(answer, "", `seed length ${len}`);
    assert.equal(challenge.powOk(seed, answer), true, `seed length ${len}`);
  }
  assert.equal(challenge.solve("not hex", 0, 100), "");
  assert.equal(challenge.solve("", 0, 100), "");
});

test("the solver stays inside its budget", () => {
  /* A 1-try budget on a seed whose first nonce fails gives up with ''. */
  assert.equal(challenge.solve(SERVER_SEED, 0, 1), "");
  assert.equal(challenge.solve(SERVER_SEED, 23, 1), "23");
});

test("solveAsync answers in slices and gives up on a malformed seed", async () => {
  const answered = await new Promise((resolve) => challenge.solveAsync(SERVER_SEED, resolve));
  assert.equal(answered, "23");
  const none = await new Promise((resolve) => challenge.solveAsync("zz", resolve));
  assert.equal(none, "");
});

/* ---- held-password IDENTIFY ----------------------------------------- */

test("identifyLine composes IDENTIFY <account> <password> <code> from the held credential", () => {
  sasl.setCredentials("Kai", "hunter22", false);
  assert.deepEqual(sasl.identifyLine("kai", "123456"), { line: "IDENTIFY kai hunter22 123456\r\n" });
  sasl.clearCredentials();
});

test("identifyLine refuses what the server would re-split or never accept", () => {
  const refused = (password, account = "kai", code = "123456") => {
    sasl.setCredentials("kai", password, false);
    return sasl.identifyLine(account, code).refused;
  };
  assert.equal(refused("has space"), "unsafe");
  assert.equal(refused(":leading"), "unsafe");
  assert.equal(refused("tab\there"), "unsafe");
  assert.equal(refused("nul\u0000x"), "unsafe");
  assert.equal(refused("fine-password", "kai", "12 3456"), "unsafe");
  assert.equal(refused("fine-password", "kai", ""), "unsafe");
  assert.equal(refused("p".repeat(600)), "toolong");
  assert.equal(refused(""), "nopassword");
  assert.equal(refused("fine-password", "someone-else"), "nopassword");
  assert.equal(refused("fine-password", ""), "nopassword");
  sasl.clearCredentials();
  assert.equal(sasl.identifyLine("kai", "123456").refused, "nopassword");
});

test("a non-ASCII password is sent as UTF-8", () => {
  sasl.setCredentials("kai", "pässwörd€", false);
  assert.equal(sasl.identifyLine("kai", "654321").line, "IDENTIFY kai pässwörd€ 654321\r\n");
  sasl.clearCredentials();
});

/* ---- SETPASS staging -------------------------------------------------- */

test("a staged SETPASS password becomes the credential only after commit", () => {
  sasl.setCredentials("kai", "old-password", false);
  sasl.stageNewPassword("kai", "new-password");
  assert.equal(sasl.plainPayload("kai"), Buffer.from("\0kai\0old-password").toString("base64"));
  assert.equal(sasl.commitNewPassword("KAI"), true);
  assert.equal(sasl.plainPayload("kai"), Buffer.from("\0kai\0new-password").toString("base64"));
  assert.equal(sasl.commitNewPassword("kai"), false, "a commit consumes the staged password");
  sasl.clearCredentials();
});

test("a dropped or mismatched SETPASS never changes the credential", () => {
  sasl.setCredentials("kai", "old-password", false);
  sasl.stageNewPassword("kai", "new-password");
  sasl.dropNewPassword();
  assert.equal(sasl.commitNewPassword("kai"), false);
  sasl.stageNewPassword("kai", "new-password");
  assert.equal(sasl.commitNewPassword("someone-else"), false);
  assert.equal(sasl.plainPayload("kai"), Buffer.from("\0kai\0old-password").toString("base64"));
  sasl.clearCredentials();
});

test("committing never invents a credential for a login that held no password", () => {
  sasl.clearCredentials();
  sasl.stageNewPassword("kai", "new-password");
  assert.equal(sasl.commitNewPassword("kai"), true);
  assert.equal(sasl.plainPayload("kai"), null);
});

test("new credentials and clearing discard a staged password", () => {
  sasl.setCredentials("kai", "old-password", false);
  sasl.stageNewPassword("kai", "new-password");
  sasl.setCredentials("kai", "other-password", false);
  assert.equal(sasl.commitNewPassword("kai"), false);
  sasl.stageNewPassword("kai", "new-password");
  sasl.clearCredentials();
  sasl.setCredentials("kai", "other-password", false);
  assert.equal(sasl.commitNewPassword("kai"), false);
  sasl.clearCredentials();
});

/* ---- the authGate ports ------------------------------------------------ */

function mockApp() {
  const sent = [];
  let handler = null;
  return {
    sent,
    app: {
      ports: {
        authGateOut: { subscribe: (fn) => { handler = fn; } },
        authGateIn: { send: (value) => sent.push(value) },
      },
    },
    out: (value) => handler(value),
  };
}

test("the solve port answers authGateIn with the seed and a valid nonce", async () => {
  const { app, sent, out } = mockApp();
  wireAuthGate(app, () => null);
  out({ kind: "solve", seed: SERVER_SEED });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(sent, [{ kind: "solved", seed: SERVER_SEED, answer: "23" }]);
});

test("a malformed seed is answered with an empty solution, never left hanging", async () => {
  const { app, sent, out } = mockApp();
  wireAuthGate(app, () => null);
  out({ kind: "solve", seed: "zz" });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(sent, [{ kind: "solved", seed: "zz", answer: "" }]);
});

test("the identify port writes the composed line to the open socket and nothing to Elm", () => {
  const { app, sent, out } = mockApp();
  const written = [];
  wireAuthGate(app, () => ({ isOpen: () => true, send: (line) => written.push(line) }));
  sasl.setCredentials("kai", "hunter22", false);
  out({ kind: "identify", account: "kai", code: "123456" });
  assert.deepEqual(written, ["IDENTIFY kai hunter22 123456\r\n"]);
  assert.deepEqual(sent, []);
  sasl.clearCredentials();
});

test("the identify port reports a refusal to Elm and writes nothing", () => {
  const { app, sent, out } = mockApp();
  const written = [];
  wireAuthGate(app, () => ({ isOpen: () => true, send: (line) => written.push(line) }));
  sasl.setCredentials("kai", "has space", false);
  out({ kind: "identify", account: "kai", code: "123456" });
  assert.deepEqual(written, []);
  assert.deepEqual(sent, [{ kind: "identifyRefused", reason: "unsafe" }]);
  /* The refusal never carries the password or code. */
  assert.equal(JSON.stringify(sent).includes("space"), false);
  sasl.clearCredentials();
});

test("the identify port does not write to a closed socket", () => {
  const { app, out } = mockApp();
  const written = [];
  wireAuthGate(app, () => ({ isOpen: () => false, send: (line) => written.push(line) }));
  sasl.setCredentials("kai", "hunter22", false);
  out({ kind: "identify", account: "kai", code: "123456" });
  assert.deepEqual(written, []);
  sasl.clearCredentials();
});

test("stage / commit / drop / forget drive the credential slot", () => {
  const { app, out } = mockApp();
  wireAuthGate(app, () => null);
  sasl.setCredentials("kai", "old-password", false);
  out({ kind: "stage", account: "kai", password: "new-password" });
  out({ kind: "commit", account: "kai" });
  assert.equal(sasl.plainPayload("kai"), Buffer.from("\0kai\0new-password").toString("base64"));
  out({ kind: "stage", account: "kai", password: "third-password" });
  out({ kind: "drop" });
  out({ kind: "commit", account: "kai" });
  assert.equal(sasl.plainPayload("kai"), Buffer.from("\0kai\0new-password").toString("base64"));
  out({ kind: "forget" });
  assert.equal(sasl.plainPayload("kai"), null);
});

test("unknown or malformed port messages are ignored", () => {
  const { app, sent, out } = mockApp();
  wireAuthGate(app, () => null);
  for (const value of [null, undefined, {}, { kind: "nope" }, "solve", 7]) out(value);
  assert.deepEqual(sent, []);
});

test("nothing in these paths writes a secret to the console", async () => {
  const seen = [];
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  for (const k of Object.keys(original)) console[k] = (...args) => seen.push(args.join(" "));
  try {
    const { app, out } = mockApp();
    wireAuthGate(app, () => ({ isOpen: () => true, send() {} }));
    sasl.setCredentials("kai", "s3cret-pass", false);
    out({ kind: "identify", account: "kai", code: "999999" });
    out({ kind: "stage", account: "kai", password: "n3w-secret" });
    out({ kind: "commit", account: "kai" });
    out({ kind: "solve", seed: SERVER_SEED });
    await new Promise((r) => setTimeout(r, 20));
    sasl.clearCredentials();
  } finally {
    Object.assign(console, original);
  }
  assert.deepEqual(seen, []);
});
