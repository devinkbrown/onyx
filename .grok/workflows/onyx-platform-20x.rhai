let meta = #{
    name: "onyx-platform-20x",
    description: "20x Onyx platform expansion: audit unfinished work, parallel implement slices, verify, gate",
    when_to_use: "When expanding Onyx client/server product surface at scale (20+ slices).",
    phases: [
        #{ title: "Audit", detail: "Map unfinished partials vs already-shipped" },
        #{ title: "Implement", detail: "Parallel client + server product slices" },
        #{ title: "Verify", detail: "Focused tests + typecheck on changed areas" },
        #{ title: "Integrate", detail: "Finish uncommitted work, full gates, deploy SPA" },
    ],
};

// ── schemas ──────────────────────────────────────────────────────────────────
let audit_schema = #{
    "type": "object",
    "required": ["slices"],
    "properties": #{
        "slices": #{
            "type": "array",
            "maxItems": 24,
            "items": #{
                "type": "object",
                "required": ["id", "title", "status", "home", "agent_hint"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "title": #{ "type": "string" },
                    "status": #{ "type": "string" },
                    "home": #{ "type": "string" },
                    "agent_hint": #{ "type": "string" },
                    "notes": #{ "type": "string" },
                },
            },
        },
        "already_partial": #{ "type": "array", "items": #{ "type": "string" } },
        "priority_ids": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

let implement_schema = #{
    "type": "object",
    "required": ["slice_id", "done", "summary", "files_touched", "tests"],
    "properties": #{
        "slice_id": #{ "type": "string" },
        "done": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "files_touched": #{ "type": "array", "items": #{ "type": "string" } },
        "tests": #{ "type": "string" },
        "blocked": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "summary", "failures"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "failures": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

// Optional args: max_implementers (default 16 for 20x backlog), skip_deploy (bool)
let max_impl = 16;
let skip_deploy = false;
if args != () {
    if args.max_implementers != () {
        let n = args.max_implementers;
        if type_of(n) == "i64" || type_of(n) == "f64" {
            if n >= 4 && n <= 20 { max_impl = n; }
        }
    }
    if args.skip_deploy == true { skip_deploy = true; }
}

// ── Phase 1: Audit ───────────────────────────────────────────────────────────
phase("Audit");
log("Auditing Onyx platform for 20x expansion opportunities…");

let audit_prompt = "";
audit_prompt += "You are auditing /home/kain/onyx (SolidJS client, branch onyx-solid) and optionally ";
audit_prompt += "/home/kain/onyx-server for a 20x product expansion wave.\n\n";
audit_prompt += "READ-ONLY. Use read_file, grep, list_dir, and bash git/status only.\n\n";
audit_prompt += "Known in-progress uncommitted partials (must note):\n";
audit_prompt += "- src/lib/preview/linkPreview.ts (mayUnfurlUrl integration)\n";
audit_prompt += "- src/lib/vault/searchVaultHybrid.ts (recency boost — fix hit.message.time)\n";
audit_prompt += "- src/lib/prefs/preferences.ts (reactionDensity)\n";
audit_prompt += "- src/shell/BoostBar.tsx (density modes)\n";
audit_prompt += "- src/lib/keyboard/shortcutsRegistry.ts (expanded chords)\n\n";
audit_prompt += "Also inventory foundations that exist as pure modules but lack UI/store wire:\n";
audit_prompt += "groupEnvelope, rankingBoost, editHistory, scheduledSend, capabilityMatrix, ";
audit_prompt += "padlockHonesty/sfuCascade, webhookBlockKit, portable identity, smart mute, ";
audit_prompt += "channel folders/stars, multi-device E2EE, Oper EVENT REPLAY.\n\n";
audit_prompt += "Return up to 24 slices with status one of: READY (implement now), PARTIAL ";
audit_prompt += "(narrow gap), SHIPPED (skip), BLOCKED (needs design).\n";
audit_prompt += "priority_ids: ordered list of up to 16 READY/PARTIAL ids to implement this wave.\n";
audit_prompt += "agent_hint: solidjs-coder | onyx-store | onyx-crypto | onyx-notify | onyx-render | ";
audit_prompt += "onyx-cmdk | zig-coder | general-purpose.\n";
audit_prompt += "Do NOT invent files — cite real paths from the tree.";

let audit = agent(audit_prompt, #{
    label: "audit-20x",
    capability_mode: "read-only",
    agent_type: "explore",
    output_schema: audit_schema,
});

// Fail soft: a missing/empty audit still runs the built-in backlog so the wave
// never hard-stops on a flaky explore agent. Only pause when the host itself
// returns a hard failure with no usable structure.
let slices_meta = ();
let priority = [];
if audit != () && audit.success && audit.output != () {
    if audit.output.slices != () {
        slices_meta = audit.output.slices;
    }
    if audit.output.priority_ids != () {
        for id in audit.output.priority_ids {
            priority.push(id);
        }
    }
} else {
    log("Audit agent unusable — continuing with built-in backlog");
}

