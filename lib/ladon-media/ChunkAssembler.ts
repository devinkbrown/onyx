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
  private static readonly TIMEOUT_MS = 30000;
  private static readonly MAX_CHUNKS = 65535;
  private static readonly MAX_CHUNK_BYTES = 120;
  private static readonly MAX_FRAME_BYTES = ChunkAssembler.MAX_CHUNKS * ChunkAssembler.MAX_CHUNK_BYTES;

  private key(nick: string, fid: number) { return `${nick}:${fid}`; }

  ingest(
    nick: string, ftype: string,
    fid: number, n: number, total: number,
    chunk: Uint8Array,
  ): Uint8Array | null {
    if (
      total <= 0 ||
      n <= 0 ||
      n > total ||
      total > ChunkAssembler.MAX_CHUNKS ||
      chunk.length > ChunkAssembler.MAX_CHUNK_BYTES ||
      total * ChunkAssembler.MAX_CHUNK_BYTES > ChunkAssembler.MAX_FRAME_BYTES
    ) {
      return null;
    }

    const k = this.key(nick, fid);
    let slot = this.slots.get(k);
    if (!slot) {
      slot = {
        ftype, total, received: 0,
        parts: new Array(total).fill(null),
        expires: Date.now() + ChunkAssembler.TIMEOUT_MS,
      };
      this.slots.set(k, slot);
    }

    const idx = n - 1;
    if (idx < 0 || idx >= total || slot.parts[idx]) return null;
    slot.parts[idx] = chunk;
    slot.received++;
    if (slot.received < total) return null;

    let totalBytes = 0;
    for (const p of slot.parts) {
      if (!p) return null;
      totalBytes += p.length;
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
