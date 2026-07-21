// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * codecFailure — pure classification + copy for codec init/mismatch toasts.
 *
 * Research R5 (onyx-cadence-voice-video-ux): when encoder init / fallback
 * exhausts or peer decode is incompatible, surface a fail-closed toast —
 * never silent black video. DOM-free for unit tests.
 */

export type CodecFailureKind =
  | 'encoder_init'
  | 'wasm_load'
  | 'decode'
  | 'mismatch'
  | 'unknown';

export type CodecFailureMediaKind = 'voice' | 'video' | 'screen';

/** Heuristic classification of engine/worker error strings. */
export function classifyCodecFailure(message: string): CodecFailureKind {
  const m = message.toLowerCase();
  if (
    m.includes('wasm load')
    || m.includes('codec unavailable')
    || m.includes('opcodec')
    || (m.includes('wasm') && m.includes('fail'))
  ) {
    return 'wasm_load';
  }
  if (
    m.includes('encoder init')
    || m.includes('cadencevis encoder')
    || m.includes('cadencevox encoder')
    || m.includes('video encoder')
    || m.includes('audio encoder')
  ) {
    return 'encoder_init';
  }
  if (
    m.includes('incompat')
    || m.includes('unsupported codec')
    || m.includes('codec mismatch')
    || m.includes('unknown codec')
  ) {
    return 'mismatch';
  }
  if (
    m.includes('decode')
    || m.includes('decoder')
  ) {
    return 'decode';
  }
  return 'unknown';
}

/** True when the message is codec-related (prefer a dedicated toast title). */
export function isCodecFailureMessage(message: string): boolean {
  return classifyCodecFailure(message) !== 'unknown'
    || /codec|encoder|decoder|wasm/i.test(message);
}

export interface CodecFailureToastCopy {
  readonly title: string;
  readonly description: string;
}

/** Stable toast copy — never silent; never blame the user. */
export function codecFailureToastCopy(
  kind: CodecFailureKind,
  opts?: {
    readonly mediaKind?: CodecFailureMediaKind;
    readonly peer?: string;
    readonly rawMessage?: string;
  },
): CodecFailureToastCopy {
  const peer = opts?.peer?.trim();
  const media = opts?.mediaKind ?? 'video';
  const mediaLabel = media === 'screen' ? 'screenshare' : media === 'voice' ? 'audio' : 'video';

  switch (kind) {
    case 'wasm_load':
      return {
        title: 'Media codec unavailable',
        description: 'Could not load the media codec. Video and enhanced audio are disabled in this browser.',
      };
    case 'encoder_init':
      return {
        title: 'Camera could not start',
        description: 'Video encoding failed after trying every quality. Your camera preview may show, but others cannot see you.',
      };
    case 'mismatch':
      return {
        title: 'Incompatible video codec',
        description: peer
          ? `Cannot play ${mediaLabel} from ${peer} — codecs do not match.`
          : `Cannot play this ${mediaLabel} — codecs do not match.`,
      };
    case 'decode':
      return {
        title: 'Video unavailable',
        description: peer
          ? `Could not decode ${mediaLabel} from ${peer}. The stream may use an incompatible codec.`
          : `Could not decode this ${mediaLabel} stream.`,
      };
    case 'unknown': {
      const raw = opts?.rawMessage?.trim();
      return {
        title: 'Media codec error',
        description: raw && raw.length > 0 && raw.length <= 200
          ? raw
          : `A media codec error stopped ${mediaLabel}.`,
      };
    }
  }
}

/**
 * Rate-limit peer decode toasts: announce on the first failure, then stay
 * quiet until the key is cleared (call end / peer leave).
 */
export function shouldAnnounceDecodeError(
  alreadyAnnounced: ReadonlySet<string>,
  peerKey: string,
): boolean {
  if (!peerKey) return false;
  return !alreadyAnnounced.has(peerKey);
}

/** Build a stable rate-limit key for decode announcements. */
export function decodeFailureKey(peer: string, mediaKind: CodecFailureMediaKind): string {
  return `${peer.toLowerCase()}:${mediaKind}`;
}
