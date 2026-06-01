# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 02-theme.spec.ts >> every offered theme applies data-theme and real CSS vars
- Location: tests/e2e/02-theme.spec.ts:6:5

# Error details

```
Error: themes that resolved no CSS: Midnight (data-theme=<none>), Bathyal (data-theme=<none>), Coral (data-theme=<none>), Kelp (data-theme=<none>), Brine (data-theme=<none>), Onyx (data-theme=<none>), AMOLED (data-theme=<none>), Arctic (data-theme=<none>), Ash (data-theme=<none>), Light (data-theme=<none>)

expect(received).toHaveLength(expected)

Expected length: 0
Received length: 10
Received array:  ["Midnight (data-theme=<none>)", "Bathyal (data-theme=<none>)", "Coral (data-theme=<none>)", "Kelp (data-theme=<none>)", "Brine (data-theme=<none>)", "Onyx (data-theme=<none>)", "AMOLED (data-theme=<none>)", "Arctic (data-theme=<none>)", "Ash (data-theme=<none>)", "Light (data-theme=<none>)"]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]:
    - img [ref=e8]
  - alert [ref=e11]
  - main [ref=e12]:
    - link "Skip to main content" [ref=e13] [cursor=pointer]:
      - /url: "#land-main"
    - navigation [ref=e14]:
      - generic [ref=e15]:
        - img [ref=e16]
        - generic [ref=e20]: Ocean
      - generic [ref=e21]:
        - link "Features" [ref=e22] [cursor=pointer]:
          - /url: "#features"
        - link "Preview" [ref=e23] [cursor=pointer]:
          - /url: "#preview"
        - link "Activity" [ref=e24] [cursor=pointer]:
          - /url: "#activity"
        - link "Connect" [ref=e25] [cursor=pointer]:
          - /url: "#connect"
        - link "About" [ref=e26] [cursor=pointer]:
          - /url: /about/
        - link "Dive in" [ref=e27] [cursor=pointer]:
          - /url: /login/
          - text: Dive in
          - img [ref=e28]
    - generic [ref=e31]:
      - generic [ref=e32]:
        - generic [ref=e33]: eshmaki.me · live
        - heading "Go deeper than Discord." [level=1] [ref=e36]:
          - text: Go
          - generic [ref=e37]: deeper
          - text: than Discord.
        - paragraph [ref=e39]: "Open-protocol community chat. Native voice and encryption built into the protocol — no relay servers, no third-party infrastructure. Start in #root."
        - generic [ref=e40]:
          - link "Enter Ocean" [ref=e41] [cursor=pointer]:
            - /url: /login/
            - text: Enter Ocean
            - img [ref=e42]
          - link "What is this?" [ref=e44] [cursor=pointer]:
            - /url: /about/
        - generic [ref=e48]:
          - generic [ref=e49]: surface
          - generic [ref=e50]: 4 000 m
      - img [ref=e52]:
        - generic [ref=e58]: 200m
        - generic [ref=e60]: 500m
        - generic [ref=e62]: 1000m
        - generic [ref=e64]: 2000m
        - generic [ref=e66]: 4000m
        - generic [ref=e81]: "#root"
        - generic [ref=e84]: "#dev"
        - generic [ref=e87]: ♪voice
        - generic [ref=e90]: "#art"
        - generic [ref=e93]: "#lounge"
        - generic [ref=e107]: Ocean
    - generic [ref=e113]: "depth: 2 500 m · features ahead"
    - generic [ref=e114]:
      - generic [ref=e115]:
        - generic [ref=e117]:
          - generic [ref=e118]:
            - img [ref=e120]
            - generic [ref=e123]: LADON
          - heading "Voice without borders" [level=3] [ref=e124]
          - paragraph [ref=e125]: Spatial audio and encrypted voice over Ophion IRC. Native protocol transport — no relay servers, no third-party infrastructure. Your voice travels the same path as your messages.
          - img [ref=e127]
        - generic [ref=e149]:
          - generic [ref=e150]:
            - img [ref=e152]
            - generic [ref=e156]: SESSION
          - heading "Stay signed in" [level=3] [ref=e157]
          - paragraph [ref=e158]: Cryptographic session tokens keep you authenticated across reconnects. No password stored. No re-entry.
          - generic [ref=e159]:
            - generic [ref=e160]:
              - generic [ref=e161]: sst_
              - generic [ref=e162]: 4f8a2e…c1b9
            - generic [ref=e163]: valid · 29 days remaining
      - generic [ref=e167]:
        - generic [ref=e168]:
          - generic [ref=e169]:
            - img [ref=e171]
            - generic [ref=e174]: VEIL
          - heading "End-to-end, always" [level=3] [ref=e175]
          - paragraph [ref=e176]: P-256 ECDH key exchange and AES-256-GCM encryption for every voice and video session. Forward secrecy built into the protocol — not bolted on.
          - generic [ref=e177]:
            - generic [ref=e178]: P-256 ECDH
            - generic [ref=e179]: AES-256-GCM
            - generic [ref=e180]: Forward Secrecy
        - img [ref=e182]:
          - generic [ref=e189]: P-256
          - generic [ref=e196]: ECDH
          - generic [ref=e200]: AES-GCM
      - generic [ref=e205]:
        - generic [ref=e207]:
          - generic [ref=e208]:
            - img [ref=e210]
            - generic [ref=e213]: PROTOCOL
          - heading "Open IRC" [level=3] [ref=e214]
          - paragraph [ref=e215]: Standard IRCv3. Connect with any client. Ocean is just the surface.
          - generic [ref=e217]: eshmaki.me:6697
        - generic [ref=e219]:
          - generic [ref=e220]:
            - img [ref=e222]
            - generic [ref=e225]: COLLABORATE
          - heading "Whiteboard" [level=3] [ref=e226]
          - paragraph [ref=e227]: Shared drawing surfaces built into every channel. No extra app.
        - generic [ref=e229]:
          - generic [ref=e230]:
            - img [ref=e232]
            - generic [ref=e235]: MESSAGING
          - heading "Rich messages" [level=3] [ref=e236]
          - paragraph [ref=e237]: Reactions, edits, threads, embeds — over standard IRC extensions.
    - generic [ref=e238]:
      - generic [ref=e239]:
        - generic [ref=e240]: Ocean app
        - heading "Everything has a predictable place." [level=2] [ref=e241]
        - paragraph [ref=e242]: Ocean keeps the familiar server, channel, chat, and member layout, then layers in IRC-native identity, voice, session handoff, media, and moderation tools where people already expect them.
      - generic "Ocean app interface preview" [ref=e243]:
        - generic [ref=e244]:
          - generic [ref=e245]: O
          - generic [ref=e246]: "#"
          - generic [ref=e247]: +
        - generic [ref=e248]:
          - generic [ref=e249]: eshmaki.me
          - generic [ref=e250]: Channels
          - generic [ref=e251]:
            - generic [ref=e252]: "#"
            - text: root
          - generic [ref=e253]:
            - generic [ref=e254]: "#"
            - text: dev
          - generic [ref=e255]:
            - generic [ref=e256]: "#"
            - text: art
          - generic [ref=e257]:
            - generic [ref=e258]: "#"
            - text: lounge
          - generic [ref=e259]: Voice
          - generic [ref=e260]:
            - img [ref=e261]
            - text: voice-1
        - generic [ref=e264]:
          - generic [ref=e265]:
            - generic [ref=e266]: "#root"
            - generic [ref=e267]:
              - generic [ref=e268]: Threads
              - generic [ref=e269]: Search
              - generic [ref=e270]: Media
          - generic [ref=e271]:
            - generic [ref=e272]: k
            - generic [ref=e273]:
              - generic [ref=e274]:
                - text: kain
                - generic [ref=e275]: today
              - paragraph [ref=e276]: Session reclaimed cleanly. Phone and desktop are both attached.
          - generic [ref=e277]:
            - generic [ref=e278]: o
            - generic [ref=e279]:
              - generic [ref=e280]:
                - text: ocean
                - generic [ref=e281]: live
              - paragraph [ref=e282]: LADON voice is encrypted, linked to the channel, and ready.
              - generic [ref=e283]:
                - generic [ref=e284]: VEIL active
                - generic [ref=e285]: 2 clients
                - generic [ref=e286]: IRCv3
          - generic [ref=e287]: "Message #root"
        - generic [ref=e288]:
          - generic [ref=e289]: Online
          - generic [ref=e290]: kain
          - generic [ref=e292]: trev
          - generic [ref=e294]: services
          - generic [ref=e296]: ocean
          - generic [ref=e298]:
            - strong [ref=e299]: Network health
            - generic [ref=e300]: Synced links, active sessions, no relay dependency.
    - region "Community activity" [ref=e301]:
      - generic [ref=e302]:
        - generic [ref=e303]: Live archive
        - heading "Community activity, exported by Ophion." [level=2] [ref=e304]
        - paragraph [ref=e305]: Channel statistics are generated directly inside the server and served as static JSON and HTML. No stats bot needs to join, part, or reconnect.
      - generic [ref=e306]:
        - 'link "Stats portal #root Open the generated channel statistics." [ref=e307] [cursor=pointer]':
          - /url: /stats/
          - generic [ref=e308]: Stats portal
          - strong [ref=e309]: "#root"
          - generic [ref=e310]: Open the generated channel statistics.
        - generic [ref=e311]:
          - generic [ref=e312]: Messages
          - strong [ref=e313]: ...
        - generic [ref=e314]:
          - generic [ref=e315]: Joins
          - strong [ref=e316]: ...
        - generic [ref=e317]:
          - generic [ref=e318]: Peak
          - strong [ref=e319]: ...
        - generic [ref=e320]:
          - generic [ref=e321]: Tracked
          - strong [ref=e322]: ...
    - region "Ocean capabilities" [ref=e323]:
      - generic [ref=e324]:
        - generic [ref=e325]: Feature map
        - heading "Built for real communities, not a demo room." [level=2] [ref=e326]
      - generic [ref=e327]:
        - generic [ref=e328]:
          - heading "Chat" [level=3] [ref=e329]
          - list [ref=e330]:
            - listitem [ref=e331]: Threaded replies
            - listitem [ref=e333]: Reactions and edits
            - listitem [ref=e335]: Pins, search, history
            - listitem [ref=e337]: Embeds and media cards
        - generic [ref=e339]:
          - heading "Voice and media" [level=3] [ref=e340]
          - list [ref=e341]:
            - listitem [ref=e342]: LADON channel voice
            - listitem [ref=e344]: Encrypted sessions
            - listitem [ref=e346]: Media gallery
            - listitem [ref=e348]: Whiteboard collaboration
        - generic [ref=e350]:
          - heading "Identity" [level=3] [ref=e351]
          - list [ref=e352]:
            - listitem [ref=e353]: SASL login
            - listitem [ref=e355]: Session reclaim
            - listitem [ref=e357]: Multi-client nick support
            - listitem [ref=e359]: Token-based resume
        - generic [ref=e361]:
          - heading "Operations" [level=3] [ref=e362]
          - list [ref=e363]:
            - listitem [ref=e364]: Services awareness
            - listitem [ref=e366]: Moderation tools
            - listitem [ref=e368]: Channel browser
            - listitem [ref=e370]: Network status views
    - generic [ref=e372]:
      - generic [ref=e373]:
        - generic [ref=e374]: Connect
        - heading "Use the web app or bring your own IRC client." [level=2] [ref=e375]
        - paragraph [ref=e376]: The website is the front door, Ocean is the rich client, and the network remains open enough for standard IRC tooling.
      - generic [ref=e377]:
        - generic [ref=e378]:
          - generic [ref=e379]: Recommended
          - heading "Ocean web app" [level=3] [ref=e380]
          - paragraph [ref=e381]: Full chat, voice, media, settings, session resume, and community tooling in the browser.
          - link "Open Ocean" [ref=e382] [cursor=pointer]:
            - /url: /login/
            - text: Open Ocean
            - img [ref=e383]
        - generic [ref=e385]:
          - generic [ref=e386]: IRC
          - heading "TLS client access" [level=3] [ref=e387]
          - paragraph [ref=e388]: Use any IRCv3 client with TLS and SASL for a direct protocol connection.
          - code [ref=e389]: eshmaki.me:6697
        - generic [ref=e390]:
          - generic [ref=e391]: Start here
          - heading "Main channel" [level=3] [ref=e392]
          - paragraph [ref=e393]: Join the shared lobby, see live community state, then branch into focused rooms.
          - code [ref=e394]: "#root"
    - generic [ref=e395]:
      - generic [ref=e396]:
        - generic [ref=e397]: FAQ
        - heading "Answers before the first login." [level=2] [ref=e398]
      - generic [ref=e399]:
        - article [ref=e400]:
          - heading "Do I need Ocean?" [level=3] [ref=e401]
          - paragraph [ref=e402]: No. Ocean is the polished web client, but the network speaks IRCv3 so native clients can connect too.
        - article [ref=e403]:
          - heading "Can I stay connected from multiple devices?" [level=3] [ref=e404]
          - paragraph [ref=e405]: Yes. Session reclaim is designed for multiple clients on the same nick without kicking out the others.
        - article [ref=e406]:
          - heading "Is voice part of IRC?" [level=3] [ref=e407]
          - paragraph [ref=e408]: Voice uses LADON over Ophion so channel voice belongs to the same open network instead of a separate relay stack.
        - article [ref=e409]:
          - heading "Where should I start?" [level=3] [ref=e410]
          - paragraph [ref=e411]: "Open Ocean, sign in, and join #root. The app exposes channels, members, voice, search, and settings in the main workspace."
    - generic [ref=e412]:
      - generic:
        - img
      - generic [ref=e413]:
        - generic [ref=e414]: eshmaki.me
        - heading "One network. Many depths." [level=2] [ref=e416]:
          - text: One network.
          - text: Many depths.
        - paragraph [ref=e417]: "Start at the surface in #root — the main gathering place. Descend into voice channels, project rooms, and late-night conversations."
        - generic [ref=e418]:
          - generic [ref=e419]:
            - generic [ref=e420]: "#"
            - generic [ref=e421]: root
            - generic [ref=e422]: LIVE
          - generic [ref=e423]:
            - generic [ref=e424]: "#"
            - generic [ref=e425]: dev
          - generic [ref=e426]:
            - generic [ref=e427]: "#"
            - generic [ref=e428]: art
          - generic [ref=e429]:
            - generic [ref=e430]: "#"
            - generic [ref=e431]: lounge
          - generic [ref=e432]:
            - img [ref=e433]
            - generic [ref=e436]: voice-1
        - generic [ref=e437]:
          - link "Join the community" [ref=e438] [cursor=pointer]:
            - /url: /login/
            - text: Join the community
            - img [ref=e439]
          - link "Learn more" [ref=e441] [cursor=pointer]:
            - /url: /about/
    - generic [ref=e442]:
      - generic [ref=e443]:
        - generic [ref=e444]:
          - img [ref=e445]
          - generic [ref=e449]: Ocean
        - paragraph [ref=e450]: Built on Ophion IRC · eshmaki.me
      - navigation "Footer navigation" [ref=e451]:
        - link "About" [ref=e452] [cursor=pointer]:
          - /url: /about/
        - link "Sign In" [ref=e453] [cursor=pointer]:
          - /url: /login/
        - link "Ophion ↗" [ref=e454] [cursor=pointer]:
          - /url: https://github.com/devinkbrown/ophion
      - paragraph [ref=e455]: © 2026 eshmaki.me
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | // Validates the theming complaint: every theme offered in the picker must
  4  | // actually change <html data-theme> AND resolve a real CSS variable (proves the
  5  | // theme exists in CSS, not just in the list). This is what was broken.
  6  | test('every offered theme applies data-theme and real CSS vars', async ({ page }) => {
  7  |   await page.goto('/app');
  8  |   await expect(page.locator('.app-shell')).toBeVisible();
  9  | 
  10 |   await page.locator('button[aria-label="Appearance"]').click();
  11 |   await expect(page.locator('[role="radiogroup"][aria-label="Theme"]')).toBeVisible();
  12 | 
  13 |   // Drive the whole picker in-page, re-querying each swatch fresh by label so
  14 |   // React's applied-flash re-renders can't invalidate element handles.
  15 |   const results = await page.evaluate(async () => {
  16 |     const sel = '[role="radiogroup"][aria-label="Theme"]';
  17 |     const labels = Array.from(document.querySelectorAll(`${sel} button.theme-swatch`))
  18 |       .map((b) => b.getAttribute('aria-label') || '');
  19 |     const out: { label: string; dt: string | null; bg: string }[] = [];
  20 |     for (const label of labels) {
  21 |       const b = document.querySelector(
  22 |         `${sel} button.theme-swatch[aria-label="${CSS.escape(label)}"]`,
  23 |       ) as HTMLButtonElement | null;
  24 |       if (!b) { out.push({ label, dt: null, bg: '' }); continue; }
  25 |       b.click();
  26 |       await new Promise((r) => setTimeout(r, 70));
  27 |       out.push({
  28 |         label,
  29 |         dt: document.documentElement.getAttribute('data-theme'),
  30 |         bg: getComputedStyle(document.documentElement).getPropertyValue('--bg-void').trim(),
  31 |       });
  32 |     }
  33 |     return out;
  34 |   });
  35 | 
  36 |   expect(results.length, 'theme swatches found').toBeGreaterThan(3);
  37 |   // Every offered theme must resolve a real --bg-void (explicit data-theme block
  38 |   // or the cleared default that inherits :root). None may be a dead picker entry.
  39 |   const dead = results.filter((r) => !r.bg).map((r) => `${r.label} (data-theme=${r.dt ?? '<none>'})`);
> 40 |   expect(dead, `themes that resolved no CSS: ${dead.join(', ')}`).toHaveLength(0);
     |                                                                   ^ Error: themes that resolved no CSS: Midnight (data-theme=<none>), Bathyal (data-theme=<none>), Coral (data-theme=<none>), Kelp (data-theme=<none>), Brine (data-theme=<none>), Onyx (data-theme=<none>), AMOLED (data-theme=<none>), Arctic (data-theme=<none>), Ash (data-theme=<none>), Light (data-theme=<none>)
  41 |   // Distinct themes must produce distinct data-theme values.
  42 |   const distinct = new Set(results.map((r) => r.dt ?? '<default>'));
  43 |   expect(distinct.size, 'distinct data-theme values').toBeGreaterThan(1);
  44 | });
  45 | 
```