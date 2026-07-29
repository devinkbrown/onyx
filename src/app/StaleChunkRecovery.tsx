// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * StaleChunkRecovery — professional recovery surface when a lazy route/shell
 * chunk fails to load (typical after deploy.sh rsync --delete removed hashed
 * assets a long-lived tab still references).
 *
 * Deliberately does NOT auto-reload: a reload loop would thrash a partially
 * cached old entry. The user chooses Reload (fresh entry + new hashes) or
 * return home (eager Landing, no lazy shell).
 */
import { type JSX } from 'solid-js';

export type StaleChunkRecoveryProps = {
  /** Short product-facing title. */
  title?: string;
  /** Supporting explanation. */
  detail?: string;
  /** Full navigation reload (defaults to location.reload). */
  onReload?: () => void;
  /** Home href for the non-reload escape hatch. */
  homeHref?: string;
  /** Optional secondary action (e.g. ErrorBoundary reset / close). */
  secondaryLabel?: string;
  onSecondary?: () => void;
};

const DEFAULT_TITLE = 'This view needs a fresh load';
const DEFAULT_DETAIL =
  'Onyx was updated while this tab stayed open, so a piece of the interface could not load. Reload once for the current release, or return home.';

function reloadWindow(): void {
  if (typeof window !== 'undefined') window.location.reload();
}

/**
 * Inert recovery card — no motion dependency, token-only styling, keyboard-
 * reachable controls, no automatic navigation.
 */
export function StaleChunkRecovery(props: StaleChunkRecoveryProps): JSX.Element {
  const homeHref = () => props.homeHref ?? '/';
  const title = () => props.title ?? DEFAULT_TITLE;
  const detail = () => props.detail ?? DEFAULT_DETAIL;

  return (
    <main
      class="stale-chunk-recovery"
      data-testid="stale-chunk-recovery"
      role="alert"
      aria-labelledby="stale-chunk-recovery-title"
      aria-describedby="stale-chunk-recovery-detail"
    >
      <div class="stale-chunk-recovery__card">
        <p class="stale-chunk-recovery__kicker">Update</p>
        <h1 id="stale-chunk-recovery-title" class="stale-chunk-recovery__title">
          {title()}
        </h1>
        <p id="stale-chunk-recovery-detail" class="stale-chunk-recovery__detail">
          {detail()}
        </p>
        <div class="stale-chunk-recovery__actions">
          <button
            type="button"
            class="stale-chunk-recovery__primary"
            data-testid="stale-chunk-reload"
            onClick={() => (props.onReload ?? reloadWindow)()}
          >
            Reload Onyx
          </button>
          <a
            class="stale-chunk-recovery__secondary"
            data-testid="stale-chunk-home"
            href={homeHref()}
          >
            Back to home
          </a>
          {props.onSecondary && props.secondaryLabel ? (
            <button
              type="button"
              class="stale-chunk-recovery__tertiary"
              data-testid="stale-chunk-secondary"
              onClick={() => props.onSecondary?.()}
            >
              {props.secondaryLabel}
            </button>
          ) : null}
        </div>
      </div>
      <style>{STALE_CHUNK_RECOVERY_CSS}</style>
    </main>
  );
}

/**
 * Wrap a lazy route/shell subtree so a failed dynamic import shows recovery
 * UI instead of a wallpaper-only blank page. No automatic reload loop.
 */
export function lazyRouteFallback(
  err: unknown,
  reset: () => void,
): JSX.Element {
  // reset is available for tests / rare same-bundle recoveries but is not
  // auto-invoked; primary path is a full reload to pick up new asset hashes.
  void err;
  return (
    <StaleChunkRecovery
      secondaryLabel="Try again"
      onSecondary={reset}
    />
  );
}

const STALE_CHUNK_RECOVERY_CSS = `
.stale-chunk-recovery {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: clamp(1.25rem, 4vw, 2.5rem);
  box-sizing: border-box;
  background:
    radial-gradient(120% 120% at 50% 0%, color-mix(in oklab, var(--lapis, #3d6cf5) 22%, var(--ink, #0b1020)) 0%, var(--ink, #0b1020) 60%);
  color: var(--paper, #f4f1ea);
  font-family: var(--font-sans, system-ui, sans-serif);
}
.stale-chunk-recovery__card {
  width: min(28rem, 100%);
  padding: 1.5rem 1.35rem 1.35rem;
  border-radius: 1rem;
  border: 1px solid color-mix(in oklab, var(--paper, #f4f1ea) 14%, transparent);
  background: color-mix(in oklab, var(--ink, #0b1020) 72%, var(--stone, #1a2238));
  box-shadow: 0 24px 60px color-mix(in oklab, #000 45%, transparent);
}
.stale-chunk-recovery__kicker {
  margin: 0 0 0.4rem;
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--gold, #d4a017) 85%, var(--paper, #f4f1ea));
}
.stale-chunk-recovery__title {
  margin: 0 0 0.65rem;
  font-family: var(--font-display, var(--font-sans, system-ui, sans-serif));
  font-size: clamp(1.35rem, 2.4vw, 1.7rem);
  line-height: 1.2;
  font-weight: 600;
}
.stale-chunk-recovery__detail {
  margin: 0 0 1.25rem;
  font-size: 0.95rem;
  line-height: 1.55;
  color: color-mix(in oklab, var(--paper, #f4f1ea) 82%, transparent);
}
.stale-chunk-recovery__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem 0.85rem;
  align-items: center;
}
.stale-chunk-recovery__primary {
  appearance: none;
  border: 0;
  border-radius: 999px;
  padding: 0.65rem 1.15rem;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  color: var(--ink, #0b1020);
  background: var(--gold, #d4a017);
}
.stale-chunk-recovery__primary:focus-visible,
.stale-chunk-recovery__secondary:focus-visible,
.stale-chunk-recovery__tertiary:focus-visible {
  outline: 2px solid var(--lapis, #3d6cf5);
  outline-offset: 2px;
}
.stale-chunk-recovery__secondary,
.stale-chunk-recovery__tertiary {
  color: color-mix(in oklab, var(--paper, #f4f1ea) 90%, transparent);
  text-decoration: underline;
  text-underline-offset: 0.15em;
  font: inherit;
  background: transparent;
  border: 0;
  padding: 0.4rem 0.2rem;
  cursor: pointer;
}
@media (prefers-reduced-motion: reduce) {
  .stale-chunk-recovery,
  .stale-chunk-recovery * {
    animation: none !important;
    transition: none !important;
  }
}
`;

export default StaleChunkRecovery;
