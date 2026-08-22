// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './about.css';
import { AccessibilityStatement } from '@/shell/AccessibilityStatement';
import { PublicFrame } from '@/ui/public';
import { setPageMeta } from './pageMeta';

/**
 * Onyx /about — community story.
 * Rooms, messages, calls, and how people join. Operators come after.
 */
export default function About() {
  setPageMeta(
    'About Onyx — rooms for your people',
    'Onyx is a community for rooms, messages, and calls. Private DMs when you want them. No ads. Open in your browser, or invite people you already know.',
    '/about/',
  );
  return (
    <PublicFrame
      currentPath="/about/"
      mainLabel="About Onyx"
      context={(
        <p class="public-frame__current-line">
          <span class="public-frame__current-kicker">Community</span>
          <span aria-hidden="true">·</span>
          <span class="public-frame__current-label">Rooms, messages, and calls</span>
        </p>
      )}
    >
      <div class="ui-root r ab-ocean">
      <div class="r-ground" aria-hidden="true" />
      <div class="r-grain" aria-hidden="true" />

      <section class="r-wrap ab-hero" aria-labelledby="about-hero-heading">
        <p class="ab-kicker">a community</p>
        <h1 id="about-hero-heading">Rooms for people you already like.</h1>
        <p class="ab-lede">
          Friends, clubs, and creators hanging out — not a status board.
        </p>
        <div class="ab-seam" aria-hidden="true" />
        <p class="sub">
          Onyx is a place for rooms, messages, and calls. Private DMs when a
          conversation should stay between two people. No ads. Open it in your
          browser, then invite the people you already know.
        </p>
        <div class="ab-cta">
          <a class="r-btn primary" href="/app/">Open Onyx</a>
          <a class="r-btn ghost" href="/invite/">Join with an invite</a>
        </div>
        <nav class="ab-topics" aria-label="About topics">
          <a href="#rooms">Rooms</a>
          <a href="#people">People</a>
          <a href="#join">Join</a>
          <a href="#hosting">Hosting</a>
          <a href="#accessibility">Accessibility</a>
        </nav>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      <section id="rooms" class="r-wrap ab-section" aria-labelledby="rooms-heading">
        <span class="ab-eyebrow">rooms, messages, calls</span>
        <h2 id="rooms-heading" class="ab-title">A room that stays open</h2>
        <p class="ab-copy">
          Text rooms are the everyday place. People drop in, catch up, and leave
          the conversation where they found it. Messages stay with the room —
          not a feed that buries them.
        </p>
        <p class="ab-copy">
          Direct messages are private when you want a quieter thread. Calls are
          there when a voice or a face is easier than typing. You join a call
          on purpose; the room does not turn into a meeting product.
        </p>
        <ul class="ab-pillars" aria-label="What you get">
          <li>
            <strong>Rooms</strong>
            <span>Places to hang out that stay open.</span>
          </li>
          <li>
            <strong>Messages</strong>
            <span>Room chat and private DMs.</span>
          </li>
          <li>
            <strong>Calls</strong>
            <span>Voice, video, and screen when you need them.</span>
          </li>
          <li>
            <strong>No ads</strong>
            <span>Nobody is selling your attention here.</span>
          </li>
        </ul>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      <section id="people" class="r-wrap ab-section" aria-labelledby="people-heading">
        <span class="ab-eyebrow">who it is for</span>
        <h2 id="people-heading" class="ab-title">Friends, clubs, creators</h2>
        <p class="ab-copy">
          Onyx is for people who want a room of their own — not a protocol desk
          and not a storefront.
        </p>
        <div class="ab-who" role="list">
          <article class="ab-who-card" role="listitem">
            <h3>Friends</h3>
            <p>A standing room for the group chat that should not evaporate every few months.</p>
          </article>
          <article class="ab-who-card" role="listitem">
            <h3>Clubs</h3>
            <p>The same place every week — topics, people, and a call when the meeting starts.</p>
          </article>
          <article class="ab-who-card" role="listitem">
            <h3>Creators</h3>
            <p>A room and a stage for the people who already showed up, without ads in the way.</p>
          </article>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      <section id="join" class="r-wrap ab-section" aria-labelledby="join-heading">
        <span class="ab-eyebrow">how to join</span>
        <h2 id="join-heading" class="ab-title">Open it. Invite people.</h2>
        <p class="ab-copy">
          The door is the browser. Open Onyx, pick a name, and walk into a room.
          If someone sent you an invite, use it — you land in their room with
          the context they shared.
        </p>
        <p class="ab-copy">
          On a phone or laptop, supporting browsers can keep Onyx on this device
          from the same page. Same rooms, same people, no extra store.
        </p>
        <div class="ab-cta">
          <a class="r-btn primary" href="/app/">Join in the browser</a>
          <a class="r-btn ghost" href="/invite/">Have an invite?</a>
          <a class="r-btn ghost" href="/download/">Get it on this device</a>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      <section id="hosting" class="r-wrap ab-section" aria-labelledby="hosting-heading">
        <span class="ab-eyebrow">operators, after that</span>
        <h2 id="hosting-heading" class="ab-title">Self-host if you want to</h2>
        <p class="ab-copy">
          Most people never need this. If you run your own community and want
          the rooms on hardware you hold, you can self-host Onyx Server and
          keep the same client.
        </p>
        <p class="ab-copy">
          Public status, the roadmap, and the longer operator notes live on
          quieter pages. They are there when you need them — they are not the
          personality of Onyx.
        </p>
        <nav class="ab-quiet-links" aria-label="Quieter operator pages">
          <a href="/status/">Status</a>
          <a href="/roadmap/">Roadmap</a>
          <a href="/download/">Download</a>
        </nav>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      <section id="accessibility" class="r-wrap ab-section" aria-labelledby="a11y-statement-title">
        <span class="ab-eyebrow">accessibility</span>
        <AccessibilityStatement class="ab-a11y" />
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      </div>
    </PublicFrame>
  );
}
