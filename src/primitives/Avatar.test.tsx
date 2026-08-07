// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

afterEach(cleanup);

describe('Avatar', () => {
  it('renders initials and an accessible image label', () => {
    render(() => <Avatar name="Ada Lovelace" />);

    const avatar = screen.getByRole('img', { name: 'Ada Lovelace' });

    expect(avatar.textContent).toBe('AL');
    expect(avatar.classList.contains('onyx-avatar--md')).toBe(true);
    expect(avatar.classList.contains('onyx-avatar--service')).toBe(false);
  });

  it('uses deterministic color variables for repeated names', () => {
    render(() => (
      <>
        <Avatar name="Onyx Operator" size="sm" />
        <Avatar name="Onyx Operator" size="sm" />
      </>
    ));

    const avatars = screen.getAllByRole('img', { name: 'Onyx Operator' });

    expect(avatars[0]?.style.getPropertyValue('--onyx-avatar-bg')).toBe(avatars[1]?.style.getPropertyValue('--onyx-avatar-bg'));
    expect(avatars[0]?.classList.contains('onyx-avatar--sm')).toBe(true);
    expect(avatars[0]?.textContent).toBe('OO');
    expect(avatars[0]?.classList.contains('onyx-avatar--service')).toBe(false);
  });

  it('adds owner status to the accessible name and owner ring class', () => {
    render(() => <Avatar name="Root User" owner />);

    const avatar = screen.getByRole('img', { name: 'Root User, owner' });

    expect(avatar.classList.contains('onyx-avatar--owner')).toBe(true);
    expect(avatar.classList.contains('onyx-avatar--service')).toBe(false);
  });

  it('renders OnyxOS as a first-party service mark (case-insensitive)', () => {
    for (const name of ['OnyxOS', 'onyxos', 'ONYXOS', '  OnyxOs  '] as const) {
      cleanup();
      render(() => <Avatar name={name} size="sm" />);

      const avatar = screen.getByRole('img', { name: 'OnyxOS, Onyx service' });

      expect(avatar.classList.contains('onyx-avatar--service')).toBe(true);
      expect(avatar.classList.contains('onyx-avatar--sm')).toBe(true);
      expect(avatar.textContent).not.toMatch(/ON/i);
      expect(avatar.textContent?.trim()).toBe('');
      expect(avatar.querySelector('svg.onyx-avatar__service-mark')).not.toBeNull();
      expect(avatar.style.getPropertyValue('--onyx-avatar-bg')).toBe('');
    }
  });

  it('includes owner wording on the OnyxOS service accessible name', () => {
    render(() => <Avatar name="OnyxOS" owner />);

    const avatar = screen.getByRole('img', { name: 'OnyxOS, Onyx service, owner' });

    expect(avatar.classList.contains('onyx-avatar--service')).toBe(true);
    expect(avatar.classList.contains('onyx-avatar--owner')).toBe(true);
    expect(avatar.querySelector('svg.onyx-avatar__service-mark')).not.toBeNull();
  });

  it('does not treat Announce or other near-names as OnyxOS service', () => {
    render(() => (
      <>
        <Avatar name="Announce" />
        <Avatar name="OnyxOSBot" />
        <Avatar name="Onyx OS" />
        <Avatar name="Bot" />
      </>
    ));

    const announce = screen.getByRole('img', { name: 'Announce' });
    const bot = screen.getByRole('img', { name: 'OnyxOSBot' });
    const spaced = screen.getByRole('img', { name: 'Onyx OS' });
    const plainBot = screen.getByRole('img', { name: 'Bot' });

    for (const avatar of [announce, bot, spaced, plainBot]) {
      expect(avatar.classList.contains('onyx-avatar--service')).toBe(false);
      expect(avatar.querySelector('svg.onyx-avatar__service-mark')).toBeNull();
    }

    expect(announce.textContent).toBe('AN');
    expect(bot.textContent).toBe('ON');
    expect(spaced.textContent).toBe('OO');
    expect(plainBot.textContent).toBe('BO');
  });
});
