import { describe, expect, it } from 'vitest';
import {
  makeAccountId,
  makeConversationId,
  makeEndpointId,
  makeMessageId,
  makeNetworkId,
} from './contracts';

const LEGACY_CONTROL = /[\u0000-\u0020\u007f]/u;

const constructors: readonly {
  readonly name: string;
  readonly maxBytes: number;
  readonly make: (value: unknown) => string | null;
}[] = [
  { name: 'account', maxBytes: 64, make: makeAccountId },
  { name: 'network', maxBytes: 128, make: makeNetworkId },
  { name: 'endpoint', maxBytes: 256, make: makeEndpointId },
  { name: 'conversation', maxBytes: 512, make: makeConversationId },
  { name: 'message', maxBytes: 512, make: makeMessageId },
];

function legacyIdentity(value: unknown, maxBytes: number): string | null {
  return typeof value === 'string'
    && value.length > 0
    && new TextEncoder().encode(value).byteLength <= maxBytes
    && !LEGACY_CONTROL.test(value)
    ? value
    : null;
}

function cases(maxBytes: number): readonly { readonly label: string; readonly value: unknown }[] {
  const printableAscii = Array.from({ length: 94 }, (_, index) => String.fromCharCode(index + 0x21)).join('');
  const bmpTwoByteCount = Math.floor(maxBytes / 2);
  const bmpThreeByteCount = Math.floor(maxBytes / 3);
  const astralCount = Math.floor(maxBytes / 4);
  const replacementByteCount = Math.floor(maxBytes / 3);
  return [
    { label: 'empty', value: '' },
    { label: 'null', value: null },
    { label: 'non-string number', value: 7 },
    { label: 'non-string object', value: { toString: () => 'identifier' } },
    { label: 'non-string symbol', value: Symbol('identifier') },
    { label: 'all printable ASCII', value: printableAscii },
    { label: 'ASCII at byte limit', value: 'a'.repeat(maxBytes) },
    { label: 'ASCII over byte limit', value: 'a'.repeat(maxBytes + 1) },
    { label: 'ASCII leading punctuation', value: '!' },
    { label: 'ASCII trailing punctuation', value: '~' },
    { label: 'NUL control', value: '\u0000' },
    { label: 'space control', value: ' ' },
    { label: 'DEL control', value: '\u007f' },
    { label: 'LF suffix control', value: 'room\n' },
    { label: 'CR suffix control', value: 'room\r' },
    { label: 'CRLF suffix control', value: 'room\r\n' },
    { label: 'TAB suffix control', value: 'room\t' },
    { label: 'Unicode line separator stays legacy-valid', value: 'room\u2028topic' },
    { label: 'two-byte BMP at limit', value: 'é'.repeat(bmpTwoByteCount) },
    { label: 'two-byte BMP over limit', value: 'é'.repeat(bmpTwoByteCount + 1) },
    { label: 'three-byte BMP within limit', value: '界'.repeat(bmpThreeByteCount) },
    { label: 'three-byte BMP over limit', value: '界'.repeat(bmpThreeByteCount + 1) },
    { label: 'astral pair at byte limit', value: '😀'.repeat(astralCount) },
    { label: 'astral pair over byte limit', value: '😀'.repeat(astralCount + 1) },
    { label: 'lone surrogate near limit', value: '\ud800'.repeat(replacementByteCount) },
    { label: 'lone surrogate over limit', value: '\ud800'.repeat(replacementByteCount + 1) },
    { label: 'mixed BMP astral and combining marks', value: 'name-é-😀-e\u0301' },
  ];
}

describe('identity fast path matches the legacy UTF-8 validator', () => {
  for (const constructor of constructors) {
    it(`${constructor.name} identity preserves byte limits and control rejection`, () => {
      for (const candidate of cases(constructor.maxBytes)) {
        expect(
          constructor.make(candidate.value),
          `${constructor.name}: ${candidate.label}`,
        ).toBe(legacyIdentity(candidate.value, constructor.maxBytes));
      }
    });
  }
});
