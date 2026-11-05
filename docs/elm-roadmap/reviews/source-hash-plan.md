# E02/E03 review source hash plan

E02 and E03 have independent bounded package reviews attached in
`acceptance-ledger.json`. Their source artifacts are stable, source-backed
contract/planning files; the manifest and evidence copies record the closure
and receipts used by the review. These reviews do not accept M0, T scenarios,
runtime crypto, durable denial, cohorts, measured performance, or release.
E04 remains pending a current expected-failure run because E01 catalog and
consumer sources changed after the historical mutant demonstration.

## E02

Bound source artifacts:

- `docs/elm-roadmap/contracts.md` (revision 4)
- `tools/check-server-contract-v2.mjs`
- `docs/protocol/onyx-client-contract.v2.json`

All three hashes are recorded in `reviews/E02.json` and matched the frozen
source manifest reviewed for that package. The server checker and machine
contract copies under `evidence/` preserve the other-repository bytes
referenced by candidate 7; they are evidence copies, not current repository
source paths.

Evidence copies in `evidence/` retain the candidate-6 client/server logs and
candidate-7 two-validator concordance receipt. They support only the bounded
contract correction/concordance review.

## E03

Bound source artifact:

- `docs/elm-roadmap/support-matrix.md`

Its hash is recorded in `reviews/E03.json` and matched the frozen source
manifest reviewed for that package. The evidence copies retain the reviewed
planning text. The review accepts only written support/cohort/unsupported-case
and proposed-budget decisions; it does not accept browser cohort observations
or E90 performance claims.

## E04

Keep E04 pending. Its earlier expected-failure log/receipt is historical after
E01 catalog and consumer changes. Add a review only after a current known-good
run plus exact mutated-assertion demonstration.
