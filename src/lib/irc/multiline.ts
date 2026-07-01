/**
 * multiline.ts — IRCv3 `draft/multiline` send-side planning.
 *
 * When the composer submits text containing newlines and the server ACKed
 * `draft/multiline`, the message is sent as a client-initiated batch:
 *
 *   BATCH +<ref> draft/multiline <target>
 *   @batch=<ref> PRIVMSG <target> :line one
 *   @batch=<ref> PRIVMSG <target> :line two
 *   BATCH -<ref>
 *
 * Plain newline-separated lines need NO `draft/multiline-concat` tag — the
 * concat tag is only for continuation fragments that must join WITHOUT a
 * newline (we only produce those when a single line exceeds the server's
 * max-bytes and has to be split mid-line).
 *
 * The cap value advertises limits (`draft/multiline=max-bytes=4096,max-lines=24`).
 * We respect both: content is chunked into as many batches as needed, and when
 * limits are absent, conservative defaults apply. Everything here is pure so
 * the chunking maths is unit-testable without a socket.
 */

export interface MultilineLimits {
  /** Max total bytes of message content per batch (sum of line payloads). */
  maxBytes: number;
  /** Max PRIVMSG lines per batch. */
  maxLines: number;
}

/** Spec-suggested floor values — used when the server advertises no limits. */
export const DEFAULT_MULTILINE_LIMITS: MultilineLimits = {
  maxBytes: 4096,
  maxLines: 24,
};

/**
 * Parse a `draft/multiline` cap value ("max-bytes=4096,max-lines=24") into
 * limits, falling back to defaults for absent or malformed tokens.
 */
export function parseMultilineLimits(capValue: string | undefined): MultilineLimits {
  const limits = { ...DEFAULT_MULTILINE_LIMITS };
  if (!capValue) return limits;
  for (const token of capValue.split(',')) {
    const eq = token.indexOf('=');
    if (eq === -1) continue;
    const key = token.slice(0, eq).trim().toLowerCase();
    const num = Number.parseInt(token.slice(eq + 1), 10);
    if (!Number.isFinite(num) || num <= 0) continue;
    if (key === 'max-bytes') limits.maxBytes = num;
    if (key === 'max-lines') limits.maxLines = num;
  }
  return limits;
}

/** One PRIVMSG inside a planned batch. */
export interface MultilinePart {
  text: string;
  /** True when this part continues the previous one WITHOUT a newline. */
  concat: boolean;
}

/** One `BATCH +ref draft/multiline` … `BATCH -ref` group. */
export type MultilineBatch = MultilinePart[];

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Split a single overlong line into fragments of at most `maxBytes` UTF-8
 * bytes without cutting a code point in half.
 */
function splitLineByBytes(line: string, maxBytes: number): string[] {
  const fragments: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const ch of line) { // iterates by code point
    const chBytes = byteLength(ch);
    if (currentBytes + chBytes > maxBytes && current.length > 0) {
      fragments.push(current);
      current = '';
      currentBytes = 0;
    }
    current += ch;
    currentBytes += chBytes;
  }
  if (current.length > 0) fragments.push(current);
  return fragments;
}

/**
 * Plan the batches for a multiline message. Lines are grouped greedily under
 * both limits; when the content exceeds a single batch's budget it degrades
 * to several sequential batches (each still a valid multiline message).
 *
 * Returns `null` when the text has no newline (caller should send normally).
 */
export function planMultilineBatches(
  text: string,
  limits: MultilineLimits = DEFAULT_MULTILINE_LIMITS,
): MultilineBatch[] | null {
  const rawLines = text.split('\n').filter((l) => l.trim().length > 0);
  if (rawLines.length <= 1) return null;

  // Explode overlong lines into concat fragments first, so limits apply to
  // wire-sized parts uniformly.
  const parts: MultilinePart[] = [];
  for (const line of rawLines) {
    if (byteLength(line) <= limits.maxBytes) {
      parts.push({ text: line, concat: false });
    } else {
      const fragments = splitLineByBytes(line, limits.maxBytes);
      fragments.forEach((fragment, i) => {
        parts.push({ text: fragment, concat: i > 0 });
      });
    }
  }

  const batches: MultilineBatch[] = [];
  let current: MultilinePart[] = [];
  let currentBytes = 0;

  for (const part of parts) {
    const partBytes = byteLength(part.text);
    const wouldOverflow =
      current.length > 0 &&
      (current.length + 1 > limits.maxLines || currentBytes + partBytes > limits.maxBytes);
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    // A concat fragment that opens a new batch loses its join partner — it
    // becomes a standalone line, which is the correct degradation (the split
    // point simply behaves like a newline across batches).
    current.push(current.length === 0 ? { ...part, concat: false } : part);
    currentBytes += partBytes;
  }
  if (current.length > 0) batches.push(current);

  return batches;
}

/** A fully-planned send: either raw batch lines or plain PRIVMSG fallbacks. */
export interface MultilineSendPlan {
  /** Raw IRC lines, in order, CRLF-terminated. */
  lines: string[];
}

let _refCounter = 0;

/** Generate a unique-enough client batch reference. */
export function nextBatchRef(): string {
  _refCounter = (_refCounter + 1) % 0xffff;
  return `ml${Date.now().toString(36)}${_refCounter.toString(36)}`;
}

/**
 * Build the raw IRC lines for a multiline send.
 *
 * @param target   channel or nick
 * @param batches  output of planMultilineBatches
 * @param makeRef  batch-ref generator (injectable for tests)
 * @param firstLineTags  extra tags (e.g. `+draft/reply=<id>`) applied to the
 *                       FIRST batch's BATCH command, per spec: tags on the
 *                       batch start apply to the overall message.
 */
export function buildMultilineLines(
  target: string,
  batches: MultilineBatch[],
  makeRef: () => string = nextBatchRef,
  firstLineTags: Record<string, string> = {},
): MultilineSendPlan {
  const lines: string[] = [];
  batches.forEach((batch, batchIdx) => {
    const ref = makeRef();
    const tagStr =
      batchIdx === 0
        ? Object.entries(firstLineTags)
            .map(([k, v]) => (v ? `${k}=${v}` : k))
            .join(';')
        : '';
    lines.push(`${tagStr ? `@${tagStr} ` : ''}BATCH +${ref} draft/multiline ${target}\r\n`);
    for (const part of batch) {
      const tags = part.concat ? `@batch=${ref};draft/multiline-concat` : `@batch=${ref}`;
      lines.push(`${tags} PRIVMSG ${target} :${part.text}\r\n`);
    }
    lines.push(`BATCH -${ref}\r\n`);
  });
  return { lines };
}

// ── Receive-side assembly ─────────────────────────────────────────────────────

/**
 * Join collected multiline parts back into a single message body:
 * concat parts append without a separator, everything else joins with '\n'.
 */
export function assembleMultilineText(parts: MultilinePart[]): string {
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (i === 0) out = part.text;
    else out += (part.concat ? '' : '\n') + part.text;
  }
  return out;
}
