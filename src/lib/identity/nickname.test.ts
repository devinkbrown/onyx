// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { nicknameError, parseNickname } from './nickname';

describe('nickname contract', () => {
  it('accepts IRC special-leading names and trims surrounding whitespace', () => {
    expect(parseNickname('  _alice  ')).toBe('_alice');
    expect(parseNickname('[alice')).toBe('[alice');
  });

  it('accepts names longer than the old 32-character client limit', () => {
    const name = `a${'b'.repeat(32)}`;
    expect(name).toHaveLength(33);
    expect(parseNickname(name)).toBe(name);
  });

  it('accepts exactly 64 characters but rejects the next character', () => {
    const boundary = 'a'.repeat(64);
    expect(parseNickname(boundary)).toBe(boundary);
    expect(parseNickname(`${boundary}b`)).toBeNull();
    expect(nicknameError(`${boundary}b`)).toMatch(/64 characters or fewer/i);
  });

  it('rejects a leading digit and embedded spaces with useful errors', () => {
    expect(parseNickname('33alice')).toBeNull();
    expect(nicknameError('33alice')).toMatch(/start with a letter/i);
    expect(parseNickname('alice smith')).toBeNull();
    expect(nicknameError('alice smith')).toMatch(/contain only letters/i);
  });
});
