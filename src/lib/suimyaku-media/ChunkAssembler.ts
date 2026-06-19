'use client';

// -------------------------------------------------------------------
// Inbound MCHUNK reassembly
// -------------------------------------------------------------------

interface InboundChunk {
  ftype:    string;
  total:    number;
  received: number;
  parts:    (Uint8Array | null)[];
  expires:  number;
}

export class ChunkAssembler {
  private slots = new Map<string, InboundChunk>();

  // Maximum number of chunks per frame. Must match the sender's
  // MAX_MCHUNK_TOTAL in MediaEngine.ts: a frame is split into 120-byte
  // chunks, so a full 65535-byte frame is ~547 chunks. A too-low cap here
  // silently drops every real video keyframe. MAX_FRAME_BYTES below is the
  // real size guard; this just bounds the per-slot parts array.
  private static readonly MAX_CHUNKS = 65535;

  // Maximum byte size of a single chunk payload.
  private static readonly MAX_CHUNK_BYTES = 65536;

  // Maximum byte size of a fully reassembled frame.
  private static readonly MAX_FRAME_BYTES = 120 * 65535;

  // Stale slot expiry: discard incomplete assemblies after 8 s.
  private static readonly TIMEOUT_MS = 8_000;

  // GC runs probabilistically every ~64 ingests to bound memory.
  private ingestCount = 0;
  private static readonly GC_INTERVAL = 64;

  private key(nick: string, fid: number) { return `${nick}:${fid}`; }

  ingest(
    nick: string, ftype: string,
    fid: number, n: number, total: number,
    chunk: Uint8Array,
  ): Uint8Array | null {
    // ── Input validation ──────────────────────────────────────────
    if (
      total <= 0 ||
      n <= 0 ||
      n > total ||
      total > ChunkAssembler.MAX_CHUNKS ||
      chunk.length === 0 ||
      chunk.length > ChunkAssembler.MAX_CHUNK_BYTES
    ) {
      return null;
    }

    // ── Slot lifecycle ────────────────────────────────────────────
    const k = this.key(nick, fid);
    let slot = this.slots.get(k);

    if (!slot) {
      slot = {
        ftype, total, received: 0,
        parts: new Array<Uint8Array | null>(total).fill(null),
        expires: Date.now() + ChunkAssembler.TIMEOUT_MS,
      };
      this.slots.set(k, slot);
    } else if (slot.total !== total) {
      // A conflicting total for the same (nick, fid) is a malformed
      // stream — drop the chunk to avoid array-bounds corruption.
      return null;
    }

    // ── Duplicate / bounds guard ──────────────────────────────────
    const idx = n - 1;
    // idx is already bounded by the n > total check above plus
    // slot.total === total, so idx < slot.parts.length is guaranteed.
    if (slot.parts[idx] !== null) return null;  // duplicate

    slot.parts[idx] = chunk;
    slot.received++;

    // ── Probabilistic GC ──────────────────────────────────────────
    if ((++this.ingestCount & (ChunkAssembler.GC_INTERVAL - 1)) === 0) {
      this.gc();
    }

    if (slot.received < slot.total) return null;

    // ── Reassemble ────────────────────────────────────────────────
    let totalBytes = 0;
    for (const p of slot.parts) {
      if (!p) return null;   // should be unreachable given received === total
      totalBytes += p.length;
    }

    // Enforce assembled-frame size cap.
    if (totalBytes > ChunkAssembler.MAX_FRAME_BYTES) {
      this.slots.delete(k);
      return null;
    }

    const out = new Uint8Array(totalBytes);
    let pos = 0;
    for (const p of slot.parts) {
      out.set(p!, pos);
      pos += p!.length;
    }
    this.slots.delete(k);
    return out;
  }

  gc() {
    const now = Date.now();
    for (const [k, s] of this.slots) {
      if (s.expires < now) this.slots.delete(k);
    }
  }
}
