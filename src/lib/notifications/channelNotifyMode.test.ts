import { describe, it, expect } from 'vitest';
import {
  channelNotifyMode,
  shouldNotify,
  modeToLevel,
  levelToMode,
  type NotifyLevel,
} from './channelNotifyMode';

describe('channelNotifyMode pure helpers', () => {
  describe('modeToLevel / levelToMode', () => {
    it('maps mute <-> none and leaves all/mentions unchanged', () => {
      expect(modeToLevel('mute')).toBe('none');
      expect(modeToLevel('all')).toBe('all');
      expect(modeToLevel('mentions')).toBe('mentions');
      expect(levelToMode('none')).toBe('mute');
      expect(levelToMode('all')).toBe('all');
      expect(levelToMode('mentions')).toBe('mentions');
    });
  });

  describe('channelNotifyMode', () => {
    it('defaults to "all" when the channel is unset', () => {
      expect(channelNotifyMode(new Map(), '#nope')).toBe('all');
    });

    it('returns the public mode for a stored level and is case-insensitive', () => {
      const levels = new Map<string, NotifyLevel>([
        ['#quiet', 'none'],
        ['#pings', 'mentions'],
      ]);
      expect(channelNotifyMode(levels, '#QUIET')).toBe('mute');
      expect(channelNotifyMode(levels, '#Pings')).toBe('mentions');
    });
  });

  describe('shouldNotify', () => {
    const levels = new Map<string, NotifyLevel>([
      ['#muted', 'none'],
      ['#mentions', 'mentions'],
    ]);

    it('mute never notifies (mention or not)', () => {
      expect(shouldNotify(levels, '#muted', true)).toBe(false);
      expect(shouldNotify(levels, '#muted', false)).toBe(false);
    });

    it('mentions notifies only on a mention', () => {
      expect(shouldNotify(levels, '#mentions', true)).toBe(true);
      expect(shouldNotify(levels, '#mentions', false)).toBe(false);
    });

    it('all (default when unset) always notifies', () => {
      expect(shouldNotify(levels, '#unset', true)).toBe(true);
      expect(shouldNotify(levels, '#unset', false)).toBe(true);
    });
  });
});
