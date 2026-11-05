export type ClientLineRejection =
  | 'empty-line'
  | 'invalid-unicode'
  | 'line-control'
  | 'line-too-long'
  | 'invalid-tags'
  | 'invalid-command'
  | 'invalid-parameter'
  | 'too-many-parameters';

export type ClientLineValidation =
  | { readonly valid: true; readonly byteLength: number }
  | { readonly valid: false; readonly reason: ClientLineRejection };

const encoder = new TextEncoder();
const MAX_LINE_BYTES = 8191;
const MAX_TAG_SEGMENT_BYTES = 4094;
const MAX_TAGS = 32;
const MAX_TAG_KEY_BYTES = 96;
const MAX_PARAMS = 15;
const MAX_COMMAND_BYTES = 64;

function tagKeyChar(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)
    || (code >= 0x30 && code <= 0x39) || code === 0x2d || code === 0x2e || code === 0x2f;
}

function validTags(raw: string): boolean {
  if (raw.length === 0 || encoder.encode(raw).byteLength > MAX_TAG_SEGMENT_BYTES) return false;
  let count = 0;
  let start = 0;
  for (let index = 0; index <= raw.length; index += 1) {
    if (index !== raw.length && raw.charCodeAt(index) !== 0x3b) continue;
    const tag = raw.slice(start, index);
    if (tag.length === 0 || ++count > MAX_TAGS) return false;
    const equals = tag.indexOf('=');
    const key = equals < 0 ? tag : tag.slice(0, equals);
    if (key.length === 0 || key.length > MAX_TAG_KEY_BYTES) return false;
    const keyStart = key.charCodeAt(0) === 0x2b ? 1 : 0;
    if (keyStart === key.length) return false;
    for (let keyIndex = keyStart; keyIndex < key.length; keyIndex += 1) {
      if (!tagKeyChar(key.charCodeAt(keyIndex))) return false;
    }
    if (equals >= 0) {
      for (let valueIndex = equals + 1; valueIndex < tag.length; valueIndex += 1) {
        const code = tag.charCodeAt(valueIndex);
        if (code === 0 || code === 0x0d || code === 0x0a || code === 0x20) return false;
      }
    }
    start = index + 1;
  }
  return true;
}

function countParams(body: string, start: number): { readonly count: number; readonly reason: 'invalid-command' | 'invalid-parameter' | null } {
  let cursor = start;
  while (body.charCodeAt(cursor) === 0x20) cursor += 1;
  if (cursor >= body.length) return { count: 0, reason: 'invalid-command' };

  if (body.charCodeAt(cursor) === 0x3a) {
    const prefixEnd = body.indexOf(' ', cursor);
    if (prefixEnd < 0 || prefixEnd === cursor + 1) return { count: 0, reason: 'invalid-parameter' };
    for (let index = cursor + 1; index < prefixEnd; index += 1) {
      const code = body.charCodeAt(index);
      if (code <= 0x20 || code === 0x7f) return { count: 0, reason: 'invalid-parameter' };
    }
    cursor = prefixEnd;
    while (body.charCodeAt(cursor) === 0x20) cursor += 1;
  }

  const commandStart = cursor;
  while (cursor < body.length && body.charCodeAt(cursor) !== 0x20) cursor += 1;
  const command = body.slice(commandStart, cursor);
  if (command.length === 0 || command.length > MAX_COMMAND_BYTES || !/^[A-Za-z0-9]+$/u.test(command)) {
    return { count: -1, reason: 'invalid-command' };
  }

  let count = 0;
  while (cursor < body.length) {
    while (body.charCodeAt(cursor) === 0x20) cursor += 1;
    if (cursor >= body.length) break;
    count += 1;
    if (body.charCodeAt(cursor) === 0x3a) break;
    const paramStart = cursor;
    while (cursor < body.length && body.charCodeAt(cursor) !== 0x20) cursor += 1;
    for (let index = paramStart; index < cursor; index += 1) {
      const code = body.charCodeAt(index);
      if (code <= 0x20 || code === 0x7f) return { count, reason: 'invalid-parameter' };
    }
  }
  return { count, reason: null };
}

/** Validate one unframed IRC application line without changing or trimming it. */
export function validateClientLine(line: string): ClientLineValidation {
  if (line.length === 0) return { valid: false, reason: 'empty-line' };
  for (const character of line) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return { valid: false, reason: 'invalid-unicode' };
    if (codePoint === 0 || codePoint === 0x0d || codePoint === 0x0a) return { valid: false, reason: 'line-control' };
  }
  const byteLength = encoder.encode(line).byteLength;
  if (byteLength > MAX_LINE_BYTES) return { valid: false, reason: 'line-too-long' };

  let cursor = 0;
  while (line.charCodeAt(cursor) === 0x20) cursor += 1;
  let hadTags = false;
  if (line.charCodeAt(cursor) === 0x40) {
    hadTags = true;
    const tagEnd = line.indexOf(' ', cursor);
    if (tagEnd < 0 || !validTags(line.slice(cursor + 1, tagEnd))) return { valid: false, reason: 'invalid-tags' };
    cursor = tagEnd;
    while (line.charCodeAt(cursor) === 0x20) cursor += 1;
  }
  if (cursor >= line.length) return { valid: false, reason: hadTags ? 'invalid-tags' : 'invalid-command' };
  const parsed = countParams(line, cursor);
  if (parsed.reason !== null) return { valid: false, reason: parsed.reason };
  if (parsed.count > MAX_PARAMS) return { valid: false, reason: 'too-many-parameters' };
  return { valid: true, byteLength };
}
