// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * src/lib/search/fuzzy.ts
 *
 * Public re-export of the spotlight fuzzy-match utilities so callers outside
 * the spotlight module can import from a stable path:
 *
 *   import { fuzzyMatch, fuzzyFilter } from '@/lib/search/fuzzy';
 *
 * The actual implementation lives in src/chat/spotlight/fuzzy.ts to preserve
 * locality with the component that first defined it. This barrel keeps the
 * lib/search path as a well-typed façade.
 */
export {
  fuzzyMatch,
  fuzzyFilter,
  type FuzzyMatch,
  type FuzzyResult,
  type HighlightRange,
} from '@/chat/spotlight/fuzzy';
