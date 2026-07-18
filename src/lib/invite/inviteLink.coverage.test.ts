// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { buildInviteCard } from './inviteCard';
import { buildInviteLink } from './inviteLink';

const OPTS = {
  network: 'Onyx',
  origin: 'https://eshmaki.me/invite/',
  appOrigin: '/app/',
} as const;

function parseShareUrl(shareUrl: string) {
  const queryStart = shareUrl.indexOf('?');
  const query = queryStart >= 0 ? shareUrl.slice(queryStart + 1) : '';
  return buildInviteCard(new URLSearchParams(query), {
    network: OPTS.network,
    origin: OPTS.origin,
  });
}

describe('rich invite link coverage', () => {
  it('round-trips a rich invite through the public parser with only canonical fields', () => {
    // Arrange
    const spec = {
      channel: ' #help ',
      guestName: '  Guest_7 ',
      at: new Date('2026-07-10T08:30:00.000Z'),
      topic: ' onboarding ',
      reader: true,
    };

    // Act
    const link = buildInviteLink(spec, OPTS);
    const parsed = parseShareUrl(link.shareUrl);

    // Assert
    expect(link).toEqual({
      card: parsed,
      shareUrl: `${OPTS.origin}?join=%23help&at=2026-07-10T08%3A30%3A00.000Z&topic=onboarding&reader=1&as=Guest_7`,
      appHref: '/app/?join=%23help&at=2026-07-10T08%3A30%3A00.000Z&topic=onboarding&reader=1&as=Guest_7',
      hasChannel: true,
    });
    expect(parsed).toEqual({
      channel: '#help',
      at: new Date('2026-07-10T08:30:00.000Z'),
      topic: 'onboarding',
      readerMode: true,
      guestName: 'Guest_7',
      network: OPTS.network,
      url: link.shareUrl,
    });
  });

  it('tolerates unknown fields and drops them from the canonical invite', () => {
    // Arrange
    const params = new URLSearchParams({
      join: '#general',
      token: 'opaque-server-token',
      redirect: 'https://attacker.example/',
      theme: 'custom',
      as: 'Reader',
    });

    // Act
    const card = buildInviteCard(params, { network: OPTS.network, origin: OPTS.origin });

    // Assert
    expect(card).toEqual({
      channel: '#general',
      at: null,
      topic: null,
      readerMode: false,
      guestName: 'Reader',
      network: OPTS.network,
      url: `${OPTS.origin}?join=%23general&as=Reader`,
    });
  });

  it('rejects malformed and oversized query values without losing a valid channel', () => {
    // Arrange
    const oversizedTopic = 'x'.repeat(51);
    const oversizedGuest = `A${'b'.repeat(64)}`;
    const params = new URLSearchParams({
      join: '#general',
      at: 'not-a-date-token',
      topic: oversizedTopic,
      reader: 'definitely',
      as: oversizedGuest,
    });

    // Act
    const card = buildInviteCard(params, { network: OPTS.network, origin: OPTS.origin });

    // Assert
    expect(card).toEqual({
      channel: '#general',
      at: null,
      topic: null,
      readerMode: false,
      guestName: null,
      network: OPTS.network,
      url: `${OPTS.origin}?join=%23general`,
    });
  });

  it('rejects expired and far-future time tokens from parsed invites', () => {
    // Arrange
    const expired = new URLSearchParams({ join: '#general', at: '2019-12-31T23:59:59.000Z' });
    const farFuture = new URLSearchParams({ join: '#general', at: '2100-01-01T00:00:00.000Z' });

    // Act
    const expiredCard = buildInviteCard(expired, { network: OPTS.network, origin: OPTS.origin });
    const farFutureCard = buildInviteCard(farFuture, { network: OPTS.network, origin: OPTS.origin });

    // Assert
    expect(expiredCard.at).toBeNull();
    expect(expiredCard.url).toBe(`${OPTS.origin}?join=%23general`);
    expect(farFutureCard.at).toBeNull();
    expect(farFutureCard.url).toBe(`${OPTS.origin}?join=%23general`);
  });

  it('keeps raw malformed channel tokens out of both share and app links', () => {
    // Arrange
    const spec = {
      channel: '#bad channel,other\r\nJOIN #evil',
      guestName: 'Guest',
      at: new Date('2026-07-10T08:30:00.000Z'),
    };

    // Act
    const link = buildInviteLink(spec, OPTS);

    // Assert
    expect(link.hasChannel).toBe(false);
    expect(link.card.channel).toBeNull();
    expect(link.card.guestName).toBe('Guest');
    expect(link.shareUrl).not.toContain('bad');
    expect(link.appHref).not.toContain('bad');
    expect(link.shareUrl).toBe(`${OPTS.origin}?at=2026-07-10T08%3A30%3A00.000Z&as=Guest`);
    expect(link.appHref).toBe('/app/?at=2026-07-10T08%3A30%3A00.000Z&as=Guest');
  });

  it('drops an invalid Date value instead of throwing', () => {
    // Arrange
    const invalidDate = new Date(Number.NaN);

    // Act
    const link = buildInviteLink({ channel: '#general', at: invalidDate }, OPTS);

    // Assert
    expect(link.card.at).toBeNull();
    expect(link.shareUrl).toBe(`${OPTS.origin}?join=%23general`);
  });
});
