// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  COMPOSER_DRAFTS_KEY,
  MAX_DRAFT_LEN,
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

  it('round-trips independent per-channel drafts through storage', () => {
    // Arrange
    let drafts = setComposerDraft({}, '#alpha', 'alpha draft');
    drafts = setComposerDraft(drafts, '#bravo', 'bravo draft');
    drafts = setComposerDraft(drafts, '#ALPHA', 'edited alpha draft');
    const storage = makeStorage();

    // Act
    saveComposerDrafts(drafts, storage);
    const restored = loadComposerDrafts(storage);

    // Assert
    expect(restored).toEqual({
      '#alpha': 'edited alpha draft',
      '#bravo': 'bravo draft',
    });
    expect(getComposerDraft(restored, '#Alpha')).toBe('edited alpha draft');
    expect(getComposerDraft(restored, '#Bravo')).toBe('bravo draft');
  });

  it('persists clear-on-send for one channel without dropping other drafts', () => {
    // Arrange
    let drafts = setComposerDraft({}, '#alpha', 'queued send');
    drafts = setComposerDraft(drafts, '#bravo', 'keep editing');
    const storage = makeStorage();
    saveComposerDrafts(drafts, storage);

    // Act
    const afterSend = setComposerDraft(loadComposerDrafts(storage), '#ALPHA', '');
    saveComposerDrafts(afterSend, storage);
    const restored = loadComposerDrafts(storage);

    // Assert
    expect(restored).toEqual({ '#bravo': 'keep editing' });
    expect(getComposerDraft(restored, '#alpha')).toBe('');
    expect(getComposerDraft(restored, '#bravo')).toBe('keep editing');
  });

  it('removes the persisted key when clear-on-send empties the final draft', () => {
    // Arrange
    let drafts = setComposerDraft({}, '#alpha', 'queued send');
    const storage = makeStorage();
    saveComposerDrafts(drafts, storage);

    // Act
    drafts = setComposerDraft(loadComposerDrafts(storage), '#alpha', '');
    saveComposerDrafts(drafts, storage);

    // Assert
    expect(storage.getItem(COMPOSER_DRAFTS_KEY)).toBeNull();
    expect(loadComposerDrafts(storage)).toEqual({});
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

  it('preserves unicode targets and draft bodies while rejecting empty unicode targets', () => {
    // Arrange
    const unicodeDraft = 'naive cafe\u0301\nemoji: \u{1F512}\u{1F4AC}\nrtl: \u05E9\u05DC\u05D5\u05DD';
    let drafts = setComposerDraft({}, ' #CAFÉ ', unicodeDraft);
    drafts = setComposerDraft(drafts, '\u3000\u3000', 'blank target');
    drafts = setComposerDraft(drafts, '#empty-unicode', '');
    const storage = makeStorage();

    // Act
    saveComposerDrafts(drafts, storage);
    const restored = loadComposerDrafts(storage);

    // Assert
    expect(restored).toEqual({ '#café': unicodeDraft });
    expect(getComposerDraft(restored, '#café')).toBe(unicodeDraft);
    expect(getComposerDraft(restored, '\u3000')).toBe('');
    expect(getComposerDraft(restored, '#empty-unicode')).toBe('');
  });

  it('round-trips target normalization, truncation, and invalid entry removal through persistence', () => {
    // Arrange
    const storage = makeStorage();
    const tooLong = 'x'.repeat(9000);

    // Act
    saveComposerDrafts(
      {
        ' #MixedCase ': 'normalized',
        '#too-long': tooLong,
        '#empty': '',
        '   ': 'blank target',
      },
      storage,
    );
    const restored = loadComposerDrafts(storage);

    // Assert
    expect(restored).toEqual({
      '#mixedcase': 'normalized',
      '#too-long': 'x'.repeat(MAX_DRAFT_LEN),
    });
  });

  it('removes the persisted key when sanitization drops every supplied draft', () => {
    // Arrange
    const storage = makeStorage({ [COMPOSER_DRAFTS_KEY]: JSON.stringify({ '#old': 'draft' }) });

    // Act
    saveComposerDrafts({ '#empty': '', '   ': 'blank target' }, storage);

    // Assert
    expect(storage.getItem(COMPOSER_DRAFTS_KEY)).toBeNull();
  });

  it('returns an empty draft for missing targets without mutating the draft map', () => {
    // Arrange
    const drafts = { '#root': 'kept' };

    // Act
    const missing = getComposerDraft(drafts, '#missing');
    const blank = getComposerDraft(drafts, '   ');

    // Assert
    expect(missing).toBe('');
    expect(blank).toBe('');
    expect(drafts).toEqual({ '#root': 'kept' });
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
