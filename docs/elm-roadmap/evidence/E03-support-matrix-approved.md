# Browser, tab, credential, and performance support

These are the architect-approved M0 decisions. A target cohort is not a
supported cohort until a source-bound acceptance receipt records its actual
browser/OS/device, relevant permissions, network, test result, and limits.

| Cohort | Target | Current evidence | Status |
|---|---|---|---|
| Chromium desktop | Required | Mocked Chromium Playwright run observed: 16 passed, 4 failed on stale connection-dialog selectors. | Pending; partial observation only |
| Firefox desktop | Required | No receipt recorded. | Pending |
| Safari desktop | Required | No receipt recorded. | Pending |
| iOS installed web app | Required | No receipt recorded. | Pending |
| iOS ordinary browser tab | Required | No receipt recorded. | Pending |
| Android browser | Required | No receipt recorded. | Pending |

Unavailable optional browser APIs must be exercised as unavailable and produce
the documented fallback; API presence or a mocked implementation does not
establish platform support. Do not infer a mobile or installed-app result from
desktop Chromium.

## Tab and credential decision

The intended model is independent, intentional attachments. Do not replay the
same exact bearer from concurrent tabs. A newly opened tab defaults to an
explicit fresh attachment. There is no implicit cross-tab leader/shared-socket
policy. E23 still owns browser-side attachment enforcement, independent AID
behavior, and local LIST/DROP safety; those behaviors are unproven until their
tests and browser receipts exist. This decision does not assert that current
token custody or account rotation already prevents concurrent reuse.

Credentials must be treated as secret authority, not ordinary UI state. The
roadmap requires no credential in the UI model, cache export, log, or URL;
storage denial must retain only transient authority and accurately report
nonremembered state. Those requirements remain acceptance-pending under E21
and E22. Fixture credentials are synthetic and explicitly never issued.

## Proposed performance budgets (not accepted)

| Measure | Proposed target | Status |
|---|---:|---|
| Input-to-paint p95 | ≤100 ms desktop; ≤200 ms on a declared low-end mobile device | Proposed; baseline not measured |
| Ingest long task | No task >200 ms | Proposed; not measured |
| Replay heap plateau | ≤10% growth across the last 3 of repeated equal replay cycles | Proposed; not measured |
| Replay workload | 50 rooms, 100k disk rows, 500–1000 loaded active rows | Proposed fixture; not established |
| Memory ceiling | Set only after a recorded baseline on declared hardware | Intentionally unset |

Do not report these budgets as pass criteria until the dataset, browser,
hardware, warm-up, sampling method, and baseline are recorded and approved.
