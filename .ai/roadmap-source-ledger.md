# Roadmap source ledger

Use this ledger before selecting a roadmap slice. The roadmap sets direction; source and tests establish shipped status.

| Slice | Roadmap claim | Verified source and test evidence | Status |
| --- | --- | --- | --- |
| Era 1 A1 hybrid search honesty | Hybrid search docs + UI “on this device” copy | `docs/search-and-history.md` matches MessageSearch mode titles/provenance (`This device` / `This server`), hybrid default, no cloud-AI claim; UI already labels modes/results “on this device”; tests in `MessageSearch.test.tsx` | closed 2026-07-19 |
| Reader reviewed-anchor handoff | Carry reviewed anchors into richer cross-room handoffs | `&` rooms eligible via `targetLooksLikeChannel`; moment `?join=` accepts `#&`; reader memory surfaces peer-reviewed anchors via `peerReviewedAnchors` + exact-id travel | closed 2026-07-19 |
| Cold return Home catch-up | Home paints catch-up from vault before network | `catchUpMemory` owner-scoped snapshot; HomeView cold path (`data-catchup-source=memory`) + vault recap seeds; live handoff once rooms hydrate; tests in `catchUpMemory.test.ts` + `HomeView.coldCatchUp.test.tsx` | closed 2026-07-19 |
| Washi background consolidation | Consolidate to signature presets with bounded ambient rendering | Registry/catalogue retain 24 selectable canvas/DOM backgrounds; shared canvas layering does not cover every variant | active gap |
| Dense nicklist browser evidence | Prove dense surface reflow in the real shell | Existing member-list Playwright fixtures use static `setContent`; a real AppShell journey remains needed | active gap |
