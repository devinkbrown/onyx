import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

afterEach(cleanup);

describe('Avatar', () => {
  it('renders initials and an accessible image label', () => {
    render(() => <Avatar name="Ada Lovelace" />);

    const avatar = screen.getByRole('img', { name: 'Ada Lovelace' });

    expect(avatar.textContent).toBe('AL');
    expect(avatar.classList.contains('ruri-avatar--md')).toBe(true);
  });

  it('uses deterministic color variables for repeated names', () => {
    render(() => (
      <>
        <Avatar name="Onyx Operator" size="sm" />
        <Avatar name="Onyx Operator" size="sm" />
      </>
    ));

    const avatars = screen.getAllByRole('img', { name: 'Onyx Operator' });

    expect(avatars[0]?.style.getPropertyValue('--ruri-avatar-bg')).toBe(avatars[1]?.style.getPropertyValue('--ruri-avatar-bg'));
    expect(avatars[0]?.classList.contains('ruri-avatar--sm')).toBe(true);
  });

  it('adds owner status to the accessible name and owner ring class', () => {
    render(() => <Avatar name="Root User" owner />);

    const avatar = screen.getByRole('img', { name: 'Root User, owner' });

    expect(avatar.classList.contains('ruri-avatar--owner')).toBe(true);
  });
});
