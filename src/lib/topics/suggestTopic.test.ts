/**
 * suggestTopic.test.ts — local topic-label suggestion coverage.
 */
import { describe, expect, it } from 'vitest';

import { MAX_TOPIC_LABEL_BYTES, isValidTopicLabel } from './topics';
import { suggestTopic } from './suggestTopic';

describe('suggestTopic', () => {
  it('extracts a compact label from one text input', () => {
    expect(suggestTopic('Can we split the mobile onboarding crash into its own thread?')).toBe(
      'split mobile onboarding',
    );
  });

  it('strips URLs, punctuation, and common filler words', () => {
    expect(suggestTopic('This is about https://example.test/runbook, the deploy rollback!!!')).toBe(
      'deploy rollback',
    );
  });

  it('scores message arrays by repeated keywords across messages', () => {
    expect(suggestTopic([
      { text: 'Latency spike around image uploads' },
      { text: 'Image upload retries are causing latency' },
      { text: 'Retry budget for upload worker' },
    ])).toBe('upload latency image');
  });

  it('counts a repeated term only once per message', () => {
    expect(suggestTopic([
      { text: 'deploy deploy deploy checklist' },
      { text: 'rollback checklist' },
    ])).toBe('checklist deploy rollback');
  });

  it('uses plaintext before ciphertext-like text when available', () => {
    expect(suggestTopic([
      { text: 'tsumugi-envelope-ciphertext', plaintext: 'Release train blockers' },
    ])).toBe('release train blocker');
  });

  it('returns an empty string when no usable keywords exist', () => {
    expect(suggestTopic('the and you can')).toBe('');
    expect(suggestTopic([])).toBe('');
  });

  it('keeps long labels inside the topic-label byte limit', () => {
    const label = suggestTopic('a'.repeat(MAX_TOPIC_LABEL_BYTES + 20));

    expect(label).toHaveLength(MAX_TOPIC_LABEL_BYTES);
    expect(new TextEncoder().encode(label).length).toBe(MAX_TOPIC_LABEL_BYTES);
    expect(isValidTopicLabel(label)).toBe(true);
  });

  it('is deterministic for equal counts by first useful occurrence', () => {
    expect(suggestTopic('zeta alpha beta gamma')).toBe('zeta alpha beta');
    expect(suggestTopic('alpha zeta beta gamma')).toBe('alpha zeta beta');
  });
});
