// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import type { Channel } from './types';
import { parseIRCMessage } from './parser';
import {
  AI_POLICY_PROP,
  aiPolicyAllowsExternal,
  aiPolicyAllowsLocal,
  parseAiPolicyProp,
  type AiPolicy,
} from './aiPolicyProp';
import { store } from '@/lib/store/store';

const initialState = store.getInitialState();

type ChannelWithAiPolicy = Channel & { aiPolicy?: AiPolicy };

function makeChannel(name: string): Channel {
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function feed(line: string): void {
  store.getState()._handleMessage(parseIRCMessage(line));
}

function channelPolicy(name = '#room'): AiPolicy | undefined {
  return (store.getState().channels.get(name.toLowerCase()) as ChannelWithAiPolicy | undefined)?.aiPolicy;
}

describe('parseAiPolicyProp', () => {
  it('parses canonical PROP values', () => {
    expect(parseAiPolicyProp('open')).toBe('open');
    expect(parseAiPolicyProp('no-ai')).toBe('no-ai');
    expect(parseAiPolicyProp('local-only')).toBe('local-only');
  });

  it('normalizes whitespace, case, and underscore variants', () => {
    expect(parseAiPolicyProp(' LOCAL_ONLY ')).toBe('local-only');
    expect(parseAiPolicyProp('No AI')).toBe('no-ai');
  });

  it('maps defensive aliases and defaults unknown values to open', () => {
    expect(parseAiPolicyProp('disabled')).toBe('no-ai');
    expect(parseAiPolicyProp('local')).toBe('local-only');
    expect(parseAiPolicyProp('anything-else')).toBe('open');
    expect(parseAiPolicyProp('')).toBe('open');
  });

  it('exposes gates for local and external AI surfaces', () => {
    expect(aiPolicyAllowsLocal('open')).toBe(true);
    expect(aiPolicyAllowsLocal('local-only')).toBe(true);
    expect(aiPolicyAllowsLocal('no-ai')).toBe(false);
    expect(aiPolicyAllowsExternal('open')).toBe(true);
    expect(aiPolicyAllowsExternal('local-only')).toBe(false);
    expect(aiPolicyAllowsExternal('no-ai')).toBe(false);
  });
});

describe('ai-policy channel PROP projection', () => {
  beforeEach(() => {
    const channels = new Map<string, Channel>();
    channels.set('#room', makeChannel('#room'));
    store.setState({ ...initialState, channels, channelProps: new Map() }, true);
  });

  it('projects RPL_PROPLIST ai-policy onto the channel field', () => {
    feed(`:server 818 me #room ${AI_POLICY_PROP} :local-only`);

    expect(store.getState().channelProps.get('#room')?.[AI_POLICY_PROP]).toBe('local-only');
    expect(channelPolicy()).toBe('local-only');
  });

  it('projects live PROP updates and clears empty values to open', () => {
    feed(`:server PROP #room ${AI_POLICY_PROP} :no-ai`);
    expect(channelPolicy()).toBe('no-ai');

    feed(`:server PROP #room ${AI_POLICY_PROP} :`);
    expect(store.getState().channelProps.get('#room')?.[AI_POLICY_PROP]).toBe('');
    expect(channelPolicy()).toBe('open');
  });

  it('projects generic optimistic channel PROP writes', () => {
    store.getState()._writeChannelProp('#room', AI_POLICY_PROP, 'local-only');
    expect(channelPolicy()).toBe('local-only');

    store.getState()._writeChannelProp('#room', AI_POLICY_PROP, '');
    expect(store.getState().channelProps.get('#room')?.[AI_POLICY_PROP]).toBeUndefined();
    expect(channelPolicy()).toBe('open');
  });

  it('does not invent channels for policy props on unknown rooms', () => {
    feed(`:server PROP #missing ${AI_POLICY_PROP} :no-ai`);

    expect(store.getState().channels.has('#missing')).toBe(false);
    expect(store.getState().channelProps.get('#missing')?.[AI_POLICY_PROP]).toBe('no-ai');
  });
});
