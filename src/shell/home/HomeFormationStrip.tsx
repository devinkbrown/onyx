// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HomeFormationStrip — 3-in-48h founder / joiner nag.
 *
 * Presentation only. Names and counts come from the classifier; this never
 * invents members or opens a tour.
 */
import { Show, type JSX } from 'solid-js';
import type { FormationStrip } from '@/lib/formation/formationLoop';

export type HomeFormationStripProps = {
  strip: FormationStrip;
  onOpen: (channel: string) => void;
  onReshare: (channel: string) => void;
};

export function HomeFormationStrip(props: HomeFormationStripProps): JSX.Element {
  return (
    <section
      class="home-formation"
      data-testid="home-formation-strip"
      data-formation-kind={props.strip.kind}
      aria-label="Room formation"
    >
      <div class="home-formation__copy">
        <p class="home-formation__eyebrow">{props.strip.channel}</p>
        <p class="home-formation__title">{props.strip.headline}</p>
        <Show when={props.strip.detail}>
          {(detail) => <p class="home-formation__detail">{detail()}</p>}
        </Show>
      </div>
      <div class="home-formation__actions">
        <button
          type="button"
          class="home-action home-action--supporting"
          onClick={() => props.onOpen(props.strip.channel)}
        >
          Open {props.strip.channel}
        </button>
        <Show when={props.strip.canReshare}>
          <button
            type="button"
            class="home-cta"
            data-testid="home-formation-reshare"
            onClick={() => props.onReshare(props.strip.channel)}
          >
            Reshare
          </button>
        </Show>
      </div>
    </section>
  );
}
