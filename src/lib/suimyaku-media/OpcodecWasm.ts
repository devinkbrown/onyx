'use client';

/*
 * OpcodecWasm.ts — TypeScript wrapper for the opcodec WASM module.
 *
 * Provides ergonomic TS APIs for:
 *   - opvox audio encode/decode (opvox_wasm_*)
 *   - opvis video encode/decode (opvis_wasm_*)
 *   - NS2 noise suppression (ns2_wasm_*)
 *
 * Usage:
 *   const codec = await OpcodecWasm.load('/opcodec_wasm.js');
 *   const enc   = codec.audioEncoder(48000, 2);
 *   const frame = enc.encode(int16Samples);  // → Uint8Array
 *
 * The WASM module is cached globally; multiple callers share one instance.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const OPVOX_FRAME_48K = 960;   // 20ms at 48kHz
export const OPVOX_FRAME_16K = 320;
export const OPVOX_FRAME_8K  = 160;

export type OpvoxQuality = 0 | 1 | 2 | 3;  // LOW / NORMAL / HIGH / ULTRA

// -------------------------------------------------------------------
// Module type (minimal Emscripten Module surface we use)
// -------------------------------------------------------------------
interface EmModule {
  ccall(name: string, ret: string | null, argtypes: string[], args: unknown[]): unknown;
  HEAPU8:  Uint8Array;
  HEAP16:  Int16Array;
  HEAPF32: Float32Array;
}

// The raw Emscripten module may expose only `cwrap` (this opcodec build does
// not export `ccall`). `cwrap` exposes the same C functions, so we can derive
// an equivalent `ccall` from it.
export interface RawEmModule {
  ccall?(name: string, ret: string | null, argtypes: string[], args: unknown[]): unknown;
  cwrap?(name: string, ret: string | null, argtypes: string[]): (...args: unknown[]) => unknown;
  HEAPU8:  Uint8Array;
  HEAP16:  Int16Array;
  HEAPF32: Float32Array;
}

/**
 * Ensure the loaded module exposes a working `ccall`.
 *
 * Some opcodec WASM builds export `cwrap` but not `ccall`. Calling
 * `m.ccall(...)` on such a module throws "m.ccall is not a function", which the
 * engine surfaces as "Codec unavailable". When `ccall` is missing we synthesize
 * it from `cwrap` (memoizing each wrapped function), giving the rest of this
 * module a single, stable `EmModule.ccall` contract regardless of build flags.
 */
export function normalizeModule(raw: RawEmModule): EmModule {
  if (typeof raw.ccall === 'function') return raw as EmModule;
  if (typeof raw.cwrap !== 'function') {
    throw new Error('opcodec module exposes neither ccall nor cwrap');
  }
  const cwrap = raw.cwrap.bind(raw);
  const cache = new Map<string, (...args: unknown[]) => unknown>();
  const ccall = (name: string, ret: string | null, argtypes: string[], args: unknown[]): unknown => {
    // Key on name + arg signature so a function called with different arg
    // shapes still gets a correctly-typed wrapper.
    const key = `${name}|${ret ?? 'void'}|${argtypes.join(',')}`;
    let fn = cache.get(key);
    if (!fn) {
      fn = cwrap(name, ret, argtypes);
      cache.set(key, fn);
    }
    return fn(...args);
  };
  (raw as RawEmModule & { ccall: typeof ccall }).ccall = ccall;
  return raw as unknown as EmModule;
}

// -------------------------------------------------------------------
// Singleton loader
// -------------------------------------------------------------------
let modulePromise: Promise<EmModule> | null = null;
let _wasmLoadFailed = false;

// Separate singleton for worker context (no shared state with main thread).
let workerModulePromise: Promise<EmModule> | null = null;