// Fallback fixed backlog if audit returned empty priority
if priority.len() == 0 {
    priority = [
        "unfurl-privacy",
        "search-boost-fix",
        "reaction-density",
        "group-e2ee-failclosed",
        "edit-history",
        "slash-clear-search",
        "dm-multidevice-ui",
        "scheduled-queue-ui",
        "guest-upgrade",
        "notify-summary",
        "webhook-blockkit",
        "room-accent",
        "read-marker-chip",
        "shortcuts-wire",
        "caps-status",
        "ledger-docs",
        "media-cascade-real",
        "portable-prefs",
        "cold-vault-toast",
        "multi-device-metadata",
    ];
    log("Using built-in 20-slice 20x backlog");
}

// Cap implementers
let work = [];
let i = 0;
for id in priority {
    if i >= max_impl { break; }
    work.push(id);
    i += 1;
}
log("Implementing " + work.len().to_string() + " slices this wave");

// Build a lookup of slice metadata from audit when available
fn slice_title(slices, id) {
    if slices == () { return id; }
    for s in slices {
        if s.id == id { return s.title; }
    }
    id
}
fn slice_home(slices, id) {
    if slices == () { return "/home/kain/onyx"; }
    for s in slices {
        if s.id == id { return s.home; }
    }
    "/home/kain/onyx"
}
fn slice_hint(slices, id) {
    if slices == () { return "general-purpose"; }
    for s in slices {
        if s.id == id { return s.agent_hint; }
    }
    "general-purpose"
}

// ── Phase 2: Implement (parallel, worktree-isolated) ─────────────────────────
phase("Implement");

let jobs = [];
for id in work {
    let title = slice_title(slices_meta, id);
    let home = slice_home(slices_meta, id);
    let hint = slice_hint(slices_meta, id);

    let p = "";
    p += "IMPLEMENT Onyx platform slice `" + id + "`: " + title + "\n\n";
    p += "Repo roots: /home/kain/onyx (client, pnpm) and /home/kain/onyx-server (Zig) when needed.\n";
    p += "Home hint from audit: " + home + "\n";
    p += "Preferred specialist: " + hint + "\n\n";
    p += "RULES:\n";
    p += "1. Read LIVE code first (grep/read_file). Prefer wiring EXISTING modules over rewrites.\n";
    p += "2. Onyx Server product name only — never orochi/legacy codenames in user-facing text.\n";
    p += "3. SolidJS: never destructure props; immutable store updates; onCleanup discipline.\n";
    p += "4. Security: fail closed on E2EE/unfurl/hostile input; no plaintext fallback for E2EE DMs.\n";
    p += "5. Tests first or with implementation for pure modules; extend existing *.test.ts when possible.\n";
    p += "6. Stay inside this slice's files. Do not rewrite roadmaps wholesale.\n";
    p += "7. Run focused vitest for your files and `pnpm typecheck` if you touch TS.\n";
    p += "8. Do NOT git push or deploy — integrator does that.\n\n";
    p += "KNOWN PARTIALS to finish if your slice matches:\n";
    p += "- searchVaultHybrid boost must use hit.message.time (VaultSearchHit shape)\n";
    p += "- linkPreview isPreviewableUrl should honor preferences().linkPreviews via mayUnfurlUrl\n";
    p += "- BoostBar density via preferences().reactionDensity\n";
    p += "- reactionDensity must parse in preferencesFromRecord + defaults\n";
    p += "- shortcutsRegistry expanded; wire any dead chords only if handlers exist\n\n";
    p += "SLICE CATALOG (implement the matching id):\n";
    p += "- unfurl-privacy: MessageText/linkPreview use mayUnfurlUrl + prefs\n";
    p += "- search-boost-fix: fix hybrid boost time field; keep tests green\n";
    p += "- reaction-density: prefs UI row + BoostBar density modes\n";
    p += "- group-e2ee-failclosed: channel encryption-policy=required refuse plaintext send\n";
    p += "- edit-history: recordEdit on store.editMessage prior body\n";
    p += "- slash-clear-search: /clear local scrollback, /search open MessageSearch\n";
    p += "- dm-multidevice-ui: DmSafetySheet show peerDmDeviceKeys count\n";
    p += "- scheduled-queue-ui: Account or Composer list/cancel scheduledMessages\n";
    p += "- guest-upgrade: stronger Account guest CTA + passkey/register steps\n";
    p += "- notify-summary: NotificationControls show smart-mute keyword count\n";
    p += "- webhook-blockkit: format webhook NOTICE bodies via webhookPayloadToMessage if JSON\n";
    p += "- room-accent: ensure channelColors/roomIdentity applied on active channel\n";
    p += "- read-marker-chip: PresenceRibbon or ribbon chip for last read / mark read\n";
    p += "- shortcuts-wire: ShortcutsOverlay lists new SHORTCUTS entries\n";
    p += "- caps-status: status buffer or Connect shows capabilitySummary\n";
    p += "- ledger-docs: update docs/era3-40-game-changers.md or add era3-20x ledger\n";
    p += "- media-cascade-real: wire sfuCascade from real media room metrics if available\n";
    p += "- portable-prefs: portable identity optionally imports display prefs\n";
    p += "- cold-vault-toast: honest toast when hydrateHistory paints before 001\n";
    p += "- multi-device-metadata: publish ocean.dm-keys multi-directory on publishDeviceKey\n\n";
    p += "Return structured {slice_id, done, summary, files_touched, tests, blocked}.";

    jobs.push(#{
        prompt: p,
        label: "impl:" + id,
        capability_mode: "read-write",
        agent_type: "general-purpose",
        isolation_worktree: true,
        output_schema: implement_schema,
    });
}

