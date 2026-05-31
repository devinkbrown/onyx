/**
 * videoEncodeWorker.ts — Off-main-thread video capture/encode worker.
 *
 * PROTOCOL (MessageEvent.data shapes):
 *
 * Main → Worker:
 *   { type: 'init', wasmUrl: string, encWidth: number, encHeight: number,
 *     encQuality: number, encProfile: 'camera'|'screen', encFps: number,
 *     track: MediaStreamTrack }
 *     — Start the capture/encode loop. `track` is transferred in the same
 *       postMessage call via the transfer list.
 *
 *   { type: 'tier', tier: 0|1|2|3 }
 *     — Update the adaptive-resolution tier. The worker scales its draw
 *       canvas to the tier's resolution on the next VideoFrame.
 *
 *   { type: 'keyreq' }
 *     — Force the next encode to be a keyframe.
 *
 *   { type: 'stop' }
 *     — Tear down reader and encoder; worker exits after this.
 *
 * Worker → Main:
 *   { type: 'encoded', data: Uint8Array, ftype: 'KEYFRAME'|'FRAME' }
 *     — One encoded opvis frame. `data.buffer` is transferred (zero-copy).
 *
 *   { type: 'ready' }
 *     — WASM loaded and encoder initialised; capture loop running.
 *
 *   { type: 'error', msg: string }
 *     — Fatal or non-fatal diagnostic.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Tier → draw resolution mapping:
 *
 *   Tier 0 — full profile resolution  (no downscale)
 *   Tier 1 — 1920 × 1080  (cap at 1080p)
 *   Tier 2 — 1280 × 720   (cap at 720p)
 *   Tier 3 — 854  × 480   (cap at 480p; audio-only gate handled in engine)
 *
 * When the draw size is smaller than the encoder dimensions the OffscreenCanvas
 * is created at the tier size AND a new OpvisEncoder is created at that size
 * so the WASM codec always receives frames at its configured dimensions.
 *
 * Re-initialising the encoder on a tier change is intentional: the codec
 * must be consistent with the YUV plane sizes it receives.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { OpcodecWasm, OpvisEncoder, rgbaToYuv420 } from './OpcodecWasm';
import type { OpvisProfile } from './OpcodecWasm';
import type { NetworkQualityTier } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Tier → capped resolution table
// ─────────────────────────────────────────────────────────────────────────────

type TierResolution = { width: number; height: number };

const TIER_RESOLUTIONS: Record<NetworkQualityTier, TierResolution> = {
  0: { width: Infinity, height: Infinity },  // use full profile resolution
  1: { width: 1920,     height: 1080 },
  2: { width: 1280,     height:  720 },
  3: { width:  854,     height:  480 },
};

function tierDimensions(
  tier: NetworkQualityTier,
  profileWidth: number,
  profileHeight: number,
): TierResolution {
  const cap = TIER_RESOLUTIONS[tier];
  if (cap.width === Infinity) return { width: profileWidth, height: profileHeight };
  // Maintain aspect ratio; cap by width, derive height proportionally.
  const aspectRatio = profileHeight / profileWidth;
  const w = Math.min(profileWidth, cap.width);
  // Force even dimensions (YUV420 planes require even w/h).
  const rawH = Math.min(profileHeight, cap.height === Infinity ? profileHeight : Math.round(w * aspectRatio));
  return {
    width:  w % 2 === 0 ? w : w - 1,
    height: rawH % 2 === 0 ? rawH : rawH - 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker state
// ─────────────────────────────────────────────────────────────────────────────

interface WorkerState {
  wasm:         OpcodecWasm;
  enc:          OpvisEncoder;
  reader:       ReadableStreamDefaultReader<VideoFrame>;
  profileWidth: number;
  profileHeight: number;
  profileQuality: number;
  profileFps:   number;
  encProfile:   OpvisProfile;
  tier:         NetworkQualityTier;
  forceKey:     boolean;
  stopped:      boolean;
}

let state: WorkerState | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Encoder initialisation (also called on tier change)
// ─────────────────────────────────────────────────────────────────────────────

function buildEncoder(
  wasm: OpcodecWasm,
  tier: NetworkQualityTier,
  profileWidth: number,
  profileHeight: number,
  profileQuality: number,
  encProfile: OpvisProfile,
  profileFps: number,
): OpvisEncoder {
  const { width, height } = tierDimensions(tier, profileWidth, profileHeight);
  return wasm.videoEncoder(width, height, profileQuality, encProfile, profileFps);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main capture loop — runs until stopped or reader closes
// ─────────────────────────────────────────────────────────────────────────────

async function captureLoop(s: WorkerState): Promise<void> {
  /* Track the current draw dimensions so we can rebuild the OffscreenCanvas
   * when the tier changes without allocating one per frame. */
  let drawW = s.enc.width;
  let drawH = s.enc.height;
  let canvas = new OffscreenCanvas(drawW, drawH);
  let ctx    = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (s.stopped) break;

    let result: ReadableStreamReadResult<VideoFrame>;
    try {
      result = await s.reader.read();
    } catch {
      // Track ended or reader cancelled — normal shutdown path.
      break;
    }
    if (result.done) break;

    const frame = result.value;

    /* Rebuild canvas + encoder if tier changed (draw dimensions differ). */
    const { width: newW, height: newH } = tierDimensions(
      s.tier, s.profileWidth, s.profileHeight,
    );
    if (newW !== drawW || newH !== drawH) {
      drawW = newW;
      drawH = newH;
      canvas = new OffscreenCanvas(drawW, drawH);
      ctx    = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
      /* Rebuild encoder at new dimensions. */
      s.enc.destroy();
      s.enc = buildEncoder(
        s.wasm, s.tier,
        s.profileWidth, s.profileHeight,
        s.profileQuality, s.encProfile, s.profileFps,
      );
    }

    if (!ctx) { frame.close(); continue; }

    /* Draw the VideoFrame into the (possibly downscaled) OffscreenCanvas. */
    ctx.drawImage(frame as unknown as ImageBitmap, 0, 0, drawW, drawH);
    frame.close();

    /* Rasterise to RGBA and convert to YUV420P. */
    let imageData: ImageData;
    try {
      imageData = ctx.getImageData(0, 0, drawW, drawH);
    } catch {
      continue;
    }
    const { y, u, v } = rgbaToYuv420(imageData.data, drawW, drawH);

    const forceKey = s.forceKey;
    s.forceKey = false;

    /* Encode via WASM. The keyframe flag is also driven internally by
     * OpvisEncoder.keyframeInterval — we only override via forceKey. */
    let encoded: Uint8Array;
    try {
      encoded = s.enc.encode(y, u, v, forceKey);
    } catch {
      continue;
    }
    if (!encoded.length) continue;

    const ftype: 'KEYFRAME' | 'FRAME' = encoded[0] === 0xFF ? 'KEYFRAME' : 'FRAME';

    /* Transfer the buffer to avoid a copy across the thread boundary.
     * Use the WindowPostMessageOptions overload so TypeScript accepts the
     * transfer list in a DOM-typed module context. */
    const transfer = encoded.buffer.slice(0) as ArrayBuffer;
    self.postMessage(
      { type: 'encoded', data: new Uint8Array(transfer), ftype },
      { transfer: [transfer] },
    );
  }

  /* Clean up on exit. */
  if (state?.enc) { state.enc.destroy(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Message dispatcher
// ─────────────────────────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data as {
    type: 'init' | 'tier' | 'keyreq' | 'stop';
    wasmUrl?: string;
    encWidth?: number;
    encHeight?: number;
    encQuality?: number;
    encProfile?: OpvisProfile;
    encFps?: number;
    track?: MediaStreamTrack;
    tier?: NetworkQualityTier;
  };

  switch (msg.type) {
    case 'init': {
      if (state) {
        /* Already initialised — shouldn't happen but guard anyway. */
        self.postMessage({ type: 'error', msg: 'Worker already initialised' });
        return;
      }
      const {
        wasmUrl = '/opcodec_wasm.js',
        encWidth  = 1920,
        encHeight = 1080,
        encQuality = 70,
        encProfile = 'camera' as OpvisProfile,
        encFps    = 60,
        track,
      } = msg;

      if (!track) {
        self.postMessage({ type: 'error', msg: 'No track provided to worker' });
        return;
      }

      /* Load the WASM codec inside the worker (worker-safe path via importScripts
       * / fetch — see OpcodecWasm.loadInWorker). */
      let wasm: OpcodecWasm;
      try {
        wasm = await OpcodecWasm.loadInWorker(wasmUrl);
      } catch (err) {
        self.postMessage({ type: 'error', msg: `WASM load failed in worker: ${err}` });
        return;
      }

      const tier: NetworkQualityTier = 0;
      let enc: OpvisEncoder;
      try {
        enc = buildEncoder(wasm, tier, encWidth, encHeight, encQuality, encProfile, encFps);
      } catch (err) {
        self.postMessage({ type: 'error', msg: `Encoder init failed: ${err}` });
        return;
      }

      /* Pull VideoFrames from the track via MediaStreamTrackProcessor. */
      const processor = new (globalThis as any).MediaStreamTrackProcessor({ track });
      const reader: ReadableStreamDefaultReader<VideoFrame> =
        (processor.readable as ReadableStream<VideoFrame>).getReader();

      state = {
        wasm,
        enc,
        reader,
        profileWidth:  encWidth,
        profileHeight: encHeight,
        profileQuality: encQuality,
        profileFps:    encFps,
        encProfile,
        tier,
        forceKey: false,
        stopped:  false,
      };

      self.postMessage({ type: 'ready' });
      captureLoop(state).catch(err => {
        self.postMessage({ type: 'error', msg: `Capture loop error: ${err}` });
      });
      break;
    }

    case 'tier': {
      if (!state) return;
      const newTier = msg.tier ?? 0;
      if (newTier !== state.tier) {
        state.tier = newTier;
        /* Encoder and canvas are rebuilt lazily at the start of the next frame
         * inside captureLoop to avoid races. */
      }
      break;
    }

    case 'keyreq': {
      if (state) state.forceKey = true;
      break;
    }

    case 'stop': {
      if (state) {
        state.stopped = true;
        try { await state.reader.cancel(); } catch { /* ignore */ }
        state = null;
      }
      break;
    }
  }
};
