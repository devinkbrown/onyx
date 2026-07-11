// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * suggestTopic.ts — deterministic local labels for named-conversation splits.
 */

import { isValidTopicLabel } from './topics';

const MAX_TOPIC_TERMS = 3;

const TOPIC_STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'because',
  'before',
  'being',
  'could',
  'from',
  'have',
  'here',
  'into',
  'just',
  'like',
  'line',
  'lines',
  'message',
  'messages',
  'need',
  'note',
  'once',
  'only',
  'over',
  'room',
  'that',
  'their',
  'then',
  'there',
  'they',
  'this',
  'with',
  'would',
  'and',
  'are',
  'can',
  'for',
  'has',
  'not',
  'our',
  'the',
  'was',
  'will',
  'you',
]);

export type SuggestTopicMessage = {
  text?: string | null;
  plaintext?: string | null;
};

export type SuggestTopicInput = string | SuggestTopicMessage | readonly SuggestTopicMessage[];

type TermScore = {
  term: string;
  count: number;
  firstSeen: number;
};

export function suggestTopic(input: SuggestTopicInput): string {
  const scores = new Map<string, TermScore>();
  let ordinal = 0;

  const addText = (text: string): void => {
    const seenInText = new Set<string>();
    for (const term of topicTermsFromText(text)) {
      if (seenInText.has(term)) continue;
      seenInText.add(term);

      const existing = scores.get(term);
      if (existing) {
        scores.set(term, { ...existing, count: existing.count + 1 });
      } else {
        scores.set(term, { term, count: 1, firstSeen: ordinal });
      }
      ordinal += 1;
    }
  };

  if (typeof input === 'string') {
    addText(input);
  } else if (isMessageList(input)) {
    for (const message of input) {
      addText(message.plaintext ?? message.text ?? '');
    }
  } else {
    addText(input.plaintext ?? input.text ?? '');
  }

  const terms = [...scores.values()]
    .sort((a, b) => b.count - a.count || a.firstSeen - b.firstSeen || a.term.localeCompare(b.term))
    .map((score) => score.term);

  return fitTopicLabel(terms);
}

function isMessageList(input: SuggestTopicInput): input is readonly SuggestTopicMessage[] {
  return Array.isArray(input);
}

function topicTermsFromText(text: string): string[] {
  const terms: string[] = [];
  const withoutUrls = text.toLowerCase().replace(/https?:\/\/\S+/gu, ' ');

  for (const raw of withoutUrls.match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []) {
    const term = normalizeTopicTerm(raw.replace(/^-+|-+$/g, ''));
    if (term.length < 3 || TOPIC_STOP_WORDS.has(term)) continue;
    terms.push(term);
  }

  return terms;
}

function normalizeTopicTerm(term: string): string {
  if (term.length > 5 && term.endsWith('ies')) return `${term.slice(0, -3)}y`;
  if (term.length > 4 && term.endsWith('s') && !term.endsWith('ss')) return term.slice(0, -1);
  return term;
}

function fitTopicLabel(terms: readonly string[]): string {
  const selected: string[] = [];

  for (const term of terms) {
    const candidate = [...selected, term].join(' ');
    if (isValidTopicLabel(candidate)) {
      selected.push(term);
      if (selected.length >= MAX_TOPIC_TERMS) break;
    } else if (selected.length === 0) {
      return clippedValidLabel(term);
    }
  }

  return selected.join(' ');
}

function clippedValidLabel(term: string): string {
  let candidate = term;
  while (candidate.length > 0 && !isValidTopicLabel(candidate)) {
    candidate = candidate.slice(0, -1);
  }
  return candidate;
}
