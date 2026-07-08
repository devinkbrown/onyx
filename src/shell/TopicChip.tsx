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
  );
}

export function TopicFilterBar(props: TopicFilterBarProps): JSX.Element {
  return (
    <div class="topic-filter-bar" role="tablist" aria-label="Topic filters">
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
        {(topic) => (
          <TopicChip
            label={topic}
            unread={props.unreadCounts?.get(topic.toLowerCase()) ?? 0}
            active={props.active === topic}
            onClick={() => props.onSelect(topic)}
          />
        )}
      </For>
    </div>
  );
}
