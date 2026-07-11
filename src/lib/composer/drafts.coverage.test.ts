// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  COMPOSER_DRAFTS_KEY,
  getComposerDraft,
  loadComposerDrafts,
  saveComposerDrafts,
  setComposerDraft,
} from './drafts';

function makeStorage(seed: Record<string, string> = {}): Storage {
  const values: Record<string, string> = { ...seed };
  return {
    get length() { return Object.keys(values).length; },
    key(index: number) { return Object.keys(values)[index] ?? null; },
    getItem(key: string) { return values[key] ?? null; },
    setItem(key: string, value: string) { values[key] = value; },
    removeItem(key: string) { delete values[key]; },
    clear() { for (const key of Object.keys(values)) delete values[key]; },
  } as Storage;
}

describe('composer draft persistence coverage', () => {
  it('restores only valid target-scoped string drafts from hostile storage', () => {
    // Arrange
    const storage = makeStorage({
      [COMPOSER_DRAFTS_KEY]: JSON.stringify({
        ' #General ': 'channel draft',
        Alice: 'dm draft',
        '   ': 'blank target draft',
        '#empty': '',
        '#nested': { text: 'not a string' },
        '#array': ['not a string'],
      }),
    });

    // Act
    const drafts = loadComposerDrafts(storage);

    // Assert
    expect(drafts).toEqual({
      '#general': 'channel draft',
      alice: 'dm draft',
    });
  });

  it('keeps channel and dm drafts isolated across save and restore', () => {
    // Arrange
    let drafts = setComposerDraft({}, '#General', 'room text');
    drafts = setComposerDraft(drafts, 'general', 'dm text');
    drafts = setComposerDraft(drafts, '#GENERAL', 'edited room text');
    const storage = makeStorage();

    // Act
    saveComposerDrafts(drafts, storage);
    const restored = loadComposerDrafts(storage);

    // Assert
    expect(getComposerDraft(restored, '#general')).toBe('edited room text');
    expect(getComposerDraft(restored, 'general')).toBe('dm text');
    expect(Object.keys(restored).sort()).toEqual(['#general', 'general']);
  });

  it('treats a whitespace target as absent but preserves whitespace draft text', () => {
    // Arrange
    const original = { '#root': 'kept' };

    // Act
    const unchanged = setComposerDraft(original, '   ', 'lost');
    const withWhitespaceDraft = setComposerDraft(original, '#space', ' \n\t ');
    const cleared = setComposerDraft(withWhitespaceDraft, '#space', '');

    // Assert
    expect(unchanged).toBe(original);
    expect(withWhitespaceDraft).toEqual({ '#root': 'kept', '#space': ' \n\t ' });
    expect(cleared).toEqual({ '#root': 'kept' });
  });

  it('round-trips multiline draft bodies without flattening batch-shaped text', () => {
    // Arrange
    const multiline = [
      'first line',
      'second line',
      '',
      '@batch=ref PRIVMSG #room :not a real outgoing line yet',
    ].join('\n');
    const drafts = setComposerDraft({}, '#room', multiline);
    const storage = makeStorage();

    // Act
    saveComposerDrafts(drafts, storage);
    const restored = loadComposerDrafts(storage);

    // Assert
    expect(getComposerDraft(restored, '#ROOM')).toBe(multiline);
  });

  it('fails closed when stored JSON is malformed or storage throws', () => {
    // Arrange
    const malformed = makeStorage({ [COMPOSER_DRAFTS_KEY]: '{"#room":' });
    const throwingStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    };

    // Act
    const malformedDrafts = loadComposerDrafts(malformed);
    const throwingDrafts = loadComposerDrafts(throwingStorage);
    const saveResult = () => saveComposerDrafts({ '#room': 'draft' }, throwingStorage);

    // Assert
    expect(malformedDrafts).toEqual({});
    expect(throwingDrafts).toEqual({});
    expect(saveResult).not.toThrow();
  });
});
