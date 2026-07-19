# LICENSE & RELEASE STATUS

## Facts

- **This client tree is not a public open-source product.** README status has long been
  **pre-release / internal — not published.** Do not treat it as a released FOSS app.
- A remote named `github` may exist on this machine; that does **not** mean the
  client was ever offered as open source to the public. Product policy is
  **proprietary first-party client**.
- **Onyx Server** (separate repo: `github.com/devinkbrown/onyx-server`) is the
  AGPL pure-Zig **engine** — that is the open piece people clone and self-host.

## Product split

| Piece | Role | Posture |
|-------|------|---------|
| **Onyx client** (this tree) | First-party app sauce — UX, vault, themes, Home, Cadence browser | **Proprietary / closed** — competitive surface |
| **Onyx network** | Public community at eshmaki.me / ircx.us | **Open to join** (service), not “client source for free” |
| **Onyx Server** | Mesh IRC daemon | **AGPL open source** |
| **Wire** | IRCv3 / IRCX | Open protocol; third-party clients welcome |

## About the AGPL `LICENSE` file in this tree

An AGPL license file may still sit in the repo from early scaffolding or
template habit. **That is not a claim that Onyx client was published under AGPL
or that the public may treat it as FOSS.**

Going forward:

- Do **not** market the Onyx *client* as open source / AGPL.
- Do market **Onyx Server** as AGPL pure Zig.
- Prefer: *“Join the public Onyx network. Run open-source Onyx Server if you want.
  The first-party Onyx app is ours.”*

Replacing or removing `LICENSE` / SPDX headers to match proprietary product is
an owner cleanup when ready — not required to state the product truth above.

## What this is not

- Not a claim the **network** is private or paywalled.
- Not a claim IRC/IRCX is proprietary.
- Not a change to Onyx Server’s AGPL terms.
