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
import { ErrorBoundary, lazy, type Component, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { updateCoordinator } from '@/pwa/updateCoordinator';
import recoveryStylesheet from './stale-chunk-recovery.css?url';

function RecoveryStylesheet(): JSX.Element {
  return <link rel="stylesheet" href={recoveryStylesheet} />;
}

export function DeferredLoading(props: { label?: string }): JSX.Element {
  return (
    <>
      <RecoveryStylesheet />
      <div class="deferred-loading" role="status" aria-live="polite" data-testid="deferred-loading">
        <span class="deferred-loading__spinner" aria-hidden="true" />
        <span>{props.label ?? 'Loading…'}</span>
      </div>
    </>
  );
}

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
  updateFailure?: boolean;
};

const DEFAULT_TITLE = 'This view needs a fresh load';
const DEFAULT_DETAIL =
  'Onyx was updated while this tab stayed open, so a piece of the interface could not load. Reload once for the current release, or return home.';
const GENERIC_TITLE = 'This view could not load';
const GENERIC_DETAIL = 'Something went wrong while loading this view. Try again, reload the app, or return home.';
let recoveryInstance = 0;

function reloadWindow(): void {
  if (typeof window !== 'undefined') window.location.reload();
}

function requestGuardedReload(): void {
  try {
    // Keep this coordinator in the eager recovery path. It queues behind active
    // work and remains the single authority for deciding whether reload is safe.
    updateCoordinator.requestReload(reloadWindow);
  } catch {
    // A partially available recovery module must not turn this action into an
    // unconditional reload or an unhandled rejection.
  }
}

/**
 * Inert recovery card — no motion dependency, token-only styling, keyboard-
 * reachable controls, no automatic navigation.
 */
export function StaleChunkRecovery(props: StaleChunkRecoveryProps): JSX.Element {
  const instanceId = ++recoveryInstance;
  const titleId = `stale-chunk-recovery-title-${instanceId}`;
  const detailId = `stale-chunk-recovery-detail-${instanceId}`;
  const homeHref = () => props.homeHref ?? '/';
  const updateFailure = () => props.updateFailure ?? true;
  const title = () => props.title ?? (updateFailure() ? DEFAULT_TITLE : GENERIC_TITLE);
  const detail = () => props.detail ?? (updateFailure() ? DEFAULT_DETAIL : GENERIC_DETAIL);

  return (
    <>
      <RecoveryStylesheet />
      <main
        class="stale-chunk-recovery"
        data-testid="stale-chunk-recovery"
        role="alert"
        aria-labelledby={titleId}
        aria-describedby={detailId}
      >
        <div class="stale-chunk-recovery__card">
          <p class="stale-chunk-recovery__kicker">{updateFailure() ? 'Update' : 'Unable to load'}</p>
          <h1 id={titleId} class="stale-chunk-recovery__title">
            {title()}
          </h1>
          <p id={detailId} class="stale-chunk-recovery__detail">
            {detail()}
          </p>
          <div class="stale-chunk-recovery__actions">
          <button
            type="button"
            class="stale-chunk-recovery__primary"
            data-testid="stale-chunk-reload"
            onClick={() => {
              if (props.onReload) props.onReload();
              else requestGuardedReload();
            }}
          >
            Reload the current app
          </button>
          <a
            class="stale-chunk-recovery__secondary"
            data-testid="stale-chunk-home"
            href={homeHref()}
          >
            Continue to home
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
      </main>
    </>
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
  const message = err instanceof Error ? err.message : String(err);
  const updateFailure = /chunk|dynamic(?:ally)? imported|imported module|module script/i.test(message);
  return (
    <StaleChunkRecovery
      updateFailure={updateFailure}
      secondaryLabel="Try again"
      onSecondary={reset}
    />
  );
}

/**
 * A lazy component whose retry creates a new Solid lazy value. Solid caches a
 * rejected lazy promise, so resetting an ErrorBoundary alone cannot recover.
 */
export function retryableLazy<T extends Record<string, any>>(
  loader: () => Promise<{ default: Component<T> }>,
  label: string,
): Component<T> {
  return function RetryableLazy(props: T): JSX.Element {
    let attempt = 0;
    const load = () => {
      const currentAttempt = attempt;
      return lazy(async () => {
        if (currentAttempt !== attempt) return loader();
        return loader();
      });
    };
    let current = load();
    return (
      <ErrorBoundary fallback={(_error, reset) => (
        <StaleChunkRecovery
          updateFailure={false}
          title={`Could not load ${label}`}
          detail={`The ${label} surface did not load. Try again, reload the app, or return home.`}
          secondaryLabel="Try again"
          onSecondary={() => {
            attempt += 1;
            current = load();
            reset();
          }}
        />
      )}>
        <Dynamic component={current as Component<any>} {...props} />
      </ErrorBoundary>
    );
  };
}

export default StaleChunkRecovery;