async function loadModule(url: string): Promise<EmModule> {
  if (typeof window === 'undefined') throw new Error('WASM requires browser environment');

  const MAX_ATTEMPTS = 3;
  const retryDelays = [500, 1000, 2000];
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, retryDelays[attempt - 1]));
    }
    try {
      const script = document.createElement('script');
      script.src = url + (attempt > 0 ? `?r=${attempt}` : '');
      document.head.appendChild(script);
      await new Promise<void>((res, rej) => {
        script.onload  = () => res();
        script.onerror = () => rej(new Error(`Failed to load ${url} (attempt ${attempt + 1})`));
      });
      const factory = (window as any).createOpcodec as  ((arg?: Record<string, unknown>) => Promise<RawEmModule>) | undefined;
      if (!factory) throw new Error('createOpcodec not found after script load');
      return normalizeModule(await factory());
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS - 1) {
        console.warn(`[opcodec] WASM load attempt ${attempt + 1}/${MAX_ATTEMPTS} failed, retrying...`);
      }
    }
  }
  /* All retries exhausted — emit event so UI can show degraded-mode warning */
  _wasmLoadFailed = true;
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  window.dispatchEvent(new CustomEvent('wasmLoadFailed', { detail: { reason } }));
  throw new Error(`Voice codec unavailable (opcodec_wasm.js not found)`);
}

/**
 * Evaluate the Emscripten bundle text in the worker's GLOBAL scope.
 *
 * `public/opcodec_wasm.js` declares `var createOpcodec = …` at top level. To
 * attach that `var` to the worker global (so `self.createOpcodec` resolves), the
 * script must run in global scope. Indirect `eval` — `(0, eval)(text)` — does
 * exactly that: unlike a direct `eval(text)` call (function/module scope) or a
 * blob `import()` (module scope, where top-level `var` stays module-local and
 * never reaches `self`), indirect eval runs its argument as a global script.
 */
function evalInWorkerGlobalScope(scriptText: string): void {
  // The `(0, eval)` form forces the indirect (global-scope) eval semantics.
  const indirectEval = eval;
  (indirectEval as (s: string) => unknown)(scriptText);
}

/**
 * Load + evaluate the opcodec bundle into the worker global.
 *
 * This worker is spawned as a MODULE worker (`new Worker(url, { type: 'module' })`)
 * because `videoEncodeWorker.ts` uses ES `import`. Two consequences:
 *
 *   - `importScripts` is present on the global but THROWS when called
 *     ("Module scripts don't support importScripts()"), so a
 *     `typeof importScripts === 'function'` guard is not enough — we must guard
 *     the call itself.
 *   - A blob `import()` would run the bundle in MODULE scope, where its
 *     top-level `var createOpcodec` stays module-local and never reaches `self`.
 *
 * So the primary path fetches the bundle text and evaluates it in GLOBAL scope
 * via indirect `eval` (see `evalInWorkerGlobalScope`), which makes the
 * top-level `var createOpcodec` a property of the worker global. `importScripts`
 * is kept only as a best-effort fallback for classic workers and is ignored if
 * it throws.
 */
