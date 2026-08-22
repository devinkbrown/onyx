// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  buildInviteCard,
  guestNameError,
  inviteDescription,
  inviteHeadline,
  inviteOgMeta,
  inviteTitle,
  inviteWelcome,
  parseGuestName,
} from './inviteCard';

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
      inviter: null,
      faces: [],
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

    expect(inviteHeadline(card)).toBe('#general');
    expect(inviteWelcome(card)).toBe('Choose a display name to walk in.');
    expect(inviteDescription(card)).toBe(`Join #general on ${NETWORK}. release`);
  });

  it('returns Open Graph metadata for the invite card', () => {
    const card = buildInviteCard(new URLSearchParams({ join: '#general' }), {
      network: NETWORK,
      origin: ORIGIN,
    });

    expect(inviteOgMeta(card)).toEqual([
      { property: 'og:title', content: `Join #general on ${NETWORK}` },
      { property: 'og:description', content: `Join #general on ${NETWORK}.` },
      { property: 'og:url', content: `${ORIGIN}?join=%23general` },
      { property: 'og:type', content: 'website' },
    ]);
  });

  it('encodes a # channel and keeps canonical params in stable order', () => {
    const card = buildInviteCard(
      new URLSearchParams({ as: 'guestnick', join: '%23space', at: '1751000000' }),
      { network: NETWORK, origin: ORIGIN },
    );

    expect(card.url).toBe(
      `${ORIGIN}?join=%23space&at=2025-06-27T04%3A53%3A20.000Z&as=guestnick`,
    );
  });

  it('keeps a valid suggested nick, trimming surrounding whitespace', () => {
    const card = buildInviteCard(new URLSearchParams({ join: '#general', as: '  Yuki_42  ' }), {
      network: NETWORK,
      origin: ORIGIN,
    });

    expect(card.guestName).toBe('Yuki_42');
    expect(card.url).toBe(`${ORIGIN}?join=%23general&as=Yuki_42`);
  });

  it('drops a suggested guest name that is not a valid IRC nick', () => {
    // A space is invalid in a nick — the value is seated downstream as one.
    const card = buildInviteCard(new URLSearchParams({ join: '#general', as: 'guest nick' }), {
      network: NETWORK,
      origin: ORIGIN,
    });

    expect(card.guestName).toBeNull();
    expect(card.url).toBe(`${ORIGIN}?join=%23general`);
  });

  it('rejects control characters, commas and over-long values in the guest name', () => {
    const opts = { network: NETWORK, origin: ORIGIN };

    expect(buildInviteCard(new URLSearchParams({ join: '#general', as: 'yu\x00ki' }), opts).guestName).toBeNull();
    expect(
      buildInviteCard(new URLSearchParams({ join: '#general', as: 'yuki\r\nJOIN #evil' }), opts).guestName,
    ).toBeNull();
    expect(buildInviteCard(new URLSearchParams({ join: '#general', as: 'a,b' }), opts).guestName).toBeNull();
    expect(
      buildInviteCard(new URLSearchParams({ join: '#general', as: 'a'.repeat(65) }), opts).guestName,
    ).toBeNull();
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

describe('guest display name', () => {
  it('accepts a valid name and explains an invalid one without protocol jargon', () => {
    expect(parseGuestName('  River  ')).toBe('River');
    expect(guestNameError('')).toBeUndefined();
    expect(guestNameError('guest nick')).toMatch(/start with a letter/i);
    expect(guestNameError('guest nick')).not.toMatch(/irc|nick|mode/i);
    expect(guestNameError('a'.repeat(65))).toMatch(/64 characters/i);
  });
});

describe('inviter and faces', () => {
  it('keeps a valid inviter and up to three faces from the link', () => {
    const card = buildInviteCard(
      new URLSearchParams({ join: '#lounge', by: '  river  ', with: 'aria, mae, jun, extra' }),
      { network: NETWORK, origin: ORIGIN },
    );

    expect(card.inviter).toBe('river');
    expect(card.faces).toEqual(['aria', 'mae', 'jun']);
    expect(card.url).toBe(`${ORIGIN}?join=%23lounge&by=river&with=aria%2Cmae%2Cjun`);
    expect(inviteDescription(card)).toBe(`river invited you to #lounge on ${NETWORK}.`);
  });

  it('drops a hostile inviter or face instead of reflecting it', () => {
    const card = buildInviteCard(
      new URLSearchParams({ join: '#lounge', by: 'bad nick', with: 'ok,bad nick,yu\x00ki' }),
      { network: NETWORK, origin: ORIGIN },
    );

    expect(card.inviter).toBeNull();
    expect(card.faces).toEqual(['ok']);
    expect(card.url).toBe(`${ORIGIN}?join=%23lounge&with=ok`);
  });
});
