// -------------------------------------------------------------------
// Inbound MCHUNK reassembly
// -------------------------------------------------------------------

interface InboundChunk {
  ftype:    string;
  total:    number;
  received: number;
  bytes:    number;
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

  // Maximum pending assemblies. These are intentionally conservative: enough
  // room for several in-flight keyframes, but bounded under malformed streams.
  private static readonly MAX_ACTIVE_SLOTS = 128;
  private static readonly MAX_PENDING_PARTS = ChunkAssembler.MAX_CHUNKS * 8;
  private static readonly MAX_PENDING_BYTES = ChunkAssembler.MAX_FRAME_BYTES * 8;

  // Stale slot expiry: discard incomplete assemblies after 8 s.
  private static readonly TIMEOUT_MS = 8_000;

  // GC runs probabilistically every ~64 ingests to bound memory.
  private ingestCount = 0;
  private static readonly GC_INTERVAL = 64;
  private pendingParts = 0;
  private pendingBytes = 0;

  private key(nick: string, ftype: string, fid: number) {
    return `${nick.toLowerCase()}\0${ftype}\0${fid}`;
  }

  private removeSlot(key: string, slot: InboundChunk | undefined = this.slots.get(key)) {
    if (!slot) return;
    this.pendingParts -= slot.total;
    this.pendingBytes -= slot.bytes;
    this.slots.delete(key);
  }

  private evictOldestUntil(extraParts: number): boolean {
    while (
      this.slots.size >= ChunkAssembler.MAX_ACTIVE_SLOTS ||
      this.pendingParts + extraParts > ChunkAssembler.MAX_PENDING_PARTS
    ) {
      const oldest = this.slots.entries().next().value as [string, InboundChunk] | undefined;
      if (!oldest) break;
      this.removeSlot(oldest[0], oldest[1]);
    }
    return (
      this.slots.size < ChunkAssembler.MAX_ACTIVE_SLOTS &&
      this.pendingParts + extraParts <= ChunkAssembler.MAX_PENDING_PARTS
    );
  }

  private evictBytes(extraBytes: number, preserveKey: string): boolean {
    if (this.pendingBytes + extraBytes <= ChunkAssembler.MAX_PENDING_BYTES) return true;
    for (const [key, slot] of this.slots) {
      if (key === preserveKey) continue;
      this.removeSlot(key, slot);
      if (this.pendingBytes + extraBytes <= ChunkAssembler.MAX_PENDING_BYTES) return true;
    }
    return false;
  }

  ingest(
    nick: string, ftype: string,
    fid: number, n: number, total: number,
    chunk: Uint8Array,
  ): Uint8Array | null {
    // ── Input validation ──────────────────────────────────────────
    if (
      !Number.isSafeInteger(fid) ||
      fid < 0 ||
      !Number.isSafeInteger(total) ||
      !Number.isSafeInteger(n) ||
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
    const now = Date.now();
    const k = this.key(nick, ftype, fid);
    let slot = this.slots.get(k);

    if (slot && slot.expires <= now) {
      this.removeSlot(k, slot);
      slot = undefined;
    }

    if (!slot) {
      this.gc(now);
      if (!this.evictOldestUntil(total)) return null;
      slot = {
        ftype, total, received: 0, bytes: 0,
        parts: new Array<Uint8Array | null>(total).fill(null),
        expires: now + ChunkAssembler.TIMEOUT_MS,
      };
      this.slots.set(k, slot);
      this.pendingParts += total;
    } else if (slot.total !== total || slot.ftype !== ftype) {
      // A conflicting total for the same (nick, ftype, fid) is a malformed
      // stream — drop the assembly to avoid array-bounds corruption.
      this.removeSlot(k, slot);
      return null;
    }

    // ── Duplicate / bounds guard ──────────────────────────────────
    const idx = n - 1;
    // idx is already bounded by the n > total check above plus
    // slot.total === total, so idx < slot.parts.length is guaranteed.
    if (slot.parts[idx] !== null) return null;  // duplicate

    if (!this.evictBytes(chunk.length, k)) {
      this.removeSlot(k, slot);
      return null;
    }

    slot.parts[idx] = chunk;
    slot.received++;
    slot.bytes += chunk.length;
    this.pendingBytes += chunk.length;

    if (slot.bytes > ChunkAssembler.MAX_FRAME_BYTES) {
      this.removeSlot(k, slot);
      return null;
    }

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
      this.removeSlot(k, slot);
      return null;
    }

    const out = new Uint8Array(totalBytes);
    let pos = 0;
    for (const p of slot.parts) {
      out.set(p!, pos);
      pos += p!.length;
    }
    this.removeSlot(k, slot);
    return out;
  }

  gc(now = Date.now()) {
    for (const [k, s] of this.slots) {
      if (s.expires <= now) this.removeSlot(k, s);
    }
  }
}
