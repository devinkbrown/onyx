// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { buildInviteCard } from './inviteCard';
import { buildInviteLink } from './inviteLink';

const OPTS = {
  network: 'IRCXNet',
  origin: 'https://eshmaki.me/invite/',
  appOrigin: '/app/',
} as const;

describe('buildInviteLink', () => {
  it('builds a canonical share URL and app deep-link from a channel spec', () => {
    const link = buildInviteLink({ channel: '#general' }, OPTS);

    expect(link.hasChannel).toBe(true);
    expect(link.shareUrl).toBe('https://eshmaki.me/invite/?join=%23general');
    expect(link.appHref).toBe('/app/?join=%23general');
    expect(link.card.channel).toBe('#general');
    expect(link.card.network).toBe('IRCXNet');
  });

  it('carries a preferred nick, moment, topic and reader mode into both links', () => {
    const at = new Date('2026-06-30T12:00:00.000Z');
    const link = buildInviteLink(
      { channel: '#general', guestName: 'Yuki_42', at, topic: 'release train', reader: true },
      OPTS,
    );

    // canonical param order matches inviteCard: join, at, topic, reader, as.
    const query = '?join=%23general&at=2026-06-30T12%3A00%3A00.000Z&topic=release+train&reader=1&as=Yuki_42';
    expect(link.shareUrl).toBe(`https://eshmaki.me/invite/${query}`);
    expect(link.appHref).toBe(`/app/${query}`);
    expect(link.card.guestName).toBe('Yuki_42');
    expect(link.card.at).toEqual(at);
    expect(link.card.topic).toBe('release train');
    expect(link.card.readerMode).toBe(true);
  });

  it('round-trips: parsing the built share URL yields the same canonical card', () => {
    const at = new Date('2026-06-30T12:00:00.000Z');
    const link = buildInviteLink(
      { channel: '#general', guestName: 'Yuki_42', at, topic: 'release train', reader: true },
      OPTS,
    );

    const query = link.shareUrl.slice(link.shareUrl.indexOf('?') + 1);
    const reparsed = buildInviteCard(new URLSearchParams(query), {
      network: OPTS.network,
      origin: OPTS.origin,
    });

    expect(reparsed).toEqual(link.card);
  });

  it('drops a hostile preferred nick without corrupting the channel link', () => {
    // CRLF-injection attempt in the nick — must never reach a link.
    const link = buildInviteLink(
      { channel: '#general', guestName: 'yuki\r\nJOIN #evil' },
      OPTS,
    );

    expect(link.hasChannel).toBe(true);
    expect(link.card.guestName).toBeNull();
    expect(link.shareUrl).toBe('https://eshmaki.me/invite/?join=%23general');
    expect(link.appHref).toBe('/app/?join=%23general');
  });

  it('drops a malformed channel entirely — a network-only link, no navigation target', () => {
    const link = buildInviteLink({ channel: '#a,b evil' }, OPTS);

    expect(link.hasChannel).toBe(false);
    expect(link.card.channel).toBeNull();
    expect(link.shareUrl).toBe('https://eshmaki.me/invite/');
    expect(link.appHref).toBe('/app/');
  });

  it('drops a channel the deep-link parser cannot decode (bare %), matching the parse contract', () => {
    // parseJoinParam runs decodeURIComponent on the value; a lone `%` throws
    // there, so the channel is dropped exactly as the website->app flow would
    // drop it. The link degrades to network-only rather than emitting a target
    // the downstream Connect flow would silently reject.
    const link = buildInviteLink({ channel: '#c%d' }, OPTS);

    expect(link.hasChannel).toBe(false);
    expect(link.card.channel).toBeNull();
    expect(link.shareUrl).toBe('https://eshmaki.me/invite/');
    expect(link.appHref).toBe('/app/');
  });

  it('treats an empty/whitespace channel as a network-only invite', () => {
    const link = buildInviteLink({ channel: '   ' }, OPTS);

    expect(link.hasChannel).toBe(false);
    expect(link.shareUrl).toBe('https://eshmaki.me/invite/');
    expect(link.appHref).toBe('/app/');
  });

  it('drops a malformed topic and reader=false while keeping the channel', () => {
    const link = buildInviteLink(
      { channel: '#general', topic: 'bad,label', reader: false },
      OPTS,
    );

    expect(link.card.topic).toBeNull();
    expect(link.card.readerMode).toBe(false);
    expect(link.shareUrl).toBe('https://eshmaki.me/invite/?join=%23general');
  });

  it('never emits an absolute app deep-link when appOrigin is a bare path', () => {
    const link = buildInviteLink({ channel: '#general', at: new Date('2026-06-30T12:00:00.000Z') }, OPTS);

    expect(link.appHref.startsWith('/app/?')).toBe(true);
    // No accidental double-origin or protocol leakage.
    expect(link.appHref).not.toContain('https://');
  });
});
