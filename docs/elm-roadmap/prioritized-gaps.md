# Prioritized roadmap gaps after E10–E14

This is a planning aid derived from the 53-package integration closure and the
read-only server roadmap. It does not change any package status or imply that
an entire package is accepted. The ordering puts authority and message
correctness before feature breadth, then calls out external and measured gates.

1. **Account, credential, and attachment authority (E20–E24).** Prove account
   proof and credential custody across abort/account-switch paths; correlate
   resume outcomes with issuer and attachment kind; cover fresh/restore,
   duplicate-tab, reload, and safe session-drop behavior. Current source paths
   exist, while configured mechanism and cross-tab/server outcomes remain open.
2. **Message identity, send admission, and history (E30–E33).** Close nick,
   account, and guest transitions; correlate each composer outcome with the
   correct volatile or durable owner; exercise history cursor completeness,
   equal-time boundaries, and confirmed versus viewed read state. The current
   two-node foundation is only one guest and one authenticated canary and does
   not establish reload or cross-node behavior.
3. **Storage and browser lifecycle (E50–E53).** Cover migration, quota/eviction,
   selective export, unsent-work preservation, worker updates, and multi-tab
   quiescence under actual storage failures. Candidate-25 retention evidence
   covers a bounded path, not the full owner or storage lifecycle.
4. **Room operations and community semantics (E34–E44).** Close edit/redact and
   replay ordering, threads/reactions/pins/topics, history landing and focus,
   permission/rejection outcomes, stale privilege retirement, member privacy,
   mesh session inventory, and ownership recovery. Feature availability and
   server acknowledgements vary by policy and endpoint.
5. **Crypto, media, and live communication (E60–E84).** Prove key and session
   lifecycles, authenticated media, codec framing, playout/adaptation, group
   control, and voice signaling through current server and browser paths.
   Unit vectors or helper smoke tests alone do not demonstrate end-to-end
   encryption, device support, or real playout.
6. **Measured performance, stress, operations, and external service boundaries
   (E90–E104).** Re-run a valid paired performance workload; broaden suspension,
   network-change, and storage-pressure stress; observe current privilege and
   health data; validate operator-import schema against its source; and prove
   factor/audit and webhook outcomes. Candidate-26 performance exited 2 with no
   metrics, so its vacuous empty-observation threshold field is unavailable.
   A trusted host-management service remains an explicit external prerequisite.

Across all groups, keep client-source coverage, configuration permission,
deployment reachability, browser cohort, and server behavior as separate
evidence dimensions. No row inherits acceptance from adjacent rows or from
this ordering.
