# Elm performance measurement method

This note describes the versioned heap observation used by the bounded Elm
measurement harness. It records measurement semantics; it does not change the
roadmap acceptance ledger or establish that any target has passed.

## Active-page post-GC heap series

The measurement receipt identifies this method as
`elm-active-page-post-gc-v3` in `measurementMethodologyVersion`; each lane also
records `heapMeasurementMethodologyVersion`. Version 3 adds a persistence
settlement barrier before each heap sample; its receipts are not directly
comparable with version 2. The raw diagnostic field
`last3EqualWorkloadHeapGrowthPercent` retains its prior non-collecting
`JSHeapUsedSize` semantics. It is reported for context and is not the retained
heap acceptance metric.

After each equal replay cycle settles and its final loaded row is observed, the
harness waits for the current owner's latest `vaultPut` snapshot for the active
target that contains `evt-<cycle>-999`. It records the snapshot row count and
result count without retaining message bodies, and requires the returned write
status to be `ready`, the affected count to be positive, all tracked writes for
that exact runtime owner and target to settle, and the marker row to be present
in the owned owner/target index with no more than 400 durable rows. The runtime
write promise covers every candidate in that snapshot; the marker lookup alone
is not treated as a drain signal. A test-only facade observes the existing
public runtime promise for each call; it adds no production status API and
retains no message bodies. Target writes run through one serial pump, so
settlement of the final snapshot after earlier work drains, together with zero
pending calls for that exact owner/target, establishes the measurement boundary
for the target. A separate 10,000 ms persistence guard fails the lane if that
boundary is not reached. The existing UI cohort guard remains 10,000 ms, and
the lane watchdog remains 600,000 ms. A host-side 15,000 ms evaluation watchdog
leaves five seconds to return the page-side timeout evidence and also bounds
the owned-row lookup.

The elapsed and long-task observations include the persistence settlement
work. Only after the full persistence criterion succeeds does the harness wait
for two animation frames, request CDP garbage collection while the application
remains on the active page, and record the resulting used heap as
`activePagePostGcHeapUsedBytes`. The five cycle samples belong to the same
active-page workload. The retained series is
`lastThreeCycleActivePostGcHeapGrowthPercent`, calculated from cycles 3 and 5
only when all five post-GC samples are present and valid. Missing collection or
samples produce an unavailable metric and an open threshold failure; a
persistence timeout fails before garbage collection and cannot produce a
partial-snapshot heap sample. Missing values are never replaced with zero or
treated as a pass. A separate collection after navigating away is a cleanup
diagnostic, not part of the active-page series.

The runner compares paired candidate and baseline receipts only when their
`measurementMethodologyVersion` values match. Historical raw-only receipts
cannot serve as a post-GC heap baseline.

## Operational guards and proposed targets

For the measurement suite, `laneOperationalTimeoutMs` is 600,000 ms per lane
and `ingestionCohortAssertionTimeoutMs` is 10,000 ms per cohort. These are
operational watchdogs for completing setup and observations, not performance
budgets.

The harness records the proposed numerical targets: input-latency p95 at or
below 100 ms for desktop and 200 ms for CPU-throttled mobile viewport
emulation; no ingest long task above 200 ms; and at most 10% active-page
post-GC heap growth from cycle 3 to cycle 5. The 200 ms viewport-emulation
observation is not a physical low-end mobile-device result. The separate
roadmap proposal requires a declared device and a recorded, approved baseline.

These targets remain proposed until the workload, browser, hardware, warm-up,
sampling method, and baseline are recorded and approved. This method note does
not promote an acceptance item or make a performance pass claim.

## Source

- [Receipt and comparison metadata](../../elm/tools/perf/run.mjs)
- [Browser measurement and per-cycle sampling](../../tests/e2e/elm-performance.measure.spec.ts)
