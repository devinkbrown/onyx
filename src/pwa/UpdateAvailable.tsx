import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { updateCoordinator, type UpdateAvailability } from './updateRecovery';
import './update-available.css';

export function UpdateAvailable() {
  const [state, setState] = createSignal<UpdateAvailability>(null);
  onMount(() => onCleanup(updateCoordinator.subscribe((next) => setState(next))));
  return <Show when={state()}>
    {(available) => (
      <div
        class="update-available ui-commercial"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="update-available"
      >
        <p class="update-available__message" id="update-available-message">
          {available().deferred
            ? 'Update ready. Reload is deferred until your call or other current work finishes.'
            : 'An Onyx update is ready. Reload when you are ready.'}
        </p>
        <button
          type="button"
          aria-describedby="update-available-message"
          onClick={() => updateCoordinator.approve()}
        >
          {available().deferred ? 'Reload when safe' : 'Reload to update'}
        </button>
      </div>
    )}
  </Show>;
}
