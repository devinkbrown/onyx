import { describe, expect, it } from 'vitest';

import { buildInviteCard, inviteDescription, inviteOgMeta, inviteTitle } from './inviteCard';

const ORIGIN = 'https://onyx.example/invite';
const NETWORK = 'Libera Garden';

describe('buildInviteCard', () => {
  it('builds a full card from meaningful params with a stable canonical URL', () => {
    const params = new URLSearchParams({
      as: '  yuki  ',
      at: '2026-06-30T12:00:00Z',
      join: '#general',
      topic: 'release train',
      reader: '1',
      ignored: 'noise',
    });

    const card = buildInviteCard(params, { network: NETWORK, origin: ORIGIN });

    expect(card).toEqual({
      channel: '#general',
      at: new Date('2026-06-30T12:00:00.000Z'),
      topic: 'release train',
      readerMode: true,
      guestName: 'yuki',
      network: NETWORK,
      url: `${ORIGIN}?join=%23general&at=2026-06-30T12%3A00%3A00.000Z&topic=release+train&reader=1&as=yuki`,
    });
  });

  it('falls back when join is missing', () => {
    const card = buildInviteCard(new URLSearchParams(), { network: NETWORK, origin: ORIGIN });

    expect(card.channel).toBeNull();
    expect(card.topic).toBeNull();
    expect(card.readerMode).toBe(false);
    expect(inviteTitle(card)).toBe(`Join ${NETWORK}`);
    expect(card.url).toBe(ORIGIN);
  });

  it('treats a blank suggested guest name as absent', () => {
    const card = buildInviteCard(new URLSearchParams({ as: '   ', join: '#general' }), {
      network: NETWORK,
      origin: ORIGIN,
    });

    expect(card.guestName).toBeNull();
    expect(card.url).toBe(`${ORIGIN}?join=%23general`);
  });

  it('creates a human description with moment and guest details', () => {
    const card = buildInviteCard(
    new URLSearchParams({ at: '2026-06-30T12:00:00Z', as: 'yuki', join: '#general', topic: 'release', reader: 'true' }),
      { network: NETWORK, origin: ORIGIN },
    );

    expect(inviteDescription(card)).toBe(
      'Jump into the conversation from 2026-06-30T12:00:00.000Z. Open the release topic. Start in reader mode. Continue as yuki',
    );
  });

  it('returns Open Graph metadata for the invite card', () => {
    const card = buildInviteCard(new URLSearchParams({ join: '#general' }), {
      network: NETWORK,
      origin: ORIGIN,
    });

    expect(inviteOgMeta(card)).toEqual([
      { property: 'og:title', content: `Join #general on ${NETWORK}` },
      { property: 'og:description', content: `Open an invite to #general on ${NETWORK}.` },
      { property: 'og:url', content: `${ORIGIN}?join=%23general` },
      { property: 'og:type', content: 'website' },
    ]);
  });

  it('encodes a # channel and keeps canonical params in stable order', () => {
    const card = buildInviteCard(
      new URLSearchParams({ as: 'guest nick', join: '%23space', at: '1751000000' }),
      { network: NETWORK, origin: ORIGIN },
    );

    expect(card.url).toBe(
      `${ORIGIN}?join=%23space&at=2025-06-27T04%3A53%3A20.000Z&as=guest+nick`,
    );
  });

  it('drops malformed topic and reader params from the canonical URL', () => {
    const card = buildInviteCard(
      new URLSearchParams({ join: '#general', topic: 'bad,label', reader: '0' }),
      { network: NETWORK, origin: ORIGIN },
    );

    expect(card.topic).toBeNull();
    expect(card.readerMode).toBe(false);
    expect(card.url).toBe(`${ORIGIN}?join=%23general`);
  });
});
