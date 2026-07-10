import { describe, expect, it } from 'vitest';
import { activityShort, parseActivity } from './activity';

describe('parseActivity', () => {
  it('returns null for an empty status', () => {
    const status = '';

    const activity = parseActivity(status);

    expect(activity).toBeNull();
  });

  it('returns null when no emoji or keyword activity matches', () => {
    const status = 'available for chat';

    const activity = parseActivity(status);

    expect(activity).toBeNull();
  });

  it('parses gaming activity from an emoji prefix', () => {
    const status = '🎮 Counter-Strike 2';

    const activity = parseActivity(status);

    expect(activity).toEqual({ emoji: '🎮', typeLabel: 'PLAYING A GAME', text: 'Counter-Strike 2' });
  });

  it('parses coding activity from an emoji prefix', () => {
    const status = '💻 Onyx';

    const activity = parseActivity(status);

    expect(activity).toEqual({ emoji: '💻', typeLabel: 'CODING', text: 'Onyx' });
  });

  it('parses music activity from an emoji prefix', () => {
    const status = '🎵 Blue Monday';

    const activity = parseActivity(status);

    expect(activity).toEqual({ emoji: '🎵', typeLabel: 'LISTENING TO MUSIC', text: 'Blue Monday' });
  });

  it('parses watching activity from an emoji prefix', () => {
    const status = '📺 Deep Space Nine';

    const activity = parseActivity(status);

    expect(activity).toEqual({ emoji: '📺', typeLabel: 'WATCHING', text: 'Deep Space Nine' });
  });

  it('parses streaming activity from an emoji prefix', () => {
    const status = '🔴 Ship stream';

    const activity = parseActivity(status);

    expect(activity).toEqual({ emoji: '🔴', typeLabel: 'LIVE ON STREAM', text: 'Ship stream' });
  });

  it('parses studying activity from the extra emoji prefix', () => {
    const status = '📚 Protocol notes';

    const activity = parseActivity(status);

    expect(activity).toEqual({ emoji: '📚', typeLabel: 'STUDYING', text: 'Protocol notes' });
  });

  it('returns null for an emoji prefix without trailing text', () => {
    const status = '🎮   ';

    const activity = parseActivity(status);

    expect(activity).toBeNull();
  });

  it('parses playing activity from a keyword case-insensitively', () => {
    const status = 'PLAYING Quake';

    const activity = parseActivity(status);

    expect(activity).toEqual({ emoji: '🎮', typeLabel: 'PLAYING A GAME', text: 'Quake' });
  });

  it('parses listening activity with a song and artist', () => {
    const status = 'listening Blue Monday by New Order';

    const activity = parseActivity(status);

    expect(activity).toEqual({ emoji: '🎵', typeLabel: 'LISTENING TO MUSIC', text: 'Blue Monday — New Order' });
  });

  it('parses listening-to activity without an artist', () => {
    const status = 'listening to ambient radio';

    const activity = parseActivity(status);

    expect(activity).toEqual({ emoji: '🎵', typeLabel: 'LISTENING TO MUSIC', text: 'ambient radio' });
  });

  it('parses watching activity from a keyword', () => {
    const status = 'watching Foundation';

    const activity = parseActivity(status);

    expect(activity).toEqual({ emoji: '📺', typeLabel: 'WATCHING', text: 'Foundation' });
  });

  it('parses coding activity from the direct keyword form', () => {
    const status = 'coding release notes';

    const activity = parseActivity(status);

    expect(activity).toEqual({ emoji: '💻', typeLabel: 'CODING', text: 'release notes' });
  });

  it('parses coding activity from the coding-on keyword form', () => {
    const status = 'coding on presence';

    const activity = parseActivity(status);

    expect(activity).toEqual({ emoji: '💻', typeLabel: 'CODING', text: 'presence' });
  });

  it('parses streaming activity from a keyword', () => {
    const status = 'streaming ladder matches';

    const activity = parseActivity(status);

    expect(activity).toEqual({ emoji: '🔴', typeLabel: 'LIVE ON STREAM', text: 'ladder matches' });
  });

  it('trims leading keyword whitespace but preserves trailing text', () => {
    const status = 'playing   spaced title  ';

    const activity = parseActivity(status);

    expect(activity).toEqual({ emoji: '🎮', typeLabel: 'PLAYING A GAME', text: 'spaced title  ' });
  });
});

describe('activityShort', () => {
  it('returns one word without an ellipsis', () => {
    const activity = { emoji: '🎮', typeLabel: 'PLAYING A GAME', text: 'Quake' };

    const label = activityShort(activity);

    expect(label).toBe('Quake');
  });

  it('returns two words without an ellipsis', () => {
    const activity = { emoji: '💻', typeLabel: 'CODING', text: 'release notes' };

    const label = activityShort(activity);

    expect(label).toBe('release notes');
  });

  it('truncates longer activity text to two words with an ellipsis', () => {
    const activity = { emoji: '📺', typeLabel: 'WATCHING', text: 'Deep Space Nine' };

    const label = activityShort(activity);

    expect(label).toBe('Deep Space…');
  });

  it('normalizes leading, trailing, and repeated whitespace', () => {
    const activity = { emoji: '🎵', typeLabel: 'LISTENING TO MUSIC', text: '  Blue   Monday  ' };

    const label = activityShort(activity);

    expect(label).toBe('Blue Monday');
  });
});
