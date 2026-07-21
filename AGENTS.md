<!-- BEGIN:onyx-agent-rules -->
# Agent rules for Onyx

**Audience: coding agents.** Onyx is a **SolidJS 1.9 + Vite 7** single-page IRC
web client for the **Onyx** network on the **Onyx Server** engine (not React,
Next.js, or any SSR framework). The reactivity model is fine-grained signals,
not a virtual DOM; patterns from React training data (rules-of-hooks, re-render
mental models, `useEffect` deps) do **not** apply. Use English subsystem names
(Cadence media, Mooring client crypto) — not retired Japanese prose names.
New code uses English identifiers. Offline memos are `MEMO` only. Wire media
codecs are `cadencevox` / `cadencevis`. Historical crypto envelope bytes
`TSUMUGI1 ` may still open in `src/lib/e2ee/dmCipher.ts` (legacy open-path
only — not a command); inbound media may dual-accept historical `TSUMUGI_*`
subtypes.

Before writing code, read [`CLAUDE.md`](CLAUDE.md) (working context: layout,
persistence conventions, IRC↔Onyx mapping) and
[`docs/architecture.md`](docs/architecture.md) (the `src/` map). Docs hub:
[`docs/README.md`](docs/README.md). For contributor setup, gates, and the
deploy-safety rule see [`CONTRIBUTING.md`](CONTRIBUTING.md). Brand: **Onyx** =
network/product/client; **Onyx Server** = engine (not "Onyx" in public docs).

## Stack (verified against `package.json`, `tsconfig.json`, `vite.config.ts`)

- **SolidJS 1.9** + `@solidjs/router` — SPA, no SSR.
- **Vite 7** build; **pnpm only**, never npm.
- **Zustand vanilla** store (`createStore` from `zustand/vanilla`, the
  `subscribeWithSelector` middleware) with a `useStore` Solid bridge —
  `src/lib/store/`.
- **IRC over wss** — `src/lib/irc/client.ts` (CAP/IRCv3/IRCX, SASL
  PLAIN/SCRAM/EXTERNAL, session resume).
- **OKLCH theme factory** — `src/theme/paletteFactory.ts`; AA contrast enforced
  by construction.
- **IndexedDB history vault** — `src/lib/vault/` (`VAULT_KEEP = 400` per target).
- **Cadence media** — `src/lib/cadence-media/` (CadenceVox/CadenceVis codecs,
  Cadence frames over WS).
- **Strict TypeScript** — `strict: true` **and** `noUncheckedIndexedAccess:
  true` (`tsconfig.json`). Indexed access is `T | undefined`; handle it.

## Conventions

- Component reads go through `useStore(s => …)` (reactive); `getState()` is a
  non-reactive snapshot. Writes go through immutable `set()` store actions.
- SolidJS: never destructure props and never read a signal in the component body
  where reactivity is expected — read signals in JSX or `createMemo`/effects.
- `localStorage` keys use the `onyx:` prefix. IRCX METADATA/PROP keys prefixed
  `ocean.` (e.g. `ocean.display-name`, `ocean.watch`) are **wire format** —
  server-persisted; never rename them.
- Gates before finishing: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- **Only `deploy.sh` writes `out/`.** `pnpm build` emits `dist/`. Never point a
  build or test at `out/`.
<!-- END:onyx-agent-rules -->
