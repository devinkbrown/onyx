/* Onyx Elm port implementations: WSS socket fan-out, the IndexedDB
   history vault, and WebAuthn passkey ceremonies. The Elm side stays
   pure and fail-closed; every effect the client needs (socket writes,
   vault get/put, credential ceremonies) crosses one of these ports.
   VAULT_KEEP mirrors the SolidJS vault: 400 rows per target, newest
   wins, trim on write — unless a `onyx:vault-retention-policy`
   value says otherwise (per-target keep + max-age, stricter-wins). */

(function (global) {
  "use strict";

  var VAULT_KEEP = 400;
  var DB_NAME = "onyx-vault";
  var DB_VERSION = 3;
  var STORE = "messages";
  var OUTBOX = "outbox";
  var SCHEDULED = "scheduled";
  var VAULT_META = "vault_meta";
  var SCHEDULED_CLEAR_EPOCH_KEY = "clear-epoch";
  var SCHEDULED_MAX_ROWS = 256;
  /* Mirrors historyVault OUTBOX_MAX_ENTRIES / OUTBOX_MAX_AGE_MS. */
  var OUTBOX_MAX_ENTRIES = 100;
  var OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  /* Session admission guards (mirror the oracle `_outboxWireAdmitted`
     memory set and the held-claim never-retry rule). `outboxWireAdmitted`
     holds ids already written to the socket this session so a later walk
     (or reload-safe durable `wire_admitted` mark) never re-admits them and
     only retries the prune. `outboxUncertainHeld` holds ids whose admission
     stayed unproven: like the oracle's never-released claim they are carried
     as waiting on later walks — never re-sent, never re-toasted. Both are
     per page load; the durable mark covers reloads for admitted rows. */
  var outboxWireAdmitted = {};
  var outboxUncertainHeld = {};
  /* Ports-minted flush labels (`q…`, never the Elm `o…` series so the
     two mint streams cannot collide in one session). Opaque, pure ASCII,
     far under the 64-byte labeled-response bound. */
  var outboxLabelCounter = 0;

  function mintFlushLabel() {
    outboxLabelCounter = (outboxLabelCounter + 1) % 0xffffff;
    return "q" + Date.now().toString(36) + outboxLabelCounter.toString(36);
  }

  function openVault(onReady) {
    if (!("indexedDB" in global)) {
      onReady(null);
      return;
    }
    var req = global.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        var store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("by-target", "target", { unique: false });
      }
      /* v2 additive layer: the durable offline outbox. Creating only
         the missing store keeps existing v1 message rows untouched. */
      if (!db.objectStoreNames.contains(OUTBOX)) {
        db.createObjectStore(OUTBOX, { keyPath: "id" });
      }
      /* v3 additive layer: the durable scheduled-message queue plus the
         vault metadata journal (erase epoch + per-owner generations).
         Additive like v2: existing rows are never migrated or touched. */
      if (!db.objectStoreNames.contains(SCHEDULED)) {
        db.createObjectStore(SCHEDULED, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(VAULT_META)) {
        db.createObjectStore(VAULT_META, { keyPath: "id" });
      }
    };
    req.onsuccess = function () { onReady(req.result); };
    req.onerror = function () { onReady(null); };
  }

  var VAULT_EXPORT_MAX_TOTAL = 16 * 1024;
  var VAULT_EXPORT_MAX_PER_TARGET = 4 * 400;
  var VAULT_EXPORT_MAX_TARGETS = 4096;

  function vaultRowAt(value) {
    return (typeof value === "number" && isFinite(value)) ? Math.max(0, Math.floor(value)) : 0;
  }

  /* Coerce one stored row to the wire shape. Legacy rows without a
     stamp read back as `at: 0` (unknown time, ordered by clock
     distance like everything else — the oracle has no special case);
     legacy rows without a type read back as `msg` so the Elm record
     decoder stays total over pre-type stores. */
  var VAULT_ROW_TYPES = {
    msg: 1, action: 1, notice: 1, join: 1, part: 1, quit: 1, kick: 1,
    mode: 1, topic: 1, nick: 1, system: 1, error: 1, whisper: 1
  };
  function vaultPlainRow(value) {
    var row = value || {};
    var rowType = typeof row.rowType === "string" ? row.rowType : "";
    var reply = row.replyTo && typeof row.replyTo === "object" ? row.replyTo : null;
    return {
      id: String(row.id || ""),
      target: String(row.target || ""),
      from: String(row.from || ""),
      body: String(row.body || ""),
      at: vaultRowAt(row.at),
      rowType: VAULT_ROW_TYPES[rowType] ? rowType : "msg",
      // Tombstone flags ride with the row (mirroring StoredMessage);
      // legacy rows predate them and read back clear.
      deleted: !!row.deleted,
      redacted: !!row.redacted,
      // Reply context rides with the row (mirroring StoredMessage.replyTo);
      // hostile or legacy shapes read back empty (Elm re-sanitizes on merge).
      replyTo:
        reply && typeof reply.id === "string" && typeof reply.from === "string" && typeof reply.text === "string"
          ? { id: reply.id, from: reply.from, text: reply.text }
          : null
    };
  }

  /* Deleted/redacted tombstones never surface in recall or time-travel,
     mirroring the `!r.deleted && !r.redacted` read filters. */
  function vaultTombstoned(row) {
    return !!(row && (row.deleted || row.redacted));
  }

  /* Vault retention policy — structurally-identical mirror of the pure
     oracle `src/lib/vault/retentionPolicy.ts`. The Elm `Retention`
     module is the shared truth for validation and selection; this
     mirror enforces the live policy in the save/prune path and
     `vaultHistory.smoke.mjs` pins both shapes. The policy is re-read
     from browser-local storage on every trim, so a future preferences
     UI (or a manually-stored value) takes effect without a reload. */
  var RETENTION_MAX_KEEP = 5000;
  var RETENTION_MAX_AGE_DAYS = 3650;
  var RETENTION_POLICY_KEY = "onyx:vault-retention-policy";
  var RETENTION_DAY_MS = 24 * 60 * 60 * 1000;

  function sanitizeRetentionKeep(value, fallback) {
    if (typeof value !== "number" || !isFinite(value) || value < 0) return fallback;
    return Math.min(Math.floor(value), RETENTION_MAX_KEEP);
  }

  function sanitizeRetentionPolicy(policy) {
    var raw = (policy && typeof policy === "object" && !Array.isArray(policy)) ? policy : {};
    var out = { keep: sanitizeRetentionKeep(raw.keep, VAULT_KEEP) };
    var overrides = raw.perChannel;
    if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
      var perChannel = {};
      Object.keys(overrides).forEach(function (rawKey) {
        var v = overrides[rawKey];
        if (typeof v !== "number" || !isFinite(v) || v < 0) return;
        perChannel[String(rawKey).toLowerCase()] = Math.min(Math.floor(v), RETENTION_MAX_KEEP);
      });
      if (Object.keys(perChannel).length > 0) out.perChannel = perChannel;
    }
    var age = raw.maxAgeDays;
    if (typeof age === "number" && isFinite(age) && age > 0) {
      out.maxAgeDays = Math.min(age, RETENTION_MAX_AGE_DAYS);
    }
    return out;
  }

  function readRetentionPolicy() {
    try {
      var store = (typeof global.localStorage !== "undefined") ? global.localStorage : null;
      var raw = store ? store.getItem(RETENTION_POLICY_KEY) : null;
      if (!raw) return { keep: VAULT_KEEP };
      var parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { keep: VAULT_KEEP };
      return sanitizeRetentionPolicy(parsed);
    } catch (err) {
      return { keep: VAULT_KEEP };
    }
  }

  function retentionEffectiveKeep(policy, channel) {
    var safe = sanitizeRetentionPolicy(policy);
    var override = safe.perChannel ? safe.perChannel[String(channel).toLowerCase()] : undefined;
    return (typeof override === "number") ? override : safe.keep;
  }

  function retentionEpochMs(time) {
    return (typeof time === "number" && isFinite(time)) ? time : 0;
  }

  /* Deterministically select the ids to prune for one target (count cap
     plus age cutoff, stricter-wins; oldest-first out, ties by id).
     `messages` are `{id, at}` vault shapes. */
  function selectPruneIds(messages, policy, nowMs) {
    var list = messages || [];
    if (list.length === 0) return [];
    var safe = sanitizeRetentionPolicy(policy);
    var ordered = list.map(function (m) {
      return { id: String((m && m.id) || ""), ms: retentionEpochMs(m && m.at) };
    }).sort(function (a, b) {
      return (a.ms - b.ms) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    var drop = {};
    var dropByCount = Math.max(0, ordered.length - safe.keep);
    for (var i = 0; i < dropByCount; i++) drop[ordered[i].id] = true;
    if (typeof safe.maxAgeDays === "number" && isFinite(nowMs)) {
      var cutoff = nowMs - safe.maxAgeDays * RETENTION_DAY_MS;
      ordered.forEach(function (entry) { if (entry.ms < cutoff) drop[entry.id] = true; });
    }
    return ordered.filter(function (entry) { return drop[entry.id]; }).map(function (entry) { return entry.id; });
  }

  function vaultPut(db, rows, onDone) {
    if (db === null) {
      onDone(0);
      return;
    }
    var now = (typeof Date !== "undefined" && Date.now) ? Date.now() : 0;
    var tx = db.transaction(STORE, "readwrite");
    var store = tx.objectStore(STORE);
    rows.forEach(function (row) {
      // Elm has no clock: stamp write time ports-side so loadAround has
      // an anchor. An explicit stamp is never clobbered.
      if (!row.at) row.at = now;
      row.deleted = !!row.deleted;
      row.redacted = !!row.redacted;
      store.put(row);
      // Any write voids the target's proof (mirroring
      // `invalidateVaultDmSearchPrivacy`): the proof is re-earned by a
      // fresh scan, never carried across a mutation.
      vaultDmPrivacyInvalidate(row && row.target);
    });
    tx.oncomplete = function () { trimTarget(db, rows, onDone); };
    tx.onerror = function () { onDone(0); };
  }

  function trimTarget(db, rows, onDone) {
    var targets = {};
    rows.forEach(function (row) { targets[row.target] = true; });
    var names = Object.keys(targets);
    if (names.length === 0) {
      onDone(rows.length);
      return;
    }
    // The live retention policy applies per target: its override (else
    // the default keep) caps the count newest-first by (at, id), and the
    // age cutoff drops strictly-older rows. Read fresh on every trim.
    var policy = readRetentionPolicy();
    var now = (typeof Date !== "undefined" && Date.now) ? Date.now() : NaN;
    var tx = db.transaction(STORE, "readwrite");
    var store = tx.objectStore(STORE);
    var index = store.index("by-target");
    var pending = names.length;
    names.forEach(function (target) {
      var seen = [];
      var cursor = index.openCursor(IDBKeyRange.only(target));
      cursor.onsuccess = function () {
        var c = cursor.result;
        if (c) {
          var plain = vaultPlainRow(c.value);
          seen.push({ key: c.primaryKey, id: plain.id, at: plain.at });
          c.continue();
        } else {
          var channelPolicy = { keep: retentionEffectiveKeep(policy, target) };
          if (typeof policy.maxAgeDays === "number") channelPolicy.maxAgeDays = policy.maxAgeDays;
          var prune = selectPruneIds(seen, channelPolicy, now);
          var keyById = {};
          seen.forEach(function (entry) { keyById[entry.id] = entry.key; });
          prune.forEach(function (id) {
            if (keyById[id] !== undefined) { try { store.delete(keyById[id]); } catch (err) {} }
          });
          pending -= 1;
        }
      };
    });
    tx.oncomplete = function () { onDone(rows.length); };
    tx.onerror = function () { onDone(rows.length); };
  }

  /* DM search-scope proofs (mirroring `dmSearchPrivacy.ts` +
     `classifyVaultDmSearchPrivacy`): per-target `plain`/`encrypted`
     cache, voided by any vault write to the target, proven by scanning
     every retained row. One encrypted row — an explicit flag or
     envelope wire text — keeps the server query off the wire.
     Cursor/transaction failures report `unknown`, never `plain`. */
  var vaultDmPrivacyCache = {};

  function vaultDmPrivacyCacheKey(target) {
    return String(target || "").toLowerCase();
  }

  function vaultDmPrivacyInvalidate(target) {
    delete vaultDmPrivacyCache[vaultDmPrivacyCacheKey(target)];
  }

  function vaultDmPrivacyTextEncrypted(text) {
    if (typeof text !== "string") return false;
    return text.indexOf(E2EE_ENVELOPE_PREFIX) === 0
      || text.indexOf(E2EE_MULTI_PREFIX) === 0
      || text.indexOf(GROUP_ENVELOPE_PREFIX) === 0;
  }

  function vaultDmPrivacyRowEncrypted(row) {
    if (row && row.encrypted === true) return true;
    // Either wire-text field proves encryption (fail closed on
    // disagreement: the oracle reads `row.text`, ports rows carry
    // `body`, and a row showing an envelope in either field keeps the
    // query off the server).
    return vaultDmPrivacyTextEncrypted(row && row.body)
      || vaultDmPrivacyTextEncrypted(row && row.text);
  }

  /* Pure over plain rows so node can smoke-test the verdict without
     IndexedDB: `encrypted` when any retained row is encrypted. */
  function classifyVaultDmRows(rows) {
    var list = rows || [];
    for (var i = 0; i < list.length; i++) {
      if (vaultDmPrivacyRowEncrypted(list[i])) return "encrypted";
    }
    return "plain";
  }

  function classifyVaultDm(db, target, onDone) {
    var key = vaultDmPrivacyCacheKey(target);
    if (vaultDmPrivacyCache[key]) {
      onDone(vaultDmPrivacyCache[key]);
      return;
    }
    if (db === null) {
      // No IndexedDB on this host: nothing retained, so nothing to
      // protect — mirroring the no-IDB `plain` commit.
      vaultDmPrivacyCache[key] = "plain";
      onDone("plain");
      return;
    }
    var collected = [];
    var failed = false;
    var tx;
    try {
      tx = db.transaction(STORE, "readonly");
    } catch (err) {
      onDone("unknown");
      return;
    }
    try {
      var cursor = tx.objectStore(STORE).index("by-target").openCursor(IDBKeyRange.only(target));
      cursor.onsuccess = function () {
        var c = cursor.result;
        if (!c) return;
        if (vaultDmPrivacyRowEncrypted(c.value)) {
          collected = [{ encrypted: true }];
          return;
        }
        collected.push(c.value);
        c.continue();
      };
      cursor.onerror = function () { failed = true; };
    } catch (err) {
      failed = true;
    }
    tx.oncomplete = function () {
      if (failed) {
        onDone("unknown");
        return;
      }
      var verdict = classifyVaultDmRows(collected);
      vaultDmPrivacyCache[key] = verdict;
      onDone(verdict);
    };
    tx.onerror = function () { onDone("unknown"); };
    tx.onabort = function () { onDone("unknown"); };
  }

  function vaultGet(db, target, limit, onRows) {
    if (db === null) {
      onRows([], "unavailable");
      return;
    }
    var tx = db.transaction(STORE, "readonly");
    var index = tx.objectStore(STORE).index("by-target");
    var rows = [];
    var cursor = index.openCursor(IDBKeyRange.only(target), "prev");
    cursor.onsuccess = function () {
      var c = cursor.result;
      if (c && rows.length < limit) {
        rows.push(vaultPlainRow(c.value));
        c.continue();
      } else {
        onRows(rows.reverse(), "ok");
      }
    };
    cursor.onerror = function () { onRows([], "unavailable"); };
  }

  /* Device-wide exact-substring vault search, mirroring the plain
     `searchVault` (the hybrid/semantic modes need embeddings and stay on
     the TS bridge): case-insensitive match on body and sender over the
     newest `VAULT_SEARCH_SCAN_MAX` rows, newest-first, sliced to limit.
     Pure over plain rows so node can smoke-test it without IndexedDB.
     Encrypted-row exclusion stays Elm-side (envelope shape + target kind),
     mirroring the oracle's post-filter after the limit. */
  var VAULT_SEARCH_SCAN_MAX = 4096;
  var VAULT_SEARCH_LIMIT = 80;
  var SEARCH_QUERY_TEXT_MAX = 512;
  var SEARCH_CORPUS_TEXT_MAX = 32 * 1024;

  function vaultSearchRows(rows, query, limit) {
    var q = String(query || "").slice(0, SEARCH_QUERY_TEXT_MAX).trim().toLowerCase();
    var capped = Math.max(0, limit | 0 || VAULT_SEARCH_LIMIT);
    if (!q) return [];
    var newest = rows.slice().sort(function (a, b) {
      return vaultRowAt(b.at) - vaultRowAt(a.at);
    }).slice(0, VAULT_SEARCH_SCAN_MAX);
    var matches = [];
    for (var i = 0; i < newest.length && matches.length < capped; i++) {
      var row = vaultPlainRow(newest[i]);
      if (!row.id || !row.target) continue;
      if (vaultTombstoned(row)) continue;
      var body = String(row.body).slice(0, SEARCH_CORPUS_TEXT_MAX).toLowerCase();
      var from = String(row.from).slice(0, SEARCH_CORPUS_TEXT_MAX).toLowerCase();
      if (body.indexOf(q) !== -1 || from.indexOf(q) !== -1) matches.push(row);
    }
    return matches;
  }

  /* Vault-RAG semantic + hybrid engine — verbatim-pure mirrors of
     `src/lib/vault/embeddingIndex.ts` (hashing vectorizer: FNV-1a,
     signed buckets, sublinear tf, L2 norm; cosine; stable rank),
     `searchVaultHybrid.ts` (RRF k=60, newest-first ties, post-RRF
     boosts), `lib/search/rankingBoost.ts`, and the needed
     `searchBounds.ts` slicers. Float32Array math stays in JS so
     bit-exact parity holds (Elm is float64, and has no Unicode
     regex); Elm owns only the mode fold + request. Pure over plain
     rows so node can smoke-test without IndexedDB. */
  var EMBEDDING_DIM = 256;
  var RRF_K = 60;
  var VAULT_BOOSTS = { exact: 0.35, sameRoom: 0.15, recencyHalfLifeMs: 14 * 24 * 60 * 60 * 1000, selfPenalty: 0.05 };

  function vaultSafeSlice(value, maxLength) {
    var s = String(value || "");
    if (s.length <= maxLength) return s;
    var sliced = s.slice(0, maxLength);
    var last = sliced.charCodeAt(sliced.length - 1);
    return (last >= 0xd800 && last <= 0xdbff) ? sliced.slice(0, -1) : sliced;
  }

  function vaultBoundedQuery(value) {
    return vaultSafeSlice(value, SEARCH_QUERY_TEXT_MAX).trim();
  }

  function vaultCandidateText(from, body) {
    var out = "";
    var fields = [from, body];
    for (var i = 0; i < fields.length; i++) {
      var sep = out.length > 0 ? " " : "";
      var remaining = SEARCH_CORPUS_TEXT_MAX - out.length - sep.length;
      if (remaining <= 0) break;
      out += sep + vaultSafeSlice(fields[i], remaining);
    }
    return out;
  }

  function vaultTokenize(text) {
    if (!text) return [];
    var out = [];
    var matches = String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu);
    if (!matches) return out;
    for (var i = 0; i < matches.length; i++) {
      if (matches[i].length >= 2) out.push(matches[i]);
    }
    return out;
  }

  function vaultFnv1a(input, seed) {
    var hash = (seed === undefined ? 0x811c9dc5 : seed) >>> 0;
    for (var i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function vaultEmbed(text, dim) {
    var d = dim || EMBEDDING_DIM;
    var vec = new Float32Array(d);
    var tokens = vaultTokenize(text);
    if (tokens.length === 0) return vec;
    var tf = new Map();
    for (var i = 0; i < tokens.length; i++) tf.set(tokens[i], (tf.get(tokens[i]) || 0) + 1);
    tf.forEach(function (count, token) {
      var weight = 1 + Math.log(count);
      var bucket = vaultFnv1a(token) % d;
      var sign = (((vaultFnv1a(token, 0x9e3779b1) >>> 16) & 1) === 0) ? 1 : -1;
      vec[bucket] += sign * weight;
    });
    var norm = 0;
    for (var j = 0; j < d; j++) norm += vec[j] * vec[j];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (var k = 0; k < d; k++) vec[k] /= norm;
    }
    return vec;
  }

  function vaultCosine(a, b) {
    if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
    var dot = 0, na = 0, nb = 0;
    for (var i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  function vaultRankBySimilarity(qVec, candidates) {
    return candidates
      .map(function (c, index) { return { candidate: c, index: index, score: vaultCosine(qVec, c.vector) }; })
      .sort(function (a, b) { return b.score - a.score || a.index - b.index; })
      .map(function (entry) {
        var out = {};
        for (var key in entry.candidate) out[key] = entry.candidate[key];
        out.score = entry.score;
        return out;
      });
  }

  function vaultHitKey(row) {
    return String(row.target) + " " + String(row.id);
  }

  function vaultNewestFirst(a, b) {
    var byTime = vaultRowAt(b.at) - vaultRowAt(a.at);
    if (byTime !== 0) return byTime;
    var ka = vaultHitKey(a), kb = vaultHitKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  }

  function vaultReciprocalRankFusion(rankings, keyOf, opts) {
    var k = (opts && opts.k !== undefined) ? opts.k : RRF_K;
    var tieBreak = opts && opts.tieBreak;
    var acc = new Map();
    for (var r = 0; r < rankings.length; r++) {
      var ranking = rankings[r];
      for (var i = 0; i < ranking.length; i++) {
        var item = ranking[i];
        var contribution = 1 / (k + i + 1);
        var key = keyOf(item);
        var prev = acc.get(key);
        if (prev) prev.score += contribution;
        else acc.set(key, { item: item, score: contribution });
      }
    }
    var results = Array.from(acc.values());
    results.sort(function (a, b) {
      var byScore = b.score - a.score;
      if (byScore !== 0) return byScore;
      return tieBreak ? tieBreak(a.item, b.item) : 0;
    });
    return results;
  }

  function vaultBoostedScore(hit, weights) {
    var w = weights || VAULT_BOOSTS;
    var score = hit.score;
    if (hit.exact) score += w.exact;
    if (hit.sameRoom) score += w.sameRoom;
    if (hit.fromSelf) score -= w.selfPenalty;
    if (typeof hit.ageMs === "number" && hit.ageMs >= 0 && w.recencyHalfLifeMs > 0) {
      score += 0.25 * Math.exp(-hit.ageMs / w.recencyHalfLifeMs);
    }
    return score;
  }

  function vaultHitAgeMs(row, nowMs) {
    var t = row.at;
    var ms = (typeof t === "number" && isFinite(t)) ? t : NaN;
    if (!isFinite(ms)) return undefined;
    return Math.max(0, nowMs - ms);
  }

  function vaultNewestSlice(rows) {
    return rows.slice().filter(function (row) { return !vaultTombstoned(vaultPlainRow(row)); })
      .sort(vaultNewestFirst).slice(0, VAULT_SEARCH_SCAN_MAX);
  }

  function vaultSearchRowsSemantic(rows, query, limit, minScore) {
    var q = vaultBoundedQuery(query);
    var capped = Math.max(0, limit | 0 || VAULT_SEARCH_LIMIT);
    if (!q) return [];
    var newest = vaultNewestSlice(rows);
    var qVec = vaultEmbed(q);
    var scored = vaultRankBySimilarity(qVec, newest.map(function (row) {
      return { row: vaultPlainRow(row), vector: vaultEmbed(vaultCandidateText(row.from, row.body)) };
    }));
    var floor = (minScore === undefined) ? 0 : minScore;
    var hits = [];
    for (var i = 0; i < scored.length && hits.length < capped; i++) {
      if (!(scored[i].score > floor)) continue;
      var plain = vaultPlainRow(scored[i].row);
      if (!plain.id || !plain.target) continue;
      hits.push(plain);
    }
    return hits;
  }

  function vaultSearchRowsHybrid(rows, query, opts) {
    var o = opts || {};
    var q = vaultBoundedQuery(query);
    var capped = Math.max(0, o.limit | 0 || VAULT_SEARCH_LIMIT);
    if (!q) return [];
    var newest = vaultNewestSlice(rows);
    var needle = q.toLocaleLowerCase();
    var lexical = newest.filter(function (row) {
      return vaultCandidateText(row.from, row.body).toLocaleLowerCase().indexOf(needle) !== -1;
    }).slice().sort(vaultNewestFirst);
    var floor = (o.minScore === undefined) ? 0 : o.minScore;
    var qVec = vaultEmbed(q);
    var semantic = vaultRankBySimilarity(qVec, newest.map(function (row) {
      return { row: vaultPlainRow(row), vector: vaultEmbed(vaultCandidateText(row.from, row.body)) };
    })).filter(function (entry) { return entry.score > floor; })
      .map(function (entry) { return entry.row; });
    var fused = vaultReciprocalRankFusion([lexical, semantic], vaultHitKey, { tieBreak: vaultNewestFirst });
    var lexicalKeys = {};
    lexical.forEach(function (row) { lexicalKeys[vaultHitKey(row)] = true; });
    var now = (o.nowMs !== undefined) ? o.nowMs : Date.now();
    var activeKey = (o.activeTarget && String(o.activeTarget).trim().toLocaleLowerCase()) || null;
    var selfKey = (o.selfNick && String(o.selfNick).trim().toLocaleLowerCase()) || null;
    var boosted = fused.map(function (entry) {
      var row = vaultPlainRow(entry.item);
      var key = vaultHitKey(row);
      var from = (typeof row.from === "string") ? String(row.from).toLocaleLowerCase() : "";
      var score = vaultBoostedScore({
        id: key,
        score: entry.score,
        exact: !!lexicalKeys[key],
        sameRoom: activeKey !== null && String(row.target).toLocaleLowerCase() === activeKey,
        fromSelf: selfKey !== null && from.length > 0 && from === selfKey,
        ageMs: vaultHitAgeMs(row, now),
      });
      return { row: row, score: score };
    });
    boosted.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return vaultNewestFirst(a.row, b.row);
    });
    var hits = [];
    for (var i = 0; i < boosted.length && hits.length < capped; i++) {
      if (!boosted[i].row.id || !boosted[i].row.target) continue;
      hits.push(boosted[i].row);
    }
    return hits;
  }

  function vaultSearch(db, query, limit, onRows) {
    vaultSearchMode(db, query, "exact", { limit: limit }, onRows);
  }

  function vaultSearchMode(db, query, mode, opts, onRows) {
    if (db === null) {
      onRows([], "unavailable");
      return;
    }
    var tx;
    try {
      tx = db.transaction(STORE, "readonly");
    } catch (err) {
      onRows([], "unavailable");
      return;
    }
    var req = tx.objectStore(STORE).getAll();
    req.onsuccess = function () {
      try {
        var rows = req.result || [];
        var o = opts || {};
        if (mode === "semantic") onRows(vaultSearchRowsSemantic(rows, query, o.limit, o.minScore), "ok");
        else if (mode === "hybrid") onRows(vaultSearchRowsHybrid(rows, query, o), "ok");
        else onRows(vaultSearchRows(rows, query, o.limit), "ok");
      } catch (err) {
        onRows([], "unavailable");
      }
    };
    req.onerror = function () { onRows([], "unavailable"); };
  }

  /* Nearest-first window around an epoch-ms anchor, mirroring
     `loadAround`: smallest clock distance first (ties older-first),
     sliced to limit, returned chronological. Pure over plain rows so
     node can smoke-test the selection without IndexedDB. */
  function vaultAroundWindow(rows, anchorAt, limit) {
    var capped = Math.max(0, limit | 0);
    var live = rows.slice().filter(function (row) { return !vaultTombstoned(vaultPlainRow(row)); });
    var ranked = live.sort(function (a, b) {
      var da = Math.abs(vaultRowAt(a.at) - anchorAt);
      var db = Math.abs(vaultRowAt(b.at) - anchorAt);
      if (da !== db) return da - db;
      return vaultRowAt(a.at) - vaultRowAt(b.at);
    }).slice(0, capped);
    ranked.sort(function (a, b) {
      if (vaultRowAt(a.at) !== vaultRowAt(b.at)) return vaultRowAt(a.at) - vaultRowAt(b.at);
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
    return ranked;
  }

  function vaultGetAround(db, target, atMs, limit, onRows) {
    if (db === null) {
      onRows([], "unavailable");
      return;
    }
    try {
      var tx = db.transaction(STORE, "readonly");
      var index = tx.objectStore(STORE).index("by-target");
      var collected = [];
      var cursor = index.openCursor(IDBKeyRange.only(target));
      cursor.onsuccess = function () {
        var c = cursor.result;
        if (c && collected.length < VAULT_EXPORT_MAX_TOTAL) {
          collected.push(vaultPlainRow(c.value));
          c.continue();
        } else {
          onRows(vaultAroundWindow(collected, atMs, limit), "ok");
        }
      };
      cursor.onerror = function () { onRows([], "unavailable"); };
    } catch (err) {
      onRows([], "unavailable");
    }
  }

  /* Whole-vault portable snapshot, mirroring `exportVault`'s shape
     (`kind`/`version`/`exportedAt`/`targets`) and bounds (4096 targets,
     1600 rows per target, 16k rows total). Pure over plain rows. */
  function vaultExportSnapshot(rows, exportedAt) {
    var byTarget = {};
    var order = [];
    var total = 0;
    for (var i = 0; i < rows.length && total < VAULT_EXPORT_MAX_TOTAL; i++) {
      var row = vaultPlainRow(rows[i]);
      if (!row.id || !row.target) continue;
      if (!byTarget[row.target]) {
        if (order.length >= VAULT_EXPORT_MAX_TARGETS) continue;
        byTarget[row.target] = [];
        order.push(row.target);
      }
      if (byTarget[row.target].length >= VAULT_EXPORT_MAX_PER_TARGET) continue;
      byTarget[row.target].push({ id: row.id, from: row.from, text: row.body, type: row.rowType, time: row.at, target: row.target });
      total += 1;
    }
    var targets = order.map(function (target) {
      var messages = byTarget[target].sort(function (a, b) {
        if (a.time !== b.time) return a.time - b.time;
        if (a.id < b.id) return -1;
        if (a.id > b.id) return 1;
        return 0;
      });
      return { target: target, messages: messages };
    });
    return { kind: "onyx-vault", version: 1, exportedAt: exportedAt, targets: targets };
  }

  function vaultExportAll(db, onSnapshot) {
    var stamped = (typeof Date !== "undefined" && Date.prototype.toISOString)
      ? new Date().toISOString()
      : "";
    if (db === null) {
      onSnapshot(vaultExportSnapshot([], stamped));
      return;
    }
    try {
      var tx = db.transaction(STORE, "readonly");
      var store = tx.objectStore(STORE);
      var collected = [];
      var cursor = store.openCursor();
      cursor.onsuccess = function () {
        var c = cursor.result;
        if (c && collected.length < VAULT_EXPORT_MAX_TOTAL) {
          collected.push(c.value);
          c.continue();
        } else {
          onSnapshot(vaultExportSnapshot(collected, stamped));
        }
      };
      cursor.onerror = function () { onSnapshot(vaultExportSnapshot([], stamped)); };
    } catch (err) {
      onSnapshot(vaultExportSnapshot([], stamped));
    }
  }

  /* Mirror of historyVault.isSafeOutboxTarget: non-empty, trimmed,
     no ASCII whitespace or control characters. */
  function isOutboxTarget(target) {
    return typeof target === "string"
      && target.length > 0
      && target === target.trim()
      && !/[\u0000\r\n\t ]/.test(target);
  }

  /* Coerce one stored outbox row. Stored shape mirrors
     historyVault.queueOutbox: {id, target_key, target, text,
     queued_at}. Rows missing an id are unaddressable repair
     candidates — the flush plan drops them from the mirror. */
  function outboxPlainEntry(value) {
    var row = value || {};
    return {
      id: String(row.id || ""),
      target: String(row.target || ""),
      text: String(row.text || ""),
      queuedAt: (typeof row.queued_at === "number" && isFinite(row.queued_at))
        ? row.queued_at
        : (typeof row.queuedAt === "number" && isFinite(row.queuedAt) ? row.queuedAt : 0),
      wireAdmitted: row.wire_admitted === true
    };
  }

  function outboxElmRow(row) {
    return { id: row.id, target: row.target, text: row.text, queuedAt: row.queuedAt };
  }

  /* Pure flush classification (node-testable) for fresh rows: expired or
     corrupt rows drop, live rows send when the socket is open and hold
     as silent waiting otherwise. Corrupt rows (no id/empty body) read back
     with queuedAt 0, so they always fall past the TTL cutoff. The walk
     pre-partitions already-admitted and uncertain-held rows before
     planning, so the plan never sees them. */
  function outboxFlushPlan(rows, nowMs, socketOpen) {
    var cutoff = nowMs - OUTBOX_MAX_AGE_MS;
    var plan = { send: [], drop: [], hold: [] };
    (rows || []).forEach(function (raw) {
      var row = outboxPlainEntry(raw);
      if (!row.id || !isOutboxTarget(row.target) || !row.text || row.queuedAt < cutoff) {
        plan.drop.push(row);
      } else if (socketOpen) {
        plan.send.push(row);
      } else {
        plan.hold.push(row);
      }
    });
    return plan;
  }

  function outboxQueue(db, req, onQueued, onFailed) {
    var target = req && req.target;
    var text = req && req.text;
    function fail() { try { onFailed(String(target || "")); } catch (err) {} }
    if (db === null || !isOutboxTarget(target) || typeof text !== "string" || text.length === 0) {
      fail();
      return;
    }
    var now = Date.now();
    var entry = {
      id: "ob-" + now.toString(36) + "-" + Math.random().toString(36).slice(2, 8),
      target_key: target.toLowerCase(),
      target: target,
      text: text,
      queued_at: now
    };
    var tx;
    try {
      tx = db.transaction(OUTBOX, "readwrite");
    } catch (err) {
      fail();
      return;
    }
    var store = tx.objectStore(OUTBOX);
    var added = false;
    try {
      var countReq = store.count();
      countReq.onsuccess = function () {
        // Count every physical row: corruption must not become an
        // escape hatch around the hard bound (mirrors queueOutbox).
        if (countReq.result >= OUTBOX_MAX_ENTRIES) return;
        try {
          // `add`, not `put`: an id collision can never overwrite an
          // existing queued message.
          var addReq = store.add(entry);
          addReq.onsuccess = function () { added = true; };
        } catch (err) {}
      };
    } catch (err) {
      fail();
      return;
    }
    tx.oncomplete = function () {
      if (added) {
        try { onQueued(outboxElmRow(outboxPlainEntry(entry))); } catch (err) { fail(); }
      } else {
        fail();
      }
    };
    tx.onerror = function () { fail(); };
    tx.onabort = function () { fail(); };
  }

  /* Ports-side flush walk: prune expired/corrupt rows, send live rows
     on the open socket, mark what was written wire-admitted, then prune
     the marks. Rows already admitted in a prior walk (durable
     `wire_admitted` mark or the session `outboxWireAdmitted` set) are never
     re-admitted — only their prune is retried, mirroring the oracle's
     `_outboxWireAdmitted` + `markOutboxWireAdmitted` double-send guard.
     Rows whose admission stayed unproven are held like the oracle's
     never-released claim: carried as waiting, never re-sent, never
     re-toasted. A closed socket holds live rows as silent waiting (the
     oracle's pre-delivery `waiting += 1; continue`); only rows actually
     written while the socket was open report `uncertain`. When `labeled`
     is set (Elm negotiated `labeled-response`), every sent row carries
     a minted `@label=` and the report maps row ids to labels under
     `sentLabels` so Elm can correlate the server's echo/ACK/FAIL —
     mirroring the oracle's outbox flush stamping. */
  function outboxFlush(db, sock, onReport, labeled) {
    /* Rows still durable when the walk ends (`waiting`) and rows the walk
       could not prune after admission/expiry (`pruneFailed`) — the pure
       terminal decision (`decideOutboxFlushTerminal` oracle) consumes both.
       Delete failures are counted, never thrown: the queue stays durable. */
    var pruneFailed = 0;
    var expiredPruneFailed = 0;
    var admittedPruneFailed = 0;
    var live = [];
    var held = [];
    var dropped = [];
    var sentLabels = [];
    /* Expired/invalid rows whose physical delete threw stay durable and
       must count as waiting (the oracle's "prune stuck" class), even
       though the report lists them under `dropped`. */
    var unprunedDropped = 0;
    function finish(report) {
      try {
        var remaining = (report && report.rows) || [];
        report.waiting = remaining.length + unprunedDropped;
        report.pruneFailed = pruneFailed;
        report.expiredPruneFailed = expiredPruneFailed;
        report.admittedPruneFailed = admittedPruneFailed;
        if (report.walkOk === undefined) report.walkOk = true;
        report.sentLabels = sentLabels;
      } catch (err) {}
      try { onReport(report); } catch (err) {}
    }
    function empty() { finish({ sent: [], uncertain: [], dropped: [], rows: [] }); }
    /* The walk itself broke (transaction/cursor/IDB error): the queue was
       never read, so the report must not masquerade as a clean empty —
       the oracle's flush catch marks delivery failed instead. */
    function failed() { finish({ sent: [], uncertain: [], dropped: [], rows: [], walkOk: false }); }
    function ids(rows) { return rows.map(function (r) { return r.id; }); }
    if (db === null) {
      empty();
      return;
    }
    var tx1;
    try {
      tx1 = db.transaction(OUTBOX, "readwrite");
    } catch (err) {
      failed();
      return;
    }
    var now = Date.now();
    var cutoff = now - OUTBOX_MAX_AGE_MS;
    var walk;
    try {
      walk = tx1.objectStore(OUTBOX).openCursor();
    } catch (err) {
      failed();
      return;
    }
    walk.onsuccess = function (event) {
      var cursor = event.target.result;
      if (!cursor) return;
      var row = outboxPlainEntry(cursor.value);
      if (!row.id || !isOutboxTarget(row.target) || !row.text || row.queuedAt < cutoff) {
        if (row.id) dropped.push(row.id);
        try { cursor.delete(); } catch (err) { expiredPruneFailed += 1; pruneFailed += 1; unprunedDropped += 1; }
      } else if (row.wireAdmitted || outboxWireAdmitted[row.id]) {
        /* Already on the wire in a prior walk: never re-admit, only retry
           the prune (silently — the placeholder already settled when the
           row first reported sent). */
        outboxWireAdmitted[row.id] = true;
        try {
          cursor.delete();
          delete outboxWireAdmitted[row.id];
        } catch (err) {
          admittedPruneFailed += 1;
          pruneFailed += 1;
          unprunedDropped += 1;
        }
      } else if (outboxUncertainHeld[row.id]) {
        /* Admission unproven in a prior walk: carry as waiting without
           re-sending or re-toasting (the oracle's never-released claim). */
        held.push(row);
      } else {
        live.push(row);
      }
      try { cursor.continue(); } catch (err) {}
    };
    walk.onerror = function () { failed(); };
    tx1.onerror = function () { failed(); };
    tx1.onabort = function () { failed(); };
    /* Durable wire-admitted marks (own transaction, like the oracle's
       `markOutboxWireAdmitted`, so a later prune failure cannot roll the
       marks back). `put` overwrites wholesale from the walked row — no
       `get` round trip needed. */
    function markWireAdmitted(rows, done) {
      var txM;
      try {
        txM = db.transaction(OUTBOX, "readwrite");
      } catch (err) {
        done();
        return;
      }
      var storeM;
      try {
        storeM = txM.objectStore(OUTBOX);
        rows.forEach(function (row) {
          storeM.put({
            id: row.id,
            target_key: row.target.toLowerCase(),
            target: row.target,
            text: row.text,
            queued_at: row.queuedAt,
            wire_admitted: true
          });
        });
      } catch (err) {
        try { if (txM.abort) txM.abort(); } catch (abortErr) {}
        done();
        return;
      }
      txM.oncomplete = function () { done(); };
      txM.onerror = function () { done(); };
      txM.onabort = function () { done(); };
    }
    function pruneSentIds(sentIds, done) {
      var tx2;
      try {
        tx2 = db.transaction(OUTBOX, "readwrite");
      } catch (err) {
        done(false);
        return;
      }
      var store2;
      try {
        store2 = tx2.objectStore(OUTBOX);
        sentIds.forEach(function (id) { store2.delete(id); });
      } catch (err) {
        done(false);
        return;
      }
      tx2.oncomplete = function () { done(true); };
      tx2.onerror = function () { done(false); };
      tx2.onabort = function () { done(false); };
    }
    tx1.oncomplete = function () {
      var open = false;
      try { open = sock.isOpen(); } catch (err) { open = false; }
      var waitingRows = held.map(outboxElmRow);
      if (!open || live.length === 0) {
        /* Closed socket (or nothing fresh): rows never left the device, so
           they wait silently — never `uncertain`, never toasted. */
        finish({ sent: [], uncertain: [], dropped: dropped, rows: waitingRows.concat(live.map(outboxElmRow)) });
        return;
      }
      live.forEach(function (row) {
        var line = "PRIVMSG " + row.target + " :" + row.text;
        if (labeled) {
          var label = mintFlushLabel();
          line = "@label=" + label + " " + line;
          sentLabels.push({ id: row.id, label: label });
        }
        try { sock.send(line); } catch (err) {}
      });
      var stillOpen = false;
      try { stillOpen = sock.isOpen(); } catch (err) { stillOpen = false; }
      if (!stillOpen) {
        /* Bytes may have reached the socket before it died: uncertain, and
           held against retry — the first walk toasts, later walks just
           carry the rows as waiting. */
        live.forEach(function (row) { outboxUncertainHeld[row.id] = true; });
        finish({ sent: [], uncertain: ids(live), dropped: dropped, rows: waitingRows.concat(live.map(outboxElmRow)) });
        return;
      }
      var sentIds = ids(live);
      sentIds.forEach(function (id) { outboxWireAdmitted[id] = true; });
      markWireAdmitted(live, function () {
        pruneSentIds(sentIds, function (pruned) {
          if (pruned) {
            sentIds.forEach(function (id) { delete outboxWireAdmitted[id]; });
            finish({ sent: sentIds, uncertain: [], dropped: dropped, rows: waitingRows });
          } else {
            /* On the wire but storage prune is pending: still `sent` (the
               oracle counts it for user feedback and toasts "stuck"), kept
               durable, and never re-admitted thanks to the mark. */
            admittedPruneFailed += sentIds.length;
            pruneFailed += sentIds.length;
            finish({ sent: sentIds, uncertain: [], dropped: dropped, rows: waitingRows.concat(live.map(outboxElmRow)) });
          }
        });
      });
    };
  }

  /* Session resume credentials — ports-side subset of
     credentials.ts (`onyx:credentials` localStorage). Only the
     server-issued resume Bearer [REDACTED] (local TOKEN + mesh MTOKEN) live
     here; passwords, remembered identities, and account handoffs need
     a login UI the Elm client has not built yet. Shape:
       { v: 1, slots: { "<server>|<nick>": { sessionToken?,
         meshToken?, meshExpiresAtMs? } } }
     with per-server/nick keying so an account switch never replays a
     stranger's bearer. Bounds mirror the oracle (4 KiB Bearer [REDACTED]
     no whitespace/control). */
  var CRED_KEY = "onyx:credentials";
  var MAX_RESUME_TOKEN_LENGTH = 4 * 1024;

  function credentialSlotKey(server, nick) {
    return String(server || "").toLowerCase() + "|" + String(nick || "").toLowerCase();
  }

  function validResumeToken(token) {
    return typeof token === "string"
      && token.length > 0
      && token.length <= MAX_RESUME_TOKEN_LENGTH
      && !/[\s\u0000-\u001f\u007f]/.test(token);
  }

  function readCredentialsStore() {
    try {
      var raw = global.localStorage.getItem(CRED_KEY);
      if (!raw) return { v: 1, slots: {} };
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { v: 1, slots: {} };
      if (!parsed.slots || typeof parsed.slots !== "object" || Array.isArray(parsed.slots)) return { v: 1, slots: {} };
      return { v: 1, slots: parsed.slots };
    } catch (err) {
      return { v: 1, slots: {} };
    }
  }

  function writeCredentialsStore(store) {
    try {
      var serialized = JSON.stringify({ v: 1, slots: store.slots || {} });
      if (serialized.length > 64 * 1024) return false;
      global.localStorage.setItem(CRED_KEY, serialized);
      return true;
    } catch (err) {
      return false;
    }
  }

  function finiteMs(value) {
    return (typeof value === "number" && isFinite(value) && value >= 0) ? Math.floor(value) : null;
  }

  /* Persist one captured Bearer [REDACTED] Merge into the slot, never clobber
     the sibling kind (mirrors updateResumeTokens). */
  function storeResumeToken(server, nick, kind, token, expiresAtSec) {
    if (!validResumeToken(token)) return false;
    var store = readCredentialsStore();
    var key = credentialSlotKey(server, nick);
    var slot = store.slots[key];
    if (!slot || typeof slot !== "object" || Array.isArray(slot)) slot = {};
    if (kind === "mtoken") {
      slot.meshToken = token;
      var ms = (typeof expiresAtSec === "number" && isFinite(expiresAtSec) && expiresAtSec >= 0)
        ? Math.floor(expiresAtSec * 1000)
        : null;
      if (ms === null) {
        delete slot.meshExpiresAtMs;
      } else {
        slot.meshExpiresAtMs = ms;
      }
    } else if (kind === "token") {
      slot.sessionToken = token;
    } else {
      return false;
    }
    store.slots[key] = slot;
    return writeCredentialsStore(store);
  }

  /* Load validated holdings for one slot; never throws, never leaks. */
  function loadResumeTokens(server, nick) {
    var store = readCredentialsStore();
    var slot = store.slots[credentialSlotKey(server, nick)];
    if (!slot || typeof slot !== "object" || Array.isArray(slot)) return null;
    var out = {};
    if (validResumeToken(slot.sessionToken)) out.sessionToken = slot.sessionToken;
    if (validResumeToken(slot.meshToken)) out.meshToken = slot.meshToken;
    var ms = finiteMs(slot.meshExpiresAtMs);
    if (ms !== null && out.meshToken) out.meshExpiresAtMs = ms;
    return out;
  }

  /* Drop the credential slot after a terminal `FAIL SESSION
     INVALID_TOKEN/NO_SESSION` (mirrors `clearSessionToken`): a rejected
     Bearer [REDACTED] never replay on the next 001. */
  function clearResumeTokens(server, nick) {
    var store = readCredentialsStore();
    var key = credentialSlotKey(server, nick);
    if (store.slots[key] === undefined) return false;
    delete store.slots[key];
    return writeCredentialsStore(store);
  }

  /* SASL credential exchange, mirroring `client.ts`: secrets live here,
     never in Elm state. Elm owns mechanism selection, the exchange state
     machine, and 400-byte chunking; this side holds the password, computes
     the PLAIN blob (UTF-8, since `btoa` is Latin-1 only), and runs the
     SCRAM-SHA-256 exchange (WebCrypto PBKDF2/HMAC) with its own challenge
     state. Answers return through `saslPayload` / `saslFailed`. */
  var SASL_TIMEOUT_MS = 15000;

  function b64encodeUtf8(value) {
    var bytes = new TextEncoder().encode(String(value));
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function b64encodeBytes(bytes) {
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function b64decodeBytes(b64) {
    var binary = atob(String(b64));
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function scramNonce() {
    var arr = new Uint8Array(18);
    var webcrypto = globalThis.crypto || (typeof require !== "undefined" ? require("crypto").webcrypto : null);
    webcrypto.getRandomValues(arr);
    return b64encodeBytes(arr).replace(/[+/=]/g, function (c) {
      return c === "+" ? "-" : c === "/" ? "_" : "";
    });
  }

  /* Length-independent, content-constant-time base64 comparison for the
     SCRAM ServerSignature, mirroring `constantTimeEqual`. */
  function scramEqual(a, b) {
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  var saslCreds = { account: "", password: "", hasClientCert: false };
  var scramExchange = null;

  async function scramHmac(keyData, data) {
    var subtle = globalThis.crypto.subtle;
    var key = await subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await subtle.sign("HMAC", key, data));
  }

  var sasl = {
    timeoutMs: SASL_TIMEOUT_MS,
    setCredentials: function (account, password, hasClientCert) {
      saslCreds = {
        account: String(account || ""),
        password: typeof password === "string" ? password : "",
        hasClientCert: Boolean(hasClientCert),
      };
      scramExchange = null;
    },
    clearCredentials: function () {
      saslCreds = { account: "", password: "", hasClientCert: false };
      scramExchange = null;
    },
    /* RFC 4616 `\0authcid\0passwd`, UTF-8 encoded. Null when no password. */
    plainPayload: function (nick) {
      if (!saslCreds.password) return null;
      return b64encodeUtf8("\0" + String(nick) + "\0" + saslCreds.password);
    },
    scramFirst: function (nick, nonceOverride) {
      var nonce = nonceOverride || scramNonce();
      var bare = "n=" + String(nick) + ",r=" + nonce;
      scramExchange = { nick: String(nick), clientFirstBare: bare, nonce: nonce, expectedServerSig: undefined };
      return { bare: bare, payload: btoa("n,," + bare) };
    },
    scramNext: async function (challengeB64) {
      var state = scramExchange;
      if (!state) return { kind: "fail", reason: "SASL authentication failed: no SCRAM exchange in flight" };
      if (state.expectedServerSig !== undefined) return sasl.scramVerify(challengeB64);
      return sasl.scramFinal(challengeB64);
    },
    scramFinal: async function (challengeB64) {
      var state = scramExchange;
      if (!state) return { kind: "fail", reason: "SASL authentication failed: no SCRAM exchange in flight" };
      var serverFirst;
      try {
        var raw = atob(String(challengeB64));
        serverFirst = raw;
      } catch (err) {
        scramExchange = null;
        return { kind: "fail", reason: "SASL authentication failed: SCRAM: invalid challenge encoding" };
      }
      var parts = {};
      var atoms = serverFirst.split(",");
      for (var i = 0; i < atoms.length; i++) {
        var atom = atoms[i];
        if (atom.length > 2 && atom.charAt(1) === "=") parts[atom.charAt(0)] = atom.slice(2);
      }
      var serverNonce = parts.r || "";
      var saltB64 = parts.s || "";
      var iterations = parseInt(parts.i !== undefined ? parts.i : "4096", 10);
      if (serverNonce.indexOf(state.nonce) !== 0) {
        scramExchange = null;
        return { kind: "fail", reason: "SASL authentication failed: SCRAM: server nonce mismatch" };
      }
      try {
        var enc = new TextEncoder();
        var subtle = globalThis.crypto.subtle;
        var salt = b64decodeBytes(saltB64);
        var rawKey = await subtle.importKey("raw", enc.encode(saslCreds.password), "PBKDF2", false, ["deriveBits"]);
        var saltedBits = await subtle.deriveBits(
          { name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: iterations },
          rawKey,
          256
        );
        var saltedPass = new Uint8Array(saltedBits);
        var clientKey = await scramHmac(saltedPass, enc.encode("Client Key"));
        var storedKey = new Uint8Array(await subtle.digest("SHA-256", clientKey));
        var withoutProof = "c=biws,r=" + serverNonce;
        var authMessage = state.clientFirstBare + "," + serverFirst + "," + withoutProof;
        var clientSig = await scramHmac(storedKey, enc.encode(authMessage));
        var proof = new Uint8Array(clientKey.length);
        for (var j = 0; j < proof.length; j++) proof[j] = clientKey[j] ^ clientSig[j];
        var serverKey = await scramHmac(saltedPass, enc.encode("Server Key"));
        var serverSig = await scramHmac(serverKey, enc.encode(authMessage));
        state.expectedServerSig = b64encodeBytes(serverSig);
        var clientFinal = withoutProof + ",p=" + b64encodeBytes(proof);
        return { kind: "send", payload: btoa(clientFinal) };
      } catch (err) {
        scramExchange = null;
        return { kind: "fail", reason: "SASL authentication failed: SCRAM error: " + (err && err.message ? err.message : err) };
      }
    },
    scramVerify: function (challengeB64) {
      var state = scramExchange;
      var expected = state ? state.expectedServerSig : undefined;
      if (expected === undefined) {
        scramExchange = null;
        return { kind: "fail", reason: "SASL authentication failed: invalid server-final encoding" };
      }
      var serverFinal;
      try {
        serverFinal = atob(String(challengeB64));
      } catch (err) {
        scramExchange = null;
        return { kind: "fail", reason: "SASL authentication failed: invalid server-final encoding" };
      }
      if (serverFinal.indexOf("e=") === 0) {
        scramExchange = null;
        return { kind: "fail", reason: "SASL authentication failed: server rejected proof (" + serverFinal.slice(2) + ")" };
      }
      var match = /(?:^|,)v=([^,]*)/.exec(serverFinal);
      var received = match ? match[1] : undefined;
      if (received === undefined || !scramEqual(received, expected)) {
        scramExchange = null;
        return { kind: "fail", reason: "SASL authentication failed: server signature mismatch" };
      }
      return { kind: "verified" };
    },
  };

  /* 15s guard against a server that never answers AUTHENTICATE,
     mirroring the oracle's `_saslTimer`. Elm owns the exchange state;
     this only fires `saslTimeout`. */
  function createSaslGuard(app) {
    var timer = null;
    return {
      start: function () {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(function () {
          timer = null;
          try { app.ports.saslTimeout.send(null); } catch (err) { /* port gone */ }
        }, SASL_TIMEOUT_MS);
      },
      clear: function () {
        if (timer !== null) { clearTimeout(timer); timer = null; }
      },
    };
  }

  /* Saved searches — local-first named vault queries in their own sibling
     database (`onyx-vault-searches`, never the primary vault store).
     Mirrors `savedSearches.ts`: dumb storage of user-entered
     label/query/mode/createdAt only, bounded at 50 rows (oldest pruned),
     upsert-by-label, idempotent import merge, readback-verified writes,
     and metadata-only cross-tab invalidation (revision/reason/count —
     never labels or query text cross tabs). Owner-scoped databases and
     the 8-handle LRU are narrowed to the single default database: the
     Elm client has no device-memory-owner machinery. */
  var SEARCH_DB_NAME = "onyx-vault-searches";
  var SEARCH_DB_VERSION = 1;
  var SEARCH_STORE = "saved_searches";
  var SAVED_SEARCH_CAP = 50;
  var MAX_SEARCH_LABEL_LEN = 120;
  var MAX_SEARCH_QUERY_LEN = 512;
  var MAX_SEARCH_ID_LEN = 128;
  var SEARCH_SCAN_LIMIT = SAVED_SEARCH_CAP * 4;
  var MAX_SEARCH_FUTURE_MS = 24 * 60 * 60 * 1000;
  var MAX_SEARCH_SEQ = 2147483647;
  var SEARCH_SYNC_CHANNEL = "onyx:saved-searches:v1";
  var SEARCH_SYNC_STORAGE_KEY = "onyx:saved-searches:sync:v1";
  var MAX_SYNC_MESSAGE_LENGTH = 512;
  var MAX_TRACKED_SOURCES = 32;
  var MAX_SYNC_COUNT = 50;
  var SYNC_SOURCE_RE = /^[A-Za-z0-9_-]{8,64}$/;
  var SYNC_MESSAGE_KEYS = ["count", "reason", "revision", "source", "version"];

  var searchSeq = 0;

  function isSearchRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function normalizeSearchLabel(label) {
    return String(label).trim().toLocaleLowerCase();
  }

  /* Boundary validation: trimmed fields or null (empty/overlong/bad mode). */
  function validateSearchInput(input) {
    if (!isSearchRecord(input)) return null;
    if (typeof input.label !== "string" || input.label.length > MAX_SEARCH_LABEL_LEN + 32) return null;
    if (typeof input.query !== "string" || input.query.length > MAX_SEARCH_QUERY_LEN + 32) return null;
    var label = input.label.trim();
    var query = input.query.trim();
    var mode = input.mode;
    if (!label || label.length > MAX_SEARCH_LABEL_LEN) return null;
    if (!query || query.length > MAX_SEARCH_QUERY_LEN) return null;
    if (mode !== "exact" && mode !== "semantic" && mode !== "hybrid") return null;
    return { label: label, query: query, mode: mode };
  }

  function sanitizeSearchId(value) {
    if (typeof value !== "string" || value.length > MAX_SEARCH_ID_LEN) return null;
    var id = value.trim();
    if (!id || id.length > MAX_SEARCH_ID_LEN || /[\u0000-\u001f\u007f]/.test(id)) return null;
    return id;
  }

  function genSearchId() {
    return "ss-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function uniqueSearchId(usedIds) {
    for (var attempt = 0; attempt < 8; attempt++) {
      var candidate = genSearchId();
      if (!usedIds.has(candidate)) return candidate;
    }
    var prefix = "ss-" + Date.now().toString(36) + "-";
    for (var suffix = 1; suffix <= SEARCH_SCAN_LIMIT + 1; suffix++) {
      var numbered = prefix + suffix.toString(36);
      if (!usedIds.has(numbered)) return numbered;
    }
    return prefix + Math.max(1, nextSearchSeq([])).toString(36);
  }

  function validSearchSequence(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_SEARCH_SEQ;
  }

  function nextSearchSeq(rows) {
    var storedMax = 0;
    for (var i = 0; i < rows.length; i++) {
      if (typeof rows[i].seq === "number" && rows[i].seq > storedMax) storedMax = rows[i].seq;
    }
    searchSeq = Math.max(searchSeq, storedMax);
    searchSeq = searchSeq >= MAX_SEARCH_SEQ ? 1 : searchSeq + 1;
    return searchSeq;
  }

  function validStoredTimestamp(value, now) {
    var at = now === undefined ? Date.now() : now;
    return typeof value === "number" && isFinite(value) && value >= 0 && value <= at + MAX_SEARCH_FUTURE_MS;
  }

  function safeImportedTimestamp(value, now) {
    var at = now === undefined ? Date.now() : now;
    var parsed = NaN;
    if (typeof value === "number") parsed = value;
    else if (typeof value === "string" && value.length <= 64) parsed = Date.parse(value);
    return isFinite(parsed) && parsed >= 0 && parsed <= at + MAX_SEARCH_FUTURE_MS ? parsed : at;
  }

  function reviveStoredSearch(raw) {
    if (!isSearchRecord(raw)) return null;
    var id = sanitizeSearchId(raw.id);
    var input = validateSearchInput(raw);
    if (!id || raw.id !== id || !input || !validStoredTimestamp(raw.createdAt)) return null;
    var seq = raw.seq === undefined ? 0 : validSearchSequence(raw.seq) ? raw.seq : null;
    if (seq === null) return null;
    return { id: id, label: input.label, query: input.query, mode: input.mode, createdAt: raw.createdAt, seq: seq };
  }

  function toPublicSearch(row) {
    return { id: row.id, label: row.label, query: row.query, mode: row.mode, createdAt: row.createdAt };
  }

  /* Newest first: createdAt desc, monotonic seq breaks same-ms ties. */
  function sortSearchesNewestFirst(rows) {
    return rows.slice().sort(function (a, b) {
      return b.createdAt - a.createdAt || b.seq - a.seq;
    });
  }

  function sameStoredSearch(left, right) {
    return left.id === right.id
      && left.label === right.label
      && left.query === right.query
      && left.mode === right.mode
      && left.createdAt === right.createdAt
      && left.seq === right.seq;
  }

  var searchDbPromise = null;

  function openSearchDb() {
    if (searchDbPromise) return searchDbPromise;
    searchDbPromise = new Promise(function (resolve) {
      var finish = function (db) {
        if (!db) {
          if (searchDbPromise) searchDbPromise = null;
          resolve(null);
          return;
        }
        resolve(db);
      };
      try {
        if (typeof indexedDB === "undefined") {
          finish(null);
          return;
        }
        var req = indexedDB.open(SEARCH_DB_NAME, SEARCH_DB_VERSION);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(SEARCH_STORE)) {
            db.createObjectStore(SEARCH_STORE, { keyPath: "id" });
          }
        };
        req.onsuccess = function () { finish(req.result); };
        req.onerror = function () { finish(null); };
        req.onblocked = function () { finish(null); };
      } catch (err) {
        finish(null);
      }
    });
    return searchDbPromise;
  }

  function searchTxDone(tx) {
    return new Promise(function (resolve) {
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { resolve(false); };
      tx.onabort = function () { resolve(false); };
    });
  }

  function getSearchRows(db) {
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(SEARCH_STORE, "readonly");
        var store = tx.objectStore(SEARCH_STORE);
        var rowsRequest = store.getAll(undefined, SEARCH_SCAN_LIMIT);
        var keysRequest = store.getAllKeys(undefined, SEARCH_SCAN_LIMIT);
        var countRequest = store.count();
        var rows = [];
        var keys = [];
        var physicalCount = 0;
        var failed = false;
        rowsRequest.onsuccess = function () { rows = rowsRequest.result || []; };
        rowsRequest.onerror = function () { failed = true; };
        keysRequest.onsuccess = function () { keys = keysRequest.result || []; };
        keysRequest.onerror = function () { failed = true; };
        countRequest.onsuccess = function () { physicalCount = countRequest.result; };
        countRequest.onerror = function () { failed = true; };
        tx.oncomplete = function () {
          if (failed || rows.length !== keys.length) {
            resolve(null);
            return;
          }
          var entries = rows.map(function (raw, index) {
            return { key: keys[index], row: reviveStoredSearch(raw) };
          });
          var valid = [];
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].row) valid.push(entries[i].row);
          }
          resolve({
            entries: entries,
            rows: valid,
            physicalCount: physicalCount,
            truncated: physicalCount > SEARCH_SCAN_LIMIT,
          });
        };
        tx.onerror = function () { resolve(null); };
        tx.onabort = function () { resolve(null); };
      } catch (err) {
        resolve(null);
      }
    });
  }

  function getStoredSearchRow(db, id) {
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(SEARCH_STORE, "readonly");
        var req = tx.objectStore(SEARCH_STORE).get(id);
        var row = null;
        req.onsuccess = function () { row = reviveStoredSearch(req.result); };
        req.onerror = function () { row = null; };
        tx.oncomplete = function () { resolve(row); };
        tx.onerror = function () { resolve(null); };
        tx.onabort = function () { resolve(null); };
      } catch (err) {
        resolve(null);
      }
    });
  }

  function hasSearchRow(db, id) {
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(SEARCH_STORE, "readonly");
        var req = tx.objectStore(SEARCH_STORE).getKey(id);
        req.onsuccess = function () { resolve(req.result !== undefined); };
        req.onerror = function () { resolve(true); };
        tx.onabort = function () { resolve(true); };
      } catch (err) {
        resolve(false);
      }
    });
  }

  /* Newest-first public rows, deduped by normalized label, capped. */
  function publicSearchRows(read) {
    var deduped = [];
    var labels = {};
    var ordered = sortSearchesNewestFirst(read.rows);
    for (var i = 0; i < ordered.length; i++) {
      var label = normalizeSearchLabel(ordered[i].label);
      if (labels[label]) continue;
      labels[label] = true;
      deduped.push(ordered[i]);
      if (deduped.length >= SAVED_SEARCH_CAP) break;
    }
    return deduped.map(toPublicSearch);
  }

  /* Delete entries beyond the cap, oldest first; verify the bound after. */
  async function pruneSearches(db) {
    try {
      var read = await getSearchRows(db);
      if (!read || read.truncated) return false;
      var keepIds = {};
      var keepCount = 0;
      var labels = {};
      var ordered = sortSearchesNewestFirst(read.rows);
      for (var i = 0; i < ordered.length; i++) {
        var label = normalizeSearchLabel(ordered[i].label);
        if (labels[label] || keepCount >= SAVED_SEARCH_CAP) continue;
        labels[label] = true;
        keepIds[ordered[i].id] = true;
        keepCount++;
      }
      var doomed = [];
      for (var j = 0; j < read.entries.length; j++) {
        var entry = read.entries[j];
        if (!entry.row || !keepIds[entry.row.id]) doomed.push(entry.key);
      }
      if (doomed.length === 0) return read.physicalCount <= SAVED_SEARCH_CAP;
      var tx = db.transaction(SEARCH_STORE, "readwrite");
      var store = tx.objectStore(SEARCH_STORE);
      for (var k = 0; k < doomed.length; k++) store.delete(doomed[k]);
      if (!await searchTxDone(tx)) return false;
      var verified = await getSearchRows(db);
      if (!verified || verified.truncated) return false;
      if (verified.physicalCount > SAVED_SEARCH_CAP) return false;
      for (var m = 0; m < verified.entries.length; m++) {
        if (!verified.entries[m].row) return false;
      }
      return publicSearchRows(verified).length === verified.physicalCount;
    } catch (err) {
      return false;
    }
  }

  var searchChangeRevision = 0;
  var searchSyncState = null;

  function searchSyncSourceId() {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch (err) { /* fall through to the tab-identity fallback */ }
    return "tab-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  /* Strict allowlist: exact keys, version 1, well-formed source,
     positive-safe revision, known reason, bounded count. Metadata only. */
  function parseSearchSyncMessage(value) {
    if (!isSearchRecord(value)) return null;
    var keys = Object.keys(value).sort();
    if (keys.length !== SYNC_MESSAGE_KEYS.length) return null;
    for (var i = 0; i < SYNC_MESSAGE_KEYS.length; i++) {
      if (keys[i] !== SYNC_MESSAGE_KEYS[i]) return null;
    }
    if (value.version !== 1) return null;
    if (typeof value.source !== "string" || !SYNC_SOURCE_RE.test(value.source)) return null;
    if (!Number.isSafeInteger(value.revision) || value.revision <= 0) return null;
    if (value.reason !== "save" && value.reason !== "delete" && value.reason !== "clear" && value.reason !== "import") {
      return null;
    }
    if (!Number.isSafeInteger(value.count) || value.count < 0 || value.count > MAX_SYNC_COUNT) return null;
    return { version: 1, source: value.source, revision: value.revision, reason: value.reason, count: value.count };
  }

  function createSearchSync(onRemoteChange, sourceOverride) {
    var ownSource = sourceOverride && SYNC_SOURCE_RE.test(sourceOverride) ? sourceOverride : searchSyncSourceId();
    var channel = null;
    try {
      if (typeof BroadcastChannel === "function") channel = new BroadcastChannel(SEARCH_SYNC_CHANNEL);
    } catch (err) {
      channel = null;
    }
    var useStorage = !channel && typeof window !== "undefined" && window.localStorage;
    var lastRevisionBySource = {};
    var sourceOrder = [];
    var closed = false;

    var receive = function (raw) {
      if (closed) return;
      var message = parseSearchSyncMessage(raw);
      if (!message || message.source === ownSource) return;
      var previous = lastRevisionBySource[message.source] || 0;
      if (message.revision <= previous) return;
      delete lastRevisionBySource[message.source];
      lastRevisionBySource[message.source] = message.revision;
      sourceOrder.push(message.source);
      while (sourceOrder.length > MAX_TRACKED_SOURCES) {
        var oldest = sourceOrder.shift();
        delete lastRevisionBySource[oldest];
      }
      try {
        onRemoteChange({ revision: message.revision, reason: message.reason, count: message.count });
      } catch (err) { /* a subscriber cannot poison the transport */ }
    };

    var onMessage = function (event) { receive(event && event.data); };
    var onStorage = function (event) {
      if (!event || event.key !== SEARCH_SYNC_STORAGE_KEY || !event.newValue) return;
      if (event.newValue.length > MAX_SYNC_MESSAGE_LENGTH) return;
      try {
        receive(JSON.parse(event.newValue));
      } catch (err) { /* ignore malformed fallback metadata */ }
    };

    if (channel && channel.addEventListener) channel.addEventListener("message", onMessage);
    if (useStorage && window.addEventListener) window.addEventListener("storage", onStorage);

    return {
      source: ownSource,
      publish: function (change) {
        if (closed) return;
        var message = parseSearchSyncMessage({
          version: 1,
          source: ownSource,
          revision: change.revision,
          reason: change.reason,
          count: change.count,
        });
        if (!message) return;
        if (channel) {
          try { channel.postMessage(message); } catch (err) { /* best effort */ }
        } else if (useStorage) {
          try {
            var text = JSON.stringify(message);
            if (text.length <= MAX_SYNC_MESSAGE_LENGTH) window.localStorage.setItem(SEARCH_SYNC_STORAGE_KEY, text);
          } catch (err) { /* best effort */ }
        }
      },
      close: function () {
        closed = true;
        try {
          if (channel) {
            if (channel.removeEventListener) channel.removeEventListener("message", onMessage);
            channel.close();
          }
        } catch (err) { /* best effort */ }
        try {
          if (useStorage && window.removeEventListener) window.removeEventListener("storage", onStorage);
        } catch (err) { /* best effort */ }
      },
    };
  }

  function ensureSearchSync(onRemoteChange) {
    if (!searchSyncState) {
      searchSyncState = createSearchSync(onRemoteChange);
    }
    return searchSyncState;
  }

  function publishSearchChange(reason, count, notify) {
    searchChangeRevision += 1;
    var change = {
      revision: searchChangeRevision,
      reason: reason,
      count: Math.max(0, Math.min(SAVED_SEARCH_CAP, Math.trunc(count))),
    };
    try {
      ensureSearchSync(function () {}).publish(change);
    } catch (err) { /* local commit already verified; sync is best effort */ }
    if (notify) {
      try { notify(change); } catch (err) { /* never fail the commit */ }
    }
    return change;
  }

  var savedSearches = {
    cap: SAVED_SEARCH_CAP,
    maxLabelLength: MAX_SEARCH_LABEL_LEN,
    maxQueryLength: MAX_SEARCH_QUERY_LEN,
    maxIdLength: MAX_SEARCH_ID_LEN,
    scanLimit: SEARCH_SCAN_LIMIT,
    futureSkewMs: MAX_SEARCH_FUTURE_MS,
    maxSequence: MAX_SEARCH_SEQ,
    syncChannel: SEARCH_SYNC_CHANNEL,
    syncStorageKey: SEARCH_SYNC_STORAGE_KEY,
    validateInput: validateSearchInput,
    normalizeLabel: normalizeSearchLabel,
    sanitizeId: sanitizeSearchId,
    reviveStored: reviveStoredSearch,
    sortNewestFirst: sortSearchesNewestFirst,
    publicRows: publicSearchRows,
    parseSyncMessage: parseSearchSyncMessage,
    createSync: createSearchSync,
    safeImportedTimestamp: safeImportedTimestamp,
    /* Create (or upsert-by-label) a saved search; null when rejected. */
    save: async function (input) {
      var valid = validateSearchInput(input);
      if (!valid) return null;
      var db = await openSearchDb();
      if (!db) return null;
      try {
        var existing = await getSearchRows(db);
        if (!existing || existing.truncated) return null;
        var norm = normalizeSearchLabel(valid.label);
        var prior = null;
        var ordered = sortSearchesNewestFirst(existing.rows);
        for (var i = 0; i < ordered.length; i++) {
          if (normalizeSearchLabel(ordered[i].label) === norm) {
            prior = ordered[i];
            break;
          }
        }
        var usedIds = new Set();
        for (var j = 0; j < existing.entries.length; j++) {
          var entryId = sanitizeSearchId(existing.entries[j].key);
          if (entryId) usedIds.add(entryId);
        }
        var record = {
          id: prior ? prior.id : uniqueSearchId(usedIds),
          label: valid.label,
          query: valid.query,
          mode: valid.mode,
          createdAt: Date.now(),
          seq: nextSearchSeq(existing.rows),
        };
        var tx = db.transaction(SEARCH_STORE, "readwrite");
        tx.objectStore(SEARCH_STORE).put(record);
        if (!await searchTxDone(tx)) return null;
        if (!await pruneSearches(db)) return null;
        var readback = await getStoredSearchRow(db, record.id);
        if (!readback || !sameStoredSearch(readback, record)) return null;
        publishSearchChange("save", 1, savedSearches.onchange);
        return toPublicSearch(readback);
      } catch (err) {
        return null;
      }
    },
    /* Newest-first public rows; [] when unavailable. */
    list: async function () {
      var db = await openSearchDb();
      if (!db) return [];
      try {
        var read = await getSearchRows(db);
        return read ? publicSearchRows(read) : [];
      } catch (err) {
        return [];
      }
    },
    /* Delete one row by id, verified gone. */
    remove: async function (id) {
      var safeId = sanitizeSearchId(id);
      if (!safeId || safeId !== id) return false;
      var db = await openSearchDb();
      if (!db) return false;
      try {
        var existed = await hasSearchRow(db, safeId);
        var tx = db.transaction(SEARCH_STORE, "readwrite");
        tx.objectStore(SEARCH_STORE).delete(safeId);
        if (!await searchTxDone(tx)) return false;
        if (await hasSearchRow(db, safeId)) return false;
        if (existed) publishSearchChange("delete", 1, savedSearches.onchange);
        return true;
      } catch (err) {
        return false;
      }
    },
    /* Wipe every row, verified empty. */
    clear: async function () {
      var db = await openSearchDb();
      if (!db) return false;
      try {
        var tx = db.transaction(SEARCH_STORE, "readwrite");
        tx.objectStore(SEARCH_STORE).clear();
        if (!await searchTxDone(tx)) return false;
        var readback = await getSearchRows(db);
        if (!readback || readback.physicalCount !== 0) return false;
        publishSearchChange("clear", 0, savedSearches.onchange);
        return true;
      } catch (err) {
        return false;
      }
    },
    exportAll: async function () {
      var snapshot = { kind: "onyx-saved-searches", version: 1, exportedAt: new Date().toISOString(), searches: [] };
      var db = await openSearchDb();
      if (!db) return snapshot;
      try {
        var read = await getSearchRows(db);
        snapshot.searches = read ? publicSearchRows(read) : [];
        return snapshot;
      } catch (err) {
        return snapshot;
      }
    },
    /* Validate untrusted JSON into an importable snapshot (allowlist). */
    parseExport: function (raw) {
      if (!isSearchRecord(raw) || raw.kind !== "onyx-saved-searches" || raw.version !== 1 || !Array.isArray(raw.searches)) {
        return null;
      }
      var list = raw.searches.slice(0, SEARCH_SCAN_LIMIT);
      var searches = [];
      for (var i = 0; i < list.length; i++) {
        var entry = list[i];
        if (!isSearchRecord(entry)) continue;
        var input = validateSearchInput(entry);
        if (!input) continue;
        searches.push({
          id: sanitizeSearchId(entry.id) || genSearchId(),
          label: input.label,
          query: input.query,
          mode: input.mode,
          createdAt: safeImportedTimestamp(entry.createdAt),
        });
        if (searches.length >= SAVED_SEARCH_CAP) break;
      }
      return {
        kind: "onyx-saved-searches",
        version: 1,
        exportedAt: new Date(safeImportedTimestamp(raw.exportedAt)).toISOString(),
        searches: searches,
      };
    },
    /* Merge a validated snapshot: dedupe by label (stable re-import),
       keep incoming ids only when unclaimed, preserve createdAt, prune,
       and count readback-verified writes. */
    importRows: async function (snapshot) {
      var parsed = savedSearches.parseExport(snapshot);
      if (!parsed || parsed.searches.length === 0) return { imported: 0 };
      var db = await openSearchDb();
      if (!db) return { imported: 0 };
      try {
        var existing = await getSearchRows(db);
        if (!existing || existing.truncated) return { imported: 0 };
        var byLabel = {};
        var usedIds = new Set();
        for (var i = 0; i < existing.entries.length; i++) {
          var entryId = sanitizeSearchId(existing.entries[i].key);
          if (entryId) usedIds.add(entryId);
        }
        var ordered = sortSearchesNewestFirst(existing.rows);
        for (var j = 0; j < ordered.length; j++) {
          var key = normalizeSearchLabel(ordered[j].label);
          if (!byLabel[key]) byLabel[key] = ordered[j];
        }
        var bounded = [];
        var incomingLabels = {};
        for (var k = 0; k < parsed.searches.length; k++) {
          if (bounded.length >= SAVED_SEARCH_CAP) break;
          var candidate = validateSearchInput(parsed.searches[k]);
          if (!candidate) continue;
          var norm = normalizeSearchLabel(candidate.label);
          if (incomingLabels[norm]) continue;
          incomingLabels[norm] = true;
          bounded.push({
            id: sanitizeSearchId(parsed.searches[k].id) || genSearchId(),
            label: candidate.label,
            query: candidate.query,
            mode: candidate.mode,
            createdAt: safeImportedTimestamp(parsed.searches[k].createdAt),
          });
        }
        var tx = db.transaction(SEARCH_STORE, "readwrite");
        var store = tx.objectStore(SEARCH_STORE);
        var records = [];
        var priorRows = existing.rows.slice();
        for (var m = 0; m < bounded.length; m++) {
          var entry = bounded[m];
          var entryNorm = normalizeSearchLabel(entry.label);
          var prior = byLabel[entryNorm] || null;
          var id = prior ? prior.id : entry.id;
          if (!prior && usedIds.has(id)) id = uniqueSearchId(usedIds);
          usedIds.add(id);
          var record = {
            id: id,
            label: entry.label,
            query: entry.query,
            mode: entry.mode,
            createdAt: entry.createdAt,
            seq: nextSearchSeq(priorRows.concat(records)),
          };
          byLabel[entryNorm] = record;
          store.put(record);
          records.push(record);
        }
        if (!await searchTxDone(tx)) return { imported: 0 };
        if (!await pruneSearches(db)) return { imported: 0 };
        var imported = 0;
        for (var n = 0; n < records.length; n++) {
          var readback = await getStoredSearchRow(db, records[n].id);
          if (readback && sameStoredSearch(readback, records[n])) imported += 1;
        }
        if (imported > 0) publishSearchChange("import", imported, savedSearches.onchange);
        return { imported: imported };
      } catch (err) {
        return { imported: 0 };
      }
    },
    onchange: null,
  };

  /* Session-reclaim banner timers, mirroring the oracle's
     `SESSION_RECLAIM_CONFIRM_MS` (2000) and `SESSION_RECLAIM_DISMISS_MS`
     (3000). Elm owns the phase machine; this only fires the stage back
     through `reclaimTimerFired`. A terminal FAIL or a fresh attempt
     clears both via `reclaimTimersClear`. */
  var RECLAIM_CONFIRM_MS = 2000;
  var RECLAIM_DISMISS_MS = 3000;

  function createReclaimTimers(app) {
    var timers = { confirm: null, dismiss: null };
    function clearReclaim(which) {
      if (timers[which] !== null) { clearTimeout(timers[which]); timers[which] = null; }
    }
    return {
      start: function (stage) {
        if (stage !== "confirm" && stage !== "dismiss") return;
        clearReclaim(stage);
        var delay = stage === "confirm" ? RECLAIM_CONFIRM_MS : RECLAIM_DISMISS_MS;
        timers[stage] = setTimeout(function () {
          timers[stage] = null;
          try { app.ports.reclaimTimerFired.send({ stage: stage }); } catch (err) { /* port gone */ }
        }, delay);
      },
      clear: function () { clearReclaim("confirm"); clearReclaim("dismiss"); }
    };
  }

  /* Clipboard write with the legacy textarea fallback, mirroring
     writeClipboardText: modern API first, then an attached readonly
     textarea for older webviews (focus/selection restored); empty
     text reports false with no DOM touch. */
  function legacyCopyText(text) {
    if (typeof document === "undefined" || !document.body) return false;
    var execCommand = document.execCommand;
    if (typeof execCommand !== "function") return false;
    var active = (typeof document.activeElement !== "undefined" && document.activeElement instanceof HTMLElement)
      ? document.activeElement
      : null;
    var selection = (typeof window !== "undefined" && typeof window.getSelection === "function")
      ? window.getSelection()
      : null;
    var ranges = [];
    if (selection) {
      for (var i = 0; i < selection.rangeCount; i += 1) {
        try { ranges.push(selection.getRangeAt(i).cloneRange()); } catch (err) { /* skip */ }
      }
    }
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.tabIndex = -1;
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.position = "fixed";
    textarea.style.inset = "0 auto auto -9999px";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    var copied = false;
    try {
      textarea.focus({ preventScroll: true });
      textarea.select();
      try { textarea.setSelectionRange(0, textarea.value.length); } catch (err) { /* older webview */ }
      copied = execCommand.call(document, "copy") === true;
    } catch (err) {
      copied = false;
    } finally {
      textarea.remove();
      if (selection) {
        try {
          selection.removeAllRanges();
          for (var j = 0; j < ranges.length; j += 1) selection.addRange(ranges[j]);
        } catch (err) { /* copy truth stands without restored ranges */ }
      }
      if (active && active.isConnected) {
        try { active.focus({ preventScroll: true }); } catch (err) { /* best-effort */ }
      }
    }
    return copied;
  }

  /* Voice engine lifecycle feed (mirroring useCadenceMedia
     onCallState plus the AppShell idle-outcome effect). The engine
     (WebRTC legs, WASM codecs) stays in JS; Elm owns validation and
     the hub fold. Events carry shell-owned evidence the Elm side
     cannot see (joinFailed / rejoinPending); snapshots carry the
     derived outcome. nowMs is a parameter so smokes can pin the
     clock; live calls pass Date.now(). */
  var VOICE_CALL_STATES = { idle: true, ringing_in: true, ringing_out: true, in_call: true };

  function voiceFeedBlank() {
    return { channel: null, startedAt: null, sawEstablished: false };
  }

  /* event: {state, nick, channel, joinFailed, rejoinPending}.
     Returns {snapshot, feed}, or null when the state is unplaceable
     (Elm drops it the same way). A null channel never wipes the last
     known one; startedAt is stamped on first in_call sighting (the
     engine only reports post-join states — the store's pre-capture
     provisional publish has no engine callback). */
  function voiceFeedNext(feed, event, nowMs) {
    var ev = event || {};
    if (!VOICE_CALL_STATES[ev.state]) return null;
    var now = (typeof nowMs === "number" && isFinite(nowMs) && nowMs >= 0) ? nowMs : Date.now();
    if (ev.state === "idle") {
      var outcome = null;
      if (ev.joinFailed) outcome = "failed";
      else if (ev.rejoinPending) outcome = "dropped";
      else if (feed.sawEstablished) outcome = "ended";
      return {
        snapshot: { state: "idle", nick: "", channel: null, startedAt: null, outcome: outcome },
        feed: voiceFeedBlank()
      };
    }
    var channel = (typeof ev.channel === "string" && ev.channel) ? ev.channel : feed.channel;
    var startedAt = feed.startedAt;
    if (ev.state === "in_call") {
      if (startedAt === null) startedAt = now;
    } else {
      startedAt = null;
    }
    return {
      snapshot: {
        state: ev.state,
        nick: (typeof ev.nick === "string") ? ev.nick : "",
        channel: channel,
        startedAt: startedAt,
        outcome: null
      },
      feed: {
        channel: channel,
        startedAt: startedAt,
        sawEstablished: feed.sawEstablished || (ev.state === "in_call" && startedAt !== null)
      }
    };
  }

  /* Subscribe the host engine (when the integration provides one) and
     push snapshots into Elm. Without an engine the hub honestly rests
     idle — never a fabricated call. Integration point:
     window.OnyxVoiceEngine.subscribe(pushEvent). */
  function mountVoiceFeedPush(app) {
    var feed = voiceFeedBlank();
    return function push(event) {
      var step = voiceFeedNext(feed, event, Date.now());
      if (!step) return;
      feed = step.feed;
      try {
        if (app.ports.voiceCallHub) app.ports.voiceCallHub.send(step.snapshot);
      } catch (err) { /* port gone */ }
    };
  }

  function mountVoiceFeed(app) {
    var push = mountVoiceFeedPush(app);
    var hook = (typeof window !== "undefined") ? window.OnyxVoiceEngine : undefined;
    if (hook && typeof hook.subscribe === "function") {
      try { hook.subscribe(push); } catch (err) { /* engine subscribe failed; hub rests idle */ }
    }
    return push;
  }

  function copyTextToClipboard(text) {
    if (!text) return Promise.resolve(false);
    var writeText = null;
    if (typeof navigator !== "undefined") {
      try {
        writeText = (navigator.clipboard && typeof navigator.clipboard.writeText === "function")
          ? navigator.clipboard.writeText.bind(navigator.clipboard)
          : null;
      } catch (err) {
        writeText = null;
      }
    }
    if (writeText) {
      return Promise.resolve()
        .then(function () { return writeText(text); })
        .then(function () { return true; })
        .catch(function () { return legacyCopyText(text); });
    }
    return Promise.resolve(legacyCopyText(text));
  }

  /* PING keepalive, mirroring client.ts: 25s idle fires the
     Elm-side probe (which also arms the 15s pong timeout in the same
     tick); any PONG observed by Elm re-arms the cycle. A dead peer
     closes the socket (4001) instead of lingering. Timers are owned
     here; policy (which lines count) stays in Elm. */
  var PING_IDLE_MS = 25000;
  var PONG_TIMEOUT_MS = 15000;

  function createPingKeepalive(app, sock, delays) {
    var idleMs = (delays && delays.idleMs) || PING_IDLE_MS;
    var timeoutMs = (delays && delays.timeoutMs) || PONG_TIMEOUT_MS;
    var pingTimer = null;
    var pongTimer = null;
    function clearPing() {
      if (pingTimer !== null) { clearTimeout(pingTimer); pingTimer = null; }
      clearPong();
    }
    function clearPong() {
      if (pongTimer !== null) { clearTimeout(pongTimer); pongTimer = null; }
    }
    function schedule() {
      clearPing();
      pingTimer = setTimeout(function () {
        pingTimer = null;
        try { app.ports.pingDue.send(null); } catch (err) {}
        pongTimer = setTimeout(function () {
          pongTimer = null;
          try { sock.close(4001, "Ping timeout"); } catch (err) {}
        }, timeoutMs);
      }, idleMs);
    }
    function observed() {
      clearPong();
      schedule();
    }
    function clear() {
      clearPing();
    }
    return { schedule: schedule, observed: observed, clear: clear };
  }

  /* Node probing — mirrors `src/app/nodes.ts` (`pingNode` /
     `probeNodes` / `selectBestNode`): time a bodyless HTTPS HEAD
     against each node's web tier (NOT the IRC socket, which would
     trip flood protection), pick the fastest reachable node, fall
     back to a random node when probing is inconclusive. A pin always
     wins and disables probing. Resolves to Infinity on error,
     timeout, or without fetch. */
  var NODES_PROBE_TIMEOUT_MS = 4000;
  var NODES_MAX_CONCURRENCY = 4;

  function boundedProbeTimeout(timeoutMs) {
    return (typeof timeoutMs === "number" && isFinite(timeoutMs) && timeoutMs >= 0)
      ? Math.floor(timeoutMs)
      : NODES_PROBE_TIMEOUT_MS;
  }

  function probeConcurrency(requested, nodeCount) {
    var finite = (typeof requested === "number" && isFinite(requested))
      ? Math.floor(requested)
      : NODES_MAX_CONCURRENCY;
    return Math.min(nodeCount, Math.max(1, finite));
  }

  function pingNode(host, timeoutMs) {
    if (typeof fetch !== "function" || typeof performance === "undefined" || !host) {
      return Promise.resolve(Number.POSITIVE_INFINITY);
    }
    var bounded = boundedProbeTimeout(timeoutMs);
    var controller = (typeof AbortController === "function") ? new AbortController() : null;
    var settled = false;
    function finish(ms) {
      if (settled) return ms;
      settled = true;
      clearTimeout(timer);
      return ms;
    }
    var timer = setTimeout(function () {
      try { if (controller) controller.abort(); } catch (err) { /* already settled */ }
      finish(Number.POSITIVE_INFINITY);
    }, bounded);
    var start = performance.now();
    var options = { method: "HEAD", mode: "no-cors", cache: "no-store" };
    if (controller) options.signal = controller.signal;
    var target = "https://" + host + "/?_lat=" + start;
    return Promise.resolve()
      .then(function () { return fetch(target, options); })
      .then(function () { return finish(performance.now() - start); })
      .catch(function () { return finish(Number.POSITIVE_INFINITY); });
  }

  function probeNodeList(nodes, timeoutMs, maxConcurrency) {
    var list = Array.isArray(nodes) ? nodes.slice() : [];
    var workers = probeConcurrency(maxConcurrency, list.length);
    var results = new Array(list.length);
    var nextIndex = 0;
    function worker() {
      var index = nextIndex++;
      var node = list[index];
      if (!node) return Promise.resolve();
      return pingNode(node.host, timeoutMs).then(function (ms) {
        results[index] = { node: node, ms: ms };
        return worker();
      });
    }
    var pool = [];
    for (var i = 0; i < workers; i += 1) pool.push(worker());
    return Promise.all(pool).then(function () {
      return results.filter(function (r) { return r !== undefined; });
    });
  }

  function pickFastestNode(results) {
    var fastest = null;
    for (var i = 0; i < results.length; i += 1) {
      var result = results[i];
      if (result && isFinite(result.ms) && (!fastest || result.ms < fastest.ms)) {
        fastest = result;
      }
    }
    return fastest ? fastest.node : null;
  }

  function randomNode(nodes) {
    var pool = (Array.isArray(nodes) && nodes.length > 0) ? nodes : [];
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function selectBestNode(nodes, options) {
    var opts = options || {};
    var pin = opts.pin;
    if (typeof pin === "string" && pin.trim() !== "") {
      var trimmed = pin.trim();
      var known = (nodes || []).filter(function (n) { return n && n.wss === trimmed; })[0];
      return Promise.resolve(known || { id: "env", host: "custom", wss: trimmed });
    }
    return probeNodeList(nodes, opts.timeoutMs, opts.maxConcurrency).then(function (results) {
      return pickFastestNode(results) || randomNode(nodes);
    });
  }

  function probeWinnerHost(wss) {
    try {
      return new URL(wss).host.toLowerCase();
    } catch (err) {
      return "";
    }
  }

  /* Upload + link-preview bridge — mirrors `src/lib/upload/upload.ts`
     (multipart POST of the `file` field, bounded response) and the
     fetch half of `src/lib/preview/linkPreview.ts` (same-origin
     `/linkpreview` endpoint only). File bytes never cross into Elm:
     the picker holds them keyed by upload key; Elm validates caps
     off the reported meta and parses response bodies with
     `Upload.parseUploadResponse`. Elm gates preview targets with
     `isPreviewableUrl` first — defense in depth; the same-origin
     endpoint is the real SSRF boundary. */
  var UPLOAD_BRIDGE_MAX_BYTES = 64 * 1024;

  function readBoundedBridgeText(response, cap) {
    var rawLength = null;
    try {
      rawLength = response.headers ? response.headers.get("content-length") : null;
    } catch (err) { rawLength = null; }
    if (rawLength !== null) {
      var length = Number(rawLength);
      if (isFinite(length) && length > cap) {
        return Promise.resolve(null);
      }
    }
    return Promise.resolve()
      .then(function () { return response.text(); })
      .then(function (text) {
        var body = typeof text === "string" ? text : "";
        if (body.length > cap) return null;
        return body;
      })
      .catch(function () { return null; });
  }

  /* XHR upload with progress events — mirrors `uploadWithXhr` in
     `src/lib/upload/upload.ts` (used when `onProgress` is set): the
     percent math matches `progressFromEvent` (null while the total is
     unknown), and the bounded response parse is shared with the fetch
     path. Falls back to `uploadSendFile` where XHR is unavailable. */
  function uploadSendXhr(file, endpoint, fieldName, onProgress) {
    return new Promise(function (resolve) {
      if (!file) {
        resolve({ ok: false, status: 0, body: "", contentType: null });
        return;
      }
      var xhr = new XMLHttpRequest();
      var form = new FormData();
      form.append(fieldName || "file", file);
      xhr.open("POST", endpoint);
      if (xhr.upload && typeof onProgress === "function") {
        xhr.upload.onprogress = function (event) {
          var total = (event && event.lengthComputable) ? event.total : null;
          onProgress({
            loaded: (event && event.loaded) || 0,
            total: total,
            percent: (total && total > 0) ? Math.round((event.loaded / total) * 100) : null
          });
        };
      }
      xhr.onerror = function () { resolve({ ok: false, status: 0, body: "", contentType: null }); };
      xhr.onabort = function () { resolve({ ok: false, status: 0, body: "", contentType: null }); };
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) {
          resolve({ ok: false, status: xhr.status, body: "", contentType: null });
          return;
        }
        var contentType = null;
        try { contentType = xhr.getResponseHeader("content-type"); } catch (err) { contentType = null; }
        var text = (typeof xhr.responseText === "string") ? xhr.responseText : "";
        if (text.length > UPLOAD_BRIDGE_MAX_BYTES) {
          resolve({ ok: false, status: xhr.status, body: "", contentType: null });
          return;
        }
        resolve({ ok: true, status: xhr.status, body: text, contentType: contentType });
      };
      xhr.send(form);
    });
  }

  function uploadSendFile(file, endpoint, fieldName, fetchFn) {
    var impl = fetchFn || ((typeof fetch === "function") ? fetch : null);
    if (!impl || !file) {
      return Promise.resolve({ ok: false, status: 0, body: "", contentType: null });
    }
    var form = new FormData();
    form.append(fieldName || "file", file);
    return Promise.resolve()
      .then(function () { return impl(endpoint, { method: "POST", body: form }); })
      .then(function (response) {
        if (!response || response.status < 200 || response.status >= 300) {
          return { ok: false, status: response ? response.status : 0, body: "", contentType: null };
        }
        var contentType = null;
        try {
          contentType = response.headers ? response.headers.get("content-type") : null;
        } catch (err) { contentType = null; }
        return readBoundedBridgeText(response, UPLOAD_BRIDGE_MAX_BYTES).then(function (body) {
          if (body === null) return { ok: false, status: response.status, body: "", contentType: null };
          return { ok: true, status: response.status, body: body, contentType: contentType };
        });
      })
      .catch(function () { return { ok: false, status: 0, body: "", contentType: null }; });
  }

  function previewEndpointAllowed(endpoint, origin) {
    try {
      var parsed = new URL(endpoint, origin || "http://localhost");
      if (!origin) return parsed.protocol === "http:" || parsed.protocol === "https:";
      return parsed.origin === origin;
    } catch (err) {
      return false;
    }
  }

  function previewGet(endpoint, targetUrl, fetchFn, origin) {
    var impl = fetchFn || ((typeof fetch === "function") ? fetch : null);
    var base = origin || ((typeof location !== "undefined" && location.origin) ? location.origin : null);
    if (!impl || !previewEndpointAllowed(endpoint, base)) {
      return Promise.resolve({ ok: false, status: 0, body: "" });
    }
    var separator = (endpoint.indexOf("?") >= 0) ? "&" : "?";
    var full = endpoint + separator + "url=" + encodeURIComponent(targetUrl);
    return Promise.resolve()
      .then(function () { return impl(full, { headers: { Accept: "application/json" } }); })
      .then(function (response) {
        if (!response || !response.ok) {
          return { ok: false, status: response ? response.status : 0, body: "" };
        }
        return readBoundedBridgeText(response, UPLOAD_BRIDGE_MAX_BYTES).then(function (body) {
          if (body === null) return { ok: false, status: response.status, body: "" };
          return { ok: true, status: response.status, body: body };
        });
      })
      .catch(function () { return { ok: false, status: 0, body: "" }; });
  }

  /* Cadence binary media bridge — mirrors the oracle socket's binary
     plane (`client.ts` `_onMessage` / `sendBinary`): binary frames are
     media datagrams, never IRC lines. `text.ircv3.net` is control-only
     (binary there closes 1002); oversized frames close 1009; empty
     frames drop; the rest forward to Elm, which validates the Cadence
     header fail-closed before handing bytes to the host engine. Media
     is loss-tolerant: a full buffer sheds the frame (false), never
     backpressure. */
  var MEDIA_MAX_BINARY_BYTES = 4 * 1024 * 1024;
  var MEDIA_MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
  var MEDIA_TEXT_SUBPROTOCOL = "text.ircv3.net";

  function mediaToBytes(data) {
    if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }
    if (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (data instanceof Uint8Array) {
      return data;
    }
    return null;
  }

  function mediaSocketOpen(socket) {
    try {
      return !!socket && socket.readyState === 1;
    } catch (err) {
      return false;
    }
  }

  function mediaAdmitsBinary(socket) {
    try {
      return !!socket && socket.readyState === 1 && socket.protocol !== MEDIA_TEXT_SUBPROTOCOL;
    } catch (err) {
      return false;
    }
  }

  function mediaHasCapacity(socket, payloadBytes) {
    try {
      var buffered = socket.bufferedAmount;
      return Number.isFinite(buffered) && buffered >= 0
        && payloadBytes <= MEDIA_MAX_BUFFERED_BYTES - buffered;
    } catch (err) {
      return false;
    }
  }

  /* Classify one socket message: "text" for the line buffer,
     "forwarded" when bytes reached Elm, "dropped" for empty frames or
     a missing port, "closed" when the socket was rejected. */
  function mediaReceiveRaw(app, data, protocol, close) {
    var bytes = mediaToBytes(data);
    if (!bytes) return "text";
    if (protocol === MEDIA_TEXT_SUBPROTOCOL) {
      try { close(1002, "Binary frame on text.ircv3.net"); } catch (err) { /* already closing */ }
      return "closed";
    }
    if (bytes.byteLength > MEDIA_MAX_BINARY_BYTES) {
      try { close(1009, "WebSocket frame too large"); } catch (err) { /* already closing */ }
      return "closed";
    }
    if (bytes.byteLength === 0) return "dropped";
    if (!app.ports.mediaBinaryReceived) return "dropped";
    try {
      app.ports.mediaBinaryReceived.send({ bytes: Array.from(bytes) });
      return "forwarded";
    } catch (err) {
      return "dropped";
    }
  }

  function mediaIsByte(n) {
    return typeof n === "number" && isFinite(n) && Math.floor(n) === n && n >= 0 && n <= 255;
  }

  function createMediaBinary(deps) {
    function liveSocket() {
      try {
        return deps.socket();
      } catch (err) {
        return null;
      }
    }
    function hostEngine() {
      try {
        var engine = deps.engine();
        return (engine && typeof engine === "object") ? engine : null;
      } catch (err) {
        return null;
      }
    }
    return {
      /* Send a prebuilt datagram (mirrors `sendBinary`): copy into a
         fresh view so pooled sources can't leak trailing bytes; shed
         when closed, non-admitting, oversized, or full. */
      sendDatagram: function (bytes) {
        if (!Array.isArray(bytes) || bytes.length === 0 || bytes.length > MEDIA_MAX_BINARY_BYTES) return false;
        for (var i = 0; i < bytes.length; i++) {
          if (!mediaIsByte(bytes[i])) return false;
        }
        var socket = liveSocket();
        if (!mediaAdmitsBinary(socket) || !mediaHasCapacity(socket, bytes.length)) return false;
        try {
          socket.send(new Uint8Array(bytes).slice());
          return mediaSocketOpen(socket);
        } catch (err) {
          return false;
        }
      },
      /* Hand a validated datagram to the host engine (mirrors the
         `onBinary` dispatch; without an engine the frame drops — Elm
         never plays media itself). */
      deliverToEngine: function (bytes) {
        var engine = hostEngine();
        if (!engine || typeof engine.receiveMediaFrame !== "function") return false;
        if (!Array.isArray(bytes) || bytes.length === 0) return false;
        try {
          engine.receiveMediaFrame(bytes.slice());
          return true;
        } catch (err) {
          return false;
        }
      }
    };
  }

  function wireMediaBinary(app, media) {
    if (app.ports.mediaBinarySend) {
      app.ports.mediaBinarySend.subscribe(function (req) {
        media.sendDatagram(req && req.bytes);
      });
    }
    if (app.ports.mediaEngineFrame) {
      app.ports.mediaEngineFrame.subscribe(function (req) {
        media.deliverToEngine(req && req.bytes);
      });
    }
  }

  function connectSocket(app, url, sendPort, onClose) {
    var socket = null;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      app.ports.wsClosed.send({ clean: false, reason: String(err) });
      return { send: function () {}, close: function () {}, isOpen: function () { return false; } };
    }
    /* Binary media datagrams arrive as ArrayBuffers (never Blobs), so the
       bridge gets bytes synchronously — mirroring the oracle client. */
    try { socket.binaryType = "arraybuffer"; } catch (err) { /* text still flows */ }
    var buffer = "";
    socket.addEventListener("open", function () {
      app.ports.wsOpened.send({ url: url });
    });
    socket.addEventListener("message", function (event) {
      /* Binary frames carry media datagrams, not IRC lines: classify first
         so binary bytes can never pollute the text buffer. */
      if (mediaReceiveRaw(app, event.data, socket.protocol, function (code, reason) {
        try { socket.close(code, reason); } catch (err) { /* already closing */ }
      }) !== "text") {
        return;
      }
      buffer += String(event.data);
      var lines = buffer.split("\r\n");
      buffer = lines.pop();
      var batch = lines.filter(function (line) { return line.length > 0; });
      if (batch.length > 0) {
        sendPort(batch);
      }
    });
    socket.addEventListener("close", function (event) {
      app.ports.wsClosed.send({ clean: event.wasClean, reason: event.reason || "" });
      if (onClose) { try { onClose(); } catch (err) {} }
    });
    socket.addEventListener("error", function () {
      app.ports.wsClosed.send({ clean: false, reason: "error" });
    });
    return {
      send: function (line) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(line + "\r\n");
        }
      },
      close: function (code, reason) {
        try {
          if (code === undefined) {
            socket.close();
          } else {
            socket.close(code, reason);
          }
        } catch (err) {}
      },
      isOpen: function () {
        try {
          return socket.readyState === WebSocket.OPEN;
        } catch (err) {
          return false;
        }
      },
      rawSocket: function () {
        return socket;
      }
    };
  }

/* Same-origin public JSON feeds, mirroring fetchPublicJson:
   8s timeout, 256 KiB cap (content-length pre-check plus stream
   accounting), Accept: application/json. Bodies cross as text;
   Elm parses and validates. Results route by caller key. */
var PUBLIC_FEED_MAX_BYTES = 256 * 1024;
var PUBLIC_FEED_TIMEOUT_MS = 8000;
function fetchPublicFeed(url) {
  if (typeof fetch !== "function") return Promise.resolve({ ok: false, status: 0, body: "" });
  var controller = (typeof AbortController === "function") ? new AbortController() : null;
  var timeout = setTimeout(function () {
    try { if (controller) controller.abort(); } catch (err) { /* already settled */ }
  }, PUBLIC_FEED_TIMEOUT_MS);
  var settled = false;
  function finish(outcome) {
    if (settled) return outcome;
    settled = true;
    clearTimeout(timeout);
    return outcome;
  }
  var options = { headers: { Accept: "application/json" } };
  if (controller) options.signal = controller.signal;
  return Promise.resolve()
    .then(function () { return fetch(url, options); })
    .then(function (response) {
      if (!response || !response.ok) return finish({ ok: false, status: response ? response.status : 0, body: "" });
      var rawLength = response.headers ? response.headers.get("content-length") : null;
      if (rawLength !== null) {
        var contentLength = Number(rawLength);
        if (Number.isFinite(contentLength) && contentLength > PUBLIC_FEED_MAX_BYTES) {
          return finish({ ok: false, status: response.status, body: "" });
        }
      }
      if (!response.body || typeof response.body.getReader !== "function") {
        return response.arrayBuffer().then(function (buffer) {
          if (buffer.byteLength > PUBLIC_FEED_MAX_BYTES) return finish({ ok: false, status: response.status, body: "" });
          return finish({ ok: true, status: response.status, body: new TextDecoder().decode(buffer) });
        });
      }
      var reader = response.body.getReader();
      var chunks = [];
      var total = 0;
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            var bytes = new Uint8Array(total);
            var offset = 0;
            for (var i = 0; i < chunks.length; i += 1) {
              bytes.set(chunks[i], offset);
              offset += chunks[i].byteLength;
            }
            return finish({ ok: true, status: response.status, body: new TextDecoder().decode(bytes) });
          }
          if (result.value) {
            total += result.value.byteLength;
            if (total > PUBLIC_FEED_MAX_BYTES) {
              try { if (controller) controller.abort(); } catch (err) { /* already over cap */ }
              try { reader.cancel(); } catch (err) { /* already over cap */ }
              return finish({ ok: false, status: response.status, body: "" });
            }
            chunks.push(result.value);
          }
          return pump();
        });
      }
      return pump();
    })
    .then(function (outcome) { return finish(outcome); })
    .catch(function () { return finish({ ok: false, status: 0, body: "" }); });
}
  function wire(app) {
    var socket = { send: function () {}, close: function () {}, isOpen: function () { return false; }, rawSocket: function () { return null; } };
    var vault = null;
    var keepalive = null;

    openVault(function (db) { vault = db; });

    app.ports.wsConnect.subscribe(function (req) {
      socket.close();
      if (keepalive) keepalive.clear();
      socket = connectSocket(app, req.url, function (batch) {
        /* Receipt stamp: folds between Ticks (latency RTT) resolve
           against receipt ms, not the last tick. */
        app.ports.wsLines.send({ at: Date.now(), lines: batch });
      }, function () {
        if (keepalive) keepalive.clear();
      });
      keepalive = createPingKeepalive(app, socket);
      keepalive.schedule();
    });

    /* Node selection (mirrors `selectBestNode` falling through to
       `initialNode`): a pin connects its endpoint with probing
       disabled; otherwise the registry is HEAD-probed and the
       winner's stored resume holdings ride along so SESSION RESUME
       survives node selection. */
    if (app.ports.probeNodes) {
      app.ports.probeNodes.subscribe(function (req) {
        var list = (req && Array.isArray(req.nodes)) ? req.nodes : [];
        var nick = (req && typeof req.nick === "string") ? req.nick : "guest";
        selectBestNode(list, {
          pin: req ? req.pin : null,
          timeoutMs: req ? req.timeoutMs : null,
          maxConcurrency: req ? req.maxConcurrency : null
        }).then(function (winner) {
          if (!winner || typeof winner.wss !== "string") return;
          var held = null;
          try {
            held = loadResumeTokens(probeWinnerHost(winner.wss), nick) || null;
          } catch (err) { held = null; }
          try {
            app.ports.nodesProbed.send({
              wss: winner.wss,
              sessionToken: (held && held.sessionToken) || null,
              meshToken: (held && held.meshToken) || null,
              meshExpiresAtMs: (held && typeof held.meshExpiresAtMs === "number") ? held.meshExpiresAtMs : null
            });
          } catch (err) { /* port gone */ }
        });
      });
    }

    if (app.ports.pingObserved) {
      app.ports.pingObserved.subscribe(function () {
        if (keepalive) keepalive.observed();
      });
    }

    /* Invite-link copy: modern clipboard API with the legacy textarea
       fallback, mirroring writeClipboardText (empty text reports
       false; no localStorage fallback — copied values may be secret). */
    if (app.ports.clipboardCopy) {
      app.ports.clipboardCopy.subscribe(function (req) {
        var text = req && typeof req.text === "string" ? req.text : "";
        var tag = req && typeof req.tag === "string" ? req.tag : "";
        copyTextToClipboard(text).then(function (ok) {
          try { app.ports.clipboardResult.send({ tag: tag, ok: !!ok }); } catch (err) { /* port gone */ }
        });
      });
    }

    /* Appearance slots, mirroring lib/prefs + theme storage: five
       small reads in one snapshot (Elm validates fail-closed), one
       write per change, and one DOM application per state change
       (data-* prefs attrs + data-theme / color-scheme, mirroring
       applyPreferences and the attribute half of applyThemeToDom;
       full token-var commit rides the ThemeStudio slice). */
    function readSlot(key) {
      try {
        if (typeof window === "undefined" || !window.localStorage) return "";
        var raw = window.localStorage.getItem(key);
        return typeof raw === "string" ? raw : "";
      } catch (err) { return ""; }
    }
    function writeSlot(key, value) {
      try {
        if (typeof window === "undefined" || !window.localStorage) return;
        window.localStorage.setItem(key, value);
      } catch (err) { /* storage unavailable / quota — non-fatal */ }
    }
    if (app.ports.appearanceRequest) {
      app.ports.appearanceRequest.subscribe(function () {
        try {
          app.ports.appearanceSnapshot.send({
            prefsJson: readSlot("onyx:preferences"),
            legacyContrast: readSlot("onyx:high-contrast"),
            sceneMotion: readSlot("onyx:scene-motion"),
            themeId: readSlot("onyx:theme"),
            customThemesJson: readSlot("onyx:custom-themes"),
            backgroundId: readSlot("onyx:bg"),
            eyeDropperSupported: (typeof window !== "undefined" && typeof window.EyeDropper === "function"),
          });
        } catch (err) { /* snapshot is best-effort; Elm defaults cover */ }
      });
    }
    if (app.ports.studioStoreCustomThemes) {
      app.ports.studioStoreCustomThemes.subscribe(function (req) {
        if (req && typeof req.json === "string") writeSlot("onyx:custom-themes", req.json);
      });
    }
    /* Cross-tab custom-theme coherence (mirroring the provider storage
       handler): another tab's write re-revives here; Elm falls back off
       a deleted active theme and forces a palette re-apply. */
    if (app.ports.studioCustomThemes && typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("storage", function (event) {
        try {
          if (event && event.storageArea && event.storageArea !== window.localStorage) return;
          if (event && event.key !== null && event.key !== "onyx:custom-themes" && event.key !== "onyx:theme") return;
          app.ports.studioCustomThemes.send({ json: readSlot("onyx:custom-themes") });
        } catch (err) { /* refresh is best-effort */ }
      });
    }
    /* Voice engine lifecycle feed: snapshots flow one way into Elm via
       voiceCallHub; Elm validates fail-closed and never commands the
       engine (the hub renders no join/accept/start control). */
    /* One shared feed for engine events and command outcomes, so
       startedAt/established tracking never diverges between them. */
    var voicePush = mountVoiceFeed(app);
    /* Voice command direction (mirroring `joinVoiceChannel` /
       `leaveVoiceChannel` guards): Elm validated socket + channel, so
       the bridge only resolves the engine. Without a mounted engine
       the join feeds joinFailed (the oracle's error-toast path —
       never a phantom call); leave/mute without an engine no-op.
       Promise rejections feed the same failed outcome. */
    function voiceEngine() {
      var hook = (typeof window !== "undefined") ? window.OnyxVoiceEngine : undefined;
      return (hook && typeof hook === "object") ? hook : null;
    }
    function voiceFailed(channel) {
      voicePush({ state: "idle", nick: "", channel: channel || null, joinFailed: true });
    }
    if (app.ports.voiceJoin) {
      app.ports.voiceJoin.subscribe(function (req) {
        var channel = req && typeof req.channel === "string" ? req.channel : "";
        var video = !!(req && req.video);
        if (!channel) return;
        var engine = voiceEngine();
        if (!engine || typeof engine.joinVoice !== "function") {
          voiceFailed(channel);
          return;
        }
        try {
          var done = engine.joinVoice(channel, { video: video });
          if (done && typeof done.then === "function") {
            done.then(null, function () { voiceFailed(channel); });
          }
        } catch (err) {
          voiceFailed(channel);
        }
      });
    }
    if (app.ports.voiceLeave) {
      app.ports.voiceLeave.subscribe(function (req) {
        var channel = req && typeof req.channel === "string" ? req.channel : "";
        if (!channel) return;
        var engine = voiceEngine();
        if (!engine || typeof engine.leaveRoom !== "function") return;
        try { engine.leaveRoom(channel); } catch (err) { /* leave is best-effort */ }
      });
    }
    if (app.ports.voiceMute) {
      app.ports.voiceMute.subscribe(function (req) {
        var engine = voiceEngine();
        if (!engine || typeof engine.setMuted !== "function") return;
        try { engine.setMuted(!!(req && req.muted)); } catch (err) { /* mute is best-effort */ }
      });
    }
    if (app.ports.appearanceStorePrefs) {
      app.ports.appearanceStorePrefs.subscribe(function (req) {
        if (req && typeof req.json === "string") writeSlot("onyx:preferences", req.json);
      });
    }
    /* Ignore/mute blocklists: Elm normalizes fail-closed; the bridge only
       persists the validated arrays (plain keys — the oracle's
       owner-suffixed slots stay ahead until Elm carries an owner). */
    if (app.ports.blocklistsSave) {
      app.ports.blocklistsSave.subscribe(function (req) {
        if (!req) return;
        if (Array.isArray(req.ignored)) writeSlot("onyx:ignored-users", JSON.stringify(req.ignored));
        if (Array.isArray(req.muted)) writeSlot("onyx:muted-dms", JSON.stringify(req.muted));
      });
    }
    /* Followed conversations: same validated-array persistence
       (`onyx:followed`, plain key like the blocklists). */
    if (app.ports.followedSave) {
      app.ports.followedSave.subscribe(function (req) {
        if (req && Array.isArray(req.keys)) writeSlot("onyx:followed", JSON.stringify(req.keys));
      });
    }
    /* Highlight terms: Elm normalizes fail-closed (trim/lower, 256-char
       cap, no controls, 128 max); the bridge only persists the validated
       array under the plain `onyx:highlight-words` key — the oracle's
       owner-suffixed slots stay ahead until Elm carries an owner. An
       emptied list removes the key, mirroring `saveHighlightWords`. */
    if (app.ports.highlightWordsSave) {
      app.ports.highlightWordsSave.subscribe(function (req) {
        if (!req || !Array.isArray(req.words)) return;
        try {
          if (req.words.length === 0) {
            if (typeof window !== "undefined" && window.localStorage) {
              window.localStorage.removeItem("onyx:highlight-words");
            }
          } else {
            writeSlot("onyx:highlight-words", JSON.stringify(req.words));
          }
        } catch (err) { /* storage unavailable / quota — non-fatal */ }
      });
    }
    /* DND axes: `onyx:dnd-enabled` always written ("true"/"false"),
       `onyx:dnd-until` written or removed when null — mirroring
       `setDndEnabled` / `setDndUntil`. */
    if (app.ports.dndSave) {
      app.ports.dndSave.subscribe(function (req) {
        if (!req || typeof req.enabled !== "boolean") return;
        try {
          writeSlot("onyx:dnd-enabled", String(req.enabled));
          if (req.until === null || req.until === undefined) {
            if (typeof window !== "undefined" && window.localStorage) {
              window.localStorage.removeItem("onyx:dnd-until");
            }
          } else if (typeof req.until === "number" && isFinite(req.until)) {
            writeSlot("onyx:dnd-until", String(Math.floor(req.until)));
          }
        } catch (err) { /* storage unavailable / quota — non-fatal */ }
      });
    }
    /* Per-room notify levels: Elm normalizes fail-closed (lowercase
       `#`/`&` keys, `mentions`/`none` only, 256 cap); the bridge writes
       the `{ [channel]: level }` object under the plain
       `onyx:channel-notify` key — the oracle's owner-suffixed slots stay
       ahead until Elm carries an owner. An emptied map removes the key,
       mirroring `saveChannelNotify`. */
    if (app.ports.channelNotifySave) {
      app.ports.channelNotifySave.subscribe(function (req) {
        if (!req || !Array.isArray(req.entries)) return;
        try {
          var obj = {};
          req.entries.forEach(function (entry) {
            if (entry && typeof entry.channel === "string" && typeof entry.level === "string") {
              obj[entry.channel] = entry.level;
            }
          });
          if (Object.keys(obj).length === 0) {
            if (typeof window !== "undefined" && window.localStorage) {
              window.localStorage.removeItem("onyx:channel-notify");
            }
          } else {
            writeSlot("onyx:channel-notify", JSON.stringify(obj));
          }
        } catch (err) { /* storage unavailable / quota — non-fatal */ }
      });
    }
    /* Starred rooms: Elm normalizes fail-closed (trim+lower, `#`/`&`
       lead, 128-char cap, no space/comma/controls, 256 max); the bridge
       writes the validated array under the plain
       `onyx:starred-channels` key — the oracle bundles stars into the
       whole owner-scoped `onyx:channel-navigation` object instead, which
       stays ahead until Elm carries navigation memory. An emptied set
       removes the key, like the highlight/notify rails. */
    if (app.ports.starredSave) {
      app.ports.starredSave.subscribe(function (req) {
        if (!req || !Array.isArray(req.channels)) return;
        try {
          if (req.channels.length === 0) {
            if (typeof window !== "undefined" && window.localStorage) {
              window.localStorage.removeItem("onyx:starred-channels");
            }
          } else {
            writeSlot("onyx:starred-channels", JSON.stringify(req.channels));
          }
        } catch (err) { /* storage unavailable / quota — non-fatal */ }
      });
    }
    /* Auto-join rooms: Elm normalizes fail-closed (trim+lower, `#`/`&`
       lead, 128-char cap, no space/comma/controls, first-wins dedupe,
       128 max, insertion-ordered); the bridge writes the validated array
       under the plain `onyx:autojoin-channels` key — the plain
       `onyx:autojoin` key is avoided because the oracle purges ownerless
       reads, and its owner-suffixed slots stay ahead until Elm carries
       an owner. An emptied list removes the key, exactly mirroring
       `saveAutoJoinChannels`. */
    if (app.ports.autoJoinSave) {
      app.ports.autoJoinSave.subscribe(function (req) {
        if (!req || !Array.isArray(req.channels)) return;
        try {
          if (req.channels.length === 0) {
            if (typeof window !== "undefined" && window.localStorage) {
              window.localStorage.removeItem("onyx:autojoin-channels");
            }
          } else {
            writeSlot("onyx:autojoin-channels", JSON.stringify(req.channels));
          }
        } catch (err) { /* storage unavailable / quota — non-fatal */ }
      });
    }
    /* Room accent labels: Elm normalizes fail-closed (lowercase
       `#`/`&` room keys, hex-only `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`
       colors, 256 cap with duplicate-key overwrite); the bridge writes
       the `{ [channel]: color }` object under the plain
       `onyx:channel-color-labels` key — the plain `onyx:channel-colors`
       key is avoided because the oracle purges ownerless reads, and its
       owner-suffixed slots stay ahead until Elm carries an owner. An
       emptied map removes the key, exactly mirroring
       `saveChannelColors`. */
    if (app.ports.channelColorsSave) {
      app.ports.channelColorsSave.subscribe(function (req) {
        if (!req || !Array.isArray(req.entries)) return;
        try {
          var obj = {};
          req.entries.forEach(function (entry) {
            if (entry && typeof entry.channel === "string" && typeof entry.color === "string") {
              obj[entry.channel] = entry.color;
            }
          });
          if (Object.keys(obj).length === 0) {
            if (typeof window !== "undefined" && window.localStorage) {
              window.localStorage.removeItem("onyx:channel-color-labels");
            }
          } else {
            writeSlot("onyx:channel-color-labels", JSON.stringify(obj));
          }
        } catch (err) { /* storage unavailable / quota — non-fatal */ }
      });
    }
    /* Scheduled-message queue projection (`onyx:scheduled`): Elm owns
       validation, owner scoping, and encoding (mirroring
       `_persistScheduledMessages`, which always writes — even an empty
       queue — rather than removing the key), and the bridge reports the
       write back so Elm can mark `scheduledProjectionDegraded` exactly
       when the projection fails. The durable IndexedDB admission fence
       joins in a later slice. */
    if (app.ports.scheduledSave) {
      app.ports.scheduledSave.subscribe(function (req) {
        var ok = false;
        try {
          if (req && req.rows !== undefined) {
            if (typeof window !== "undefined" && window.localStorage) {
              window.localStorage.setItem("onyx:scheduled", JSON.stringify(req.rows));
            }
            ok = true;
          }
        } catch (err) { ok = false; /* storage unavailable / quota */ }
        try {
          if (app.ports.scheduledPersisted) {
            app.ports.scheduledPersisted.send({ ok: ok });
          }
        } catch (err) { /* port gone */ }
      });
    }
    /* Durable scheduled-message queue — structurally-identical mirror
       of the `historyVault.ts` scheduled ops (`captureScheduledFence`,
       `addScheduledRow`, `reconcileScheduledRows`, `claimScheduledRow`,
       `settleScheduledClaim`, `cancelScheduledRow`,
       `cancelScheduledRowsForOwner`). Elm owns validation, owner
       scoping, due selection, and claim tokens; this mirror enforces
       the same-origin CAS fences (erase epoch, owner generation,
       capacity, claim exclusivity, cancellation tombstones) in
       IndexedDB transactions, so tabs and reloads serialize exactly
       like the oracle. Owner keys are byte-identical to
       `deviceMemoryOwnerKey` (`JSON.stringify([serverUrl, lowered])`). */
    function scheduledSafeInt(n) {
      return typeof n === "number" && Number.isSafeInteger(n);
    }
    function scheduledOwnerKey(owner) {
      if (!owner || typeof owner !== "object") return "legacy";
      var url = owner.serverUrl, identity = owner.identity;
      if (typeof url !== "string" || url.length === 0 || url.length > 2048 || url !== url.trim()) return "legacy";
      if (typeof identity !== "string" || identity.length === 0 || identity.length > 256 || identity !== identity.trim()) return "legacy";
      try {
        return JSON.stringify([url, identity.toLowerCase()]);
      } catch (err) {
        return "legacy";
      }
    }
    function scheduledCleanOwner(raw) {
      if (!raw || typeof raw !== "object") return null;
      var url = raw.serverUrl, identity = raw.identity;
      if (typeof url !== "string" || url.length === 0 || url.length > 2048 || url !== url.trim()) return null;
      if (typeof identity !== "string" || identity.length === 0 || identity.length > 256 || identity !== identity.trim()) return null;
      return { serverUrl: url, identity: identity.toLowerCase() };
    }
    function scheduledCleanClaim(raw) {
      if (!raw || typeof raw !== "object") return undefined;
      if (typeof raw.token !== "string" || raw.token.length === 0 || raw.token.length > 128) return undefined;
      if (!scheduledSafeInt(raw.claimedAt) || raw.claimedAt <= 0) return undefined;
      return { token: raw.token, claimedAt: raw.claimedAt };
    }
    /* Presence is significant like the oracle parse: a present-but-bad
       generation/clearEpoch drops the row, while a present-but-bad
       owner/claim only clears that slot. */
    function scheduledCleanRow(raw) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      var id = raw.id, channel = raw.channel, text = raw.text, sendAt = raw.sendAt;
      if (typeof id !== "string" || id.length === 0 || id.length > 128) return null;
      if (typeof channel !== "string" || channel.length === 0 || channel.length > 256) return null;
      if (typeof text !== "string" || text.trim().length === 0 || text.length > 65536) return null;
      if (!scheduledSafeInt(sendAt) || sendAt <= 0) return null;
      if (raw.generation !== undefined && (!scheduledSafeInt(raw.generation) || raw.generation < 0)) return null;
      if (raw.clearEpoch !== undefined && (!scheduledSafeInt(raw.clearEpoch) || raw.clearEpoch < 0)) return null;
      var row = { id: id, channel: channel, text: text, sendAt: sendAt, owner: scheduledCleanOwner(raw.owner) };
      var claim = scheduledCleanClaim(raw.claim);
      if (claim !== undefined) row.claim = claim;
      if (raw.generation !== undefined) row.generation = raw.generation;
      if (raw.clearEpoch !== undefined) row.clearEpoch = raw.clearEpoch;
      return row;
    }
    function scheduledVisibleRow(stored) {
      if (!stored || typeof stored !== "object" || stored.status) return null;
      if (typeof stored.channel !== "string" || typeof stored.text !== "string" || typeof stored.sendAt !== "number") return null;
      var key = String(stored.id || "");
      var sep = key.indexOf("\u0000");
      if (sep < 0) return null;
      var row = {
        id: key.slice(sep + 1),
        channel: stored.channel,
        text: stored.text,
        sendAt: stored.sendAt,
        owner: stored.owner && typeof stored.owner === "object" ? stored.owner : null
      };
      if (stored.claim && typeof stored.claim === "object") row.claim = stored.claim;
      if (stored.generation !== undefined) row.generation = stored.generation;
      if (stored.clearEpoch !== undefined) row.clearEpoch = stored.clearEpoch;
      return row;
    }
    function scheduledRowActive(row, epoch) {
      return !row.status && (row.clearEpoch === epoch || (row.clearEpoch === undefined && epoch === 0));
    }
    function scheduledOwnerGenerationKey(owner) {
      return "owner-generation:" + scheduledOwnerKey(owner);
    }
    /* Read the erase + owner-generation fences (mirroring
       `captureScheduledFence`: a pristine vault reads the zero fence,
       not a failure; only a missing database or a failed read is
       null). */
    function scheduledFence(db, owner, done) {
      if (!db) { done(null); return; }
      var tx;
      try {
        tx = db.transaction(VAULT_META, "readonly");
      } catch (err) { done(null); return; }
      var epoch = 0, generation = 0, failed = false;
      try {
        var meta = tx.objectStore(VAULT_META);
        var epochReq = meta.get(SCHEDULED_CLEAR_EPOCH_KEY);
        epochReq.onsuccess = function () { epoch = Number(epochReq.result && epochReq.result.value) || 0; };
        epochReq.onerror = function () { failed = true; };
        var genReq = meta.get(scheduledOwnerGenerationKey(owner));
        genReq.onsuccess = function () { generation = Number(genReq.result && genReq.result.value) || 0; };
        genReq.onerror = function () { failed = true; };
      } catch (err) { done(null); return; }
      tx.oncomplete = function () { done(failed ? null : { clearEpoch: epoch, generation: generation }); };
      tx.onerror = function () { done(null); };
      tx.onabort = function () { done(null); };
    }
    /* Add one row without replacing a newer durable record (mirroring
       `addScheduledRow`: expected-fence CAS, existing-row no-op,
       capacity fence, cross-tab add races resolve as success). */
    function scheduledAdd(db, row, expectedEpoch, expectedGeneration, done) {
      var clean = scheduledCleanRow(row);
      if (!db || !clean) { done(false); return; }
      var tx;
      try {
        tx = db.transaction([SCHEDULED, VAULT_META], "readwrite");
      } catch (err) { done(false); return; }
      var meta = tx.objectStore(VAULT_META);
      var epochReq = meta.get(SCHEDULED_CLEAR_EPOCH_KEY);
      epochReq.onerror = function () { tx.abort(); };
      epochReq.onsuccess = function () {
        var epoch = Number(epochReq.result && epochReq.result.value) || 0;
        var genReq = meta.get(clean.owner ? scheduledOwnerGenerationKey(clean.owner) : "unused");
        genReq.onerror = function () { tx.abort(); };
        genReq.onsuccess = function () {
          var generation = clean.owner ? (Number(genReq.result && genReq.result.value) || 0) : 0;
          if (expectedEpoch !== undefined && expectedEpoch !== epoch) { tx.abort(); return; }
          if (expectedEpoch === undefined && epoch !== 0) { tx.abort(); return; }
          if (clean.owner && expectedGeneration !== undefined && expectedGeneration !== generation) { tx.abort(); return; }
          var os = tx.objectStore(SCHEDULED);
          var key = scheduledRowKey(clean);
          var existing = os.get(key);
          existing.onerror = function () { tx.abort(); };
          existing.onsuccess = function () {
            if (existing.result !== undefined) return;
            var all = os.getAll();
            all.onerror = function () { tx.abort(); };
            all.onsuccess = function () {
              var active = 0;
              (all.result || []).forEach(function (candidate) {
                if (scheduledRowActive(candidate, epoch)) active += 1;
              });
              if (active >= SCHEDULED_MAX_ROWS) { tx.abort(); return; }
              var stored = {
                id: key,
                owner: clean.owner,
                channel: clean.channel,
                text: clean.text,
                sendAt: clean.sendAt,
                clearEpoch: epoch,
                generation: generation
              };
              if (clean.claim !== undefined) stored.claim = clean.claim;
              var add = os.add(stored);
              add.onerror = function (event) {
                if (add.error && add.error.name === "ConstraintError") {
                  event.preventDefault();
                  event.stopPropagation();
                } else {
                  tx.abort();
                }
              };
            };
          };
        };
      };
      tx.oncomplete = function () { done(true); };
      tx.onerror = function () { done(false); };
      tx.onabort = function () { done(false); };
      function scheduledRowKey(r) {
        return scheduledOwnerKey(r.owner) + "\u0000" + r.id;
      }
    }
    /* Reconcile the projection into the durable queue and claim due
       rows in one transaction (mirroring `reconcileScheduledRows` plus
       the dispatcher's claim loop: missing rows migrate in, existing
       claims/statuses are never overwritten, canceled rows stay out,
       and each claim CAS-excludes claimed/canceled/foreign rows).
       Responds `{ queue, granted }` or null when no durable queue
       could be established. */
    function scheduledReconcile(db, rows, owner, tokens, done) {
      if (!db) { done(null); return; }
      var tx;
      try {
        tx = db.transaction([SCHEDULED, VAULT_META], "readwrite");
      } catch (err) { done(null); return; }
      var os = tx.objectStore(SCHEDULED);
      var meta = tx.objectStore(VAULT_META);
      var epoch = 0;
      var projection = [];
      var granted = [];
      var clean = [];
      (rows || []).forEach(function (raw) {
        var row = scheduledCleanRow(raw);
        if (row) clean.push(row);
      });
      var pendingTokens = [];
      (tokens || []).forEach(function (tok) {
        if (tok && typeof tok.id === "string" && typeof tok.token === "string" && scheduledSafeInt(tok.claimedAt)) {
          pendingTokens.push(tok);
        }
      });
      var ownerKey = scheduledOwnerKey(owner);
      tx.onerror = function () { done(null); };
      tx.onabort = function () { done(null); };
      tx.oncomplete = function () {
        var queue = [];
        projection.forEach(function (stored) {
          if (!scheduledRowActive(stored, epoch)) return;
          var visible = scheduledVisibleRow(stored);
          if (visible) queue.push(visible);
        });
        done({ queue: queue, granted: granted });
      };
      var epochReq = meta.get(SCHEDULED_CLEAR_EPOCH_KEY);
      epochReq.onerror = function () { tx.abort(); };
      epochReq.onsuccess = function () {
        epoch = Number(epochReq.result && epochReq.result.value) || 0;
        migrateNext(0);
      };
      function migrateNext(index) {
        var row = clean[index];
        if (!row) { claimNext(0); return; }
        var get = os.get(scheduledOwnerKey(row.owner) + "\u0000" + row.id);
        get.onerror = function () { tx.abort(); };
        get.onsuccess = function () {
          if (get.result !== undefined) { migrateNext(index + 1); return; }
          if ((row.clearEpoch !== undefined && row.clearEpoch !== epoch)
            || (row.clearEpoch === undefined && epoch !== 0)) { migrateNext(index + 1); return; }
          var genReq = row.owner ? meta.get(scheduledOwnerGenerationKey(row.owner)) : null;
          var addAt = function (generation) {
            if (row.owner && row.generation !== undefined && row.generation !== generation) { migrateNext(index + 1); return; }
            var all = os.getAll();
            all.onerror = function () { tx.abort(); };
            all.onsuccess = function () {
              var active = 0;
              (all.result || []).forEach(function (candidate) {
                if (scheduledRowActive(candidate, epoch)) active += 1;
              });
              if (active >= SCHEDULED_MAX_ROWS) { migrateNext(index + 1); return; }
              var stored = {
                id: scheduledOwnerKey(row.owner) + "\u0000" + row.id,
                owner: row.owner,
                channel: row.channel,
                text: row.text,
                sendAt: row.sendAt,
                clearEpoch: epoch,
                generation: generation
              };
              if (row.claim !== undefined) stored.claim = row.claim;
              var add = os.add(stored);
              add.onerror = function (event) {
                if (add.error && add.error.name === "ConstraintError") {
                  event.preventDefault();
                  event.stopPropagation();
                  migrateNext(index + 1);
                } else {
                  tx.abort();
                }
              };
              add.onsuccess = function () { migrateNext(index + 1); };
            };
          };
          if (!genReq) { addAt(0); return; }
          genReq.onerror = function () { tx.abort(); };
          genReq.onsuccess = function () { addAt(Number(genReq.result && genReq.result.value) || 0); };
        };
      }
      function claimNext(index) {
        var tok = pendingTokens[index];
        if (!tok) {
          var all = os.getAll();
          all.onerror = function () { tx.abort(); };
          all.onsuccess = function () { projection = all.result || []; };
          return;
        }
        var get = os.get(ownerKey + "\u0000" + tok.id);
        get.onerror = function () { tx.abort(); };
        get.onsuccess = function () {
          var stored = get.result;
          if (stored && !stored.status && !stored.claim && stored.owner
            && typeof stored.channel === "string" && typeof stored.text === "string" && typeof stored.sendAt === "number"
            && scheduledOwnerKey(stored.owner) === ownerKey) {
            var claimed = {
              id: stored.id,
              owner: stored.owner,
              channel: stored.channel,
              text: stored.text,
              sendAt: stored.sendAt,
              claim: { token: tok.token, claimedAt: tok.claimedAt }
            };
            if (stored.generation !== undefined) claimed.generation = stored.generation;
            if (stored.clearEpoch !== undefined) claimed.clearEpoch = stored.clearEpoch;
            var put = os.put(claimed);
            put.onerror = function () { tx.abort(); };
            put.onsuccess = function () {
              granted.push(tok.id);
              claimNext(index + 1);
            };
          } else {
            claimNext(index + 1);
          }
        };
      }
    }
    /* Close one durable claim (mirroring `settleScheduledClaim`:
       admitted rows become plaintext-free tombstones so a stale tab
       snapshot can never migrate and replay them; rejected rows keep
       their content with the claim released). */
    function scheduledSettle(db, id, owner, token, admitted, done) {
      if (!db) { if (done) done(false); return; }
      var tx;
      try {
        tx = db.transaction(SCHEDULED, "readwrite");
      } catch (err) { if (done) done(false); return; }
      var os = tx.objectStore(SCHEDULED);
      var get = os.get(scheduledOwnerKey(owner) + "\u0000" + id);
      get.onerror = function () { tx.abort(); };
      get.onsuccess = function () {
        var stored = get.result;
        if (!stored || !stored.claim || stored.claim.token !== token || stored.status) { tx.abort(); return; }
        if (admitted) {
          var tomb = { id: stored.id, owner: stored.owner, status: "admitted", statusAt: Date.now() };
          if (stored.generation !== undefined) tomb.generation = stored.generation;
          if (stored.clearEpoch !== undefined) tomb.clearEpoch = stored.clearEpoch;
          os.put(tomb);
        } else {
          delete stored.claim;
          os.put(stored);
        }
      };
      tx.oncomplete = function () { if (done) done(true); };
      tx.onerror = function () { if (done) done(false); };
      tx.onabort = function () { if (done) done(false); };
    }
    /* Tombstone one row even when it has not migrated yet (mirroring
       `cancelScheduledRow`: tombstones carry no channel/text so a
       racing migration can never resurrect plaintext). */
    function scheduledCancel(db, id, owner, done) {
      if (!db) { done(false); return; }
      var tx;
      try {
        tx = db.transaction(SCHEDULED, "readwrite");
      } catch (err) { done(false); return; }
      try {
        tx.objectStore(SCHEDULED).put({
          id: scheduledOwnerKey(owner) + "\u0000" + id,
          owner: owner && typeof owner === "object" ? owner : null,
          status: "canceled",
          statusAt: Date.now()
        });
      } catch (err) { done(false); return; }
      tx.oncomplete = function () { done(true); };
      tx.onerror = function () { done(false); };
      tx.onabort = function () { done(false); };
    }
    /* Tombstone one owner's rows and turn its generation (mirroring
       `cancelScheduledRowsForOwner`: another tab's rows this tab never
       hydrated are still retired). */
    function scheduledCancelForOwner(db, owner, done) {
      if (!db) { if (done) done(false); return; }
      var tx;
      try {
        tx = db.transaction([SCHEDULED, VAULT_META], "readwrite");
      } catch (err) { if (done) done(false); return; }
      var os = tx.objectStore(SCHEDULED);
      var prefix = scheduledOwnerKey(owner) + "\u0000";
      try {
        var meta = tx.objectStore(VAULT_META);
        var genKey = scheduledOwnerGenerationKey(owner);
        var genReq = meta.get(genKey);
        genReq.onsuccess = function () {
          meta.put({ id: genKey, value: (Number(genReq.result && genReq.result.value) || 0) + 1 });
        };
        var range = globalThis.IDBKeyRange
          ? globalThis.IDBKeyRange.bound(prefix, prefix + "\uffff")
          : null;
        var cursorReq = range ? os.openCursor(range) : os.openCursor();
        cursorReq.onsuccess = function () {
          var cursor = cursorReq.result;
          if (!cursor) return;
          var row = cursor.value;
          if (row && typeof row.id === "string" && row.id.indexOf(prefix) === 0 && row.status !== "canceled") {
            cursor.update({ id: row.id, owner: row.owner, status: "canceled", statusAt: Date.now() });
          } else if (row && typeof row.id === "string" && row.id.indexOf(prefix) !== 0 && range === null) {
            /* No key-range support: skip foreign rows by key. */
          }
          cursor.continue();
        };
      } catch (err) { if (done) done(false); return; }
      tx.oncomplete = function () { if (done) done(true); };
      tx.onerror = function () { if (done) done(false); };
      tx.onabort = function () { if (done) done(false); };
    }
    /* Scheduled-queue durable legs: fence + add for queueing, one
       reconcile-and-claim round per dispatch, settle/cancel closes.
       Elm revalidates owners at every async step; the bridge only
       enforces the CAS fences. */
    if (app.ports.scheduledFenceRequest) {
      app.ports.scheduledFenceRequest.subscribe(function (req) {
        var tag = req && typeof req.tag === "string" ? req.tag : "";
        scheduledFence(vault, req && req.owner, function (fence) {
          try {
            app.ports.scheduledFenceResult.send(fence
              ? { tag: tag, ok: true, epoch: fence.clearEpoch, generation: fence.generation }
              : { tag: tag, ok: false, epoch: 0, generation: 0 });
          } catch (err) { /* port gone */ }
        });
      });
    }
    if (app.ports.scheduledAddRequest) {
      app.ports.scheduledAddRequest.subscribe(function (req) {
        var id = req && req.row && typeof req.row.id === "string" ? req.row.id : "";
        scheduledAdd(
          vault,
          req && req.row,
          req && req.expectedEpoch != null ? req.expectedEpoch : undefined,
          req && req.expectedGeneration != null ? req.expectedGeneration : undefined,
          function (ok) {
            try {
              app.ports.scheduledAddResult.send({ id: id, ok: !!ok });
            } catch (err) { /* port gone */ }
          }
        );
      });
    }
    if (app.ports.scheduledDispatchRequest) {
      app.ports.scheduledDispatchRequest.subscribe(function (req) {
        scheduledReconcile(
          vault,
          req && req.rows,
          req && req.owner,
          req && req.candidates,
          function (result) {
            try {
              app.ports.scheduledDispatchResult.send(result
                ? { queue: result.queue, granted: result.granted }
                : { queue: null, granted: [] });
            } catch (err) { /* port gone */ }
          }
        );
      });
    }
    if (app.ports.scheduledSettle) {
      app.ports.scheduledSettle.subscribe(function (req) {
        if (!req || typeof req.id !== "string") return;
        scheduledSettle(vault, req.id, req.owner, req.token, !!req.admitted);
      });
    }
    if (app.ports.scheduledCancelRequest) {
      app.ports.scheduledCancelRequest.subscribe(function (req) {
        var id = req && typeof req.id === "string" ? req.id : "";
        scheduledCancel(vault, id, req && req.owner, function (ok) {
          try {
            app.ports.scheduledCancelResult.send({ id: id, owner: (req && req.owner) || null, ok: !!ok });
          } catch (err) { /* port gone */ }
        });
      });
    }
    if (app.ports.scheduledOwnerCancel) {
      app.ports.scheduledOwnerCancel.subscribe(function (req) {
        if (!req) return;
        scheduledCancelForOwner(vault, req.owner);
      });
    }
    /* Send-later clock + datetime-local parse (mirroring
       `scheduleTime.ts`): Elm owns the schedulability window and the
       preset table, but only this side can do local-zone wall-clock
       math. The clock answer carries the `tomorrow-9` epoch plus the
       datetime-local floor; the parse answer echoes the submitted
       value with the epoch (or null) so Elm can drop stale answers.
       The parse never applies the schedule window — Elm owns
       `isSchedulable` and maps out-of-window instants to the custom
       error copy exactly like the oracle's null-folding parser. */
    function nextScheduleHour(now, hour) {
      var d = new Date(now);
      d.setHours(hour, 0, 0, 0);
      if (d.getTime() <= now) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    function toScheduleLocalValue(epoch) {
      var d = new Date(epoch);
      function pad(n) { return n < 10 ? "0" + n : "" + n; }
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
        "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }
    if (app.ports.scheduleClockRequest) {
      app.ports.scheduleClockRequest.subscribe(function () {
        var now = Date.now();
        try {
          app.ports.scheduleClockResult.send({
            tomorrow9: nextScheduleHour(now, 9),
            minLocal: toScheduleLocalValue(now)
          });
        } catch (err) { /* port gone */ }
      });
    }
    if (app.ports.scheduleParseRequest) {
      app.ports.scheduleParseRequest.subscribe(function (req) {
        var value = req && typeof req.value === "string" ? req.value : "";
        var trimmed = value.trim();
        var epoch = null;
        if (trimmed) {
          var ms = new Date(trimmed).getTime();
          if (Number.isFinite(ms)) epoch = ms;
        }
        try {
          app.ports.scheduleParseResult.send({ value: value, epoch: epoch });
        } catch (err) { /* port gone */ }
      });
    }
    /* Default device-memory search mode (`onyx:vault-search-mode`):
       Elm validates against the three known modes before sending. */
    if (app.ports.vaultSearchModeSave) {
      app.ports.vaultSearchModeSave.subscribe(function (req) {
        if (req && (req.mode === "exact" || req.mode === "semantic" || req.mode === "hybrid")) {
          writeSlot("onyx:vault-search-mode", req.mode);
        }
      });
    }
    /* Identity profile memory (`onyx:identity-profile:owner:<key>`,
       mirroring `identityProfileMemory.ts`): Elm owns
       validation/normalization, so the bridge only merges the two
       status keys into the stored JSON — sibling fields owned by the
       Solid client are never touched — purges legacy ownerless keys
       on access, enforces the 16 KiB read cap, and parses the ISO
       expiry with `Date.parse` (fail-closed to null). Only the latest
       requested owner resolves, so a stale load after an account or
       nick switch can never overwrite the new owner's state. */
    var IDENTITY_PROFILE_BASE_KEY = "onyx:identity-profile";
    var IDENTITY_PROFILE_MAX_CHARS = 16 * 1024;
    var LEGACY_IDENTITY_PROFILE_KEYS = [
      "onyx:custom-status",
      "onyx:custom-status-expiry",
      "onyx:self-display-name",
      "onyx:selfBio",
      "onyx:selfPronouns",
      "onyx:selfBannerUrl",
      "ocean-custom-status",
      "ocean-custom-status-expiry",
      "ocean-self-display-name",
      "ocean-selfBio",
      "ocean-selfPronouns",
      "ocean-selfBannerUrl"
    ];
    var identityProfilePendingKey = null;
    function identityProfileOwnerKey(serverUrl, identity) {
      if (typeof serverUrl !== "string" || !serverUrl) return null;
      if (typeof identity !== "string" || !identity) return null;
      try {
        return IDENTITY_PROFILE_BASE_KEY + ":owner:" + encodeURIComponent(JSON.stringify([serverUrl, identity]));
      } catch (err) { return null; }
    }
    function purgeLegacyIdentityProfile() {
      try {
        if (typeof window === "undefined" || !window.localStorage) return;
        window.localStorage.removeItem(IDENTITY_PROFILE_BASE_KEY);
        for (var i = 0; i < LEGACY_IDENTITY_PROFILE_KEYS.length; i++) {
          window.localStorage.removeItem(LEGACY_IDENTITY_PROFILE_KEYS[i]);
        }
      } catch (err) { /* storage unavailable — non-fatal */ }
    }
    function readIdentityProfileSlot(key) {
      try {
        if (typeof window === "undefined" || !window.localStorage) return {};
        var raw = window.localStorage.getItem(key);
        if (typeof raw !== "string") return {};
        if (raw.length > IDENTITY_PROFILE_MAX_CHARS) return {};
        var parsed = JSON.parse(raw);
        return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
      } catch (err) { return {}; }
    }
    if (app.ports.identityProfileSave) {
      app.ports.identityProfileSave.subscribe(function (req) {
        var key = (req && identityProfileOwnerKey(req.serverUrl, req.identity)) || null;
        if (!key) return;
        var stored = readIdentityProfileSlot(key);
        if (typeof req.status === "string" && req.status) stored.customStatus = req.status;
        else delete stored.customStatus;
        if (typeof req.expiryIso === "string" && req.expiryIso) stored.customStatusExpiry = req.expiryIso;
        else delete stored.customStatusExpiry;
        try {
          if (typeof window === "undefined" || !window.localStorage) return;
          purgeLegacyIdentityProfile();
          if (Object.keys(stored).length === 0) window.localStorage.removeItem(key);
          else window.localStorage.setItem(key, JSON.stringify(stored));
        } catch (err) { /* storage unavailable / quota — non-fatal */ }
      });
    }
    if (app.ports.identityProfileRequest) {
      app.ports.identityProfileRequest.subscribe(function (req) {
        var key = (req && identityProfileOwnerKey(req.serverUrl, req.identity)) || null;
        if (!key || !app.ports.identityProfileLoaded) return;
        identityProfilePendingKey = key;
        purgeLegacyIdentityProfile();
        var stored = readIdentityProfileSlot(key);
        var status = (typeof stored.customStatus === "string") ? stored.customStatus : "";
        var expiryMs = null;
        if (typeof stored.customStatusExpiry === "string" && stored.customStatusExpiry) {
          var parsed = Date.parse(stored.customStatusExpiry);
          if (Number.isFinite(parsed)) expiryMs = parsed;
        }
        if (identityProfilePendingKey !== key) return;
        identityProfilePendingKey = null;
        try {
          app.ports.identityProfileLoaded.send({ status: status, expiryMs: expiryMs });
        } catch (err) { /* Elm tore down — non-fatal */ }
      });
    }
    /* Owner-scoped topic history (mirroring `topicHistory.ts`:
       `onyx:topic-history:owner:<owner>` slots, the bare legacy key
       purged instead of claimed, a 1 MiB read cap, and bounded
       re-parsing on every read and write). */
    var TOPIC_HISTORY_BASE_KEY = "onyx:topic-history";
    var TOPIC_HISTORY_MAX_CHARS = 1024 * 1024;
    var TOPIC_HISTORY_MAX_CHANNELS = 128;
    var TOPIC_HISTORY_MAX_TOPICS = 10;
    function topicHistoryOwnerKey(serverUrl, identity) {
      if (typeof serverUrl !== "string" || !serverUrl) return null;
      if (typeof identity !== "string" || !identity) return null;
      try {
        return TOPIC_HISTORY_BASE_KEY + ":owner:" + encodeURIComponent(JSON.stringify([serverUrl, identity]));
      } catch (err) { return null; }
    }
    function purgeLegacyTopicHistory() {
      try {
        if (typeof window === "undefined" || !window.localStorage) return;
        window.localStorage.removeItem(TOPIC_HISTORY_BASE_KEY);
      } catch (err) { /* storage unavailable — non-fatal */ }
    }
    function normalizeTopicHistoryChannel(value) {
      if (typeof value !== "string") return null;
      var channel = value.trim().toLowerCase();
      if (!channel || channel.length > 128) return null;
      var first = channel.charAt(0);
      if (first !== "#" && first !== "&") return null;
      if (/[\s,\x00-\x1f\x7f]/u.test(channel)) return null;
      return channel;
    }
    function normalizeTopicHistoryText(value) {
      if (typeof value !== "string") return null;
      var topic = value.trim();
      if (!topic) return null;
      if (/[\x00\r\n\x7f]/u.test(topic)) return null;
      return topic.slice(0, 2048);
    }
    function parseTopicHistorySlot(raw) {
      var history = {};
      var count = 0;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return history;
      var channels = Object.keys(raw);
      for (var i = 0; i < channels.length && i < 4096; i++) {
        var key = normalizeTopicHistoryChannel(channels[i]);
        if (!key) continue;
        var fresh = !Object.prototype.hasOwnProperty.call(history, key);
        if (fresh && count >= TOPIC_HISTORY_MAX_CHANNELS) break;
        var rows = raw[channels[i]];
        if (!Array.isArray(rows)) continue;
        var topics = [];
        for (var j = 0; j < rows.length; j++) {
          var entry = normalizeTopicHistoryText(rows[j]);
          if (!entry || topics.indexOf(entry) !== -1) continue;
          topics.push(entry);
          if (topics.length >= TOPIC_HISTORY_MAX_TOPICS) break;
        }
        if (topics.length === 0) continue;
        history[key] = topics;
        if (fresh) count++;
      }
      return history;
    }
    function readTopicHistorySlot(key) {
      try {
        if (typeof window === "undefined" || !window.localStorage) return {};
        var raw = window.localStorage.getItem(key);
        if (typeof raw !== "string") return {};
        if (raw.length > TOPIC_HISTORY_MAX_CHARS) return {};
        return parseTopicHistorySlot(JSON.parse(raw));
      } catch (err) { return {}; }
    }
    if (app.ports.topicHistorySave) {
      app.ports.topicHistorySave.subscribe(function (req) {
        var key = (req && topicHistoryOwnerKey(req.serverUrl, req.identity)) || null;
        if (!key) return;
        var history = parseTopicHistorySlot(req.history);
        try {
          if (typeof window === "undefined" || !window.localStorage) return;
          purgeLegacyTopicHistory();
          if (Object.keys(history).length === 0) window.localStorage.removeItem(key);
          else window.localStorage.setItem(key, JSON.stringify(history));
        } catch (err) { /* storage unavailable / quota — non-fatal */ }
      });
    }
    if (app.ports.topicHistoryRequest) {
      app.ports.topicHistoryRequest.subscribe(function (req) {
        var key = (req && topicHistoryOwnerKey(req.serverUrl, req.identity)) || null;
        if (!key || !app.ports.topicHistoryLoaded) return;
        purgeLegacyTopicHistory();
        var history = readTopicHistorySlot(key);
        try {
          app.ports.topicHistoryLoaded.send(history);
        } catch (err) { /* Elm tore down — non-fatal */ }
      });
    }
    /* Owner-scoped nick aliases (`onyx:nick-aliases:owner:<owner>`,
       mirroring `nickAliases.ts`): Elm owns validation/normalization,
       so the bridge only returns the stored JSON array verbatim —
       Elm drops non-strings and normalizes (cap, shape, dedupe,
       canonical exclusion) on load. The bare legacy key is purged on
       access instead of claimed, reads cap at 8 KiB, and only the
       latest requested owner resolves so a stale load after an
       account or nick switch can never overwrite the new owner's
       list. Writes stay with the Solid client (Elm has no alias
       management UI yet), so there is no save subscription here. */
    var NICK_ALIASES_BASE_KEY = "onyx:nick-aliases";
    var NICK_ALIASES_MAX_CHARS = 8 * 1024;
    var nickAliasesPendingKey = null;
    function nickAliasesOwnerKey(serverUrl, identity) {
      if (typeof serverUrl !== "string" || !serverUrl) return null;
      if (typeof identity !== "string" || !identity) return null;
      try {
        return NICK_ALIASES_BASE_KEY + ":owner:" + encodeURIComponent(JSON.stringify([serverUrl, identity]));
      } catch (err) { return null; }
    }
    function purgeLegacyNickAliases() {
      try {
        if (typeof window === "undefined" || !window.localStorage) return;
        window.localStorage.removeItem(NICK_ALIASES_BASE_KEY);
      } catch (err) { /* storage unavailable — non-fatal */ }
    }
    function readNickAliasesSlot(key) {
      try {
        if (typeof window === "undefined" || !window.localStorage) return [];
        var raw = window.localStorage.getItem(key);
        if (typeof raw !== "string") return [];
        if (raw.length > NICK_ALIASES_MAX_CHARS) return [];
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) { return []; }
    }
    if (app.ports.nickAliasesRequest) {
      app.ports.nickAliasesRequest.subscribe(function (req) {
        var key = (req && nickAliasesOwnerKey(req.serverUrl, req.identity)) || null;
        if (!key || !app.ports.nickAliasesLoaded) return;
        nickAliasesPendingKey = key;
        purgeLegacyNickAliases();
        var aliases = readNickAliasesSlot(key);
        if (nickAliasesPendingKey !== key) return;
        nickAliasesPendingKey = null;
        try {
          app.ports.nickAliasesLoaded.send(aliases);
        } catch (err) { /* Elm tore down — non-fatal */ }
      });
    }
    /* Owner-scoped contact presence (`onyx:friends:owner:<owner>` and
       `onyx:watch-list:owner:<owner>`, mirroring
       `contactPresenceMemory.ts`): Elm owns validation/normalization,
       so the bridge returns the stored JSON verbatim (capped at
       256 KiB like the oracle's storage guard) and writes the
       verbatim JSON Elm hands back — a null payload removes the key,
       mirroring the empty-list removal. Bare legacy keys purge on
       access; only the latest requested owner resolves. */
    var FRIENDS_BASE_KEY = "onyx:friends";
    var WATCH_LIST_BASE_KEY = "onyx:watch-list";
    var CONTACTS_MAX_CHARS = 256 * 1024;
    var contactsPendingKey = null;
    function contactsOwnerKey(baseKey, serverUrl, identity) {
      if (typeof serverUrl !== "string" || !serverUrl) return null;
      if (typeof identity !== "string" || !identity) return null;
      try {
        return baseKey + ":owner:" + encodeURIComponent(JSON.stringify([serverUrl, identity]));
      } catch (err) { return null; }
    }
    function purgeLegacyContacts() {
      try {
        if (typeof window === "undefined" || !window.localStorage) return;
        window.localStorage.removeItem(FRIENDS_BASE_KEY);
        window.localStorage.removeItem(WATCH_LIST_BASE_KEY);
      } catch (err) { /* storage unavailable — non-fatal */ }
    }
    function readContactsSlot(key) {
      try {
        if (typeof window === "undefined" || !window.localStorage) return [];
        var raw = window.localStorage.getItem(key);
        if (typeof raw !== "string") return [];
        if (raw.length > CONTACTS_MAX_CHARS) return [];
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) { return []; }
    }
    function writeContactsSlot(key, entries) {
      try {
        if (typeof window === "undefined" || !window.localStorage) return;
        if (entries === null || entries === undefined) {
          window.localStorage.removeItem(key);
        } else if (typeof entries === "string") {
          window.localStorage.setItem(key, entries);
        }
      } catch (err) { /* storage unavailable — non-fatal */ }
    }
    if (app.ports.friendsRequest) {
      app.ports.friendsRequest.subscribe(function (req) {
        var key = (req && contactsOwnerKey(FRIENDS_BASE_KEY, req.serverUrl, req.identity)) || null;
        if (!key || !app.ports.friendsLoaded) return;
        contactsPendingKey = key;
        purgeLegacyContacts();
        var friends = readContactsSlot(key);
        if (contactsPendingKey !== key) return;
        contactsPendingKey = null;
        try {
          app.ports.friendsLoaded.send(friends);
        } catch (err) { /* Elm tore down — non-fatal */ }
      });
    }
    if (app.ports.friendsSave) {
      app.ports.friendsSave.subscribe(function (req) {
        var key = (req && contactsOwnerKey(FRIENDS_BASE_KEY, req.serverUrl, req.identity)) || null;
        if (!key) return;
        purgeLegacyContacts();
        writeContactsSlot(key, req.entries);
      });
    }
    if (app.ports.watchListRequest) {
      app.ports.watchListRequest.subscribe(function (req) {
        var key = (req && contactsOwnerKey(WATCH_LIST_BASE_KEY, req.serverUrl, req.identity)) || null;
        if (!key || !app.ports.watchListLoaded) return;
        contactsPendingKey = key;
        purgeLegacyContacts();
        var entries = readContactsSlot(key);
        if (contactsPendingKey !== key) return;
        contactsPendingKey = null;
        try {
          app.ports.watchListLoaded.send(entries);
        } catch (err) { /* Elm tore down — non-fatal */ }
      });
    }
    if (app.ports.watchListSave) {
      app.ports.watchListSave.subscribe(function (req) {
        var key = (req && contactsOwnerKey(WATCH_LIST_BASE_KEY, req.serverUrl, req.identity)) || null;
        if (!key) return;
        purgeLegacyContacts();
        writeContactsSlot(key, req.entries);
      });
    }
    /* CTCP reply config (`onyx:ctcp-config:owner:<owner>`, mirroring
       `ctcpMemory.ts`): Elm owns validation/normalization, so the
       bridge returns the stored JSON verbatim (capped at 64 KiB like
       the oracle's storage guard); a missing/unparsable slot resolves
       to null so Elm falls back to the defaults field-by-field. The
       bare legacy key purges on access; only the latest requested
       owner resolves. */
    var CTCP_CONFIG_BASE_KEY = "onyx:ctcp-config";
    var CTCP_CONFIG_MAX_CHARS = 64 * 1024;
    var ctcpConfigPendingKey = null;
    function ctcpConfigOwnerKey(serverUrl, identity) {
      if (typeof serverUrl !== "string" || !serverUrl) return null;
      if (typeof identity !== "string" || !identity) return null;
      try {
        return CTCP_CONFIG_BASE_KEY + ":owner:" + encodeURIComponent(JSON.stringify([serverUrl, identity]));
      } catch (err) { return null; }
    }
    if (app.ports.ctcpConfigRequest) {
      app.ports.ctcpConfigRequest.subscribe(function (req) {
        var key = (req && ctcpConfigOwnerKey(req.serverUrl, req.identity)) || null;
        if (!key || !app.ports.ctcpConfigLoaded) return;
        ctcpConfigPendingKey = key;
        try {
          if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.removeItem(CTCP_CONFIG_BASE_KEY);
          }
        } catch (err) { /* storage unavailable — non-fatal */ }
        var raw = null;
        try {
          if (typeof window !== "undefined" && window.localStorage) {
            raw = window.localStorage.getItem(key);
          }
        } catch (err) { raw = null; }
        if (ctcpConfigPendingKey !== key) return;
        ctcpConfigPendingKey = null;
        var payload = null;
        try {
          if (typeof raw === "string" && raw.length > 0 && raw.length <= CTCP_CONFIG_MAX_CHARS) {
            payload = JSON.parse(raw);
          }
        } catch (err) { payload = null; }
        try {
          app.ports.ctcpConfigLoaded.send(payload);
        } catch (err) { /* Elm tore down — non-fatal */ }
      });
    }
    /* CTCP TIME query reply (mirroring the oracle's
       `new Date().toString()` body): the clock lives ports-side, so
       Elm hands over the validated target and the bridge sends the
       NOTICE directly. The target is re-validated here (fail-closed);
       a closed socket drops the send like any other line. */
    if (app.ports.ctcpTimeReply) {
      app.ports.ctcpTimeReply.subscribe(function (req) {
        var to = req && req.to;
        if (typeof to !== "string" || !to || /[\s\x00-\x1f\x7f,]/.test(to) || to.length > 256 || to.charAt(0) === ":") return;
        try {
          socket.send("NOTICE " + to + " :\x01TIME " + new Date().toString() + "\x01");
        } catch (err) { /* socket gone — non-fatal */ }
      });
    }
    /* Guest-claim chip dismissal (`onyx:guest-claim-dismissed:owner:<owner>`,
       mirroring `GuestClaimPrompt.tsx`'s per-owner flag with legacy bare-key
       purge): the bridge stores the verbatim `"1"` marker and returns a
       boolean — Elm owns the visibility decision. Only the latest
       requested owner resolves so a stale load after an account or nick
       switch can never dismiss the new owner's chip. */
    var GUEST_CLAIM_DISMISS_KEY = "onyx:guest-claim-dismissed";
    var guestClaimDismissPendingKey = null;
    function guestClaimDismissOwnerKey(serverUrl, identity) {
      if (typeof serverUrl !== "string" || !serverUrl) return null;
      if (typeof identity !== "string" || !identity) return null;
      try {
        return GUEST_CLAIM_DISMISS_KEY + ":owner:" + encodeURIComponent(JSON.stringify([serverUrl, identity]));
      } catch (err) { return null; }
    }
    function purgeLegacyGuestClaimDismiss() {
      try {
        if (typeof window === "undefined" || !window.localStorage) return;
        window.localStorage.removeItem(GUEST_CLAIM_DISMISS_KEY);
      } catch (err) { /* storage unavailable — non-fatal */ }
    }
    if (app.ports.guestClaimDismissSave) {
      app.ports.guestClaimDismissSave.subscribe(function (req) {
        var key = (req && guestClaimDismissOwnerKey(req.serverUrl, req.identity)) || null;
        if (!key) return;
        try {
          if (typeof window === "undefined" || !window.localStorage) return;
          window.localStorage.removeItem(GUEST_CLAIM_DISMISS_KEY);
          window.localStorage.setItem(key, "1");
        } catch (err) { /* storage unavailable — non-fatal */ }
      });
    }
    if (app.ports.guestClaimDismissRequest) {
      app.ports.guestClaimDismissRequest.subscribe(function (req) {
        var key = (req && guestClaimDismissOwnerKey(req.serverUrl, req.identity)) || null;
        if (!key || !app.ports.guestClaimDismissLoaded) return;
        guestClaimDismissPendingKey = key;
        purgeLegacyGuestClaimDismiss();
        var dismissed = false;
        try {
          if (typeof window !== "undefined" && window.localStorage) {
            dismissed = window.localStorage.getItem(key) === "1";
          }
        } catch (err) { dismissed = false; }
        if (guestClaimDismissPendingKey !== key) return;
        guestClaimDismissPendingKey = null;
        try {
          app.ports.guestClaimDismissLoaded.send(dismissed);
        } catch (err) { /* Elm tore down — non-fatal */ }
      });
    }
    /* DM search-scope proof scans (mirroring `searchServerHistory`'s
       `privacyUnknown` arm): Elm withholds the query and asks for a
       proof; the verdict returns through `vaultDmPrivacyClassified`
       and the user retries. The query itself is never held here. */
    if (app.ports.vaultClassifyDm) {
      app.ports.vaultClassifyDm.subscribe(function (req) {
        var target = (req && req.target) || "";
        if (!target) return;
        classifyVaultDm(vault, target, function (privacy) {
          try {
            if (app.ports.vaultDmPrivacyClassified) {
              app.ports.vaultDmPrivacyClassified.send({ target: target, privacy: privacy });
            }
          } catch (err) { /* port gone */ }
        });
      });
    }
    /* Desktop/sound alerts (mirroring browser.ts): the Notification
       renders silent with the app icon and focuses on click; the beep
       is the 880→660Hz sine envelope at the granted volume. Elm already
       decided desktop/sound, so the bridge only performs. */
    var notifyAudioCtx = null;
    function notifyPermissionNow() {
      if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
      try {
        return window.Notification.permission || "default";
      } catch (e) { return "default"; }
    }
    function playNotifyBeep(volume) {
      if (typeof window === "undefined") return;
      try {
        var Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        notifyAudioCtx = notifyAudioCtx || new Ctor();
        var ctx = notifyAudioCtx;
        var safeVolume = Math.max(0, Math.min(1, volume));
        var now = ctx.currentTime;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.12);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, safeVolume * 0.16), now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.18);
      } catch (e) { /* beep is best-effort */ }
    }
    if (app.ports.notifyAlert) {
      app.ports.notifyAlert.subscribe(function (req) {
        if (!req) return;
        if (req.sound) playNotifyBeep(typeof req.volume === "number" ? req.volume : 0.5);
        if (!req.desktop) return;
        if (notifyPermissionNow() !== "granted") return;
        try {
          var note = new window.Notification(req.title || "Onyx", {
            body: req.body || "",
            tag: req.tag || "onyx-alert",
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            silent: true,
          });
          note.onclick = function () {
            try { window.focus(); } catch (e) {}
            try { note.close(); } catch (e) {}
          };
        } catch (e) { /* alert is best-effort */ }
      });
    }
    if (app.ports.offlineMemoNotice) {
      app.ports.offlineMemoNotice.subscribe(function (req) {
        if (!req || typeof window === "undefined") return;
        try {
          window.dispatchEvent(new CustomEvent("onyx:offlineMemo", {
            detail: { channel: req.channel, count: req.count, firstMsgId: req.firstMsgId },
          }));
        } catch (e) { /* memo notice is best-effort */ }
      });
    }
    if (app.ports.notifyPermissionRequest) {
      app.ports.notifyPermissionRequest.subscribe(function () {
        try {
          if (typeof window === "undefined" || !("Notification" in window)) {
            if (app.ports.notifyPermissionChanged) app.ports.notifyPermissionChanged.send("unsupported");
            return;
          }
          var result = window.Notification.requestPermission();
          var report = function (p) {
            if (app.ports.notifyPermissionChanged) app.ports.notifyPermissionChanged.send(p || "default");
          };
          if (result && typeof result.then === "function") result.then(report, function () { report("default"); });
          else report(notifyPermissionNow());
        } catch (e) { /* request is best-effort */ }
      });
    }
    /* Push the live permission in at wire time so Elm never decides
       desktop on a stale default. */
    try {
      if (app.ports.notifyPermissionChanged) app.ports.notifyPermissionChanged.send(notifyPermissionNow());
    } catch (e) { /* best-effort */ }
    /* Visibility/focus feed for the alert decision (inactive-only
       alerts mirror the oracle's pageVisible/appFocused inputs). */
    function sendVisibility() {
      try {
        if (!app.ports.visibilityChanged) return;
        var visible = typeof document === "undefined" ? true : document.visibilityState !== "hidden";
        var focused = true;
        try {
          if (typeof document !== "undefined" && typeof document.hasFocus === "function") focused = document.hasFocus();
        } catch (e) { focused = true; }
        app.ports.visibilityChanged.send({ visible: visible, focused: focused });
      } catch (e) { /* best-effort */ }
    }
    if (app.ports.visibilityChanged && typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("visibilitychange", sendVisibility);
      try {
        window.addEventListener("focus", sendVisibility);
        window.addEventListener("blur", sendVisibility);
      } catch (e) { /* best-effort */ }
      sendVisibility();
    }
    /* Ctrl/Cmd+F message-search hotkey (mirroring AppShell
       handleMessageSearchHotkey guard-for-guard: `f` with ctrl or
       meta, no shift/alt, not composing, never behind a modal
       dialog — preventDefault runs synchronously so the browser
       find bar never opens, then Elm opens the search panel). */
    function isFindHotkey(e) {
      if (!e || e.defaultPrevented) return false;
      if (e.isComposing || e.keyCode === 229) return false;
      var key = typeof e.key === "string" ? e.key.toLowerCase() : "";
      if (key !== "f") return false;
      if (!(e.metaKey || e.ctrlKey)) return false;
      if (e.shiftKey || e.altKey) return false;
      try {
        if (typeof document !== "undefined" && document.querySelector
          && document.querySelector('[role="dialog"][aria-modal="true"]')) return false;
      } catch (err) { return false; }
      return true;
    }
    if (app.ports.searchHotkey && typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("keydown", function (e) {
        if (!isFindHotkey(e)) return;
        try { e.preventDefault(); } catch (err) { /* best-effort */ }
        try { app.ports.searchHotkey.send(null); } catch (err) { /* best-effort */ }
      });
    }
    /* Image lightbox dialog focus (mirroring `createDialogFocus` for
       `MessageImageLightbox`: while the lightbox dialog is mounted the
       background is isolated and scroll-locked, Tab cycles inside the
       dialog, opening moves focus into it, and closing returns focus
       to the opener. A document stamp keeps re-wiring idempotent. */
    (function installLightboxFocus() {
      if (typeof document === "undefined" || !document) return;
      try {
        if (document.__onyxLightboxFocus) return;
        document.__onyxLightboxFocus = true;
      } catch (err) { return; }
      var Mutation =
        (typeof MutationObserver !== "undefined" && MutationObserver)
        || (typeof window !== "undefined" && window && window.MutationObserver)
        || null;
      var dialogSelector = ".shell-msg-lightbox-dialog";
      var returnFocus = null;
      function panel() {
        try { return document.querySelector(dialogSelector); } catch (err) { return null; }
      }
      function focusables(root) {
        var nodes = [];
        try {
          nodes = root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        } catch (err) { return []; }
        return Array.prototype.filter.call(nodes, function (el) {
          try {
            return !el.disabled && el.getAttribute("aria-hidden") !== "true" && el.tabIndex >= 0;
          } catch (err) { return false; }
        });
      }
      function trapTab(e) {
        var root = panel();
        if (!root) return;
        if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
        if (e.key !== "Tab") return;
        var scope = root.parentNode || root;
        try {
          if (e.target !== root && !(scope.contains && scope.contains(e.target))) return;
        } catch (err) { return; }
        var items = focusables(root);
        if (items.length === 0) {
          try { e.preventDefault(); } catch (err) { /* best-effort */ }
          return;
        }
        var first = items[0];
        var last = items[items.length - 1];
        var active = null;
        try { active = document.activeElement; } catch (err) { active = null; }
        var onFirst = active === first || active === root;
        try {
          if (e.shiftKey && (onFirst || !(scope.contains && scope.contains(active)))) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
          }
        } catch (err) { /* best-effort */ }
      }
      try {
        document.addEventListener("keydown", trapTab);
      } catch (err) { /* no DOM events */ }
      if (!Mutation) return;
      var lockedOverflow = null;
      var isolated = [];
      function isolate() {
        // Hide the dialog's siblings from assistive tech while it is
        // mounted (mirroring the oracle background isolation); the
        // lightbox container itself stays exposed.
        release();
        var host = null;
        try {
          var root = panel();
          host = root && (root.parentNode || root);
        } catch (err) { host = null; }
        var body = null;
        try { body = document.body; } catch (err) { body = null; }
        if (!host || !body) return;
        try { lockedOverflow = body.style.overflow || ""; } catch (err) { lockedOverflow = ""; }
        try { body.style.overflow = "hidden"; } catch (err) { /* best-effort */ }
        Array.prototype.forEach.call(body.children, function (child) {
          if (child === host || child.contains(host)) return;
          try {
            if (child.getAttribute("aria-hidden") !== "true") {
              isolated.push(child);
              child.setAttribute("aria-hidden", "true");
            }
          } catch (err) { /* best-effort */ }
        });
      }
      function release() {
        var body = null;
        try { body = document.body; } catch (err) { body = null; }
        if (body && lockedOverflow !== null) {
          try { body.style.overflow = lockedOverflow; } catch (err) { /* best-effort */ }
          lockedOverflow = null;
        }
        while (isolated.length > 0) {
          var child = isolated.pop();
          try { child.removeAttribute("aria-hidden"); } catch (err) { /* best-effort */ }
        }
      }
      function settle() {
        var root = panel();
        if (root && !root.__onyxFocusReady) {
          try { root.__onyxFocusReady = true; } catch (err) { /* best-effort */ }
          try { returnFocus = document.activeElement || null; } catch (err) { returnFocus = null; }
          isolate();
          try { root.focus({ preventScroll: true }); } catch (err) {
            try { root.focus(); } catch (ignored) { /* best-effort */ }
          }
        } else if (!root && returnFocus) {
          var back = returnFocus;
          returnFocus = null;
          release();
          try {
            if (back.isConnected) back.focus({ preventScroll: true });
          } catch (err) {
            try { if (back.isConnected) back.focus(); } catch (ignored) { /* best-effort */ }
          }
        } else if (!root) {
          release();
        }
      }
      try {
        var observer = new Mutation(function () { settle(); });
        observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      } catch (err) { /* observation unavailable */ }
    })();
    /* Device vault retention policy (mirroring `readRetentionPolicy` /
       `writeRetentionPolicy` + `applyRetentionPolicy`: the stored JSON
       is the source of truth — `trimTarget` re-reads it on every
       write — and saving re-applies it across all targets at once.
       The receipt mirrors the oracle status branches: saved+pruned,
       saved-but-unavailable, or session-only. */
    function sendRetentionPolicy() {
      if (!app.ports.retentionPolicyLoaded) return;
      var policy = readRetentionPolicy();
      try { app.ports.retentionPolicyLoaded.send(policy); } catch (err) { /* port gone */ }
    }
    if (app.ports.retentionPolicyRequest) {
      app.ports.retentionPolicyRequest.subscribe(function () { sendRetentionPolicy(); });
      sendRetentionPolicy();
    }
    function pruneAllTargets(db, onDone) {
      var seen = [];
      var tx;
      try {
        tx = db.transaction(STORE, "readonly");
      } catch (err) { onDone(0); return; }
      var cursor;
      try {
        cursor = tx.objectStore(STORE).openCursor();
      } catch (err) { onDone(0); return; }
      cursor.onsuccess = function () {
        var c = cursor.result;
        if (c) {
          var plain = vaultPlainRow(c.value);
          seen.push({ key: c.primaryKey, target: plain.target, id: plain.id, at: plain.at });
          c.continue();
        } else {
          pruneCollectedTargets(db, seen, onDone);
        }
      };
      cursor.onerror = function () { onDone(0); };
    }
    function pruneCollectedTargets(db, seen, onDone) {
      var policy = readRetentionPolicy();
      var now = (typeof Date !== "undefined" && Date.now) ? Date.now() : NaN;
      var byTarget = {};
      seen.forEach(function (entry) {
        if (!entry.target) return;
        (byTarget[entry.target] = byTarget[entry.target] || []).push(entry);
      });
      var targets = Object.keys(byTarget);
      if (targets.length === 0) { onDone(0); return; }
      var tx;
      try {
        tx = db.transaction(STORE, "readwrite");
      } catch (err) { onDone(0); return; }
      var store = tx.objectStore(STORE);
      var deleted = 0;
      var finished = false;
      function finish(count) {
        if (finished) return;
        finished = true;
        onDone(count);
      }
      tx.oncomplete = function () { finish(deleted); };
      tx.onerror = function () { finish(deleted); };
      targets.forEach(function (target) {
        var channelPolicy = { keep: retentionEffectiveKeep(policy, target) };
        if (typeof policy.maxAgeDays === "number") channelPolicy.maxAgeDays = policy.maxAgeDays;
        var prune = selectPruneIds(byTarget[target], channelPolicy, now);
        var keyById = {};
        byTarget[target].forEach(function (entry) { keyById[entry.id] = entry.key; });
        prune.forEach(function (id) {
          if (keyById[id] !== undefined) {
            try { store.delete(keyById[id]); deleted += 1; } catch (err) {}
          }
        });
      });
    }
    if (app.ports.retentionPolicySave) {
      app.ports.retentionPolicySave.subscribe(function (req) {
        var saved = false;
        try {
          var parsed = (req && typeof req.json === "string") ? JSON.parse(req.json) : null;
          var safe = sanitizeRetentionPolicy(parsed);
          var store = (typeof global.localStorage !== "undefined") ? global.localStorage : null;
          if (store) {
            store.setItem(RETENTION_POLICY_KEY, JSON.stringify(safe));
            saved = true;
          }
        } catch (err) { saved = false; }
        openVault(function (db) {
          function receipt(pruned) {
            if (!app.ports.retentionPolicyApplied) return;
            try { app.ports.retentionPolicyApplied.send({ saved: saved, pruned: pruned }); } catch (err) {}
          }
          if (db === null) {
            receipt(false);
            return;
          }
          try {
            pruneAllTargets(db, function (deleted) { receipt(deleted > 0); });
          } catch (err) { receipt(false); }
        });
      });
    }
    if (app.ports.appearanceStoreSceneMotion) {
      app.ports.appearanceStoreSceneMotion.subscribe(function (req) {
        if (req && typeof req.value === "string") writeSlot("onyx:scene-motion", req.value);
      });
    }
    if (app.ports.appearanceStoreTheme) {
      app.ports.appearanceStoreTheme.subscribe(function (req) {
        if (req && typeof req.id === "string") writeSlot("onyx:theme", req.id);
      });
    }
    if (app.ports.appearanceStoreBackground) {
      app.ports.appearanceStoreBackground.subscribe(function (req) {
        if (req && typeof req.id === "string") writeSlot("onyx:bg", req.id);
      });
    }
    var applyAppearanceSeenTokens = [];
    if (app.ports.appearanceApply) {
      app.ports.appearanceApply.subscribe(function (req) {
        try {
          if (!req || typeof document === "undefined") return;
          var root = document.documentElement;
          if (!root || !root.dataset) return;
          root.dataset.density = req.density;
          root.dataset.fontScale = req.fontScale;
          root.dataset.hideEvents = String(!!req.hideEvents);
          root.dataset.width = req.width;
          root.dataset.reader = String(!!req.reader);
          root.dataset.reduceMotion = String(!!req.reduceMotion);
          root.dataset.reduceTransparency = String(!!req.reduceTransparency);
          root.dataset.highContrast = String(!!req.highContrast);
          root.dataset.experienceMode = req.experienceMode;
          if (typeof req.dataTheme === "string" && req.dataTheme) {
            root.setAttribute("data-theme", req.dataTheme);
          }
          if (typeof req.scheme === "string" && req.scheme) {
            root.style.setProperty("color-scheme", req.scheme);
          }
          /* Full token-var commit (mirroring applyThemeToDom): the Elm
             fold always sends the complete resolved map, so vars absent
             from this commit but set by the previous one are removed —
             no stale session override survives a reset or base switch. */
          try {
            var seen = {};
            var pairs = (req && Array.isArray(req.tokens)) ? req.tokens : [];
            for (var i = 0; i < pairs.length; i++) {
              var pair = pairs[i];
              if (!Array.isArray(pair) || typeof pair[0] !== "string") continue;
              var prop = pair[0];
              if (prop.slice(0, 2) !== "--") continue;
              seen[prop] = true;
              if (typeof pair[1] === "string" && pair[1]) {
                root.style.setProperty(prop, pair[1]);
              } else {
                root.style.removeProperty(prop);
              }
            }
            var prev = applyAppearanceSeenTokens;
            for (var j = 0; j < prev.length; j++) {
              if (!Object.prototype.hasOwnProperty.call(seen, prev[j])) {
                root.style.removeProperty(prev[j]);
              }
            }
            applyAppearanceSeenTokens = Object.keys(seen);
          } catch (err) { /* token commit is best-effort; the browser ignores invalid values */ }
        } catch (err) { /* DOM application is best-effort */ }
      });
    }
    /* Theme Studio share link (mirroring handleShare): the Elm fold
       owns validation and the code; ports-side only prefixes the
       origin and works the clipboard, echoing through the shared
       clipboard result channel. */
    if (app.ports.studioShareCopy) {
      app.ports.studioShareCopy.subscribe(function (req) {
        var code = req && typeof req.code === "string" ? req.code : "";
        var origin = "";
        try {
          if (typeof window !== "undefined" && window.location && typeof window.location.origin === "string") {
            origin = window.location.origin;
          }
        } catch (err) { /* origin stays empty; the copy still carries the code */ }
        copyTextToClipboard(origin + "?theme=" + code).then(function (ok) {
          try { app.ports.clipboardResult.send({ tag: "ts:share", ok: !!ok }); } catch (err) { /* port gone */ }
        });
      });
    }
    /* Studio import prompts (mirroring handleImportSeed/handleImport):
       blocking prompt text matches the oracle; cancel/empty yields
       null so Elm stays silent. */
    if (app.ports.studioPromptRequest) {
      app.ports.studioPromptRequest.subscribe(function (req) {
        var kind = req && typeof req.kind === "string" ? req.kind : "";
        var message = kind === "seed"
          ? "Paste an Onyx theme-seed JSON to import:"
          : "Paste an Onyx theme JSON blob to import:";
        var text = null;
        try {
          if (typeof window !== "undefined" && typeof window.prompt === "function") {
            text = window.prompt(message, "");
          }
        } catch (err) { text = null; }
        try { app.ports.studioPromptResult.send({ kind: kind, text: text }); } catch (err) { /* port gone */ }
      });
    }
    /* Screen colour sampling (mirroring pickScreenColor): feature
       detection never constructs; open() runs on the click's message
       turn so the browser keeps the user gesture. */
    if (app.ports.studioEyeDropperRequest) {
      app.ports.studioEyeDropperRequest.subscribe(function () {
        var done = function (state, detail, hex) {
          /* sRGBHex arrives untrusted; a non-string must not break the
             port contract (a stuck busy button) — Elm re-validates. */
          var safeHex = (typeof hex === "string") ? hex : "";
          try { app.ports.studioEyeDropperResult.send({ state: state, detail: detail, hex: safeHex }); } catch (err) { /* port gone */ }
        };
        try {
          var Ctor = (typeof window !== "undefined" && typeof window.EyeDropper === "function") ? window.EyeDropper : null;
          if (!Ctor) {
            done("unsupported", "Screen colour sampling is unavailable. Use the accent colour control instead.");
            return;
          }
          var picker = new Ctor();
          Promise.resolve(picker.open()).then(function (result) {
            var hex = (result && typeof result === "object") ? result.sRGBHex : undefined;
            done("selected", "", hex);
          }, function (error) {
            if (error && typeof error === "object" && error.name === "AbortError") {
              done("cancelled", "Screen colour sampling cancelled. The accent seed was not changed.");
            } else {
              done("failed", "Screen colour sampling failed. Use the accent colour control instead.");
            }
          });
        } catch (err) {
          done("failed", "Screen colour sampling failed. Use the accent colour control instead.");
        }
      });
    }
    /* Boot share-link cleanup (mirroring stripShareParam): drop the
       one-time ?theme= param without navigating. */
    if (app.ports.studioStripShareParam) {
      app.ports.studioStripShareParam.subscribe(function () {
        try {
          if (typeof window === "undefined" || !window.location || typeof window.history !== "object" || typeof window.history.replaceState !== "function") return;
          var params = new URLSearchParams(window.location.search);
          if (!params.has("theme")) return;
          params.delete("theme");
          var query = params.toString();
          var next = window.location.pathname + (query ? "?" + query : "") + (window.location.hash || "");
          window.history.replaceState(window.history.state, "", next);
        } catch (err) { /* address-bar rewrite is a nicety, never fatal */ }
      });
    }
    if (app.ports.backgroundPreviewRequest) {
      var backgroundPreviewTimer = null;
      var clearBackgroundPreviewTimer = function () {
        if (backgroundPreviewTimer !== null) {
          try { clearTimeout(backgroundPreviewTimer); } catch (err) {}
          backgroundPreviewTimer = null;
        }
      };
      app.ports.backgroundPreviewRequest.subscribe(function (req) {
        clearBackgroundPreviewTimer();
        var id = req && typeof req.id === "string" ? req.id : "";
        if (!id) {
          try { app.ports.appearancePreviewed.send({ id: "" }); } catch (err) {}
          return;
        }
        backgroundPreviewTimer = setTimeout(function () {
          backgroundPreviewTimer = null;
          try { app.ports.appearancePreviewed.send({ id: id }); } catch (err) {}
        }, 160);
      });
    }

    /* Shareable stats query state, mirroring the route's
       history.replaceState mutations (room/compare/window): the URL
       updates without navigating, so no fetch loop follows. */
    if (app.ports.historyReplace) {
      app.ports.historyReplace.subscribe(function (url) {
        try {
          if (typeof url === "string" && url && typeof window !== "undefined" && window.history && typeof window.history.replaceState === "function") {
            window.history.replaceState(null, "", url);
          }
        } catch (err) { /* jsdom / sandboxed documents may reject URL mutation */ }
      });
    }

    /* User-activated reveal of the stats room inspector (mirroring
       revealStatsInspector): scroll + focus, never on initial load —
       Elm only sends this after an Inspect click. */
    if (app.ports.statsRevealInspector) {
      app.ports.statsRevealInspector.subscribe(function () {
        try {
          if (typeof document === "undefined") return;
          var target = document.getElementById("stats-room-inspector");
          if (!target) return;
          var reduce = false;
          try {
            reduce = typeof window !== "undefined" && typeof window.matchMedia === "function"
              && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          } catch (err) { /* motion query unavailable */ }
          if (typeof target.scrollIntoView === "function") {
            target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
          }
          if (typeof target.focus === "function") {
            target.focus({ preventScroll: true });
          }
        } catch (err) { /* inspector reveal is best-effort */ }
      });
    }

    if (app.ports.httpFetch) {
      app.ports.httpFetch.subscribe(function (req) {
        var key = req && typeof req.key === "string" ? req.key : "";
        var url = req && typeof req.url === "string" ? req.url : "";
        if (!key || !url) return;
        fetchPublicFeed(url).then(function (result) {
          try {
            app.ports.httpResult.send({ key: key, ok: !!result.ok, status: result.status | 0, body: result.body || "" });
          } catch (err) { /* port gone */ }
        });
      });
    }

    /* First-room plan progress, mirroring lib/guides/progress: the
       `onyx:guides-progress-v1` slot holds a JSON id array; reads
       send it raw (Elm allowlists element-wise) and writes store the
       Elm-filtered list. Unusable storage degrades to empty, never
       an exception — the guide stays usable. */
    var GUIDE_PROGRESS_KEY = "onyx:guides-progress-v1";
    function readGuideProgress() {
      try {
        if (typeof window === "undefined" || !window.localStorage) return [];
        var raw = window.localStorage.getItem(GUIDE_PROGRESS_KEY);
        var parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        return [];
      }
    }
    if (app.ports.guidesProgressRequest) {
      app.ports.guidesProgressRequest.subscribe(function () {
        try { app.ports.guidesProgressLoaded.send(readGuideProgress()); } catch (err) { /* port gone */ }
      });
    }
    if (app.ports.guidesProgressStore) {
      app.ports.guidesProgressStore.subscribe(function (ids) {
        try {
          if (typeof window !== "undefined" && window.localStorage) {
            var safe = Array.isArray(ids) ? ids.filter(function (id) { return typeof id === "string"; }) : [];
            window.localStorage.setItem(GUIDE_PROGRESS_KEY, JSON.stringify(safe));
          }
        } catch (err) { /* private browsing or quota policy; guide stays usable */ }
      });
    }

    if (app.ports.sessionTokenStore) {
      app.ports.sessionTokenStore.subscribe(function (req) {
        storeResumeToken(req.server, req.nick, req.kind, req.token, req.expiresAt);
      });
    }

    if (app.ports.sessionTokensClear) {
      app.ports.sessionTokensClear.subscribe(function (req) {
        clearResumeTokens(req.server, req.nick);
      });
    }

  var reclaimTimers = createReclaimTimers(app);
    if (app.ports.reclaimTimerStart) {
      app.ports.reclaimTimerStart.subscribe(function (req) {
        reclaimTimers.start(req && req.stage);
      });
    }
    if (app.ports.reclaimTimersClear) {
      app.ports.reclaimTimersClear.subscribe(function () {
        reclaimTimers.clear();
      });
    }

    /* SASL exchange: credentials in, crypto answers out. Elm chunks and
       sends every payload; a failure answer tears the Elm exchange down. */
    if (app.ports.saslStoreCredentials) {
      app.ports.saslStoreCredentials.subscribe(function (req) {
        sasl.setCredentials(req && req.account, req && req.password, req && req.hasClientCert);
      });
    }
    if (app.ports.saslRespond) {
      app.ports.saslRespond.subscribe(function (req) {
        var mech = req && req.mech;
        var nick = req && req.nick;
        var param = req && req.param;
        if (mech === "PLAIN") {
          var blob = sasl.plainPayload(nick);
          if (blob === null) {
            app.ports.saslFailed.send({ reason: "SASL authentication failed: no password held" });
          } else {
            app.ports.saslPayload.send({ payload: blob });
          }
          return;
        }
        if (mech === "SCRAM-SHA-256") {
          var done = function (out) {
            if (out.kind === "send") app.ports.saslPayload.send({ payload: out.payload });
            else if (out.kind === "fail") app.ports.saslFailed.send({ reason: out.reason });
            /* "verified" needs no reply: the trailing 903 completes login. */
          };
          if (param === "+") {
            done({ kind: "send", payload: sasl.scramFirst(nick).payload });
          } else {
            sasl.scramNext(param).then(done, function (err) {
              app.ports.saslFailed.send({ reason: "SASL authentication failed: SCRAM error: " + (err && err.message ? err.message : err) });
            });
          }
          return;
        }
        app.ports.saslFailed.send({ reason: "SASL authentication failed: unsupported mechanism" });
      });
    }
    var saslGuard = createSaslGuard(app);
    if (app.ports.saslTimerStart) {
      app.ports.saslTimerStart.subscribe(function () {
        saslGuard.start();
      });
    }
    if (app.ports.saslTimerClear) {
      app.ports.saslTimerClear.subscribe(function () {
        saslGuard.clear();
      });
    }

    /* Saved searches: Elm owns validation-at-entry and the visible list;
       this side owns the sibling IndexedDB, the import merge, and the
       metadata-only cross-tab invalidation. Every answer is fail-closed
       (null / [] / false / zero). */
    savedSearches.onchange = function (change) {
      try {
        if (app.ports.savedSearchesChanged) {
          app.ports.savedSearchesChanged.send(change);
        }
      } catch (err) { /* port gone */ }
    };
    if (app.ports.savedSearchesChanged) {
      ensureSearchSync(function (change) {
        try { app.ports.savedSearchesChanged.send(change); } catch (err) { /* port gone */ }
      });
    }
    if (app.ports.savedSearchesList) {
      app.ports.savedSearchesList.subscribe(function () {
        savedSearches.list().then(function (rows) {
          try { app.ports.savedSearchesRows.send({ rows: rows, status: "ok" }); }
          catch (err) {
            try { app.ports.savedSearchesRows.send({ rows: [], status: "unavailable" }); }
            catch (inner) { /* port gone */ }
          }
        }, function () {
          try { app.ports.savedSearchesRows.send({ rows: [], status: "unavailable" }); }
          catch (err) { /* port gone */ }
        });
      });
    }
    if (app.ports.savedSearchesSave) {
      app.ports.savedSearchesSave.subscribe(function (req) {
        savedSearches.save(req || {}).then(function (search) {
          try { app.ports.savedSearchesSaved.send({ search: search }); }
          catch (err) { /* port gone */ }
        });
      });
    }
    if (app.ports.savedSearchesDelete) {
      app.ports.savedSearchesDelete.subscribe(function (req) {
        savedSearches.remove(req && req.id).then(function (deleted) {
          try { app.ports.savedSearchesDeleted.send({ id: req && req.id, deleted: deleted }); }
          catch (err) { /* port gone */ }
        });
      });
    }
    if (app.ports.savedSearchesClear) {
      app.ports.savedSearchesClear.subscribe(function () {
        savedSearches.clear().then(function (cleared) {
          try { app.ports.savedSearchesCleared.send({ cleared: cleared }); }
          catch (err) { /* port gone */ }
        });
      });
    }
    if (app.ports.savedSearchesExport) {
      app.ports.savedSearchesExport.subscribe(function () {
        savedSearches.exportAll().then(function (snapshot) {
          var json = "";
          try { json = JSON.stringify(snapshot); } catch (err) { json = ""; }
          try { app.ports.savedSearchesExported.send({ json: json }); }
          catch (err) { /* port gone */ }
        });
      });
    }
    if (app.ports.savedSearchesImport) {
      app.ports.savedSearchesImport.subscribe(function (req) {
        var raw = null;
        try { raw = JSON.parse(req && req.json); } catch (err) { raw = null; }
        savedSearches.importRows(raw).then(function (result) {
          try { app.ports.savedSearchesImported.send({ imported: result.imported }); }
          catch (err) { /* port gone */ }
        });
      });
    }
    if (app.ports.savedSearchesPick) {
      app.ports.savedSearchesPick.subscribe(function () {
        try {
          var picker = document.createElement("input");
          picker.type = "file";
          picker.accept = "application/json,.json";
          picker.onchange = function () {
            var file = picker.files && picker.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
              try {
                app.ports.savedSearchesImportFile.send({ json: String(reader.result || "") });
              } catch (err) { /* port gone */ }
            };
            reader.onerror = function () { /* unreadable file imports nothing */ };
            reader.readAsText(file);
          };
          picker.click();
        } catch (err) { /* no DOM file picker here */ }
      });
    }
    if (app.ports.savedSearchesDownload) {
      app.ports.savedSearchesDownload.subscribe(function (req) {
        try {
          var blob = new Blob([String(req && req.json ? req.json : "")], { type: "application/json" });
          var anchor = document.createElement("a");
          anchor.href = URL.createObjectURL(blob);
          anchor.download = String(req && req.filename ? req.filename : "onyx-saved-searches.json");
          document.body.appendChild(anchor);
          anchor.click();
          setTimeout(function () {
            try {
              URL.revokeObjectURL(anchor.href);
              anchor.remove();
            } catch (err) { /* best effort cleanup */ }
          }, 1000);
        } catch (err) { /* no DOM download here */ }
      });
    }

    /* Account record / device history download — same blob-anchor
       shape as the saved-searches download, driven by Elm-built JSON
       (`encodeAccountStoreRecord` / `encodeDeviceHistoryCopy`). */
    /* Per-view transcript download — same blob-anchor shape, with the
       caller-chosen MIME allowlisted (mirroring
       `downloadConversationExport`: `text/plain` or `application/json`
       only — anything else falls back to plain text, never executes). */
    if (app.ports.transcriptDownload) {
      app.ports.transcriptDownload.subscribe(function (req) {
        try {
          var mime = req && req.mime === "application/json" ? "application/json" : "text/plain";
          var blob = new Blob([String(req && req.body ? req.body : "")], { type: mime });
          var anchor = document.createElement("a");
          anchor.href = URL.createObjectURL(blob);
          anchor.download = String(req && req.filename ? req.filename : "onyx-conversation.txt");
          anchor.rel = "noopener";
          document.body.appendChild(anchor);
          anchor.click();
          setTimeout(function () {
            try {
              URL.revokeObjectURL(anchor.href);
              anchor.remove();
            } catch (err) { /* best effort cleanup */ }
          }, 1000);
        } catch (err) { /* no DOM download here */ }
      });
    }
    if (app.ports.accountDownload) {
      app.ports.accountDownload.subscribe(function (req) {
        try {
          var blob = new Blob([String(req && req.json ? req.json : "")], { type: "application/json" });
          var anchor = document.createElement("a");
          anchor.href = URL.createObjectURL(blob);
          anchor.download = String(req && req.filename ? req.filename : "onyx-account-record.json");
          document.body.appendChild(anchor);
          anchor.click();
          setTimeout(function () {
            try {
              URL.revokeObjectURL(anchor.href);
              anchor.remove();
            } catch (err) { /* best effort cleanup */ }
          }, 1000);
        } catch (err) { /* no DOM download here */ }
      });
    }

    /* Explicit Save for chat media — mirrors `saveMediaFromUserGesture`:
       a transient <a download> click, never a gallery/background write.
       The filename is Elm-built (`mediaSaveName`); empty still defaults. */
    if (app.ports.mediaSave) {
      app.ports.mediaSave.subscribe(function (req) {
        try {
          var href = req && req.href ? String(req.href) : "";
          if (!href) return;
          var anchor = document.createElement("a");
          anchor.href = href;
          anchor.download = req && req.name ? String(req.name) : "image";
          anchor.rel = "noopener noreferrer";
          anchor.target = "_blank";
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        } catch (err) { /* no DOM download here */ }
      });
    }
    app.ports.wsSend.subscribe(function (line) {
      socket.send(line);
    });

    app.ports.wsClose.subscribe(function () {
      socket.close();
    });

    app.ports.vaultPut.subscribe(function (req) {
      vaultPut(vault, req.rows, function (stored) {
        app.ports.vaultStored.send({ target: req.target, stored: stored });
      });
    });

    app.ports.vaultGet.subscribe(function (req) {
      vaultGet(vault, req.target, req.limit, function (rows, status) {
        app.ports.vaultRows.send({ target: req.target, rows: rows, status: status });
      });
    });

    if (app.ports.vaultGetAround) {
      app.ports.vaultGetAround.subscribe(function (req) {
        vaultGetAround(vault, req.target, req.at, req.limit, function (rows, status) {
          app.ports.vaultRowsAround.send({ target: req.target, at: req.at, rows: rows, status: status });
        });
      });
    }

    if (app.ports.outboxQueue) {
      app.ports.outboxQueue.subscribe(function (req) {
        outboxQueue(vault, req, function (entry) {
          app.ports.outboxQueued.send(entry);
        }, function (target) {
          app.ports.outboxQueueFailed.send({ target: target });
        });
      });
    }

    if (app.ports.outboxFlush) {
      app.ports.outboxFlush.subscribe(function (req) {
        var labeled = !!(req && req.labeled);
        outboxFlush(vault, socket, function (report) {
          app.ports.outboxFlushed.send(report);
        }, labeled);
      });
    }

    /* Outbox auto-retry: the pure terminal fold schedules one retry per
       flush while the budget lasts (`OUTBOX_AUTO_RETRY_DELAY_MS`). The
       timer fires unconditionally — an offline flush reports back waiting
       and the fold defers without burning budget, mirroring the oracle's
       `setTimeout(() => get().flushOutbox(), delayMs)`. */
    /* Timed-ban unban: Elm owns validation, the entry map, and the
       fire retry budget; the host only wakes it per key (mirroring the
       oracle's `setTimeout(fire, …)` with keyed re-entry). */
    if (app.ports.tempBanTimerStart) {
      app.ports.tempBanTimerStart.subscribe(function (req) {
        var key = req && typeof req.key === "string" ? req.key : "";
        var wait = req ? Math.max(0, Math.floor(req.delayMs)) : 0;
        if (!key) return;
        setTimeout(function () {
          try { app.ports.tempBanTimerFired.send({ key: key }); } catch (err) { /* port gone */ }
        }, wait);
      });
    }
    /* WHOIS request timeout: Elm owns the generation guard and the
       sheet update; the host only wakes the current request
       (mirroring the oracle's single re-armed `setTimeout`, so a new
       request supersedes the pending fire). */
    var whoisTimeoutHandle = null;
    if (app.ports.whoisTimeoutStart) {
      app.ports.whoisTimeoutStart.subscribe(function (req) {
        var nick = req && typeof req.nick === "string" ? req.nick : "";
        var gen = req && Number.isFinite(req.gen) ? Math.floor(req.gen) : -1;
        var wait = req ? Math.max(0, Math.floor(req.delayMs)) : 0;
        if (!nick || gen < 0 || !app.ports.whoisTimeoutFired) return;
        if (whoisTimeoutHandle !== null) {
          try { clearTimeout(whoisTimeoutHandle); } catch (err) { /* already fired */ }
          whoisTimeoutHandle = null;
        }
        whoisTimeoutHandle = setTimeout(function () {
          whoisTimeoutHandle = null;
          try { app.ports.whoisTimeoutFired.send({ nick: nick, gen: gen }); } catch (err) { /* port gone */ }
        }, wait);
      });
    }
    if (app.ports.outboxRetryStart) {
      app.ports.outboxRetryStart.subscribe(function (delayMs) {
        var wait = Math.max(0, Math.floor(delayMs));
        setTimeout(function () {
          try { app.ports.outboxRetryFired.send(null); } catch (err) { /* port gone */ }
        }, wait);
      });
    }

    if (app.ports.vaultSearch) {
      app.ports.vaultSearch.subscribe(function (req) {
        var query = req && req.query ? String(req.query) : "";
        var limit = req && req.limit ? req.limit : 80;
        var seq = req && req.seq ? req.seq | 0 : 0;
        var mode = req && req.mode === "semantic" ? "semantic" : req && req.mode === "hybrid" ? "hybrid" : "exact";
        var scanOpts = {
          limit: limit,
          activeTarget: req ? req.activeTarget : null,
          selfNick: req ? req.selfNick : null,
          nowMs: req ? req.nowMs : undefined
        };
        vaultSearchMode(vault, query, mode, scanOpts, function (rows, status) {
          try { app.ports.vaultSearched.send({ rows: rows, status: status, seq: seq, mode: mode }); } catch (err) { /* port gone */ }
        });
      });
    }

    if (app.ports.vaultExportRequest) {
      app.ports.vaultExportRequest.subscribe(function () {
        vaultExportAll(vault, function (snapshot) {
          var targets = snapshot.targets.length;
          var messages = 0;
          snapshot.targets.forEach(function (entry) { messages += entry.messages.length; });
          try {
            var blob = new Blob([JSON.stringify(snapshot)], { type: "application/json" });
            var url = URL.createObjectURL(blob);
            var anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "onyx-vault-export.json";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
          } catch (err) {
            // Download unsupported here: counts are still reported.
          }
          app.ports.vaultExported.send({ targets: targets, messages: messages });
        });
      });
    }

    /* Device history copy rows — dump the vault snapshot and hand the
       rows back for Elm to scrub, tail-keep, and encode
       (`buildDeviceHistoryCopy`). Row kinds are unknown vault-side, so
       they ride along absent and Elm defaults them to `msg`. */
    if (app.ports.deviceHistoryCopyRequest) {
      app.ports.deviceHistoryCopyRequest.subscribe(function (req) {
        var seq = (req && typeof req.seq === "number") ? req.seq : 0;
        vaultExportAll(vault, function (snapshot) {
          try {
            var targets = (snapshot.targets || []).map(function (entry) {
              return {
                target: String(entry.target || ""),
                rows: (entry.messages || []).map(function (m) {
                  return {
                    id: String(m.id || ""),
                    at: (typeof m.at === "number" && isFinite(m.at) ? m.at : 0),
                    from: String(m.from || ""),
                    body: String(m.body || "")
                  };
                })
              };
            });
            app.ports.deviceHistoryCopyRows.send({
              seq: seq,
              exportedAt: String(snapshot.exportedAt || ""),
              json: JSON.stringify(targets)
            });
          } catch (err) {
            app.ports.deviceHistoryCopyRows.send({ seq: seq, exportedAt: "", json: "[]" });
          }
        });
      });
    }

    /* Vault import picker: read an export file back as text. Parsing
       and validation stay in Elm (`VaultImport.parseVaultExport`); the
       merge reuses the normal `vaultPut` path. */
    if (app.ports.vaultImportPick) {
      app.ports.vaultImportPick.subscribe(function () {
        try {
          var picker = document.createElement("input");
          picker.type = "file";
          picker.accept = "application/json,.json";
          picker.onchange = function () {
            var file = picker.files && picker.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
              try {
                app.ports.vaultImportFile.send({ json: String(reader.result || "") });
              } catch (err) { /* port gone */ }
            };
            reader.onerror = function () { /* unreadable file imports nothing */ };
            reader.readAsText(file);
          };
          picker.click();
        } catch (err) { /* no DOM file picker here */ }
      });
    }

    /* Upload picker + send wiring (bridge functions live at top
       level beside the node probe so smokes can drive them). */
    var pendingUploadFiles = {};

    if (app.ports.uploadPick) {
      app.ports.uploadPick.subscribe(function (req) {
        try {
          var picker = document.createElement("input");
          picker.type = "file";
          if (req && typeof req.accept === "string" && req.accept) picker.accept = req.accept;
          if (req && req.multiple === true) picker.multiple = true;
          picker.onchange = function () {
            var files = [];
            var held = [];
            var list = picker.files || [];
            for (var i = 0; i < list.length; i += 1) {
              var file = list[i];
              files.push({ name: file.name || "", size: file.size || 0, mime: file.type || "" });
              held.push(file);
            }
            pendingUploadFiles[req && req.key] = held;
            try {
              app.ports.uploadPicked.send({ key: (req && req.key) || "", files: files });
            } catch (err) { /* port gone */ }
          };
          picker.click();
        } catch (err) { /* no DOM file picker here */ }
      });
    }

    if (app.ports.uploadSend) {
      app.ports.uploadSend.subscribe(function (req) {
        var held = (req && pendingUploadFiles[req.key]) || [];
        var file = held[req ? req.index : 0];
        var key = (req && req.key) || "";
        var index = (req && typeof req.index === "number") ? req.index : 0;
        var sender;
        if (typeof XMLHttpRequest !== "undefined") {
          sender = uploadSendXhr(file, req ? req.endpoint : "", req ? req.fieldName : "file", function (progress) {
            try {
              if (app.ports.uploadProgress) {
                app.ports.uploadProgress.send({ key: key, index: index, loaded: progress.loaded, total: progress.total });
              }
            } catch (err) { /* port gone */ }
          });
        } else {
          sender = uploadSendFile(file, req ? req.endpoint : "", req ? req.fieldName : "file");
        }
        sender.then(function (outcome) {
          try {
            app.ports.uploadDone.send({
              key: (req && req.key) || "",
              index: (req && typeof req.index === "number") ? req.index : 0,
              ok: outcome.ok,
              status: outcome.status,
              body: outcome.body,
              contentType: outcome.contentType
            });
          } catch (err) { /* port gone */ }
        });
      });
    }

    if (app.ports.previewFetch) {
      app.ports.previewFetch.subscribe(function (req) {
        previewGet(req ? req.endpoint : "", req ? req.url : "").then(function (outcome) {
          try {
            app.ports.previewDone.send({
              key: (req && req.key) || "",
              ok: outcome.ok,
              status: outcome.status,
              body: outcome.body
            });
          } catch (err) { /* port gone */ }
        });
      });
    }

    if (app.ports.passkeySupport) {
      try { app.ports.passkeySupport.send({ supported: passkeySupported() === true }); } catch (err) { /* port gone */ }
    }

    app.ports.passkeyCreate.subscribe(function (req) {
      runCreate(app, req);
    });

    app.ports.passkeyGet.subscribe(function (req) {
      runGet(app, req);
    });

    app.ports.passkeySettleRequest.subscribe(function () {
      setTimeout(function () { app.ports.passkeySettle.send(null); }, 80);
    });

    if (app.ports.vhostRefreshRequest) {
      app.ports.vhostRefreshRequest.subscribe(function () {
        setTimeout(function () { app.ports.vhostRefresh.send(null); }, 300);
      });
    }

    var e2ee = createE2ee();
    wireE2ee(app, e2ee, function (line) {
      socket.send(line);
    });

    var rooms = createRoomCrypto();
    wireRoom(app, rooms);

    var groupControl = createGroupControlVerify();
    wireGroupControl(app, groupControl);

    var groupDirectory = createGroupDirectory();
    wireGroupDirectory(app, groupDirectory);

    var groupPublisher = createGroupPublisherIdentity({
      ecdhPublicB64: function () { return e2ee.devicePublicB64(); }
    });
    wireGroupPublisher(app, groupPublisher);

    var attribution = createAttributionIdentity({});
    wireAttribution(app, attribution);

    var webPush = createWebPush({
      sendLine: function (line) {
        if (socket.isOpen()) {
          socket.send(line);
          return true;
        }
        return false;
      },
      socketOpen: function () { return socket.isOpen(); }
    });
    wireWebPush(app, webPush);

    /* Binary media plane: prebuilt datagrams out, socket bytes in
       (Elm validates the Cadence header before the engine sees them).
       `socket` here is the connectSocket facade; the live check reads
       through it so reconnects need no rewiring. */
    var mediaBinary = createMediaBinary({
      socket: function () { return socket.rawSocket ? socket.rawSocket() : null; },
      engine: voiceEngine
    });
    wireMediaBinary(app, mediaBinary);

    var groupWelcome = createGroupWelcome({
      devicePrivateKey: function () {
        return e2ee.deviceKeys().then(function (keys) { return keys ? keys.privateKey : null; });
      },
      roomProvision: function (room, epoch, raw) { return rooms.provisionRoomKey(room, epoch, raw); }
    });
    wireGroupWelcome(app, groupWelcome);
  }

  var CEREMONY_TIMEOUT_MS = 120000;

  function bytesToB64url(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function passkeySupported() {
    var credentials = typeof navigator !== "undefined" ? navigator.credentials : undefined;
    return (
      typeof window !== "undefined" &&
      window.isSecureContext === true &&
      typeof window.PublicKeyCredential === "function" &&
      credentials &&
      typeof credentials.create === "function" &&
      typeof credentials.get === "function"
    );
  }

  function runCreate(app, req) {
    if (!passkeySupported()) {
      app.ports.passkeyError.send({ message: "Passkeys are not available in this browser." });
      return;
    }
    var challenge = new Uint8Array(req.challenge);
    var accountBytes = new TextEncoder().encode(req.account);
    var promise = navigator.credentials.create({
      publicKey: {
        challenge: challenge,
        rp: { id: req.rpId, name: req.rpId },
        user: { id: accountBytes, name: req.account, displayName: req.account },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -8 }
        ],
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
        timeout: CEREMONY_TIMEOUT_MS,
        attestation: "none"
      }
    });
    Promise.resolve(promise).then(function (cred) {
      if (!cred) {
        app.ports.passkeyError.send({ message: "Passkey creation was cancelled." });
        return;
      }
      var response = cred.response;
      app.ports.passkeyCreated.send({
        credId: bytesToB64url(new Uint8Array(cred.rawId)),
        clientDataJSON: bytesToB64url(new Uint8Array(response.clientDataJSON)),
        authData: bytesToB64url(new Uint8Array(response.getAuthenticatorData()))
      });
    }).catch(function (err) {
      app.ports.passkeyError.send({ message: String((err && err.message) || err) });
    });
  }

  function runGet(app, req) {
    if (!passkeySupported()) {
      app.ports.passkeyError.send({ message: "Passkeys are not available in this browser." });
      return;
    }
    var challenge = new Uint8Array(req.challenge);
    var allow = (req.allowCreds || []).map(function (bytes) {
      return { type: "public-key", id: new Uint8Array(bytes) };
    });
    var promise = navigator.credentials.get({
      publicKey: {
        challenge: challenge,
        rpId: req.rpId,
        allowCredentials: allow,
        userVerification: "preferred",
        timeout: CEREMONY_TIMEOUT_MS
      }
    });
    Promise.resolve(promise).then(function (cred) {
      if (!cred) {
        app.ports.passkeyError.send({ message: "Passkey sign-in was cancelled." });
        return;
      }
      var response = cred.response;
      app.ports.passkeyAssertion.send({
        credId: bytesToB64url(new Uint8Array(cred.rawId)),
        clientDataJSON: bytesToB64url(new Uint8Array(response.clientDataJSON)),
        authData: bytesToB64url(new Uint8Array(response.authenticatorData)),
        signature: bytesToB64url(new Uint8Array(response.signature))
      });
    }).catch(function (err) {
      app.ports.passkeyError.send({ message: String((err && err.message) || err) });
    });
  }

  /* ── Mooring DM crypto (WebCrypto ECDH + HKDF + AES-GCM) ────────────
     Ports-side half of the DmCipher slice: device keys in their own
     `onyx-keys` IndexedDB (never the history vault), TOFU pins in
     `onyx-key-pins`, trust-gated seal/open with open-then-pin on
     receive and pin-then-seal on send. Every failure resolves to
     nothing-sent / stays-locked — never plaintext. Pure envelope
     structure lives in Elm (`DmCipher`); only secret bytes live here.
     `createE2ee` takes injectable stores so node can smoke-test the
     full seal/open interop with in-memory stores. */

  var E2EE_KEYS_DB = "onyx-keys";
  var E2EE_KEYS_STORE = "device";
  var E2EE_KEY_ID = "dm-v1";
  var E2EE_PINS_DB = "onyx-key-pins";
  var E2EE_PINS_STORE = "pins";
  var E2EE_CURVE = "P-256";
  var E2EE_HKDF_SALT = "onyx-dm-v1";
  var E2EE_NONCE_BYTES = 12;
  var E2EE_MIN_BODY_BYTES = 28;
  var E2EE_MAX_SEALS = 16;
  var E2EE_SHARED_CACHE_CAP = 64;
  var E2EE_ENVELOPE_PREFIX = "ONYXDM1 ";
  var E2EE_MULTI_PREFIX = "ONYXDMN1 ";
  var E2EE_SAFETY_LABEL = "onyx-safety-v1";

  function e2eeOpenDb(name, store, onReady) {
    if (!("indexedDB" in global)) {
      onReady(null);
      return;
    }
    var req = global.indexedDB.open(name, 1);
    req.onupgradeneeded = function () {
      if (!req.result.objectStoreNames.contains(store)) {
        req.result.createObjectStore(store);
      }
    };
    req.onsuccess = function () { onReady(req.result); };
    req.onerror = function () { onReady(null); };
  }

  /* get resolves null when the key is absent and undefined when the
     store itself could not be read — callers MUST fail closed on
     undefined but may generate/pin-on-first-use on null. */
  function idbKV(dbName, storeName) {
    return {
      get: function (key) {
        return new Promise(function (resolve) {
          e2eeOpenDb(dbName, storeName, function (db) {
            if (!db) { resolve(undefined); return; }
            try {
              var tx = db.transaction(storeName, "readonly");
              var get = tx.objectStore(storeName).get(key);
              tx.oncomplete = function () {
                db.close();
                resolve(get.result === undefined ? null : get.result);
              };
              tx.onerror = tx.onabort = function () { db.close(); resolve(undefined); };
            } catch (err) { db.close(); resolve(undefined); }
          });
        });
      },
      set: function (key, value) {
        return new Promise(function (resolve) {
          e2eeOpenDb(dbName, storeName, function (db) {
            if (!db) { resolve(false); return; }
            try {
              var tx = db.transaction(storeName, "readwrite");
              tx.objectStore(storeName).put(value, key);
              tx.oncomplete = function () { db.close(); resolve(true); };
              tx.onerror = tx.onabort = function () { db.close(); resolve(false); };
            } catch (err) { db.close(); resolve(false); }
          });
        });
      },
      del: function (key) {
        return new Promise(function (resolve) {
          e2eeOpenDb(dbName, storeName, function (db) {
            if (!db) { resolve(false); return; }
            try {
              var tx = db.transaction(storeName, "readwrite");
              tx.objectStore(storeName).delete(key);
              tx.oncomplete = function () { db.close(); resolve(true); };
              tx.onerror = tx.onabort = function () { db.close(); resolve(false); };
            } catch (err) { db.close(); resolve(false); }
          });
        });
      }
    };
  }

  function memKV() {
    var map = {};
    return {
      get: function (key) { return Promise.resolve(Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null); },
      set: function (key, value) { map[key] = value; return Promise.resolve(true); },
      del: function (key) { delete map[key]; return Promise.resolve(true); }
    };
  }

  function e2eeFromB64url(text) {
    if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
    try {
      var b64 = text.replace(/-/g, "+").replace(/_/g, "/");
      b64 += "====".slice(b64.length % 4 === 0 ? 4 : b64.length % 4);
      var raw = atob(b64);
      var out = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    } catch (err) {
      return null;
    }
  }

  function e2eeToB64url(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /* Structural peer-key check: strict b64url to a 65-byte 0x04 SEC1 point.
     Curve membership is still verified by importKey/deriveBits. */
  function e2eeValidPeerKey(key) {
    var raw = e2eeFromB64url(String(key).trim());
    return raw !== null && raw.length === 65 && raw[0] === 0x04;
  }

  function e2eeNormalizeKeys(keys) {
    var seen = {};
    var out = [];
    (keys || []).forEach(function (raw) {
      var key = String(raw).trim();
      if (!key || seen[key] || !e2eeValidPeerKey(key)) return;
      seen[key] = true;
      if (out.length < E2EE_MAX_SEALS) out.push(key);
    });
    return out;
  }

  function e2eeEncodeMulti(bodies) {
    if (bodies.length === 0 || bodies.length > E2EE_MAX_SEALS) return null;
    var total = 2;
    for (var i = 0; i < bodies.length; i++) {
      if (bodies[i].length < E2EE_MIN_BODY_BYTES || bodies[i].length > 0xffff) return null;
      total += 2 + bodies[i].length;
    }
    var out = new Uint8Array(total);
    var view = new DataView(out.buffer);
    view.setUint16(0, bodies.length, false);
    var offset = 2;
    bodies.forEach(function (body) {
      view.setUint16(offset, body.length, false);
      offset += 2;
      out.set(body, offset);
      offset += body.length;
    });
    return out;
  }

  function e2eeDecodeMulti(packed) {
    if (packed.length < 2) return null;
    var view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    var count = view.getUint16(0, false);
    if (count === 0 || count > E2EE_MAX_SEALS) return null;
    var bodies = [];
    var offset = 2;
    for (var i = 0; i < count; i++) {
      if (offset + 2 > packed.length) return null;
      var len = view.getUint16(offset, false);
      offset += 2;
      if (len < E2EE_MIN_BODY_BYTES || offset + len > packed.length) return null;
      bodies.push(packed.slice(offset, offset + len));
      offset += len;
    }
    if (offset !== packed.length) return null;
    return bodies;
  }

  function e2eeSafetyGroups(digest, count) {
    var groups = [];
    for (var g = 0; g < count; g++) {
      var v = 0;
      for (var i = 0; i < 5; i++) v = v * 256 + digest[g * 5 + i];
      groups.push(String(v % 100000).padStart(5, "0"));
    }
    return groups.join(" ");
  }

  function createE2ee(deps) {
    deps = deps || {};
    var subtle = deps.subtle || (global.crypto && global.crypto.subtle) || null;
    var keyStore = deps.keyStore || idbKV(E2EE_KEYS_DB, E2EE_KEYS_STORE);
    var pinStore = deps.pinStore || idbKV(E2EE_PINS_DB, E2EE_PINS_STORE);
    var TextEnc = deps.TextEncoder || global.TextEncoder;
    var TextDec = deps.TextDecoder || global.TextDecoder;
    var rand = deps.random || function (n) {
      var bytes = new Uint8Array(n);
      global.crypto.getRandomValues(bytes);
      return bytes;
    };
    var sharedCache = new Map();
    var deviceCache = null;
    var pinChains = {};

    function usable() {
      return !!subtle && !!TextEnc && !!TextDec;
    }

    function exactUsages(actual, expected) {
      if (actual.length !== expected.length) return false;
      return expected.every(function (u) { return actual.indexOf(u) !== -1; });
    }

    function validPrivateUsages(usages) {
      return exactUsages(usages, ["deriveBits"]) || exactUsages(usages, ["deriveKey", "deriveBits"]);
    }

    function equalBytes(a, b) {
      if (a.byteLength !== b.byteLength) return false;
      var x = new Uint8Array(a);
      var y = new Uint8Array(b);
      var diff = 0;
      for (var i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
      return diff === 0;
    }

    function exportPublicB64(pair) {
      return subtle.exportKey("raw", pair.publicKey).then(function (raw) {
        return e2eeToB64url(new Uint8Array(raw));
      });
    }

    function validateStoredPair(value) {
      if (!value || typeof value !== "object" || typeof CryptoKey === "undefined") return Promise.resolve(null);
      var priv = value.privateKey;
      var pub = value.publicKey;
      if (!(priv instanceof CryptoKey) || !(pub instanceof CryptoKey)) return Promise.resolve(null);
      if (priv.type !== "private" || pub.type !== "public" || priv.extractable) return Promise.resolve(null);
      if (priv.algorithm.name !== "ECDH" || pub.algorithm.name !== "ECDH") return Promise.resolve(null);
      if (priv.algorithm.namedCurve !== E2EE_CURVE || pub.algorithm.namedCurve !== E2EE_CURVE) return Promise.resolve(null);
      if (!validPrivateUsages(priv.usages) || !exactUsages(pub.usages, [])) return Promise.resolve(null);
      return exportPublicB64({ publicKey: pub }).then(function (pubB64) {
        if (!e2eeValidPeerKey(pubB64)) return null;
        return subtle.generateKey({ name: "ECDH", namedCurve: E2EE_CURVE }, false, ["deriveBits"]).then(function (witness) {
          return Promise.all([
            subtle.deriveBits({ name: "ECDH", public: witness.publicKey }, priv, 256),
            subtle.deriveBits({ name: "ECDH", public: pub }, witness.privateKey, 256)
          ]).then(function (pair) {
            return equalBytes(pair[0], pair[1]) ? { privateKey: priv, publicKey: pub } : null;
          });
        });
      }).catch(function () { return null; });
    }

    /* The device key pair, created on first use. Null when E2EE is
       unavailable — and an ephemeral-only key is never exposed, so a
       failed persist cannot silently orphan sealed history. */
    function deviceKeys() {
      if (deviceCache) return deviceCache;
      var pending = keyStore.get(E2EE_KEY_ID).then(function (stored) {
        // undefined = unreadable store: fail closed, never generate.
        // null = absent: generate below. A corrupt row is never
        // treated as absence — it fails closed instead of silently
        // rotating the device identity.
        if (stored === undefined) return { tag: "unreadable" };
        if (stored === null) return { tag: "absent" };
        return validateStoredPair(stored).then(function (valid) {
          return valid ? { tag: "pair", pair: valid } : { tag: "invalid" };
        });
      }).then(function (existing) {
        if (existing.tag === "pair") return existing.pair;
        if (existing.tag !== "absent") return null;
        return subtle.generateKey({ name: "ECDH", namedCurve: E2EE_CURVE }, false, ["deriveBits"]).then(function (kp) {
          return keyStore.set(E2EE_KEY_ID, kp).then(function (ok) {
            if (!ok) return null;
            return keyStore.get(E2EE_KEY_ID).then(function (durable) {
              if (durable === undefined) return null;
              return validateStoredPair(durable);
            });
          });
        });
      }).catch(function () { return null; });
      deviceCache = pending.then(function (keys) {
        // Do not permanently cache a hard failure: a transient abort
        // must not freeze the tab into "no E2EE" after recovery.
        if (keys === null) deviceCache = null;
        return keys;
      });
      return deviceCache;
    }

    function rememberShared(peerB64, promise) {
      if (sharedCache.has(peerB64)) sharedCache.delete(peerB64);
      sharedCache.set(peerB64, promise);
      while (sharedCache.size > E2EE_SHARED_CACHE_CAP) {
        var oldest = sharedCache.keys().next().value;
        if (oldest === undefined) break;
        sharedCache.delete(oldest);
      }
    }

    function sharedKeyWith(peerB64) {
      var cached = sharedCache.get(peerB64);
      if (cached) {
        rememberShared(peerB64, cached);
        return cached;
      }
      if (!e2eeValidPeerKey(peerB64)) return Promise.resolve(null);
      var p = deviceKeys().then(function (mine) {
        if (!mine) return null;
        return exportPublicB64(mine).then(function (myB64) {
          var peerRaw = e2eeFromB64url(peerB64);
          if (!peerRaw) return null;
          return subtle.importKey("raw", peerRaw, { name: "ECDH", namedCurve: E2EE_CURVE }, false, []).then(function (peerKey) {
            return subtle.deriveBits({ name: "ECDH", public: peerKey }, mine.privateKey, 256);
          }).then(function (sharedBits) {
            return subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
          }).then(function (hkdfKey) {
            var pair = [myB64, peerB64].sort();
            var info = new TextEnc().encode("onyx-dm:" + pair[0] + ":" + pair[1]);
            var salt = new TextEnc().encode(E2EE_HKDF_SALT);
            return subtle.deriveKey(
              { name: "HKDF", hash: "SHA-256", salt: salt, info: info },
              hkdfKey,
              { name: "AES-GCM", length: 256 },
              false,
              ["encrypt", "decrypt"]
            );
          });
        });
      }).catch(function () { return null; });
      rememberShared(peerB64, p);
      p.then(function (key) {
        if (key === null && sharedCache.get(peerB64) === p) sharedCache.delete(peerB64);
      });
      return p;
    }

    function sealBodyFor(peerB64, plaintext) {
      return sharedKeyWith(peerB64).then(function (key) {
        if (!key) return null;
        var nonce = rand(E2EE_NONCE_BYTES);
        var data = new TextEnc().encode(plaintext);
        return subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, data).then(function (ct) {
          var body = new Uint8Array(E2EE_NONCE_BYTES + ct.byteLength);
          body.set(nonce, 0);
          body.set(new Uint8Array(ct), E2EE_NONCE_BYTES);
          return body;
        }).catch(function () { return null; });
      });
    }

    function openBodyFrom(peerB64, body) {
      if (body.length < E2EE_MIN_BODY_BYTES) return Promise.resolve(null);
      return sharedKeyWith(peerB64).then(function (key) {
        if (!key) return null;
        return subtle.decrypt(
          { name: "AES-GCM", iv: body.slice(0, E2EE_NONCE_BYTES) },
          key,
          body.slice(E2EE_NONCE_BYTES)
        ).then(function (pt) {
          return new TextDec().decode(pt);
        }).catch(function () { return null; });
      });
    }

    function openEnvelope(peerB64, envelope) {
      if (envelope.indexOf(E2EE_MULTI_PREFIX) === 0) {
        var packed = e2eeFromB64url(envelope.slice(E2EE_MULTI_PREFIX.length));
        var bodies = packed && e2eeDecodeMulti(packed);
        if (!bodies) return Promise.resolve(null);
        var chain = Promise.resolve(null);
        bodies.forEach(function (body) {
          chain = chain.then(function (found) {
            if (found !== null) return found;
            return openBodyFrom(peerB64, body);
          });
        });
        return chain;
      }
      var offset = -1;
      if (envelope.indexOf(E2EE_MULTI_PREFIX) === 0) offset = E2EE_MULTI_PREFIX.length;
      else if (envelope.indexOf(E2EE_ENVELOPE_PREFIX) === 0) offset = E2EE_ENVELOPE_PREFIX.length;
      if (offset < 0) return Promise.resolve(null);
      var single = e2eeFromB64url(envelope.slice(offset));
      if (!single) return Promise.resolve(null);
      return openBodyFrom(peerB64, single);
    }

    /* ── TOFU pins (legacy single-key or {"v":1,"k":[...]} multi-pin) ── */

    function acctKey(account) {
      return String(account).toLowerCase();
    }

    /* Canonical device-memory owner key (`JSON.stringify([serverUrl,
       identity])`, mirroring `deviceMemoryOwnerKey`: nonempty server ≤
       2048 chars and identity ≤ 256 chars, both unpadded, identity
       lowercased). Anything else is not an owner. */
    function ownerKeyOf(owner) {
      if (!owner || typeof owner !== "object") return null;
      var server = owner.serverUrl;
      var identity = owner.identity;
      if (typeof server !== "string" || typeof identity !== "string") return null;
      if (server.length === 0 || server.length > 2048 || server !== server.trim()) return null;
      if (identity.length === 0 || identity.length > 256 || identity !== identity.trim()) return null;
      return JSON.stringify([server, identity.toLowerCase()]);
    }

    /* Pin record key (mirroring the oracle `pinRecordKey`): per-owner
       namespaced so two local accounts never share TOFU pins for one
       peer nick. Absent owner keeps the legacy peer-only key; an
       invalid owner fails closed (null → unavailable/locked). */
    function pinRecordKey(account, owner) {
      var peer = acctKey(account);
      if (owner === undefined || owner === null) return peer;
      var ownerKey = ownerKeyOf(owner);
      return ownerKey ? JSON.stringify([ownerKey, peer]) : null;
    }

    function parsePinnedKeys(raw) {
      if (raw === null || raw === undefined) return null;
      if (e2eeValidPeerKey(raw)) return [raw];
      if (raw.indexOf('{"v":1,"k":') !== 0 && raw.indexOf("{") !== 0) return null;
      try {
        var parsed = JSON.parse(raw);
        if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.k)) return null;
        var keys = e2eeNormalizeKeys(parsed.k.filter(function (e) { return typeof e === "string"; }));
        return keys.length > 0 ? keys : null;
      } catch (err) {
        return null;
      }
    }

    function withPinChain(recordKey, fn) {
      var tail = pinChains[recordKey] || Promise.resolve();
      var next = tail.then(fn, fn);
      pinChains[recordKey] = next.catch(function () {});
      return next;
    }

    function keyStatus(account, presentedKeys, owner) {
      var keys = e2eeNormalizeKeys(presentedKeys);
      if (keys.length === 0) return Promise.resolve("unreadable");
      var recordKey = pinRecordKey(account, owner);
      if (!recordKey) return Promise.resolve("unreadable");
      return pinStore.get(recordKey).then(function (raw) {
        if (raw === undefined) return "unreadable";
        if (raw === null) return "first-use";
        var pinned = parsePinnedKeys(raw);
        if (!pinned || pinned.length === 0) return "changed";
        var set = {};
        pinned.forEach(function (k) { set[k] = true; });
        for (var i = 0; i < keys.length; i++) {
          if (!set[keys[i]]) return "changed";
        }
        return "unchanged";
      }).catch(function () { return "unreadable"; });
    }

    /* Trust-gated multi-device seal. Only `sealed` puts ciphertext on
       the wire; changed keys and every failure yield nothing. */
    function sealToDevices(account, presentedKeys, plaintext, owner) {
      var keys = e2eeNormalizeKeys(presentedKeys);
      if (keys.length === 0 || !usable()) return Promise.resolve({ status: "unavailable" });
      var recordKey = pinRecordKey(account, owner);
      if (!recordKey) return Promise.resolve({ status: "unavailable" });
      return withPinChain("seal:" + recordKey, function () {
        return keyStatus(account, keys, owner).then(function (verdict) {
          if (verdict === "unreadable") return { status: "unavailable" };
          if (verdict === "changed") {
            return pinStore.get(recordKey).then(function (raw) {
              var pinned = parsePinnedKeys(raw === undefined ? null : raw);
              return { status: "key-changed", pinnedKey: (pinned && pinned[0]) || "" };
            });
          }
          var pin =
            verdict === "first-use"
              ? pinStore.set(
                  recordKey,
                  keys.length === 1 ? keys[0] : JSON.stringify({ v: 1, k: keys })
                )
              : Promise.resolve(true);
          return pin.then(function (ok) {
            if (!ok) return { status: "unavailable" };
            var chain = Promise.resolve([]);
            keys.forEach(function (key) {
              chain = chain.then(function (bodies) {
                if (bodies === null) return null;
                return sealBodyFor(key, plaintext).then(function (body) {
                  if (!body) return null;
                  bodies.push(body);
                  return bodies;
                });
              });
            });
            return chain.then(function (bodies) {
              if (!bodies) return { status: "unavailable" };
              if (bodies.length === 1) {
                return { status: "sealed", envelope: E2EE_ENVELOPE_PREFIX + e2eeToB64url(bodies[0]) };
              }
              var packed = e2eeEncodeMulti(bodies);
              if (!packed) return { status: "unavailable" };
              return { status: "sealed", envelope: E2EE_MULTI_PREFIX + e2eeToB64url(packed) };
            });
          });
        });
      });
    }

    /* Trust-gated open with open-then-pin: on first contact we decrypt
       FIRST and pin only after a successful GCM auth, so a forged key
       that never sealed anything can never occupy the pin slot. */
    function openFrom(account, presentedKey, envelope, owner) {
      if (envelope.indexOf(E2EE_ENVELOPE_PREFIX) !== 0 && envelope.indexOf(E2EE_MULTI_PREFIX) !== 0) {
        return Promise.resolve({ status: "locked", reason: "undecryptable" });
      }
      if (!e2eeValidPeerKey(presentedKey) || !usable()) {
        return Promise.resolve({ status: "locked", reason: "unavailable" });
      }
      var recordKey = pinRecordKey(account, owner);
      if (!recordKey) return Promise.resolve({ status: "locked", reason: "unavailable" });
      return withPinChain("open:" + recordKey, function () {
        return keyStatus(account, [presentedKey], owner).then(function (verdict) {
          if (verdict === "unreadable") return { status: "locked", reason: "unavailable" };
          if (verdict === "changed") return { status: "locked", reason: "key-changed" };
          return openEnvelope(presentedKey, envelope).then(function (plaintext) {
            if (plaintext === null || plaintext === undefined) {
              return { status: "locked", reason: "undecryptable" };
            }
            if (verdict === "first-use") {
              return pinStore.set(recordKey, String(presentedKey).trim()).then(function (ok) {
                if (!ok) return { status: "locked", reason: "unavailable" };
                return { status: "opened", plaintext: plaintext };
              });
            }
            return { status: "opened", plaintext: plaintext };
          });
        });
      });
    }

    function safetyFor(localB64, peerKeys) {
      var peers = e2eeNormalizeKeys(peerKeys);
      if (!e2eeValidPeerKey(localB64) || peers.length === 0 || !usable()) {
        return Promise.resolve(null);
      }
      var sorted = [String(localB64).trim()].concat(peers).sort();
      var material = new TextEnc().encode(E2EE_SAFETY_LABEL + "\x00" + sorted.join("\x00"));
      return subtle.digest("SHA-512", material).then(function (digest) {
        return e2eeSafetyGroups(new Uint8Array(digest).slice(0, 60), 12);
      }).catch(function () { return null; });
    }

    function registryId(publicB64) {
      if (!e2eeValidPeerKey(publicB64)) return Promise.resolve(null);
      var raw = e2eeFromB64url(String(publicB64).trim());
      return subtle.digest("SHA-256", raw).then(function (digest) {
        return "web-" + e2eeToB64url(new Uint8Array(digest)).slice(0, 20);
      }).catch(function () { return null; });
    }

    function publishKeys(sendLine) {
      return deviceKeys().then(function (keys) {
        if (!keys) return false;
        return exportPublicB64(keys).then(function (pub) {
          sendLine("METADATA * SET ocean.dm-key " + pub);
          sendLine("METADATA * SET ocean.dm-keys " + pub);
          return true;
        });
      }).catch(function () { return false; });
    }

    return {
      deviceKeys: deviceKeys,
      devicePublicB64: function () {
        return deviceKeys().then(function (keys) {
          if (!keys) return null;
          return exportPublicB64(keys);
        });
      },
      sealToDevices: sealToDevices,
      openFrom: openFrom,
      safetyFor: safetyFor,
      registryId: registryId,
      publishKeys: publishKeys
    };
  }

  /* ── Group device publisher identity (ODD1 projection) ───────────────
     Ports-side half of the publisher slice: the Ed25519 `sign-v1` pair
     lives in `onyx-keys`/`device` next to the ECDH `dm-v1` pair (never
     the history vault); the private half never leaves WebCrypto. Only
     public bytes plus the derived `ogc1-…` id cross into Elm, where
     `GroupPublisher` rebuilds the ODD1 record through its codec and
     verifies before sending `E2EEKEY ADD`. Mirrors
     `src/lib/e2ee/deviceSign.ts` (read-or-generate+persist; a corrupt
     row fails closed and never rotates the identity) and
     `src/lib/e2ee/groupDeviceIdentity.ts` (projection only — this
     module never mints a third identity; each pair is created once by
     its owner). Takes injectable stores so node can smoke-test
     projection + derivation deterministically. */

  var GROUP_SIGN_KEY_ID = "sign-v1";
  var GROUP_ID_DOMAIN = "ONYX-OGC1-DEVICE-ID-v1";
  var GROUP_SIGN_BYTES = 32;
  var GROUP_ENC_BYTES = 65;
  var GROUP_PUBLISH_RETRY_MS = 2000;

  function groupPublisherPackEntry(signer, enc) {
    // ODD1 binary: "ODD1" magic + 0x01 suite + 32B signer + 65B key.
    var raw = new Uint8Array(4 + 1 + GROUP_SIGN_BYTES + GROUP_ENC_BYTES);
    raw[0] = 0x4f; raw[1] = 0x44; raw[2] = 0x44; raw[3] = 0x31;
    raw[4] = 0x01;
    raw.set(signer, 5);
    raw.set(enc, 5 + GROUP_SIGN_BYTES);
    return raw;
  }

  function createGroupPublisherIdentity(deps) {
    deps = deps || {};
    var subtle = deps.subtle || (global.crypto && global.crypto.subtle) || null;
    var keyStore = deps.keyStore || idbKV(E2EE_KEYS_DB, E2EE_KEYS_STORE);
    var ecdhPublicB64 = deps.ecdhPublicB64 || null;
    var TextEnc = deps.TextEncoder || global.TextEncoder;
    var rand = deps.random || function (n) {
      var bytes = new Uint8Array(n);
      global.crypto.getRandomValues(bytes);
      return bytes;
    };

    function usable() {
      return !!subtle && !!TextEnc && typeof CryptoKey !== "undefined";
    }

    function validSigningPair(value) {
      if (!value || typeof value !== "object") return Promise.resolve(null);
      var priv = value.privateKey;
      var pub = value.publicKey;
      if (!(priv instanceof CryptoKey) || !(pub instanceof CryptoKey)) return Promise.resolve(null);
      if (priv.type !== "private" || pub.type !== "public" || priv.extractable) return Promise.resolve(null);
      if (priv.algorithm.name !== "Ed25519" || pub.algorithm.name !== "Ed25519") return Promise.resolve(null);
      if (priv.usages.indexOf("sign") === -1 || pub.usages.indexOf("verify") === -1) return Promise.resolve(null);
      return subtle.exportKey("raw", pub).then(function (raw) {
        var bytes = new Uint8Array(raw);
        if (bytes.length !== GROUP_SIGN_BYTES) return null;
        var nonzero = 0;
        for (var i = 0; i < bytes.length; i++) nonzero |= bytes[i];
        if (nonzero === 0) return null;
        // Liveness probe: the stored private half must sign for its public.
        var challenge = rand(32);
        return subtle.sign("Ed25519", priv, challenge).then(function (sig) {
          return subtle.verify("Ed25519", pub, sig, challenge).then(function (ok) {
            return ok ? { privateKey: priv, publicKey: pub, publicRaw: bytes } : null;
          });
        });
      }).catch(function () { return null; });
    }

    function signingPublic() {
      return keyStore.get(GROUP_SIGN_KEY_ID).then(function (stored) {
        // undefined = unreadable store: fail closed, never generate.
        // null = absent: generate below. A corrupt row is never treated
        // as absence — it fails closed instead of silently rotating the
        // device identity.
        if (stored === undefined) return null;
        if (stored === null) {
          return subtle.generateKey("Ed25519", false, ["sign", "verify"]).then(function (kp) {
            return keyStore.set(GROUP_SIGN_KEY_ID, kp).then(function (ok) {
              if (!ok) return null;
              return keyStore.get(GROUP_SIGN_KEY_ID).then(function (durable) {
                if (durable === undefined || durable === null) return null;
                return validSigningPair(durable).then(function (valid) {
                  return valid ? valid.publicRaw : null;
                });
              });
            });
          });
        }
        return validSigningPair(stored).then(function (valid) {
          return valid ? valid.publicRaw : null;
        });
      }).catch(function () { return null; });
    }

    function deriveDeviceId(signer, enc) {
      var domain = new TextEnc().encode(GROUP_ID_DOMAIN);
      var pack = groupPublisherPackEntry(signer, enc);
      var material = new Uint8Array(domain.length + 1 + pack.length);
      material.set(domain, 0);
      material[domain.length] = 0;
      material.set(pack, domain.length + 1);
      return subtle.digest("SHA-256", material).then(function (digest) {
        return "ogc1-" + e2eeToB64url(new Uint8Array(digest)).slice(0, 22);
      }).catch(function () { return null; });
    }

    function project() {
      if (!usable()) return Promise.resolve(null);
      var encP = ecdhPublicB64 ? ecdhPublicB64() : Promise.resolve(null);
      return Promise.all([signingPublic(), encP]).then(function (parts) {
        var signer = parts[0];
        var enc = parts[1] ? e2eeFromB64url(String(parts[1]).trim()) : null;
        if (!signer || !enc) return null;
        // Structural shape only; curve membership is enforced ports-side
        // at derivation-trust time, like the oracle's decode gate.
        if (enc.length !== GROUP_ENC_BYTES || enc[0] !== 0x04) return null;
        return deriveDeviceId(signer, enc).then(function (deviceId) {
          if (!deviceId) return null;
          return {
            signerPub: e2eeToB64url(signer),
            encryptionPub: e2eeToB64url(enc),
            deviceId: deviceId
          };
        });
      }).catch(function () { return null; });
    }

    return {
      project: project,
      deriveDeviceId: deriveDeviceId
    };
  }

  /* ── Account-attribution identity (IDENTITY ADD / RESIDENCE) ─────────
     Ports-side half of the attribution slice: the SAME Ed25519 `sign-v1`
     pair the group publisher reads (one device identity — this module
     never mints a second pair), the two daemon transcripts byte-matched
     to `src/lib/e2ee/deviceSign.ts`, and the owner-scoped
     `onyx:attribution-enrolled` localStorage marker mirroring
     `src/lib/irc/attribution.ts` (legacy ownerless
     `onyx:attribution-enrolled:<account>` rows quarantined, never
     claimed). Elm (`Attribution`) owns validation, generation guards,
     and the state machine; this side only answers `RequestEnroll` /
     `RequestResidenceSign` and records `ConfirmEnrolled`. Any failure —
     unreadable store, corrupt row, unparsable request, sign error —
     resolves null / false and Elm stays on the daemon's conservative
     UID path, never a weaker proof. Takes injectable stores so node can
     smoke-test transcripts + key lifecycle deterministically. */

  var ATTRIBUTION_SIGN_KEY_ID = "sign-v1";
  var ATTRIBUTION_IDENTITY_DOMAIN = "ONYX-ACCOUNT-IDENTITY-v1";
  var ATTRIBUTION_RESIDENCE_DOMAIN = "ONYX-ACCOUNT-RESIDENCE-v1";
  var ATTRIBUTION_RESIDENCE_MAGIC = 0x41525031; // "ARP1"
  var ATTRIBUTION_ENROLLED_BASE_KEY = "onyx:attribution-enrolled";
  var ATTRIBUTION_MAX_ACCOUNT_LEN = 64;
  var ATTRIBUTION_LABEL_RE = /^[A-Za-z0-9._-]{1,32}$/;
  var ATTRIBUTION_NODE_HEX_RE = /^[0-9a-f]{16}$/;
  var ATTRIBUTION_PUB_BYTES = 32;
  var ATTRIBUTION_SIG_BYTES = 64;

  function attributionToHex(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      out += h.length === 1 ? "0" + h : h;
    }
    return out;
  }

  function attributionAccountBytes(account, TextEnc) {
    if (typeof account !== "string") return null;
    var bytes = new TextEnc().encode(account);
    if (bytes.length === 0 || bytes.length > ATTRIBUTION_MAX_ACCOUNT_LEN) return null;
    return bytes;
  }

  function attributionOwnerKey(serverUrl, identity) {
    if (typeof serverUrl !== "string" || !serverUrl || serverUrl.length > 2048 || serverUrl !== serverUrl.trim()) return null;
    if (typeof identity !== "string" || !identity || identity.length > 256 || identity !== identity.trim()) return null;
    return JSON.stringify([serverUrl, identity.toLowerCase()]);
  }

  function createAttributionIdentity(deps) {
    deps = deps || {};
    // An explicitly injected null disables the capability (fail-closed);
    // only an absent dep falls back to the ambient global.
    var subtle = deps.subtle !== undefined ? deps.subtle : ((global.crypto && global.crypto.subtle) || null);
    var keyStore = deps.keyStore || idbKV(E2EE_KEYS_DB, E2EE_KEYS_STORE);
    var TextEnc = deps.TextEncoder !== undefined ? deps.TextEncoder : global.TextEncoder;
    var rand = deps.random || function (n) {
      var bytes = new Uint8Array(n);
      global.crypto.getRandomValues(bytes);
      return bytes;
    };
    // Injectable synchronous string store for the enrolled marker
    // (localStorage in production, a plain object in smokes).
    var markerStore = deps.markerStore || null;

    function usable() {
      return !!subtle && !!TextEnc && typeof CryptoKey !== "undefined";
    }

    function markerGet(key) {
      if (markerStore) return markerStore.get(key);
      try {
        if (typeof localStorage === "undefined") return null;
        return localStorage.getItem(key);
      } catch (err) { return null; }
    }

    function markerSet(key, value) {
      if (markerStore) { markerStore.set(key, value); return true; }
      try {
        if (typeof localStorage === "undefined") return false;
        localStorage.setItem(key, value);
        return true;
      } catch (err) { return false; }
    }

    function markerRemove(key) {
      if (markerStore) { markerStore.remove(key); return; }
      try {
        if (typeof localStorage !== "undefined") localStorage.removeItem(key);
      } catch (err) { /* private mode — the marker is ignored anyway */ }
    }

    function enrolledKey(serverUrl, account) {
      var ownerKey = attributionOwnerKey(serverUrl, account);
      return ownerKey ? ATTRIBUTION_ENROLLED_BASE_KEY + ":owner:" + encodeURIComponent(ownerKey) : null;
    }

    function validSigningPair(value) {
      if (!value || typeof value !== "object") return Promise.resolve(null);
      var priv = value.privateKey;
      var pub = value.publicKey;
      if (!(priv instanceof CryptoKey) || !(pub instanceof CryptoKey)) return Promise.resolve(null);
      if (priv.type !== "private" || pub.type !== "public" || priv.extractable) return Promise.resolve(null);
      if (priv.algorithm.name !== "Ed25519" || pub.algorithm.name !== "Ed25519") return Promise.resolve(null);
      if (priv.usages.indexOf("sign") === -1 || pub.usages.indexOf("verify") === -1) return Promise.resolve(null);
      return subtle.exportKey("raw", pub).then(function (raw) {
        var bytes = new Uint8Array(raw);
        if (bytes.length !== ATTRIBUTION_PUB_BYTES) return null;
        var nonzero = 0;
        for (var i = 0; i < bytes.length; i++) nonzero |= bytes[i];
        if (nonzero === 0) return null;
        var challenge = rand(32);
        return subtle.sign("Ed25519", priv, challenge).then(function (sig) {
          return subtle.verify("Ed25519", pub, sig, challenge).then(function (ok) {
            return ok ? { privateKey: priv, publicKey: pub, publicRaw: bytes } : null;
          });
        });
      }).catch(function () { return null; });
    }

    function signingKeys() {
      return keyStore.get(ATTRIBUTION_SIGN_KEY_ID).then(function (stored) {
        // undefined = unreadable store: fail closed, never generate.
        // null = absent: generate once, persist, re-read. A corrupt row
        // is never treated as absence — it fails closed instead of
        // silently rotating the device identity.
        if (stored === undefined) return null;
        if (stored === null) {
          return subtle.generateKey("Ed25519", false, ["sign", "verify"]).then(function (kp) {
            return keyStore.set(ATTRIBUTION_SIGN_KEY_ID, kp).then(function (ok) {
              if (!ok) return null;
              return keyStore.get(ATTRIBUTION_SIGN_KEY_ID).then(function (durable) {
                if (durable === undefined || durable === null) return null;
                return validSigningPair(durable).then(function (valid) {
                  if (!valid) return null;
                  return subtle.exportKey("raw", valid.publicKey).then(function (raw) {
                    return { privateKey: valid.privateKey, publicKey: valid.publicKey, publicRaw: new Uint8Array(raw) };
                  });
                });
              });
            });
          });
        }
        return validSigningPair(stored);
      }).catch(function () { return null; });
    }

    // "ONYX-ACCOUNT-IDENTITY-v1" ‖ 0x00 ‖ account ‖ 0x00 ‖ label ‖ 0x00 ‖ pub(32).
    function buildIdentityTranscript(account, label, publicRaw) {
      var acct = attributionAccountBytes(account, TextEnc);
      if (!acct || !ATTRIBUTION_LABEL_RE.test(label) || publicRaw.length !== ATTRIBUTION_PUB_BYTES) return null;
      var domain = new TextEnc().encode(ATTRIBUTION_IDENTITY_DOMAIN);
      var labelBytes = new TextEnc().encode(label);
      var out = new Uint8Array(domain.length + 1 + acct.length + 1 + labelBytes.length + 1 + publicRaw.length);
      var off = 0;
      out.set(domain, off); off += domain.length;
      out[off++] = 0;
      out.set(acct, off); off += acct.length;
      out[off++] = 0;
      out.set(labelBytes, off); off += labelBytes.length;
      out[off++] = 0;
      out.set(publicRaw, off);
      return out;
    }

    // "ARP1"(u32 BE) ‖ len8(account) ‖ account ‖ node:u64 BE ‖
    // epoch:u64 BE ‖ expiry_ms:u64 BE, framed as
    // "ONYX-ACCOUNT-RESIDENCE-v1" ‖ 0x00 ‖ unsigned-wire.
    function buildResidenceMessage(account, nodeHex, epoch, expiryMs) {
      var acct = attributionAccountBytes(account, TextEnc);
      if (!acct || !ATTRIBUTION_NODE_HEX_RE.test(nodeHex)) return null;
      if (!Number.isSafeInteger(epoch) || epoch < 0) return null;
      if (!Number.isSafeInteger(expiryMs) || expiryMs < 0) return null;
      var node = new Uint8Array(8);
      var nodeView = new DataView(node.buffer);
      // 16 hex chars = 8 bytes, big-endian; parse in two u32 halves so
      // values above 2^53 still encode exactly.
      nodeView.setUint32(0, parseInt(nodeHex.slice(0, 8), 16), false);
      nodeView.setUint32(4, parseInt(nodeHex.slice(8, 16), 16), false);
      var unsigned = new Uint8Array(4 + 1 + acct.length + 8 + 8 + 8);
      var view = new DataView(unsigned.buffer);
      view.setUint32(0, ATTRIBUTION_RESIDENCE_MAGIC, false);
      unsigned[4] = acct.length;
      unsigned.set(acct, 5);
      var off = 5 + acct.length;
      unsigned.set(node, off); off += 8;
      view.setBigUint64(off, BigInt(epoch), false); off += 8;
      view.setBigUint64(off, BigInt(expiryMs), false);
      var domain = new TextEnc().encode(ATTRIBUTION_RESIDENCE_DOMAIN);
      var out = new Uint8Array(domain.length + 1 + unsigned.length);
      out.set(domain, 0);
      out[domain.length] = 0;
      out.set(unsigned, domain.length + 1);
      return out;
    }

    function signMessage(keys, message) {
      return subtle.sign("Ed25519", keys.privateKey, message).then(function (sig) {
        var bytes = new Uint8Array(sig);
        if (bytes.length !== ATTRIBUTION_SIG_BYTES) return null;
        return attributionToHex(bytes);
      }).catch(function () { return null; });
    }

    function validGen(gen) {
      return typeof gen === "number" && Number.isInteger(gen) && gen >= 0;
    }

    function enroll(req) {
      if (!usable()) return Promise.resolve(null);
      req = req || {};
      if (typeof req.serverUrl !== "string" || !req.serverUrl) return Promise.resolve(null);
      if (!attributionAccountBytes(req.account, TextEnc)) return Promise.resolve(null);
      if (!ATTRIBUTION_NODE_HEX_RE.test(req.nodeHex || "")) return Promise.resolve(null);
      if (!validGen(req.gen)) return Promise.resolve(null);
      var serverUrl = req.serverUrl;
      var account = req.account;
      var nodeHex = req.nodeHex;
      var gen = req.gen;
      return signingKeys().then(function (keys) {
        if (!keys) return null;
        var publicHex = attributionToHex(keys.publicRaw);
        var label = "onyx-" + publicHex.slice(0, 16);
        // The pre-owner key cannot prove which server confirmed it:
        // quarantine it instead of attributing it to this endpoint.
        markerRemove(ATTRIBUTION_ENROLLED_BASE_KEY + ":" + account);
        var key = enrolledKey(serverUrl, account);
        var alreadyEnrolled = !!key && markerGet(key) === publicHex;
        if (alreadyEnrolled) {
          return { account: account, nodeHex: nodeHex, gen: gen, label: label, publicHex: publicHex, sig: "", alreadyEnrolled: true };
        }
        var transcript = buildIdentityTranscript(account, label, keys.publicRaw);
        if (!transcript) return null;
        return signMessage(keys, transcript).then(function (sig) {
          if (!sig) return null;
          return { account: account, nodeHex: nodeHex, gen: gen, label: label, publicHex: publicHex, sig: sig, alreadyEnrolled: false };
        });
      }).catch(function () { return null; });
    }

    function residence(req) {
      if (!usable()) return Promise.resolve(null);
      req = req || {};
      if (typeof req.serverUrl !== "string" || !req.serverUrl) return Promise.resolve(null);
      if (!attributionAccountBytes(req.account, TextEnc)) return Promise.resolve(null);
      if (!ATTRIBUTION_NODE_HEX_RE.test(req.nodeHex || "")) return Promise.resolve(null);
      if (!validGen(req.gen)) return Promise.resolve(null);
      var account = req.account;
      var nodeHex = req.nodeHex;
      var epoch = req.epoch;
      var expiryMs = req.expiryMs;
      var gen = req.gen;
      var message = buildResidenceMessage(account, nodeHex, epoch, expiryMs);
      if (!message) return Promise.resolve(null);
      return signingKeys().then(function (keys) {
        if (!keys) return null;
        return signMessage(keys, message).then(function (sig) {
          if (!sig) return null;
          return { account: account, nodeHex: nodeHex, epoch: epoch, expiryMs: expiryMs, gen: gen, sig: sig };
        });
      }).catch(function () { return null; });
    }

    function confirmEnrolled(req) {
      req = req || {};
      if (typeof req.serverUrl !== "string" || !req.serverUrl) return false;
      if (!attributionAccountBytes(req.account, TextEnc)) return false;
      if (typeof req.publicHex !== "string" || !/^[0-9a-f]{64}$/.test(req.publicHex)) return false;
      var key = enrolledKey(req.serverUrl, req.account);
      if (!key) return false;
      return markerSet(key, req.publicHex);
    }

    return {
      enroll: enroll,
      residence: residence,
      confirmEnrolled: confirmEnrolled,
      buildIdentityTranscript: buildIdentityTranscript,
      buildResidenceMessage: buildResidenceMessage,
      enrolledKey: enrolledKey
    };
  }

  function wireAttribution(app, attribution) {
    if (app.ports.attributionEnrollRequest) {
      app.ports.attributionEnrollRequest.subscribe(function (req) {
        attribution.enroll(req).then(function (reply) {
          app.ports.attributionEnrollReply.send(reply);
        }).catch(function () {
          app.ports.attributionEnrollReply.send(null);
        });
      });
    }
    if (app.ports.attributionResidenceRequest) {
      app.ports.attributionResidenceRequest.subscribe(function (req) {
        attribution.residence(req).then(function (reply) {
          app.ports.attributionResidenceReply.send(reply);
        }).catch(function () {
          app.ports.attributionResidenceReply.send(null);
        });
      });
    }
    if (app.ports.attributionConfirmEnrolled) {
      app.ports.attributionConfirmEnrolled.subscribe(function (req) {
        attribution.confirmEnrolled(req);
      });
    }
  }

  /* ── Web-push subscription (WEBPUSH SUBSCRIBE/UNSUBSCRIBE) ───────────
     Ports-side half of the push slice: ServiceWorker PushManager
     subscribe/unsubscribe, the notification permission prompt (enable
     only — recovery never prompts), the owner/intent localStorage
     markers, and the SUBSCRIBE/UNSUBSCRIBE lines, sent only while the
     socket is open (mirroring `sendRaw` false-on-closed). Elm
     (`Push`) owns VAPID shape validation, the Elm-side gate order,
     and the toggle state machine; this side re-validates everything
     and answers with `{ ok }` or `{ ok: false, reason }` carrying the
     oracle's typed reasons verbatim. Takes injectable fakes so node
     can smoke-test every path without a browser. */

  var WEB_PUSH_OWNER_KEY = "onyx:web-push-owner";
  var WEB_PUSH_INTENT_KEY = "onyx:web-push-intent";
  var WEB_PUSH_MAX_MARKER = 4096;
  var WEB_PUSH_VAPID_RE = /^[A-Za-z0-9_-]+$/;
  var WEB_PUSH_SESSION_CHANGED = "Your account or connection changed. Try again.";
  var WEB_PUSH_NO_INTENT = "Push is not enabled on this browser.";

  function webPushB64ToBytes(b64url) {
    if (typeof b64url !== "string" || !WEB_PUSH_VAPID_RE.test(b64url)) return null;
    try {
      var b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
      b64 += "====".slice(b64.length % 4 === 0 ? 4 : b64.length % 4);
      var raw = atob(b64);
      var out = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    } catch (err) {
      return null;
    }
  }

  function webPushOwnerKey(serverUrl, identity) {
    if (typeof serverUrl !== "string" || !serverUrl || serverUrl.length > 2048 || serverUrl !== serverUrl.trim()) return null;
    if (typeof identity !== "string" || !identity || identity.length > 256 || identity !== identity.trim()) return null;
    try {
      return JSON.stringify([serverUrl, identity.toLowerCase()]);
    } catch (err) {
      return null;
    }
  }

  function createWebPush(deps) {
    deps = deps || {};
    var swReady = deps.serviceWorkerReady || function () {
      try {
        if (typeof navigator === "undefined" || !navigator.serviceWorker) return Promise.resolve(null);
        var ready = navigator.serviceWorker.ready;
        if (ready && typeof ready.then === "function") {
          return ready.then(function (reg) { return reg || null; }, function () { return null; });
        }
        return Promise.resolve(null);
      } catch (err) {
        return Promise.resolve(null);
      }
    };
    var notifyApi = deps.notification !== undefined ? deps.notification : ((typeof window !== "undefined" && window.Notification) || null);
    var envSupported = deps.supported;
    var markerStore = deps.markerStore || null;
    var sendLine = deps.sendLine || function () { return false; };
    var socketOpen = deps.socketOpen || function () { return false; };

    function supported() {
      if (typeof envSupported === "boolean") return envSupported;
      try {
        return typeof navigator !== "undefined" && !!navigator.serviceWorker
          && typeof window !== "undefined" && ("PushManager" in window) && ("Notification" in window);
      } catch (err) {
        return false;
      }
    }

    function permission() {
      try {
        if (!notifyApi) return "unsupported";
        return notifyApi.permission || "default";
      } catch (err) {
        return "default";
      }
    }

    function requestPermission() {
      try {
        if (!notifyApi || typeof notifyApi.requestPermission !== "function") return Promise.resolve(null);
        var result = notifyApi.requestPermission();
        if (result && typeof result.then === "function") {
          return result.then(function (p) { return p || "default"; }, function () { return null; });
        }
        return Promise.resolve(result || "default");
      } catch (err) {
        return Promise.resolve(null);
      }
    }

    function markerGet(key) {
      if (markerStore) return markerStore.get(key);
      try {
        if (typeof localStorage === "undefined") return null;
        var raw = localStorage.getItem(key);
        return (typeof raw === "string" && raw.length <= WEB_PUSH_MAX_MARKER) ? raw : null;
      } catch (err) {
        return null;
      }
    }

    function markerSet(key, value) {
      if (markerStore) { markerStore.set(key, value); return true; }
      try {
        if (typeof localStorage === "undefined") return false;
        localStorage.setItem(key, value);
        return true;
      } catch (err) {
        return false;
      }
    }

    function markerClear(key, expected) {
      if (markerStore) {
        if (expected !== undefined && markerStore.get(key) !== expected) return;
        markerStore.remove(key);
        return;
      }
      try {
        if (typeof localStorage === "undefined") return;
        if (expected !== undefined && localStorage.getItem(key) !== expected) return;
        localStorage.removeItem(key);
      } catch (err) { /* a blocked store cannot be made less private by retaining */ }
    }

    function vapidBytes(vapidKey) {
      if (typeof vapidKey !== "string" || vapidKey.length === 0) return { kind: "missing" };
      var bytes = webPushB64ToBytes(vapidKey);
      if (!bytes || bytes.length !== 65 || bytes[0] !== 0x04) return { kind: "malformed" };
      return { kind: "ok", bytes: bytes };
    }

    function keysOf(sub) {
      try {
        if (!sub || typeof sub.endpoint !== "string" || !sub.endpoint) return null;
        var json = (typeof sub.toJSON === "function") ? sub.toJSON() : null;
        var keys = json ? json.keys : null;
        if (!keys || !keys.p256dh || !keys.auth) return null;
        return { endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth };
      } catch (err) {
        return null;
      }
    }

    function unsubscribeQuietly(sub) {
      try {
        var result = sub.unsubscribe();
        if (result && typeof result.then === "function") {
          return result.then(function (ok) { return ok !== false; }, function () { return false; });
        }
        return Promise.resolve(result !== false);
      } catch (err) {
        return Promise.resolve(false);
      }
    }

    function closeNotifications(reg, stillCurrent) {
      try {
        if (!stillCurrent()) return Promise.resolve(false);
        if (!reg || typeof reg.getNotifications !== "function") return Promise.resolve(stillCurrent());
        return reg.getNotifications().then(function (notes) {
          if (!stillCurrent()) return false;
          for (var i = 0; i < (notes || []).length; i++) {
            try { notes[i].close(); } catch (err) { /* best effort */ }
          }
          return true;
        }, function () { return stillCurrent(); });
      } catch (err) {
        return Promise.resolve(stillCurrent());
      }
    }

    function fail(reason) {
      return { ok: false, reason: reason };
    }

    function checkOwner(req) {
      var ownerKey = webPushOwnerKey(req && req.serverUrl, req && req.account);
      if (!ownerKey) return fail("Sign in first — push is tied to your account.");
      return { ownerKey: ownerKey };
    }

    function probe() {
      return Promise.resolve({ supported: supported(), permission: permission() });
    }

    // Shared subscribe + register path. Gate order mirrors
    // `registerWebPush`: supported → account → connected → VAPID →
    // permission (prompt only for enable) → intent (recover only) →
    // retire foreign/incomplete → subscribe → complete keys →
    // markers → SUBSCRIBE.
    function register(req, mode) {
      if (!supported()) return Promise.resolve(fail("This browser does not support push."));
      var checked = checkOwner(req);
      if (checked.reason) return Promise.resolve(checked);
      var ownerKey = checked.ownerKey;
      if (!socketOpen()) return Promise.resolve(fail("Reconnect first."));
      var key = vapidBytes(req && req.vapidKey);
      if (key.kind === "missing") return Promise.resolve(fail("Push is not enabled on this server."));
      if (key.kind !== "ok") return Promise.resolve(fail("Push is misconfigured on this server."));
      if (mode === "recover" && markerGet(WEB_PUSH_INTENT_KEY) !== ownerKey) {
        return Promise.resolve(fail(WEB_PUSH_NO_INTENT));
      }
      var permissionP = (mode === "enable")
        ? requestPermission().then(function (p) { return p; }, function () { return null; })
        : Promise.resolve(permission());
      return permissionP.then(function (perm) {
        if (perm === null || perm === undefined) return fail("Requesting notification permission failed.");
        if (perm !== "granted") return fail("Notifications are blocked by the browser.");
        return swReady().then(function (reg) {
          if (!reg) return fail("Subscribing failed — check site notification settings.");
          if (!socketOpen()) return fail(WEB_PUSH_SESSION_CHANGED);
          return reg.pushManager.getSubscription().then(function (sub) {
            if (!socketOpen()) return fail(WEB_PUSH_SESSION_CHANGED);
            var marked = markerGet(WEB_PUSH_OWNER_KEY);
            var created = null;
            var chain = Promise.resolve(sub);
            if (marked !== ownerKey) {
              chain = chain.then(function (existing) {
                return closeNotifications(reg, socketOpen).then(function (closed) {
                  if (!closed || !socketOpen()) return Promise.reject({ session: true });
                  if (existing) {
                    return unsubscribeQuietly(existing).then(function (retired) {
                      if (!retired) return Promise.reject({ foreign: true });
                      return null;
                    });
                  }
                  return null;
                });
              }).then(function (cleared) {
                markerClear(WEB_PUSH_OWNER_KEY, marked);
                if (!socketOpen()) return Promise.reject({ session: true });
                return cleared;
              });
            }
            return chain.then(function (kept) {
              if (kept && !keysOf(kept)) {
                return unsubscribeQuietly(kept).then(function () {
                  if (!socketOpen()) return Promise.reject({ session: true });
                  return null;
                });
              }
              return kept;
            }).then(function (usable) {
              var next = usable
                ? Promise.resolve({ sub: usable, created: null })
                : reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key.bytes }).then(
                    function (fresh) { return { sub: fresh, created: fresh }; },
                    function () { return Promise.reject({ subscribe: true }); });
              return next;
            }).then(function (pair) {
              created = pair.created;
              if (!socketOpen()) {
                return rollBack(ownerKey, created).then(function () { return fail(WEB_PUSH_SESSION_CHANGED); });
              }
              var keys = keysOf(pair.sub);
              if (!keys) {
                return rollBack(ownerKey, created || pair.sub).then(function () {
                  return fail("The browser returned an incomplete subscription.");
                });
              }
              if (!markerSet(WEB_PUSH_OWNER_KEY, ownerKey) || !markerSet(WEB_PUSH_INTENT_KEY, ownerKey)) {
                markerClear(WEB_PUSH_OWNER_KEY, ownerKey);
                markerClear(WEB_PUSH_INTENT_KEY, ownerKey);
                return discard(pair.sub, created).then(function () {
                  return fail("This browser could not bind push to the current account.");
                });
              }
              if (!sendLine("WEBPUSH SUBSCRIBE " + keys.endpoint + " " + keys.p256dh + " " + keys.auth)) {
                return rollBack(ownerKey, created).then(function () {
                  return fail("The connection closed before push could be registered. Reconnect and try again.");
                });
              }
              return { ok: true };
            }).catch(function (err) {
              if (err && err.session) return fail(WEB_PUSH_SESSION_CHANGED);
              if (err && err.foreign) {
                return fail("This browser could not retire another account's push subscription.");
              }
              return rollBack(ownerKey, null).then(function () {
                return fail("Subscribing failed — check site notification settings.");
              });
            });
          });
        });
      });
    }

    function rollBack(ownerKey, created) {
      markerClear(WEB_PUSH_OWNER_KEY, ownerKey);
      if (!created) return Promise.resolve(null);
      try {
        var result = created.unsubscribe();
        if (result && typeof result.then === "function") return result.catch(function () { return null; });
        return Promise.resolve(null);
      } catch (err) {
        return Promise.resolve(null);
      }
    }

    function discard(sub, created) {
      return rollBack("never-matches-any-owner", created || sub);
    }

    function enable(req) {
      return register(req, "enable");
    }

    function recover(req) {
      return register(req, "recover");
    }

    function disable(req) {
      if (!supported()) return Promise.resolve(fail("This browser does not support push."));
      var ownerKey = (req && req.serverUrl && req.account) ? webPushOwnerKey(req.serverUrl, req.account) : null;
      var marked = markerGet(WEB_PUSH_OWNER_KEY);
      var scopeCurrent = function () {
        var nowOwner = (req && req.serverUrl && req.account) ? webPushOwnerKey(req.serverUrl, req.account) : null;
        return nowOwner === ownerKey && markerGet(WEB_PUSH_OWNER_KEY) === marked;
      };
      return swReady().then(function (reg) {
        if (!reg) return fail("Turning off push failed. Try again.");
        if (!scopeCurrent()) return fail(WEB_PUSH_SESSION_CHANGED);
        return closeNotifications(reg, scopeCurrent).then(function (closed) {
          if (!closed || !scopeCurrent()) return fail(WEB_PUSH_SESSION_CHANGED);
          return reg.pushManager.getSubscription().then(function (sub) {
            if (!scopeCurrent()) return fail(WEB_PUSH_SESSION_CHANGED);
            if (!sub) {
              markerClear(WEB_PUSH_OWNER_KEY, marked);
              if (ownerKey) markerClear(WEB_PUSH_INTENT_KEY, ownerKey);
              return { ok: true };
            }
            return unsubscribeQuietly(sub).then(function (retired) {
              if (!retired) return fail("The browser could not remove its push subscription.");
              markerClear(WEB_PUSH_OWNER_KEY, marked);
              if (ownerKey) markerClear(WEB_PUSH_INTENT_KEY, ownerKey);
              // Never unregister through a replacement session; the
              // local revoke already leaves this browser truthfully off.
              // The captured owner/marker pair decides (not a marker
              // re-read — the claim was just cleared above).
              if (ownerKey && marked === ownerKey && socketOpen()) {
                try { sendLine("WEBPUSH UNSUBSCRIBE " + sub.endpoint); } catch (err) { /* already off */ }
              }
              return { ok: true };
            });
          });
        });
      }).catch(function () { return fail("Turning off push failed. Try again."); });
    }

    // True when this browser holds the current account's subscription.
    // Foreign endpoints are retired locally before answering; a missing
    // subscription clears the ownership claim but keeps intent so
    // recovery can re-bind.
    function checkActive(req) {
      if (!supported()) return Promise.resolve({ active: false, intentDesired: false });
      var ownerKey = (req && req.serverUrl && req.account) ? webPushOwnerKey(req.serverUrl, req.account) : null;
      var intentDesired = !!ownerKey && markerGet(WEB_PUSH_INTENT_KEY) === ownerKey;
      return swReady().then(function (reg) {
        if (!reg) return { active: false, intentDesired: intentDesired };
        return reg.pushManager.getSubscription().then(function (sub) {
          var marked = markerGet(WEB_PUSH_OWNER_KEY);
          var scopeCurrent = function () {
            var nowOwner = (req && req.serverUrl && req.account) ? webPushOwnerKey(req.serverUrl, req.account) : null;
            return nowOwner === ownerKey && markerGet(WEB_PUSH_OWNER_KEY) === marked;
          };
          if (!sub) {
            if (scopeCurrent()) {
              return closeNotifications(reg, scopeCurrent).then(function (closed) {
                if (closed && scopeCurrent() && (!ownerKey || marked !== ownerKey)) markerClear(WEB_PUSH_OWNER_KEY, marked);
                return { active: false, intentDesired: intentDesired };
              });
            }
            return { active: false, intentDesired: intentDesired };
          }
          if (ownerKey && marked === ownerKey && scopeCurrent()) return { active: true, intentDesired: intentDesired };
          if (!scopeCurrent()) return { active: false, intentDesired: intentDesired };
          return closeNotifications(reg, scopeCurrent).then(function (closed) {
            if (!closed || !scopeCurrent()) return { active: false, intentDesired: intentDesired };
            return unsubscribeQuietly(sub).then(function (retired) {
              if (retired) markerClear(WEB_PUSH_OWNER_KEY, marked);
              return { active: false, intentDesired: intentDesired };
            });
          });
        });
      }).catch(function () { return { active: false, intentDesired: intentDesired }; });
    }

    return {
      probe: probe,
      enable: enable,
      recover: recover,
      disable: disable,
      checkActive: checkActive
    };
  }

  function wireWebPush(app, push) {
    if (app.ports.webPushProbe) {
      app.ports.webPushProbe.subscribe(function () {
        push.probe().then(function (probed) {
          app.ports.webPushProbed.send(probed);
        }).catch(function () {
          app.ports.webPushProbed.send({ supported: false, permission: "default" });
        });
      });
    }
    if (app.ports.webPushEnable) {
      app.ports.webPushEnable.subscribe(function (req) {
        push.enable(req || {}).then(function (reply) {
          app.ports.webPushEnabled.send(reply);
        }).catch(function () {
          app.ports.webPushEnabled.send({ ok: false, reason: "Subscribing failed — check site notification settings." });
        });
      });
    }
    if (app.ports.webPushRecover) {
      app.ports.webPushRecover.subscribe(function (req) {
        push.recover(req || {}).then(function (reply) {
          app.ports.webPushRecovered.send(reply);
        }).catch(function () {
          app.ports.webPushRecovered.send({ ok: false, reason: "Subscribing failed — check site notification settings." });
        });
      });
    }
    if (app.ports.webPushDisable) {
      app.ports.webPushDisable.subscribe(function (req) {
        push.disable(req || {}).then(function (reply) {
          app.ports.webPushDisabled.send(reply);
        }).catch(function () {
          app.ports.webPushDisabled.send({ ok: false, reason: "Turning off push failed. Try again." });
        });
      });
    }
    if (app.ports.webPushCheckActive) {
      app.ports.webPushCheckActive.subscribe(function (req) {
        push.checkActive(req || {}).then(function (reply) {
          app.ports.webPushActiveState.send(reply);
        }).catch(function () {
          app.ports.webPushActiveState.send({ active: false, intentDesired: false });
        });
      });
    }
    try {
      if (typeof navigator !== "undefined" && navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
        navigator.serviceWorker.addEventListener("controllerchange", function () {
          try {
            if (app.ports.webPushRecoveryHint) app.ports.webPushRecoveryHint.send(null);
          } catch (err) { /* hint is best-effort */ }
        });
      }
    } catch (err) { /* no service-worker events here */ }
  }

  /* ── OGW1 group-welcome open + epoch-key install ─────────────────────
     Ports-side half of the welcome slice: ECDH (P-256) + HKDF-SHA256 +
     AES-GCM open of a target-specific welcome against our `dm-v1`
     private key, the plaintext binding checks, the OGCMT2 epoch-key
     commitment check, and installation into the ephemeral room keyring
     — in one call, so the epoch key never crosses into Elm and every
     intermediate copy is zeroed. Mirrors `src/lib/e2ee/groupWelcome.ts`
     (`decodeGroupWelcome`, `buildGroupWelcomeContext`, `openGroupWelcome`
     binding checks) and `src/lib/e2ee/groupCommit.ts`
     (`computeGroupEpochKeyCommitment`); the recipient-vs-local binding
     is enforced by Elm before requesting. `prepareWelcome` mirrors
     `prepareGroupWelcome` so node can smoke-test the full
     prepare→open→install→seal interop. */

  var GROUP_WELCOME_MAGIC = [0x4f, 0x47, 0x57, 0x31]; // "OGW1"
  var GROUP_WELCOME_VERSION = 1;
  var GROUP_WELCOME_EPHEMERAL_BYTES = 65;
  var GROUP_WELCOME_NONCE_BYTES = 12;
  var GROUP_WELCOME_COMMIT_ID_BYTES = 32;
  var GROUP_WELCOME_DIGEST_BYTES = 32;
  var GROUP_WELCOME_KEY_BYTES = 32;
  var GROUP_WELCOME_PLAINTEXT_MAGIC = [0x4f, 0x47, 0x57, 0x50, 0x31]; // "OGWP1"
  var GROUP_WELCOME_PLAINTEXT_BYTES = 109;
  var GROUP_WELCOME_MAX_BYTES = 207;
  var GROUP_WELCOME_CONTEXT_DOMAIN = "ONYX-GROUP-WELCOME-CONTEXT-v1";
  var GROUP_WELCOME_HKDF_INFO = "ONYX-GROUP-WELCOME-v1";
  var GROUP_COMMIT_KEY_DOMAIN = "ONYX-OGCMT2-EPOCH-KEY-v1";
  var GROUP_WELCOME_ACCOUNT_RE = /^[A-Za-z0-9_.@-]{1,64}$/;
  var GROUP_WELCOME_DEVICE_RE = /^[A-Za-z0-9_.-]{1,32}$/;

  function groupWelcomeBytesEqual(a, b) {
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  function groupWelcomeNonZero(bytes) {
    var v = 0;
    for (var i = 0; i < bytes.length; i++) v |= bytes[i];
    return v !== 0;
  }

  function groupWelcomeNormRoom(room, TextEnc) {
    var norm = String(room).trim().toLowerCase();
    if (!norm || new TextEnc().encode(norm).length > 256) return null;
    return norm;
  }

  function createGroupWelcome(deps) {
    deps = deps || {};
    var subtle = deps.subtle || (global.crypto && global.crypto.subtle) || null;
    var TextEnc = deps.TextEncoder || global.TextEncoder;
    var devicePrivateKey = deps.devicePrivateKey || null;
    var roomProvision = deps.roomProvision || null;
    var rand = deps.random || function (n) {
      var bytes = new Uint8Array(n);
      global.crypto.getRandomValues(bytes);
      return bytes;
    };

    function usable() {
      return !!subtle && !!TextEnc;
    }

    function writeU64be(out, offset, epoch) {
      var hi = Math.floor(epoch / 4294967296);
      var lo = epoch >>> 0;
      out[offset] = (hi >>> 24) & 0xff;
      out[offset + 1] = (hi >>> 16) & 0xff;
      out[offset + 2] = (hi >>> 8) & 0xff;
      out[offset + 3] = hi & 0xff;
      out[offset + 4] = (lo >>> 24) & 0xff;
      out[offset + 5] = (lo >>> 16) & 0xff;
      out[offset + 6] = (lo >>> 8) & 0xff;
      out[offset + 7] = lo & 0xff;
    }

    function buildContext(input) {
      if (!usable()) return null;
      var room = groupWelcomeNormRoom(input.room, TextEnc);
      var fromAccount = String(input.fromAccount).trim().toLowerCase();
      var toAccount = String(input.toAccount).trim().toLowerCase();
      var epoch = input.epoch;
      var commitId = input.commitId;
      if (!room || !GROUP_WELCOME_ACCOUNT_RE.test(fromAccount) || !GROUP_WELCOME_ACCOUNT_RE.test(toAccount)) return null;
      if (!GROUP_WELCOME_DEVICE_RE.test(String(input.fromDevice)) || !GROUP_WELCOME_DEVICE_RE.test(String(input.toDevice))) return null;
      if (!Number.isInteger(epoch) || epoch < 0 || epoch > 0xffffffff) return null;
      if (!(commitId instanceof Uint8Array) || commitId.length !== GROUP_WELCOME_COMMIT_ID_BYTES || !groupWelcomeNonZero(commitId)) return null;
      var enc = new TextEnc();
      var fields = [enc.encode(room), enc.encode(fromAccount), enc.encode(String(input.fromDevice)), enc.encode(toAccount), enc.encode(String(input.toDevice))];
      var domain = enc.encode(GROUP_WELCOME_CONTEXT_DOMAIN);
      var total = domain.length + 1;
      for (var i = 0; i < fields.length; i++) total += 2 + fields[i].length;
      total += 8 + GROUP_WELCOME_COMMIT_ID_BYTES;
      var out = new Uint8Array(total);
      var offset = 0;
      out.set(domain, offset); offset += domain.length;
      out[offset++] = 0;
      for (var j = 0; j < fields.length; j++) {
        out[offset++] = (fields[j].length >>> 8) & 0xff;
        out[offset++] = fields[j].length & 0xff;
        out.set(fields[j], offset); offset += fields[j].length;
      }
      writeU64be(out, offset, epoch); offset += 8;
      out.set(commitId, offset);
      return out;
    }

    function decodeEnvelope(wire) {
      var raw = e2eeFromB64url(String(wire));
      if (!raw || raw.length !== GROUP_WELCOME_MAX_BYTES) return null;
      if (e2eeToB64url(raw) !== String(wire)) return null;
      for (var i = 0; i < 4; i++) {
        if (raw[i] !== GROUP_WELCOME_MAGIC[i]) return null;
      }
      if (raw[4] !== GROUP_WELCOME_VERSION) return null;
      var ephemeral = raw.slice(5, 70);
      if (ephemeral.length !== GROUP_WELCOME_EPHEMERAL_BYTES || ephemeral[0] !== 0x04) return null;
      return { ephemeral: ephemeral, nonce: raw.slice(70, 82), ciphertext: raw.slice(82) };
    }

    function decodePlaintext(raw) {
      if (!(raw instanceof Uint8Array) || raw.length !== GROUP_WELCOME_PLAINTEXT_BYTES) return null;
      for (var i = 0; i < 5; i++) {
        if (raw[i] !== GROUP_WELCOME_PLAINTEXT_MAGIC[i]) return null;
      }
      var epoch = 0;
      for (var j = 5; j < 13; j++) epoch = epoch * 256 + raw[j];
      if (!Number.isSafeInteger(epoch)) return null;
      var commitId = raw.slice(13, 45);
      var membership = raw.slice(45, 77);
      var epochKey = raw.slice(77, 109);
      if (!groupWelcomeNonZero(commitId) || !groupWelcomeNonZero(membership) || !groupWelcomeNonZero(epochKey)) return null;
      return { epoch: epoch, commitId: commitId, membershipDigest: membership, epochKey: epochKey };
    }

    function deriveWelcomeKey(sharedBits, context) {
      return subtle.digest("SHA-256", context).then(function (saltBuf) {
        var salt = new Uint8Array(saltBuf);
        return subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]).then(function (hkdf) {
          var prefix = new TextEnc().encode(GROUP_WELCOME_HKDF_INFO + "\u0000");
          var info = new Uint8Array(prefix.length + context.length);
          info.set(prefix, 0);
          info.set(context, prefix.length);
          var p = subtle.deriveKey(
            { name: "HKDF", hash: "SHA-256", salt: salt, info: info },
            hkdf,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
          );
          salt.fill(0);
          info.fill(0);
          return p;
        });
      });
    }

    function computeCommitment(room, epoch, commitId, membership, epochKey) {
      var norm = groupWelcomeNormRoom(room, TextEnc);
      if (!norm) return Promise.resolve(null);
      var domain = new TextEnc().encode(GROUP_COMMIT_KEY_DOMAIN);
      var roomBytes = new TextEnc().encode(norm);
      var material = new Uint8Array(domain.length + 1 + roomBytes.length + 8 + 32 + 32 + 32);
      var offset = 0;
      material.set(domain, offset); offset += domain.length;
      material[offset++] = 0;
      material.set(roomBytes, offset); offset += roomBytes.length;
      writeU64be(material, offset, epoch); offset += 8;
      material.set(commitId, offset); offset += 32;
      material.set(membership, offset); offset += 32;
      material.set(epochKey, offset);
      return subtle.digest("SHA-256", material).then(function (digest) {
        material.fill(0);
        return new Uint8Array(digest);
      }).catch(function () {
        material.fill(0);
        return null;
      });
    }

    function recipientWrapBytes(wrapB64) {
      var raw = e2eeFromB64url(String(wrapB64).trim());
      if (!raw) return null;
      if (raw.length === 102
        && raw[0] === 0x4f && raw[1] === 0x44 && raw[2] === 0x44 && raw[3] === 0x31
        && raw[4] === 0x01) {
        var enc = raw.slice(37, 102);
        return (enc.length === 65 && enc[0] === 0x04) ? enc : null;
      }
      if (raw.length === 65 && raw[0] === 0x04 && e2eeToB64url(raw) === String(wrapB64).trim()) return raw;
      return null;
    }

    function fixedBytes(b64, length) {
      if (typeof b64 !== "string") return null;
      var raw = e2eeFromB64url(b64.trim());
      if (!raw || raw.length !== length || e2eeToB64url(raw) !== b64.trim()) return null;
      return raw;
    }

    function prepareWelcome(input) {
      if (!usable()) return Promise.resolve({ ok: false, reason: "unavailable" });
      var commitId = fixedBytes(input.commitIdB64, 32);
      var membership = fixedBytes(input.membershipB64, 32);
      var epochKey = fixedBytes(input.epochKeyB64, 32);
      var recipient = recipientWrapBytes(input.recipientWrapB64 || "");
      var context = null;
      if (!commitId || !membership || !epochKey || !recipient
        || !groupWelcomeNonZero(commitId) || !groupWelcomeNonZero(membership) || !groupWelcomeNonZero(epochKey)) {
        return Promise.resolve({ ok: false, reason: "invalid-commit" });
      }
      context = buildContext({ room: input.room, fromAccount: input.fromAccount, fromDevice: input.fromDevice, toAccount: input.toAccount, toDevice: input.toDevice, epoch: input.epoch, commitId: commitId });
      if (!context) return Promise.resolve({ ok: false, reason: "invalid-commit" });
      var pt = new Uint8Array(GROUP_WELCOME_PLAINTEXT_BYTES);
      pt.set(GROUP_WELCOME_PLAINTEXT_MAGIC, 0);
      writeU64be(pt, 5, input.epoch);
      pt.set(commitId, 13);
      pt.set(membership, 45);
      pt.set(epochKey, 77);
      return subtle.importKey("raw", recipient, { name: "ECDH", namedCurve: "P-256" }, false, []).then(function (recipientKey) {
        return subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]).then(function (ephemeralPair) {
          return subtle.exportKey("raw", ephemeralPair.publicKey).then(function (ephemRaw) {
            var ephem = new Uint8Array(ephemRaw);
            if (ephem.length !== 65 || ephem[0] !== 0x04) {
              context.fill(0);
              pt.fill(0);
              return { ok: false, reason: "unavailable" };
            }
            return subtle.deriveBits({ name: "ECDH", public: recipientKey }, ephemeralPair.privateKey, 256).then(function (sharedBits) {
              return deriveWelcomeKey(sharedBits, context).then(function (key) {
                new Uint8Array(sharedBits).fill(0);
                var nonce = rand(12);
                return subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: context }, key, pt).then(function (ct) {
                  var envelope = new Uint8Array(GROUP_WELCOME_MAX_BYTES);
                  envelope.set(GROUP_WELCOME_MAGIC, 0);
                  envelope[4] = GROUP_WELCOME_VERSION;
                  envelope.set(ephem, 5);
                  envelope.set(nonce, 70);
                  envelope.set(new Uint8Array(ct), 82);
                  var wireOut = e2eeToB64url(envelope);
                  context.fill(0);
                  pt.fill(0);
                  envelope.fill(0);
                  return { ok: true, wire: wireOut };
                });
              });
            });
          });
        });
      }).catch(function () {
        if (context) context.fill(0);
        pt.fill(0);
        return { ok: false, reason: "unavailable" };
      });
    }

    function validRecipientKey(key) {
      return !!key && typeof CryptoKey !== "undefined" && (key instanceof CryptoKey)
        && key.type === "private" && !key.extractable
        && key.algorithm.name === "ECDH" && key.usages.indexOf("deriveBits") !== -1;
    }

    function openAndInstall(input) {
      var room = typeof input.room === "string" ? input.room : "";
      var epoch = input.epoch;
      if (!usable()) return Promise.resolve({ ok: false, room: room, epoch: epoch, reason: "unavailable" });
      var envelope = decodeEnvelope(input.welcomeB64 || "");
      var commitId = fixedBytes(input.commitIdB64, 32);
      var membership = fixedBytes(input.membershipB64, 32);
      var commitment = fixedBytes(input.commitmentB64, 32);
      if (!envelope) return Promise.resolve({ ok: false, room: room, epoch: epoch, reason: "invalid-welcome" });
      if (!commitId || !membership || !commitment
        || !groupWelcomeNonZero(commitId) || !groupWelcomeNonZero(membership) || !groupWelcomeNonZero(commitment)) {
        return Promise.resolve({ ok: false, room: room, epoch: epoch, reason: "invalid-commit" });
      }
      var context = buildContext({ room: room, fromAccount: input.fromAccount, fromDevice: input.fromDevice, toAccount: input.toAccount, toDevice: input.toDevice, epoch: epoch, commitId: commitId });
      if (!context) return Promise.resolve({ ok: false, room: room, epoch: epoch, reason: "invalid-commit" });
      var keyP = devicePrivateKey ? devicePrivateKey() : Promise.resolve(null);
      return keyP.then(function (priv) {
        if (!validRecipientKey(priv)) {
          context.fill(0);
          return { ok: false, room: room, epoch: epoch, reason: "recipient-key-unavailable" };
        }
        return subtle.importKey("raw", envelope.ephemeral, { name: "ECDH", namedCurve: "P-256" }, false, []).then(function (ephemeralKey) {
          return subtle.deriveBits({ name: "ECDH", public: ephemeralKey }, priv, 256).then(function (sharedBits) {
            return deriveWelcomeKey(sharedBits, context).then(function (key) {
              new Uint8Array(sharedBits).fill(0);
              return subtle.decrypt({ name: "AES-GCM", iv: envelope.nonce, additionalData: context }, key, envelope.ciphertext).then(function (ptBuf) {
                var opened = decodePlaintext(new Uint8Array(ptBuf));
                var fail = null;
                if (!opened) fail = "welcome-open-failed";
                else if (opened.epoch !== epoch) fail = "welcome-open-failed";
                else if (!groupWelcomeBytesEqual(opened.commitId, commitId)) fail = "welcome-open-failed";
                else if (!groupWelcomeBytesEqual(opened.membershipDigest, membership)) fail = "welcome-open-failed";
                if (fail) {
                  context.fill(0);
                  return { ok: false, room: room, epoch: epoch, reason: fail };
                }
                return computeCommitment(room, epoch, opened.commitId, opened.membershipDigest, opened.epochKey).then(function (expected) {
                  if (!expected || !groupWelcomeBytesEqual(expected, commitment)) {
                    opened.epochKey.fill(0);
                    context.fill(0);
                    return { ok: false, room: room, epoch: epoch, reason: "commitment-mismatch" };
                  }
                  var installP = roomProvision
                    ? roomProvision(room, epoch, opened.epochKey)
                    : Promise.resolve(false);
                  return installP.then(function (installed) {
                    opened.epochKey.fill(0);
                    context.fill(0);
                    if (!installed) return { ok: false, room: room, epoch: epoch, reason: "install-failed" };
                    return { ok: true, room: room, epoch: epoch };
                  });
                });
              }).catch(function () {
                context.fill(0);
                return { ok: false, room: room, epoch: epoch, reason: "welcome-open-failed" };
              });
            });
          });
        }).catch(function () {
          context.fill(0);
          return { ok: false, room: room, epoch: epoch, reason: "welcome-open-failed" };
        });
      }).catch(function () {
        context.fill(0);
        return { ok: false, room: room, epoch: epoch, reason: "recipient-key-unavailable" };
      });
    }

    return {
      buildContext: buildContext,
      decodeEnvelope: decodeEnvelope,
      prepareWelcome: prepareWelcome,
      openAndInstall: openAndInstall,
      computeCommitment: computeCommitment
    };
  }

  function wireGroupWelcome(app, welcome) {
    if (app.ports.groupWelcomeOpen) {
      app.ports.groupWelcomeOpen.subscribe(function (req) {
        welcome.openAndInstall(req).then(function (outcome) {
          if (outcome.ok) {
            app.ports.groupWelcomeOpened.send({ room: outcome.room, epoch: outcome.epoch, ok: true, reason: "" });
          } else {
            app.ports.groupWelcomeOpened.send({ room: outcome.room, epoch: outcome.epoch, ok: false, reason: outcome.reason });
          }
        }).catch(function () {
          app.ports.groupWelcomeOpened.send({ room: req.room, epoch: req.epoch, ok: false, reason: "unavailable" });
        });
      });
    }
  }

  function wireGroupPublisher(app, publisher) {
    if (app.ports.groupPublisherProject) {
      app.ports.groupPublisherProject.subscribe(function () {
        publisher.project().then(function (identity) {
          app.ports.groupPublisherIdentity.send(identity);
        }).catch(function () {
          app.ports.groupPublisherIdentity.send(null);
        });
      });
    }
    if (app.ports.groupPublisherScheduleRetry) {
      app.ports.groupPublisherScheduleRetry.subscribe(function () {
        setTimeout(function () {
          app.ports.groupPublisherRetryDue.send(null);
        }, GROUP_PUBLISH_RETRY_MS);
      });
    }
  }

  /* ── Group-room crypto (AES-GCM under epoch keys + AAD) ─────────────
     Ports-side half of the room seal/open slice: ephemeral per-room
     epoch keys (never persisted — a reload re-provisions through the
     E2EEGROUP control plane, still planned), canonical
     `ONYXROOM1|<room>|<epoch>` AAD, and the version/epoch/nonce pack.
     Pure envelope structure lives in Elm (`GroupEnvelope`); key
     provisioning arrives with the control plane — until then rooms
     stay session-not-provisioned (locked), never plaintext. */

  var GROUP_ENVELOPE_PREFIX = "ONYXROOM1 ";
  var GROUP_VERSION = 1;
  var GROUP_NONCE_BYTES = 12;
  var GROUP_HEADER_BYTES = 5;
  var GROUP_TAG_BYTES = 16;
  var GROUP_MAX_PLAINTEXT_BYTES = 3031;
  var GROUP_MAX_CIPHERTEXT_BYTES = GROUP_MAX_PLAINTEXT_BYTES + GROUP_TAG_BYTES;
  var GROUP_MAX_WIRE_BYTES = 4096;
  var GROUP_MAX_ROOM_BYTES = 256;

  function groupNormalizeRoom(room, TextEnc) {
    var norm = String(room).trim().toLowerCase();
    if (!norm) return null;
    if (new TextEnc().encode(norm).length > GROUP_MAX_ROOM_BYTES) return null;
    return norm;
  }

  function groupAad(normRoom, epoch, TextEnc) {
    return new TextEnc().encode(
      GROUP_ENVELOPE_PREFIX.trim() + "|" + normRoom + "|" + (epoch >>> 0)
    );
  }

  function groupParseEnvelope(text) {
    if (text.indexOf(GROUP_ENVELOPE_PREFIX) !== 0) return null;
    var raw = e2eeFromB64url(text.slice(GROUP_ENVELOPE_PREFIX.length));
    var minBody = GROUP_HEADER_BYTES + GROUP_NONCE_BYTES + GROUP_TAG_BYTES;
    var maxBody = GROUP_HEADER_BYTES + GROUP_NONCE_BYTES + GROUP_MAX_CIPHERTEXT_BYTES;
    if (!raw || raw.length < minBody || raw.length > maxBody) return null;
    if (raw[0] !== GROUP_VERSION) return null;
    var epoch = ((raw[1] * 16777216) + (raw[2] << 16) + (raw[3] << 8) + raw[4]) >>> 0;
    var nonce = raw.slice(GROUP_HEADER_BYTES, GROUP_HEADER_BYTES + GROUP_NONCE_BYTES);
    var ct = raw.slice(GROUP_HEADER_BYTES + GROUP_NONCE_BYTES);
    if (ct.length < GROUP_TAG_BYTES) return null;
    return { epoch: epoch, nonce: nonce, ct: ct };
  }

  function groupPackEnvelope(epoch, nonce, ct) {
    if (!Number.isInteger(epoch) || epoch < 0 || epoch > 0xffffffff) return null;
    if (nonce.length !== GROUP_NONCE_BYTES) return null;
    if (ct.length < GROUP_TAG_BYTES || ct.length > GROUP_MAX_CIPHERTEXT_BYTES) return null;
    var body = new Uint8Array(GROUP_HEADER_BYTES + GROUP_NONCE_BYTES + ct.length);
    body[0] = GROUP_VERSION;
    body[1] = (epoch >>> 24) & 0xff;
    body[2] = (epoch >>> 16) & 0xff;
    body[3] = (epoch >>> 8) & 0xff;
    body[4] = epoch & 0xff;
    body.set(nonce, GROUP_HEADER_BYTES);
    body.set(ct, GROUP_HEADER_BYTES + GROUP_NONCE_BYTES);
    var wire = GROUP_ENVELOPE_PREFIX + e2eeToB64url(body);
    return wire.length <= GROUP_MAX_WIRE_BYTES ? wire : null;
  }

  function createRoomCrypto(deps) {
    deps = deps || {};
    var subtle = deps.subtle || (global.crypto && global.crypto.subtle) || null;
    var TextEnc = deps.TextEncoder || global.TextEncoder;
    var TextDec = deps.TextDecoder || global.TextDecoder;
    var rand = deps.random || function (n) {
      var bytes = new Uint8Array(n);
      global.crypto.getRandomValues(bytes);
      return bytes;
    };
    /* roomKey -> Map(epoch -> CryptoKey). Ephemeral: never persisted,
       re-provisioned per session by the control plane. */
    var rooms = new Map();

    function usable() {
      return !!subtle && !!TextEnc && !!TextDec;
    }

    function roomMap(normRoom) {
      var entry = rooms.get(normRoom);
      if (!entry) {
        entry = { keys: new Map(), active: -1 };
        rooms.set(normRoom, entry);
      }
      return entry;
    }

    /* Test/control-plane hook: install one epoch key (32 raw bytes).
       The newest provisioned epoch seals; opens address any known epoch. */
    function provisionRoomKey(room, epoch, rawBytes) {
      if (!usable()) return Promise.resolve(false);
      var norm = groupNormalizeRoom(room, TextEnc);
      if (!norm) return Promise.resolve(false);
      if (!Number.isInteger(epoch) || epoch < 0 || epoch > 0xffffffff) return Promise.resolve(false);
      if (!(rawBytes instanceof Uint8Array) || rawBytes.length !== 32) return Promise.resolve(false);
      return subtle.importKey("raw", rawBytes, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]).then(function (key) {
        var entry = roomMap(norm);
        entry.keys.set(epoch >>> 0, key);
        if ((epoch >>> 0) > entry.active) entry.active = epoch >>> 0;
        return true;
      }).catch(function () { return false; });
    }

    function sealRoomMessage(room, plaintext) {
      if (!usable()) return Promise.resolve({ ok: false, reason: "session-not-provisioned" });
      var norm = groupNormalizeRoom(room, TextEnc);
      if (!norm) return Promise.resolve({ ok: false, reason: "session-not-provisioned" });
      var entry = rooms.get(norm);
      if (!entry || entry.active < 0 || !entry.keys.has(entry.active)) {
        return Promise.resolve({ ok: false, reason: "session-not-provisioned" });
      }
      var epoch = entry.active;
      var key = entry.keys.get(epoch);
      var aad = groupAad(norm, epoch, TextEnc);
      var encoded = new TextEnc().encode(plaintext);
      if (encoded.length === 0 || encoded.length > GROUP_MAX_PLAINTEXT_BYTES) {
        return Promise.resolve({ ok: false, reason: "unavailable" });
      }
      var nonce = rand(GROUP_NONCE_BYTES);
      return subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, key, encoded).then(function (ct) {
        var envelope = groupPackEnvelope(epoch, nonce, new Uint8Array(ct));
        if (!envelope) return { ok: false, reason: "unavailable" };
        return { ok: true, envelope: envelope };
      }).catch(function () { return { ok: false, reason: "unavailable" }; });
    }

    function openRoomMessage(room, envelope) {
      if (!usable()) return Promise.resolve({ ok: false, reason: "session-not-provisioned" });
      var norm = groupNormalizeRoom(room, TextEnc);
      var parts = groupParseEnvelope(envelope);
      if (!norm || !parts) return Promise.resolve({ ok: false, reason: "undecryptable" });
      var entry = rooms.get(norm);
      var key = entry && entry.keys.get(parts.epoch);
      if (!key) return Promise.resolve({ ok: false, reason: "session-not-provisioned" });
      var aad = groupAad(norm, parts.epoch, TextEnc);
      return subtle.decrypt({ name: "AES-GCM", iv: parts.nonce, additionalData: aad }, key, parts.ct).then(function (pt) {
        return { ok: true, plaintext: new TextDec().decode(pt) };
      }).catch(function () { return { ok: false, reason: "undecryptable" }; });
    }

    return {
      provisionRoomKey: provisionRoomKey,
      sealRoomMessage: sealRoomMessage,
      openRoomMessage: openRoomMessage
    };
  }

  function wireRoom(app, roomCrypto) {
    app.ports.roomSealRequest.subscribe(function (req) {
      roomCrypto.sealRoomMessage(req.room, req.plaintext).then(function (outcome) {
        // Unprovisioned rooms and seal failures yield no ciphertext:
        // the App drops the pending seal instead of downgrading. A room
        // with no session at all carries the no-bridge copy downstream.
        if (outcome.ok) {
          app.ports.roomSealed.send({ room: req.room, envelope: outcome.envelope });
        } else {
          app.ports.roomSealFailed.send({
            room: req.room,
            recoveryRequired: outcome.reason === "recovery-required",
            notProvisioned: outcome.reason === "session-not-provisioned"
          });
        }
      });
    });

    app.ports.roomOpenRequest.subscribe(function (req) {
      roomCrypto.openRoomMessage(req.room, req.envelope).then(function (outcome) {
        if (outcome.ok) {
          app.ports.roomOpened.send({
            room: req.room,
            messageId: req.messageId,
            envelope: req.envelope,
            plaintext: outcome.plaintext
          });
        } else {
          app.ports.roomOpenFailed.send({ room: req.room, messageId: req.messageId, envelope: req.envelope });
        }
      });
    });
  }

  /* ── ODD1 group device-directory derivation ──────────────────────────
     Strict structural re-decode (canonical base64url, magic, suite,
     nonzero signer, full P-256 curve equation via BigInt — self-contained
     like the oracle, never trusting a WebCrypto import to reject a bad
     point) plus the SHA-256 `ogc1-…` device-id derivation. A row is
     trusted only when the derived id equals the advertised device id.
     Every request resolves; failures are per-row closed verdicts. */
  var GROUP_DIR_MAGIC = [0x4f, 0x44, 0x44, 0x31]; // "ODD1"
  var GROUP_DIR_SUITE = 1;
  var GROUP_DIR_ID_DOMAIN = "ONYX-OGC1-DEVICE-ID-v1";
  var GROUP_DIR_MAX_ROWS = 64;
  var P256_P = BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff");
  var P256_B = BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b");

  function createGroupDirectory(deps) {
    deps = deps || {};
    var subtle = deps.subtle || (global.crypto && global.crypto.subtle) || null;
    var TextEnc = deps.TextEncoder || global.TextEncoder;

    function bytesToBigInt(bytes) {
      var hex = "";
      for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
      return BigInt("0x" + hex);
    }

    function modP256(value) {
      var reduced = value % P256_P;
      return reduced < 0n ? reduced + P256_P : reduced;
    }

    function isValidP256(point) {
      if (!(point instanceof Uint8Array) || point.length !== 65 || point[0] !== 0x04) return false;
      var x = bytesToBigInt(point.slice(1, 33));
      var y = bytesToBigInt(point.slice(33, 65));
      if (x >= P256_P || y >= P256_P) return false;
      return modP256(y * y) === modP256(x * x * x - 3n * x + P256_B);
    }

    function decodeOdd1(publicKeyB64) {
      if (typeof publicKeyB64 !== "string" || publicKeyB64.length === 0) return null;
      var raw = e2eeFromB64url(publicKeyB64);
      if (!raw || e2eeToB64url(raw) !== publicKeyB64 || raw.length !== 102) return null;
      for (var m = 0; m < 4; m++) {
        if (raw[m] !== GROUP_DIR_MAGIC[m]) return null;
      }
      if (raw[4] !== GROUP_DIR_SUITE) return null;
      var signerPub = raw.slice(5, 37);
      var nonzero = false;
      for (var s = 0; s < signerPub.length; s++) nonzero = nonzero || signerPub[s] !== 0;
      if (!nonzero) return null;
      var encryptionPub = raw.slice(37, 102);
      if (!isValidP256(encryptionPub)) return null;
      return { signerPub: signerPub, encryptionPub: encryptionPub, raw: raw };
    }

    function deriveDeviceId(raw) {
      if (!subtle || !TextEnc) return Promise.resolve(null);
      try {
        var domain = new TextEnc().encode(GROUP_DIR_ID_DOMAIN);
        var material = new Uint8Array(domain.length + 1 + raw.length);
        material.set(domain, 0);
        material[domain.length] = 0;
        material.set(raw, domain.length + 1);
        return subtle.digest("SHA-256", material.slice().buffer).then(function (digest) {
          return "ogc1-" + e2eeToB64url(new Uint8Array(digest)).slice(0, 22);
        }).catch(function () { return null; });
      } catch (err) {
        return Promise.resolve(null);
      }
    }

    function deriveRow(row) {
      var deviceId = row && typeof row.deviceId === "string" ? row.deviceId : "";
      var decoded = decodeOdd1(row && row.publicKey);
      if (!decoded) {
        return Promise.resolve({ deviceId: deviceId, directoryKey: null, derivedId: null, trusted: false });
      }
      var directoryKey = e2eeToB64url(decoded.signerPub);
      return deriveDeviceId(decoded.raw).then(function (derivedId) {
        return {
          deviceId: deviceId,
          directoryKey: directoryKey,
          derivedId: derivedId,
          trusted: derivedId !== null && derivedId === deviceId
        };
      });
    }

    function deriveSnapshot(req) {
      var account = req && typeof req.account === "string" ? req.account : "";
      var rows = req && Array.isArray(req.rows) ? req.rows.slice(0, GROUP_DIR_MAX_ROWS + 1) : [];
      if (rows.length > GROUP_DIR_MAX_ROWS) {
        return Promise.resolve({ account: account, rows: [] });
      }
      var out = [];
      var chain = Promise.resolve();
      rows.forEach(function (row) {
        chain = chain.then(function () {
          return deriveRow(row).then(function (verdict) { out.push(verdict); });
        });
      });
      return chain.then(function () {
        return { account: account, rows: out };
      }).catch(function () {
        return { account: account, rows: [] };
      });
    }

    return {
      isValidP256: isValidP256,
      decodeOdd1: decodeOdd1,
      deriveDeviceId: deriveDeviceId,
      deriveSnapshot: deriveSnapshot
    };
  }

  function wireGroupDirectory(app, directory) {
    app.ports.groupDirectoryDerive.subscribe(function (req) {
      directory.deriveSnapshot(req).then(function (verdicts) {
        app.ports.groupDirectoryDerived.send(verdicts);
      });
    });
  }

  /* ── OGC1 control-record signature verification (Ed25519) ──────────
     Elm owns parsing, routing policy, and room projection; this factory
     only checks the cryptographic binding: structural OGC1 parse, exact
     transcript rebuild, Ed25519 verify. Legacy v1 envelopes never verify.
     Every request yields exactly one verdict; failures are closed. */
  var GROUP_CONTROL_MAGIC = [0x4f, 0x47, 0x43, 0x31]; // "OGC1"
  var GROUP_CONTROL_VERSION = 2;
  var GROUP_CONTROL_DOMAIN = "ONYX-GROUP-CONTROL-v2";
  var GROUP_CONTROL_MAX_WIRE = 4096;
  var GROUP_CONTROL_MAX_BODY = 2048;
  var GROUP_CONTROL_KINDS = { "key-package": 1, "welcome": 2, "commit": 3 };

  /* First-use signer pins, mirroring trustedGroupSignerStore: scoped
     IDB rows with deletion tombstones, serialized per owner so
     concurrent first-use writes cannot race. Pins are only ever read
     or written after a valid signature (anti-poisoning). */
  var GROUP_SIGNER_PINS_DB = "onyx-trusted-group-signers";
  var GROUP_SIGNER_PINS_STORE = "pins";

  function createSignerPins(deps) {
    deps = deps || {};
    var store = deps.pinStore || idbKV(GROUP_SIGNER_PINS_DB, GROUP_SIGNER_PINS_STORE);
    var lanes = {};

    function ownerKey(endpoint, localAccount, account, deviceId) {
      return [endpoint, localAccount, account, deviceId].join("\u0000");
    }

    function canonicalSigner(value) {
      if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
      var raw = e2eeFromB64url(value);
      return raw && raw.length === 32 && e2eeToB64url(raw) === value ? value : null;
    }

    function withLane(owner, work) {
      var previous = lanes[owner] || Promise.resolve();
      var release;
      var gate = new Promise(function (resolve) { release = resolve; });
      var current = previous.then(function () { return gate; }, function () { return gate; });
      lanes[owner] = current;
      return previous.catch(function () {}).then(work).then(function (result) {
        release();
        if (lanes[owner] === current) delete lanes[owner];
        return result;
      }, function (err) {
        release();
        if (lanes[owner] === current) delete lanes[owner];
        throw err;
      });
    }

    function readPin(owner) {
      return store.get(owner).then(function (raw) {
        if (raw === null || raw === undefined) return null;
        var row = typeof raw === "string" ? null : raw;
        if (!row || row.v !== 1 || typeof row.deleted !== "boolean") return "corrupt";
        if (row.deleted) return { deleted: true };
        if (typeof row.signer !== "string" || canonicalSigner(row.signer) !== row.signer) return "corrupt";
        return { deleted: false, signer: row.signer };
      });
    }

    /* Resolve after a VERIFIED signature. Never called otherwise. */
    function resolveTrust(scope, account, deviceId, signerB64) {
      var endpoint = typeof scope.endpoint === "string" ? scope.endpoint : "";
      var localAccount = typeof scope.localAccount === "string" ? scope.localAccount.trim().toLowerCase() : "";
      if (!localAccount) return Promise.resolve("store-unavailable");
      var owner = ownerKey(endpoint, localAccount, account, deviceId);
      return withLane(owner, function () {
        return readPin(owner).then(function (pin) {
          if (pin === "corrupt") return "store-unavailable";
          if (pin && pin.deleted) return "device-absent";
          if (pin) {
            return pin.signer === signerB64 ? "pinned" : "key-changed";
          }
          return store.set(owner, { v: 1, signer: signerB64, deleted: false }).then(function (ok) {
            return ok === false ? "store-unavailable" : "first-use";
          }).catch(function () { return "store-unavailable"; });
        }).catch(function () { return "store-unavailable"; });
      });
    }

    function forgetSigner(scope, account, deviceId) {
      var endpoint = scope && typeof scope.endpoint === "string" ? scope.endpoint : "";
      var localAccount = scope && typeof scope.localAccount === "string" ? scope.localAccount.trim().toLowerCase() : "";
      if (!localAccount) return Promise.resolve(false);
      var owner = ownerKey(endpoint, localAccount, account, deviceId);
      return withLane(owner, function () {
        return readPin(owner).then(function (pin) {
          var signer = pin && pin !== "corrupt" && !pin.deleted ? pin.signer : "";
          return store.set(owner, { v: 1, signer: signer, deleted: true }).then(function (ok) { return ok !== false; });
        });
      }).catch(function () { return false; });
    }

    return {
      resolveTrust: resolveTrust,
      forgetSigner: forgetSigner
    };
  }

  function createGroupControlVerify(deps) {
    deps = deps || {};
    var subtle = deps.subtle || (global.crypto && global.crypto.subtle) || null;
    var TextEnc = deps.TextEncoder || global.TextEncoder;
    var pins = createSignerPins(deps);

    function usable() {
      return !!subtle && !!TextEnc;
    }

    function parseOgc1(payloadB64) {
      if (typeof payloadB64 !== "string" || payloadB64.length === 0 || payloadB64.length > GROUP_CONTROL_MAX_WIRE) return null;
      var raw = e2eeFromB64url(payloadB64);
      if (!raw || e2eeToB64url(raw) !== payloadB64) return null;
      if (raw.length < 108) return null;
      for (var m = 0; m < 4; m++) {
        if (raw[m] !== GROUP_CONTROL_MAGIC[m]) return null;
      }
      if (raw[4] !== GROUP_CONTROL_VERSION) return null;
      var kind = raw[5];
      if (kind !== 1 && kind !== 2 && kind !== 3) return null;
      var epoch = ((raw[6] * 256 + raw[7]) * 256 + raw[8]) * 256 + raw[9];
      var bodyLen = raw[10] * 256 + raw[11];
      if (bodyLen === 0 || bodyLen > GROUP_CONTROL_MAX_BODY) return null;
      if (raw.length !== 108 + bodyLen) return null;
      return {
        kind: kind,
        epoch: epoch >>> 0,
        body: raw.slice(12, 12 + bodyLen),
        signerPub: raw.slice(12 + bodyLen, 12 + bodyLen + 32),
        signature: raw.slice(12 + bodyLen + 32, 12 + bodyLen + 32 + 64)
      };
    }

    function utf8Bytes(text) {
      return new TextEnc().encode(text);
    }

    /* Exact mirror of GroupControl.buildGroupControlTranscript. */
    function transcriptBytes(routing, parts) {
      var domain = utf8Bytes(GROUP_CONTROL_DOMAIN);
      var channel = utf8Bytes(routing.channel);
      var fromAccount = utf8Bytes(routing.fromAccount);
      var fromDevice = utf8Bytes(routing.fromDevice);
      var toAccount = utf8Bytes(routing.toAccount);
      var toDevice = utf8Bytes(routing.toDevice);
      var fields = [channel, fromAccount, fromDevice, toAccount, toDevice];
      for (var i = 0; i < fields.length; i++) {
        if (fields[i].length > 255) return null;
      }
      var out = new Uint8Array(
        domain.length + 1 + 1 + fromAccount.length + 1 + channel.length + 1 +
        1 + fromDevice.length + 1 + toAccount.length + 1 + toDevice.length +
        1 + 4 + 2 + parts.body.length + parts.signerPub.length
      );
      var o = 0;
      out.set(domain, o); o += domain.length;
      out[o++] = 0;
      out[o++] = fromAccount.length; out.set(fromAccount, o); o += fromAccount.length;
      out[o++] = channel.length; out.set(channel, o); o += channel.length;
      out[o++] = parts.kind;
      out[o++] = fromDevice.length; out.set(fromDevice, o); o += fromDevice.length;
      out[o++] = toAccount.length; out.set(toAccount, o); o += toAccount.length;
      out[o++] = toDevice.length; out.set(toDevice, o); o += toDevice.length;
      out[o++] = GROUP_CONTROL_VERSION;
      out[o++] = (parts.epoch >>> 24) & 0xff; out[o++] = (parts.epoch >>> 16) & 0xff;
      out[o++] = (parts.epoch >>> 8) & 0xff; out[o++] = parts.epoch & 0xff;
      out[o++] = (parts.body.length >>> 8) & 0xff; out[o++] = parts.body.length & 0xff;
      out.set(parts.body, o); o += parts.body.length;
      out.set(parts.signerPub, o);
      return out;
    }

    function closed(req) {
      return {
        channel: req.channel,
        epoch: req.epoch,
        signerB64: req.signerB64,
        fromAccount: req.fromAccount,
        fromDevice: req.fromDevice,
        toAccount: req.toAccount == null ? null : String(req.toAccount),
        toDevice: req.toDevice == null ? null : String(req.toDevice),
        kind: req.kind,
        payload: req.payload,
        signatureValid: false,
        trust: "unverified"
      };
    }

    function verifyDelivery(req) {
      if (!usable()) return Promise.resolve(closed(req));
      var parts = parseOgc1(req.payload);
      if (!parts) return Promise.resolve(closed(req));
      if (GROUP_CONTROL_KINDS[req.kind] !== parts.kind) return Promise.resolve(closed(req));
      if ((req.epoch >>> 0) !== parts.epoch) return Promise.resolve(closed(req));
      var signerB64 = e2eeToB64url(parts.signerPub);
      if (signerB64 !== req.signerB64) return Promise.resolve(closed(req));
      var transcript = transcriptBytes({
        channel: String(req.channel).trim().toLowerCase(),
        fromAccount: String(req.fromAccount).trim().toLowerCase(),
        fromDevice: String(req.fromDevice),
        toAccount: req.toAccount == null ? "" : String(req.toAccount),
        toDevice: req.toDevice == null ? "" : String(req.toDevice)
      }, parts);
      if (!transcript) return Promise.resolve(closed(req));
      var response = {
        channel: req.channel,
        epoch: req.epoch,
        signerB64: signerB64,
        fromAccount: req.fromAccount,
        fromDevice: req.fromDevice,
        toAccount: req.toAccount == null ? null : String(req.toAccount),
        toDevice: req.toDevice == null ? null : String(req.toDevice),
        kind: req.kind,
        payload: req.payload,
        signatureValid: false,
        trust: "unverified"
      };
      return subtle.importKey("raw", parts.signerPub, { name: "Ed25519" }, false, ["verify"]).then(function (key) {
        return subtle.verify({ name: "Ed25519" }, key, parts.signature, transcript);
      }).then(function (ok) {
        if (ok !== true) return response;
        response.signatureValid = true;
        // Pins resolve only after a valid signature, so a forged
        // record can never poison first use.
        return pins.resolveTrust(
          { endpoint: req.endpoint, localAccount: req.localAccount },
          String(req.fromAccount).trim().toLowerCase(),
          String(req.fromDevice),
          signerB64
        ).then(function (trust) {
          response.trust = trust;
          return response;
        }).catch(function () {
          response.trust = "store-unavailable";
          return response;
        });
      }).catch(function () { return response; });
    }

    return {
      parseOgc1: parseOgc1,
      verifyDelivery: verifyDelivery,
      resolveTrust: pins.resolveTrust,
      forgetSigner: pins.forgetSigner
    };
  }

  function wireGroupControl(app, groupControl) {
    app.ports.groupControlInstall.subscribe(function (req) {
      groupControl.verifyDelivery(req).then(function (verdict) {
        app.ports.groupControlVerified.send(verdict);
      });
    });
  }

  function wireE2ee(app, e2ee, sendLine) {
    app.ports.dmSealRequest.subscribe(function (req) {
      e2ee.sealToDevices(req.target, req.keys, req.plaintext, req.owner).then(function (outcome) {
        // A seal-time key change flags the peer with no toast (the App
        // drops the pending seal like the oracle flag-only path).
        // Genuine seal failures surface so the App can toast instead of
        // leaving a silently unsent message.
        if (outcome.status === "sealed") {
          app.ports.dmSealed.send({ target: req.target, envelope: outcome.envelope, schedId: req.schedId === undefined ? null : req.schedId });
        } else {
          if (app.ports.dmSealFailed) {
            try { app.ports.dmSealFailed.send({ target: req.target, keyChanged: outcome.status === "key-changed", schedId: req.schedId === undefined ? null : req.schedId }); } catch (err) { /* port gone */ }
          }
        }
      });
    });

    app.ports.dmOpenRequest.subscribe(function (req) {
      // The presented key travels with the request from Elm's live
      // directory. Trust is still verified against the pin store
      // inside openFrom, so a rotated key fails locked, never open.
      if (!req.presentedKey) return;
      e2ee.openFrom(req.peer, req.presentedKey, req.envelope, req.owner).then(function (outcome) {
        if (outcome.status === "opened") {
          app.ports.dmOpened.send({
            peer: req.peer,
            messageId: req.messageId,
            envelope: req.envelope,
            plaintext: outcome.plaintext
          });
        } else {
          app.ports.dmOpenFailed.send({
            peer: req.peer,
            messageId: req.messageId,
            keyChanged: outcome.reason === "key-changed"
          });
        }
      });
    });

    app.ports.dmPublishKey.subscribe(function () {
      e2ee.publishKeys(sendLine);
    });
    /* Manual "publish this device key" (Account panel): resolve the
       registry id + public point for `E2EEKEY ADD`. Any failure
       (unreadable store, missing crypto, bad key) reports empty legs
       and Elm stays silent — mirroring `publishThisDeviceKey`. */
    if (app.ports.e2eeDeviceIdentityRequest) {
      app.ports.e2eeDeviceIdentityRequest.subscribe(function () {
        function failed() {
          try { app.ports.e2eeDeviceIdentity.send({ deviceId: "", publicKey: "" }); } catch (err) { /* port gone */ }
        }
        try {
          e2ee.devicePublicB64().then(function (pub) {
            if (!pub) { failed(); return; }
            e2ee.registryId(pub).then(function (id) {
              if (!id) { failed(); return; }
              try { app.ports.e2eeDeviceIdentity.send({ deviceId: id, publicKey: pub }); } catch (err) { /* port gone */ }
            }).catch(failed);
          }).catch(failed);
        } catch (err) { failed(); }
      });
    }
  }

  global.OnyxPorts = {
    vaultStore: {
      put: vaultPut,
      get: vaultGet,
      getAround: vaultGetAround,
      search: vaultSearch,
      searchMode: vaultSearchMode,
      searchRows: vaultSearchRows,
      searchRowsSemantic: vaultSearchRowsSemantic,
      searchRowsHybrid: vaultSearchRowsHybrid,
      tokenize: vaultTokenize,
      embed: vaultEmbed,
      cosine: vaultCosine,
      rankBySimilarity: vaultRankBySimilarity,
      reciprocalRankFusion: vaultReciprocalRankFusion,
      boostedScore: vaultBoostedScore,
      hitAgeMs: vaultHitAgeMs,
      embeddingDim: EMBEDDING_DIM,
      rrfK: RRF_K,
      vaultBoosts: VAULT_BOOSTS,
      exportAll: vaultExportAll,
      aroundWindow: vaultAroundWindow,
      classifyDmRows: classifyVaultDmRows,
      dmPrivacyRowEncrypted: vaultDmPrivacyRowEncrypted,
      dmPrivacyInvalidate: vaultDmPrivacyInvalidate,
      exportSnapshot: vaultExportSnapshot,
      plainRow: vaultPlainRow,
      retentionPolicy: readRetentionPolicy,
      sanitizeRetentionPolicy: sanitizeRetentionPolicy,
      retentionEffectiveKeep: retentionEffectiveKeep,
      selectPruneIds: selectPruneIds,
      retentionPolicyKey: RETENTION_POLICY_KEY,
      retentionMaxKeep: RETENTION_MAX_KEEP,
      retentionMaxAgeDays: RETENTION_MAX_AGE_DAYS,
      vaultKeep: VAULT_KEEP
    },
    outboxStore: {
      isOutboxTarget: isOutboxTarget,
      plainEntry: outboxPlainEntry,
      flushPlan: outboxFlushPlan,
      flush: outboxFlush,
      maxEntries: OUTBOX_MAX_ENTRIES,
      maxAgeMs: OUTBOX_MAX_AGE_MS
    },
    pingKeepalive: {
      create: createPingKeepalive,
      idleMs: PING_IDLE_MS,
      timeoutMs: PONG_TIMEOUT_MS
    },
    nodeProbe: {
      selectBest: selectBestNode,
      ping: pingNode,
      pickFastest: pickFastestNode,
      random: randomNode,
      timeoutMs: NODES_PROBE_TIMEOUT_MS,
      maxConcurrency: NODES_MAX_CONCURRENCY
    },
    uploadBridge: {
      send: uploadSendFile,
      preview: previewGet,
      maxBytes: UPLOAD_BRIDGE_MAX_BYTES
    },
    publicFeed: {
      fetch: fetchPublicFeed,
      maxBytes: PUBLIC_FEED_MAX_BYTES,
      timeoutMs: PUBLIC_FEED_TIMEOUT_MS
    },
    clipboard: {
      copy: copyTextToClipboard,
      legacyCopy: legacyCopyText
    },
    resumeCredentials: {
      slotKey: credentialSlotKey,
      validToken: validResumeToken,
      store: storeResumeToken,
      load: loadResumeTokens,
      clear: clearResumeTokens,
      reclaimConfirmMs: RECLAIM_CONFIRM_MS,
      reclaimDismissMs: RECLAIM_DISMISS_MS,
      key: CRED_KEY,
      maxTokenLength: MAX_RESUME_TOKEN_LENGTH
    },
    sasl: {
      setCredentials: sasl.setCredentials,
      clearCredentials: sasl.clearCredentials,
      plainPayload: sasl.plainPayload,
      scramFirst: sasl.scramFirst,
      scramNext: sasl.scramNext,
      scramFinal: sasl.scramFinal,
      scramVerify: sasl.scramVerify,
      equal: scramEqual,
      timeoutMs: SASL_TIMEOUT_MS,
    },
    savedSearches: savedSearches,
    voiceFeed: {
      blank: voiceFeedBlank,
      next: voiceFeedNext
    },
    wire: wire,
    VAULT_KEEP: VAULT_KEEP,
    createE2ee: createE2ee,
    wireE2ee: wireE2ee,
    createRoomCrypto: createRoomCrypto,
    wireRoom: wireRoom,
    createGroupControlVerify: createGroupControlVerify,
    wireGroupControl: wireGroupControl,
    createGroupDirectory: createGroupDirectory,
    wireGroupDirectory: wireGroupDirectory,
    createGroupPublisherIdentity: createGroupPublisherIdentity,
    wireGroupPublisher: wireGroupPublisher,
    createAttributionIdentity: createAttributionIdentity,
    wireAttribution: wireAttribution,
    createWebPush: createWebPush,
    wireWebPush: wireWebPush,
    createMediaBinary: createMediaBinary,
    wireMediaBinary: wireMediaBinary,
    mediaReceiveRaw: mediaReceiveRaw,
    mediaMaxBinaryBytes: MEDIA_MAX_BINARY_BYTES,
    createGroupWelcome: createGroupWelcome,
    wireGroupWelcome: wireGroupWelcome,
    memKV: memKV
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports.OnyxPorts = global.OnyxPorts;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
