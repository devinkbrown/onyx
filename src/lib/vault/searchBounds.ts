// SPDX-License-Identifier: AGPL-3.0-or-later

/** Maximum message/sender text examined by one local-search candidate. */
export const SEARCH_CORPUS_TEXT_MAX = 32 * 1024;
/** Maximum user query text accepted by any local-search boundary. */
export const SEARCH_QUERY_TEXT_MAX = 512;
/** Maximum body text carried from a match into reactive/UI result state. */
export const SEARCH_RESULT_TEXT_MAX = 4096;

function safeSlice(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const sliced = value.slice(0, maxLength);
  const finalCodeUnit = sliced.charCodeAt(sliced.length - 1);
  return finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff
    ? sliced.slice(0, -1)
    : sliced;
}

/** Bound one hostile/stale stored field before lowercase, token, or regex work. */
export function boundedSearchField(value: string): string {
  return safeSlice(value, SEARCH_CORPUS_TEXT_MAX);
}

export function boundedSearchResultText(value: string, query = ''): string {
  if (value.length <= SEARCH_RESULT_TEXT_MAX) return value;
  const boundedCorpus = boundedSearchField(value);
  const needle = boundedSearchQuery(query).toLocaleLowerCase();
  const matchAt = needle ? boundedCorpus.toLocaleLowerCase().indexOf(needle) : -1;
  if (matchAt < 0 || matchAt < SEARCH_RESULT_TEXT_MAX) {
    return safeSlice(value, SEARCH_RESULT_TEXT_MAX);
  }

  const leadingEllipsis = '…';
  const trailingEllipsis = matchAt + needle.length < value.length ? '…' : '';
  const contentLength = SEARCH_RESULT_TEXT_MAX - leadingEllipsis.length - trailingEllipsis.length;
  const start = Math.max(0, matchAt - Math.floor(contentLength / 3));
  return `${leadingEllipsis}${safeSlice(value.slice(start), contentLength)}${trailingEllipsis}`;
}

/** Slice before trimming so leading hostile whitespace cannot force a full scan. */
export function boundedSearchQuery(value: string): string {
  return boundedSearchQueryInput(value).trim();
}

/** Bound live input while preserving spaces during editing. */
export function boundedSearchQueryInput(value: string): string {
  return safeSlice(value, SEARCH_QUERY_TEXT_MAX);
}

/** Build one candidate without first concatenating unbounded stored fields. */
export function buildBoundedSearchText(...fields: readonly string[]): string {
  let output = '';
  for (const field of fields) {
    const separator = output.length > 0 ? ' ' : '';
    const remaining = SEARCH_CORPUS_TEXT_MAX - output.length - separator.length;
    if (remaining <= 0) break;
    output += separator + safeSlice(field, remaining);
  }
  return output;
}
