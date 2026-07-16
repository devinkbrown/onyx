// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { SuimyakuMediaEngine } from './MediaEngine';
import type { SuimyakuMediaCallbacks } from './types';

function callbacks(overrides: Partial<SuimyakuMediaCallbacks> = {}): SuimyakuMediaCallbacks {
  return {
    onCallState: vi.fn(),
    onPeerLeft: vi.fn(),
    onLocalStream: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

describe('SuimyakuMediaEngine control payload boundary', () => {
  it('does not partially populate peers from wrong-shape roster fields', () => {
    const engine = new SuimyakuMediaEngine(callbacks(), { kind: 'voice' });

    expect(() => {
      engine.handleMediaMessage('server', '#room', 'ROSTER', JSON.stringify({
        voice: 'Alice',
        video: [{ nick: 'not-a-string-entry' }],
      }));
    }).not.toThrow();
    expect(engine.getPeers().size).toBe(0);

    engine.handleMediaMessage('server', '#room', 'ROSTER', JSON.stringify({
      voice: ['Alice', 'alice', 7],
      video: ['Bob'],
    }));
    expect([...engine.getPeers().keys()]).toEqual(['Alice', 'Bob']);
  });

  it('publishes only validated room statistics and bounded reactions', () => {
    const onRoomStats = vi.fn();
    const onReaction = vi.fn();
    const engine = new SuimyakuMediaEngine(callbacks({ onRoomStats, onReaction }), { kind: 'voice' });

    engine.handleMediaMessage('server', '#room', 'STATS', '{"active_senders":"many"}');
    engine.handleMediaMessage('server', '#room', 'STATS', JSON.stringify({
      active_senders: 2,
      total_viewers: 8,
      video_fps: 60,
      audio_kbps: 128,
    }));
    engine.handleMediaMessage('Alice', '#room', 'REACTION', `  ${'🔥'.repeat(100)}  `);

    expect(onRoomStats).toHaveBeenCalledOnce();
    expect(onRoomStats).toHaveBeenCalledWith('#room', {
      active_senders: 2,
      total_viewers: 8,
      video_fps: 60,
      audio_kbps: 128,
    });
    expect(Array.from(onReaction.mock.calls[0]?.[1] as string)).toHaveLength(64);
  });

  it('contains malformed base64 in chunk, legacy-frame, and screen-data paths', () => {
    const engine = new SuimyakuMediaEngine(callbacks(), { kind: 'voice' });

    expect(() => engine.handleMediaMessage('Alice', '#room', 'MCHUNK/AUDIO/1/1/1', '%%%bad%%%'))
      .not.toThrow();
    expect(() => engine.handleMediaMessage('Alice', '#room', 'AUDIO_FRAME/Alice', '%%%bad%%%'))
      .not.toThrow();
    expect(() => engine.handleMediaMessage('Alice', '#room', 'SCREEN_DATA', '%%%bad%%%'))
      .not.toThrow();
    expect(engine.getPeers().size).toBe(0);
  });

  it('bounds channel roster creation before firing near-capacity state', () => {
    const onRoomNearFull = vi.fn();
    const engine = new SuimyakuMediaEngine(callbacks({ onRoomNearFull }), { kind: 'voice' });
    const roster = Array.from({ length: 200 }, (_, index) => ({ nick: `nick-${index}` }));

    engine.handleMediaMessage('server', '#room', 'CHANNEL_INFO', JSON.stringify(roster));
    engine.handleMediaMessage('server', '#room', 'CHANNEL_INFO', JSON.stringify(roster));

    expect(engine.getPeers().size).toBe(64);
    expect(onRoomNearFull).toHaveBeenCalledOnce();
  });
});