let impl_results = parallel(jobs);

let done_ids = [];
let blocked = [];
let files_all = [];
for r in impl_results {
    if r == () || !r.success || r.output == () {
        blocked.push("agent-failed");
    } else {
        if r.output.done == true {
            done_ids.push(r.output.slice_id);
        } else {
            let b = r.output.slice_id;
            if r.output.blocked != () { b += ": " + r.output.blocked; }
            blocked.push(b);
        }
        if r.output.files_touched != () {
            for f in r.output.files_touched { files_all.push(f); }
        }
        log("slice " + r.output.slice_id + " done=" + r.output.done.to_string() + " — " + r.output.summary);
    }
}
log("Implemented " + done_ids.len().to_string() + "/" + work.len().to_string() + " slices");

// ── Phase 3: Verify ──────────────────────────────────────────────────────────
phase("Verify");

let vprompt = "";
vprompt += "VERIFY the Onyx client at /home/kain/onyx after a multi-slice implement wave.\n";
vprompt += "1. Run: cd /home/kain/onyx && pnpm typecheck\n";
vprompt += "2. Run focused vitest on changed areas (e2ee, notifications, vault hybrid, BoostBar, prefs, linkPreview, ChannelSidebar if dirty)\n";
vprompt += "3. Run pnpm lint if quick\n";
vprompt += "4. Report ok=false with concrete failure strings if red; fix ONLY trivial type errors you introduced if under 5 min, else report.\n";
vprompt += "Do not deploy. Do not push.";

let verify = agent(vprompt, #{
    label: "verify-gates",
    capability_mode: "execute",
    agent_type: "general-purpose",
    output_schema: verify_schema,
});

let verify_ok = false;
let verify_summary = "verify agent failed";
let verify_failures = [];
if verify != () && verify.success && verify.output != () {
    verify_ok = verify.output.ok == true;
    verify_summary = verify.output.summary;
    if verify.output.failures != () {
        for f in verify.output.failures { verify_failures.push(f); }
    }
}

if !verify_ok {
    log("Verification red: " + verify_summary + " — integrator will attempt repair");
}

// ── Phase 4: Integrate ───────────────────────────────────────────────────────
phase("Integrate");

let iprompt = "";
iprompt += "INTEGRATE the Onyx 20x wave in /home/kain/onyx (and onyx-server only if you changed it).\n\n";
iprompt += "1. Merge any remaining uncommitted partials (linkPreview, searchVaultHybrid hit.message.time, ";
iprompt += "prefs reactionDensity, BoostBar, shortcutsRegistry) so typecheck is green.\n";
iprompt += "2. Harvest useful worktree outputs if agents left worktrees under .claude/worktrees or similar — ";
iprompt += "only apply clean disjoint diffs; skip conflicts.\n";
iprompt += "3. pnpm typecheck && pnpm lint && focused tests for changed files.\n";
iprompt += "4. Update docs/era3-40-game-changers.md or docs/era3-20x-wave.md with what shipped.\n";
iprompt += "5. Conventional commit on onyx-solid; git push github onyx-solid.\n";
if skip_deploy {
    iprompt += "6. SKIP deploy (args.skip_deploy).\n";
} else {
    iprompt += "6. Run ./deploy.sh for SPA live out/.\n";
}
iprompt += "7. Return a short markdown report of commits, test counts, deploy shell stamp.\n";
iprompt += "Brand: Onyx / Onyx Server only.";

let integrate = agent(iprompt, #{
    label: "integrate-20x",
    capability_mode: "all",
    agent_type: "general-purpose",
});

let report = "# Onyx platform 20x wave\n\n";
report += "- slices attempted: " + work.len().to_string() + "\n";
report += "- slices done (agent-reported): " + done_ids.len().to_string() + "\n";
report += "- verify_ok: " + verify_ok.to_string() + " — " + verify_summary + "\n";
if blocked.len() > 0 {
    report += "- blocked: " + blocked.len().to_string() + "\n";
}
if integrate != () && integrate.success {
    report += "\n## Integrator\n\n";
    report += integrate.output + "\n";
} else {
    report += "\n## Integrator failed or incomplete\n";
}

let path = write_scratch_file("onyx-20x-report.md", report);
complete(#{
    path: path,
    report: report,
    done_count: done_ids.len(),
    attempted: work.len(),
    verify_ok: verify_ok,
});
