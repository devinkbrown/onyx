// SPDX-License-Identifier: AGPL-3.0-or-later

import { createBoundedAbort, type BoundedAbort } from '@/lib/net/boundedAbort';

export type HighResolutionCapability = 'unknown' | 'efficient' | 'constrained';
export type SuimyakuStreamQuality = 'auto' | '1080p60' | '4k60';

interface MediaCapabilityInfoLike {
  readonly supported?: boolean;
  readonly smooth?: boolean;
  readonly powerEfficient?: boolean;
}

interface MediaCapabilitiesLike {
  encodingInfo(configuration: MediaEncodingConfigurationLike): Promise<MediaCapabilityInfoLike>;
}

interface MediaEncodingConfigurationLike {
  readonly type: 'record';
  readonly video: {
    readonly contentType: string;
    readonly width: number;
    readonly height: number;
    readonly bitrate: number;
    readonly framerate: number;
  };
}

interface HighResolutionProbeOptions {
  /** null explicitly represents an unsupported browser in deterministic tests. */
  mediaCapabilities?: MediaCapabilitiesLike | null;
  timeoutMs?: number;
  createAbort?: (timeoutMs: number) => BoundedAbort;
}

export interface HighResolutionCapabilityProbe {
  /** Starts at most one bounded probe and deliberately returns immediately. */
  prime(): void;
  /** Synchronous cached result. Pending and failed probes remain unknown. */
  current(): HighResolutionCapability;
}

const PROBE_TIMEOUT_MS = 250;

/**
 * Media Capabilities cannot describe KaguraVis, which remains the unchanged
 * Suimyaku wire codec. This standard VP9 record configuration is therefore
 * used only as a conservative browser/device signal for the existing 4K60 vs
 * 1080p60 local capture choice. It never selects a codec or enters wire data.
 */
const HIGH_RESOLUTION_ENCODING_CONFIGURATION: MediaEncodingConfigurationLike = {
  type: 'record',
  video: {
    contentType: 'video/webm; codecs="vp09.00.10.08"',
    width: 3_840,
    height: 2_160,
    bitrate: 12_000_000,
    framerate: 60,
  },
};

function browserMediaCapabilities(): MediaCapabilitiesLike | null {
  if (typeof navigator === 'undefined') return null;
  try {
    const candidate = (navigator as Navigator & {
      mediaCapabilities?: Partial<MediaCapabilitiesLike>;
    }).mediaCapabilities;
    if (!candidate || typeof candidate.encodingInfo !== 'function') return null;
    return {
      encodingInfo: candidate.encodingInfo.bind(candidate),
    };
  } catch {
    return null;
  }
}

function classify(info: MediaCapabilityInfoLike): HighResolutionCapability {
  if (info.supported === false) return 'constrained';
  if (info.supported !== true) return 'unknown';
  if (info.smooth === false || info.powerEfficient === false) return 'constrained';
  if (info.smooth === true && info.powerEfficient === true) return 'efficient';
  return 'unknown';
}

async function probeOnce(
  mediaCapabilities: MediaCapabilitiesLike,
  timeoutMs: number,
  makeAbort: (timeoutMs: number) => BoundedAbort,
): Promise<HighResolutionCapability> {
  const bounded = makeAbort(timeoutMs);
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: HighResolutionCapability) => {
      if (settled) return;
      settled = true;
      bounded.signal.removeEventListener('abort', onTimeout);
      bounded.dispose();
      resolve(result);
    };
    const onTimeout = () => finish('unknown');

    bounded.signal.addEventListener('abort', onTimeout, { once: true });
    if (bounded.signal.aborted) {
      finish('unknown');
      return;
    }

    let requested: Promise<MediaCapabilityInfoLike>;
    try {
      requested = mediaCapabilities.encodingInfo(HIGH_RESOLUTION_ENCODING_CONFIGURATION);
    } catch {
      finish('unknown');
      return;
    }

    void Promise.resolve(requested).then(
      (info) => finish(classify(info)),
      () => finish('unknown'),
    );
  });
}

/** Create a one-entry, one-request capability cache for the 4K workload. */
export function createHighResolutionCapabilityProbe(
  options: HighResolutionProbeOptions = {},
): HighResolutionCapabilityProbe {
  const mediaCapabilities = options.mediaCapabilities === undefined
    ? browserMediaCapabilities()
    : options.mediaCapabilities;
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const makeAbort = options.createAbort ?? createBoundedAbort;
  let started = false;
  let cached: HighResolutionCapability = 'unknown';

  return {
    prime(): void {
      if (started) return;
      started = true;
      if (!mediaCapabilities) return;
      void probeOnce(mediaCapabilities, timeoutMs, makeAbort).then((result) => {
        cached = result;
      });
    },
    current(): HighResolutionCapability {
      return cached;
    },
  };
}

/** Apply the cached hint only to the existing high-resolution quality choice. */
export function constrainHighResolutionQuality(
  requested: SuimyakuStreamQuality,
  capability: HighResolutionCapability,
): SuimyakuStreamQuality {
  return requested === '4k60' && capability === 'constrained'
    ? '1080p60'
    : requested;
}

export const highResolutionCapability = createHighResolutionCapabilityProbe();