async function loadModuleInWorker(url: string): Promise<EmModule> {
  const MAX_ATTEMPTS = 3;
  const retryDelays  = [500, 1000, 2000];
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, retryDelays[attempt - 1]));
    try {
      const scriptUrl = url + (attempt > 0 ? `?r=${attempt}` : '');
      // Primary path (works in both module and classic workers): fetch the
      // bundle and evaluate it in GLOBAL scope so its top-level
      // `var createOpcodec` attaches to the worker global.
      const text = await fetch(scriptUrl).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      });
      evalInWorkerGlobalScope(text);

      let factory = (self as any).createOpcodec as  ((arg?: Record<string, unknown>) => Promise<RawEmModule>) | undefined;
      // Classic-worker fallback: if global eval somehow did not define the
      // factory, try importScripts, swallowing its throw in module workers.
      if (typeof factory !== 'function' && typeof (self as any).importScripts === 'function') {
        try {
          (self as any).importScripts(scriptUrl);
          factory = (self as any).createOpcodec as  ((arg?: Record<string, unknown>) => Promise<RawEmModule>) | undefined;
        } catch { /* module worker: importScripts unsupported — ignore */ }
      }
      if (typeof factory !== 'function') {
        throw new Error('createOpcodec not defined after worker script load');
      }

      // Inside a (module) worker the Emscripten bundle derives its
      // `scriptDirectory` from `self.location.href` — the worker chunk's URL,
      // NOT the site root. So its default `locateFile("opcodec_wasm.wasm")`
      // resolves to the wrong path and the dev server returns index.html (an
      // HTML body whose first bytes `3c 21 64 6f` = "<!do" fail the wasm magic
      // check). We sidestep that entirely by fetching the .wasm ourselves,
      // relative to the known JS URL, and handing it to the factory as
      // `wasmBinary` so it never has to locate the file.
      const wasmBinary = await fetchWasmBinary(url);
      // Resolve the bundle URL against the worker origin so a root-relative
      // `url` (e.g. "/opcodec_wasm.js") becomes a valid absolute base for any
      // residual locateFile lookups (the wasmBinary override usually wins).
      const base = new URL(url, (self as any).location?.href ?? 'http://localhost/');
      const moduleArg: Record<string, unknown> = {
        locateFile: (path: string) => new URL(path, base).toString(),
      };
      if (wasmBinary) moduleArg.wasmBinary = wasmBinary;

      return normalizeModule(await factory.call(self, moduleArg));
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS - 1) {
        console.warn(`[opcodec worker] load attempt ${attempt + 1}/${MAX_ATTEMPTS} failed, retrying...`);
      }
    }
  }
  throw new Error(`Voice codec unavailable in worker: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/**
 * Fetch the opcodec `.wasm` binary that sits next to the given JS bundle URL.
 * Returns the bytes, or `null` if the fetch fails (callers then fall back to
 * the module's own locateFile-based loading).
 */
async function fetchWasmBinary(jsUrl: string): Promise<ArrayBuffer | null> {
  // `/path/opcodec_wasm.js` → `/path/opcodec_wasm.wasm`. Strip any query first.
  const noQuery = jsUrl.split('?')[0] ?? jsUrl;
  const wasmUrl = noQuery.replace(/\.js$/, '.wasm');
  try {
    const resp = await fetch(wasmUrl);
    if (!resp.ok) return null;
    const type = resp.headers.get('content-type') ?? '';
    // Guard against an HTML fallback masquerading as the binary.
    if (type.includes('text/html')) return null;
    return await resp.arrayBuffer();
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------
// Audio encoder
// -------------------------------------------------------------------
export class OpvoxEncoder {
  private m: EmModule;
  private handle: number;
  private outPtr: number;
  private ns2Handle: number;
  private readonly OUT_CAP = 256;
  readonly ns2Enabled: boolean;
  framesEncoded = 0;
  dtxSuppressedCount = 0;

  constructor(m: EmModule, sampleRate: number, quality: OpvoxQuality, enableNs2 = true) {
    this.m = m;
    this.ns2Enabled = enableNs2;
    this.handle = m.ccall('opvox_wasm_enc_create', 'number',
                          ['number', 'number'], [sampleRate, quality]) as number;
    if (!this.handle) throw new Error('opvox encoder init failed');
    this.outPtr = m.ccall('opcodec_alloc_u8', 'number', ['number'], [this.OUT_CAP]) as number;
    this.ns2Handle = enableNs2
      ? (m.ccall('ns2_wasm_create', 'number', ['number', 'number'], [sampleRate, 0]) as number)
      : 0;
  }

  /** Encode one 20ms PCM frame. Returns encoded bytes, empty if DTX suppressed, null if gated. */
  encode(samples: Int16Array): Uint8Array | null {
    /* item 30: noise gate — skip NS2 + encode below -45dBFS */
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) sumSq += samples[i]! * samples[i]!;
    const rms = Math.sqrt(sumSq / Math.max(1, samples.length));
    const dbFS = 20 * Math.log10(Math.max(rms / 32768, 1e-10));
    if (dbFS < -45) return null;

    const n = samples.length;
    const pcmPtr = this.m.ccall('opcodec_alloc_i16', 'number', ['number'], [n]) as number;
    this.m.HEAP16.set(samples, pcmPtr >> 1);

    /* NS2 noise suppression (optional) */
    if (this.ns2Handle) {
      this.m.ccall('ns2_wasm_process', null, ['number', 'number', 'number'],
                   [this.ns2Handle, pcmPtr, n]);
    }

    /* DTX — skip frame if silence */
    const active = this.m.ccall('opvox_wasm_dtx_check', 'number',
                                ['number', 'number', 'number'],
                                [this.handle, pcmPtr, n]) as number;
    if (active === 0) {
      this.m.ccall('opcodec_free', null, ['number'], [pcmPtr]);
      this.dtxSuppressedCount++;
      return new Uint8Array(0); /* silence — skip send */
    }

    const len = this.m.ccall('opvox_wasm_encode', 'number',
                             ['number', 'number', 'number', 'number', 'number'],
                             [this.handle, pcmPtr, n, this.outPtr, this.OUT_CAP]) as number;
    this.m.ccall('opcodec_free', null, ['number'], [pcmPtr]);
    if (len <= 0) return new Uint8Array(0);
    this.framesEncoded++;
    return this.m.HEAPU8.slice(this.outPtr, this.outPtr + len);
  }

  /** Item 14: current noise-floor estimate in dBFS from NS2 (-100 if NS2 disabled). */
  getNoiseDb(): number {
    if (!this.ns2Handle) return -100;
    return this.m.ccall('ns2_wasm_get_noise_db', 'number', ['number'], [this.ns2Handle]) as number;
  }

  destroy() {
    /* Item 13: flush buffered audio before tearing down codec */
    if (this.handle) {
      this.m.ccall('opvox_wasm_enc_flush', 'number',
                   ['number', 'number', 'number'],
                   [this.handle, this.outPtr, this.OUT_CAP]);
    }
    this.m.ccall('opcodec_free', null, ['number'], [this.outPtr]);
    this.m.ccall('opvox_wasm_enc_destroy', null, ['number'], [this.handle]);
    if (this.ns2Handle) this.m.ccall('ns2_wasm_destroy', null, ['number'], [this.ns2Handle]);
    this.handle = 0;
    this.ns2Handle = 0;
  }
}

// -------------------------------------------------------------------
// Audio decoder
// -------------------------------------------------------------------
export class OpvoxDecoder {
  private m: EmModule;
  private handle: number;
  private outPtr: number;
  private dtxDecHandle: number;
  readonly frameSize: number;
  private readonly sampleRate: number;
  framesDecoded = 0;

  constructor(m: EmModule, sampleRate: number, quality: OpvoxQuality) {
    this.m = m;
    this.sampleRate = sampleRate;
    this.frameSize = sampleRate === 48000 ? OPVOX_FRAME_48K
                   : sampleRate === 16000 ? OPVOX_FRAME_16K
                   : OPVOX_FRAME_8K;
    this.handle = m.ccall('opvox_wasm_dec_create', 'number',
                          ['number', 'number'], [sampleRate, quality]) as number;
    if (!this.handle) throw new Error('opvox decoder init failed');
    this.outPtr = m.ccall('opcodec_alloc_i16', 'number',
                          ['number'], [this.frameSize]) as number;
    /* Item 12: DTX comfort noise decoder — generates background noise during silence */
    this.dtxDecHandle = (m.ccall('dtx_wasm_dec_create', 'number',
                                 ['number'], [sampleRate]) as number) || 0;
  }

  /** Feed a SID (silence insertion descriptor) frame from the remote encoder's DTX. */
  setSid(sidFrame: Uint8Array): void {
    if (!this.dtxDecHandle || sidFrame.length === 0) return;
    const p = this.m.ccall('opcodec_alloc_u8', 'number', ['number'], [sidFrame.length]) as number;
    this.m.HEAPU8.set(sidFrame, p);
    this.m.ccall('dtx_wasm_set_sid', null, ['number', 'number', 'number'],
                 [this.dtxDecHandle, p, sidFrame.length]);
    this.m.ccall('opcodec_free', null, ['number'], [p]);
  }

  /** Decode one opvox frame. Pass null/empty for PLC (or DTX comfort noise). Returns Int16Array. */
  decode(frame: Uint8Array | null): Int16Array {
    const inLen = frame ? frame.length : 0;

    if (inLen === 0) {
      /* Item 12: generate comfort noise during DTX silence */
      if (this.dtxDecHandle) {
        this.m.ccall('dtx_wasm_generate', null,
                     ['number', 'number', 'number'],
                     [this.dtxDecHandle, this.outPtr, this.frameSize]);
      } else {
        this.m.HEAP16.fill(0, this.outPtr >> 1, (this.outPtr >> 1) + this.frameSize);
      }
      return new Int16Array(
        this.m.HEAP16.buffer.slice(this.outPtr, this.outPtr + this.frameSize * 2)
      );
    }

    let inPtr = 0;
    if (frame && inLen > 0) {
      inPtr = this.m.ccall('opcodec_alloc_u8', 'number', ['number'], [inLen]) as number;
      this.m.HEAPU8.set(frame, inPtr);
    }
    this.m.ccall('opvox_wasm_decode', 'number',
                 ['number', 'number', 'number', 'number', 'number'],
                 [this.handle, inPtr, inLen, this.outPtr, this.frameSize]);
    if (inPtr) this.m.ccall('opcodec_free', null, ['number'], [inPtr]);
    this.framesDecoded++;
    return new Int16Array(
      this.m.HEAP16.buffer.slice(this.outPtr, this.outPtr + this.frameSize * 2)
    );
  }

  destroy() {
    this.m.ccall('opcodec_free', null, ['number'], [this.outPtr]);
    this.m.ccall('opvox_wasm_dec_destroy', null, ['number'], [this.handle]);
    if (this.dtxDecHandle) this.m.ccall('dtx_wasm_dec_destroy', null, ['number'], [this.dtxDecHandle]);
    this.handle = 0;
    this.dtxDecHandle = 0;
  }
}

// -------------------------------------------------------------------
// Video encoder
// -------------------------------------------------------------------
export type OpvisProfile = 'camera' | 'screen';

export class OpvisEncoder {
  private m: EmModule;
  private handle: number;
  private outPtr: number;
  readonly width: number;
  readonly height: number;
  readonly profile: OpvisProfile;
  private readonly OUT_CAP: number;
  /** Frames between forced keyframes (screen share ≈5s; camera ≈1s) */
  readonly keyframeInterval: number;
  /** Target frame rate requested by the capture pipeline. */
  readonly targetFps: number;
  private frameCount = 0;

  constructor(m: EmModule, width: number, height: number, quality: number, profile: OpvisProfile = 'camera', fps = 60) {
    this.m       = m;
    this.width   = width;
    this.height  = height;
    this.profile = profile;
    this.OUT_CAP = width * height * 2 + 65536;

    /* Screen share keeps source frame rate; only the keyframe interval changes. */
    const encQuality  = profile === 'screen' ? Math.max(quality, 75) : quality;
    this.targetFps = Math.max(1, Math.min(60, Math.round(fps)));
    this.keyframeInterval = profile === 'screen' ? this.targetFps * 5 : this.targetFps;

    this.handle = m.ccall('opvis_wasm_enc_create', 'number',
                          ['number', 'number', 'number'],
                          [width, height, encQuality]) as number;
    if (!this.handle) throw new Error('opvis encoder init failed');
    this.outPtr = m.ccall('opcodec_alloc_u8', 'number', ['number'], [this.OUT_CAP]) as number;
  }

  /**
   * Encode one YUV420P frame.
   * y, u, v: plane data (sizes: w*h, w/2*h/2, w/2*h/2).
   * forceKey: true to force I-frame (also auto-forced per keyframeInterval).
   * Returns encoded bytes.
   */
  encode(y: Uint8Array, u: Uint8Array, v: Uint8Array, forceKey = false): Uint8Array {
    const isKey = forceKey || (this.frameCount % this.keyframeInterval === 0);
    this.frameCount++;
    forceKey = isKey;
    const yPtr = this.m.ccall('opcodec_alloc_u8', 'number', ['number'], [y.length]) as number;
    const uPtr = this.m.ccall('opcodec_alloc_u8', 'number', ['number'], [u.length]) as number;
    const vPtr = this.m.ccall('opcodec_alloc_u8', 'number', ['number'], [v.length]) as number;
    this.m.HEAPU8.set(y, yPtr);
    this.m.HEAPU8.set(u, uPtr);
    this.m.HEAPU8.set(v, vPtr);
    const len = this.m.ccall('opvis_wasm_enc_encode', 'number',
                             ['number','number','number','number','number','number','number'],
                             [this.handle, yPtr, uPtr, vPtr,
                              this.outPtr, this.OUT_CAP, forceKey ? 1 : 0]) as number;
    this.m.ccall('opcodec_free', null, ['number'], [yPtr]);
    this.m.ccall('opcodec_free', null, ['number'], [uPtr]);
    this.m.ccall('opcodec_free', null, ['number'], [vPtr]);
    if (len <= 0) return new Uint8Array(0);
    return this.m.HEAPU8.slice(this.outPtr, this.outPtr + len);
  }

  setQuality(q: number) {
    this.m.ccall('opvis_wasm_enc_set_quality', null, ['number', 'number'], [this.handle, q]);
    this.frameCount = 0; /* item 27: reset so next frame forces a keyframe */
  }

  destroy() {
    this.m.ccall('opcodec_free', null, ['number'], [this.outPtr]);
    this.m.ccall('opvis_wasm_enc_destroy', null, ['number'], [this.handle]);
    this.handle = 0;
  }
}

// -------------------------------------------------------------------
// Video decoder
// -------------------------------------------------------------------
export class OpvisDecoder {
  private m: EmModule;
  private handle: number;
  private yPtr: number;
  private uPtr: number;
  private vPtr: number;
  readonly width: number;
  readonly height: number;

  constructor(m: EmModule, width: number, height: number) {
    this.m = m; this.width = width; this.height = height;
    const uvSize = (width >> 1) * (height >> 1);
    this.handle = m.ccall('opvis_wasm_dec_create', 'number',
                          ['number', 'number'], [width, height]) as number;
    if (!this.handle) throw new Error('opvis decoder init failed');
    this.yPtr = m.ccall('opcodec_alloc_u8', 'number', ['number'], [width * height]) as number;
    this.uPtr = m.ccall('opcodec_alloc_u8', 'number', ['number'], [uvSize]) as number;
    this.vPtr = m.ccall('opcodec_alloc_u8', 'number', ['number'], [uvSize]) as number;
  }

  /** Decode one opvis frame. Returns {y, u, v} planes. */
  decode(frame: Uint8Array): { y: Uint8Array; u: Uint8Array; v: Uint8Array } | null {
    const inPtr = this.m.ccall('opcodec_alloc_u8', 'number', ['number'], [frame.length]) as number;
    this.m.HEAPU8.set(frame, inPtr);
    const ret = this.m.ccall('opvis_wasm_dec_decode', 'number',
                             ['number','number','number','number','number','number'],
                             [this.handle, inPtr, frame.length,
                              this.yPtr, this.uPtr, this.vPtr]) as number;
    this.m.ccall('opcodec_free', null, ['number'], [inPtr]);
    if (ret !== 0) return null;
    const uvSize = (this.width >> 1) * (this.height >> 1);
    return {
      y: this.m.HEAPU8.slice(this.yPtr, this.yPtr + this.width * this.height),
      u: this.m.HEAPU8.slice(this.uPtr, this.uPtr + uvSize),
      v: this.m.HEAPU8.slice(this.vPtr, this.vPtr + uvSize),
    };
  }

  destroy() {
    this.m.ccall('opcodec_free', null, ['number'], [this.yPtr]);
    this.m.ccall('opcodec_free', null, ['number'], [this.uPtr]);
    this.m.ccall('opcodec_free', null, ['number'], [this.vPtr]);
    this.m.ccall('opvis_wasm_dec_destroy', null, ['number'], [this.handle]);
    this.handle = 0;
  }
}

// -------------------------------------------------------------------
// Factory
// -------------------------------------------------------------------
export class OpcodecWasm {
  private constructor(private readonly m: EmModule) {}

  /** True if the WASM codec failed to load after all retries. Voice/video will be unavailable. */
  static get loadFailed(): boolean { return _wasmLoadFailed; }

  static async load(url = '/opcodec_wasm.js'): Promise<OpcodecWasm> {
    if (!modulePromise) modulePromise = loadModule(url);
    return new OpcodecWasm(await modulePromise);
  }

  /**
   * Worker-safe variant of `load`.  Must be called from inside a Web Worker
   * (no `document`/`window` available).  Uses `importScripts` or a fetch-based
   * fallback instead of a `<script>` tag.
   *
   * A separate promise singleton is kept so the worker does not share the main
   * thread's module state (they run in different JS realms).
   */
  static async loadInWorker(url = '/opcodec_wasm.js'): Promise<OpcodecWasm> {
    if (!workerModulePromise) workerModulePromise = loadModuleInWorker(url);
    return new OpcodecWasm(await workerModulePromise);
  }

  audioEncoder(sampleRate: number, quality: OpvoxQuality = 2, enableNs2 = true): OpvoxEncoder {
    return new OpvoxEncoder(this.m, sampleRate, quality, enableNs2);
  }

  audioDecoder(sampleRate: number, quality: OpvoxQuality = 2): OpvoxDecoder {
    return new OpvoxDecoder(this.m, sampleRate, quality);
  }

  videoEncoder(width: number, height: number, quality: number, profile: OpvisProfile = 'camera', fps = 60): OpvisEncoder {
    return new OpvisEncoder(this.m, width, height, quality, profile, fps);
  }

  videoDecoder(width: number, height: number): OpvisDecoder {
    return new OpvisDecoder(this.m, width, height);
  }
}

// -------------------------------------------------------------------
// YUV ↔ Canvas helpers
// -------------------------------------------------------------------

/** Convert YUV420P planes to RGBA for rendering on a canvas. */
export function yuv420ToRgba(
  y: Uint8Array, u: Uint8Array, v: Uint8Array,
  width: number, height: number,
  out: Uint8ClampedArray,
): void {
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const yVal = y[row * width + col]!;
      const uvRow = row >> 1;
      const uvCol = col >> 1;
      const uvIdx = uvRow * (width >> 1) + uvCol;
      const uVal = u[uvIdx]! - 128;
      const vVal = v[uvIdx]! - 128;
      const r = Math.max(0, Math.min(255, yVal + 1.402 * vVal));
      const g = Math.max(0, Math.min(255, yVal - 0.344 * uVal - 0.714 * vVal));
      const b = Math.max(0, Math.min(255, yVal + 1.772 * uVal));
      const i = (row * width + col) * 4;
      out[i] = r; out[i+1] = g; out[i+2] = b; out[i+3] = 255;
    }
  }
}

/** Sample a canvas ImageData frame to YUV420P. */
export function rgbaToYuv420(
  rgba: Uint8ClampedArray,
  width: number, height: number,
): { y: Uint8Array; u: Uint8Array; v: Uint8Array } {
  const yPlane = new Uint8Array(width * height);
  const uvW = width >> 1, uvH = height >> 1;
  const uPlane = new Uint8Array(uvW * uvH);
  const vPlane = new Uint8Array(uvW * uvH);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = (row * width + col) * 4;
      const r = rgba[i]!, g = rgba[i+1]!, b = rgba[i+2]!;
      yPlane[row * width + col] =
        Math.max(0, Math.min(255, 0.299*r + 0.587*g + 0.114*b));
    }
  }
  for (let row = 0; row < uvH; row++) {
    for (let col = 0; col < uvW; col++) {
      const i = (row * 2 * width + col * 2) * 4;
      const r = rgba[i]!, g = rgba[i+1]!, b = rgba[i+2]!;
      uPlane[row * uvW + col] =
        Math.max(0, Math.min(255, -0.168736*r - 0.331264*g + 0.5*b + 128));
      vPlane[row * uvW + col] =
        Math.max(0, Math.min(255,  0.5*r - 0.418688*g - 0.081312*b + 128));
    }
  }
  return { y: yPlane, u: uPlane, v: vPlane };
}
