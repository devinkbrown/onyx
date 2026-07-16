// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * TopicChip.tsx — prop-driven topic chips for named conversations.
 *
 * Self-contained presentation only; integration decides where these appear.
 *
 * SOLID IDIOMS: component runs once; never destructure props; Show/For.
 */

import { For, Show, type JSX } from 'solid-js';
import './TopicChip.css';

export type TopicChipProps = {
  label: string;
  unread?: number;
  active?: boolean;
  onClick?: (label: string) => void;
  onSplit?: (label: string) => void;
  splitAriaLabel?: string;
};

export type TopicFilterBarProps = {
  topics: readonly string[];
  active: string | null;
  unreadCounts?: ReadonlyMap<string, number>;
  onSelect: (label: string | null) => void;
};

function TopicChipContent(props: { label: string; unread?: number }): JSX.Element {
  return (
    <>
      <span class="topic-chip__hash" aria-hidden="true">#</span>
      <span class="topic-chip__label">{props.label}</span>
      <Show when={(props.unread ?? 0) > 0}>
        <span class="topic-chip__unread" aria-label={`${props.unread} unread`}>
          {props.unread}
        </span>
      </Show>
    </>
  );
}

export function TopicChip(props: TopicChipProps): JSX.Element {
  return (
    <Show
      when={props.onSplit}
      keyed
      fallback={
        <Show
          when={props.onClick}
          keyed
          fallback={
            <span class="topic-chip" classList={{ 'is-active': props.active === true }}>
              <TopicChipContent label={props.label} unread={props.unread} />
            </span>
          }
        >
          {(handleClick) => (
            <button
              type="button"
              class="topic-chip"
              classList={{ 'is-active': props.active === true }}
              aria-pressed={props.active}
              onClick={() => handleClick(props.label)}
            >
              <TopicChipContent label={props.label} unread={props.unread} />
            </button>
          )}
        </Show>
      }
    >
      {(handleSplit) => (
        <span class="topic-chip" classList={{ 'is-active': props.active === true }}>
          <TopicChipContent label={props.label} unread={props.unread} />
          <button
            type="button"
            class="topic-chip__split"
            style={{
              border: '0',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              'font-family': 'inherit',
              'font-size': '0.68rem',
              'font-weight': 800,
              padding: '0',
              'text-decoration': 'underline',
              'text-underline-offset': '0.12rem',
            }}
            aria-label={props.splitAriaLabel ?? `Split into topic ${props.label}`}
            onClick={() => handleSplit(props.label)}
          >
            Split
          </button>
        </span>
      )}
    </Show>
  );
}

export function TopicFilterBar(props: TopicFilterBarProps): JSX.Element {
  return (
    <div class="topic-filter-bar" role="group" aria-label="Topic filters">
      <button
        type="button"
        class="topic-chip topic-chip--all"
        classList={{ 'is-active': props.active === null }}
        aria-pressed={props.active === null}
        onClick={() => props.onSelect(null)}
      >
        All
      </button>
      <For each={props.topics}>
        {(topic) => {
          const active = () => props.active?.toLowerCase() === topic.toLowerCase();
          return (
            <TopicChip
              label={topic}
              unread={props.unreadCounts?.get(topic.toLowerCase()) ?? 0}
              active={active()}
              onClick={() => props.onSelect(topic)}
            />
          );
        }}
      </For>
    </div>
  );
}
