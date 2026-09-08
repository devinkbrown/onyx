// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * YouSettings — the default You / Settings list.
 *
 * Task categories for You. Account, this device, help, and Advanced stay
 * reachable from one list. Theme Studio, protocol options, and operator tools
 * stay in Advanced. Reuses existing preference and store actions.
 */
import { For, Show, type JSX } from 'solid-js';

import { getState } from '@/lib/store';
import {
  DENSITIES,
  FONT_SCALES,
  openPreferences,
  preferences,
  setPreference,
  type Density,
  type FontScale,
} from '@/lib/prefs/preferences';
import { sceneMotion, setSceneMotion } from '@/lib/prefs/sceneMotion';
import {
  TRANSLATION_TARGETS,
  languageLabel,
  setTranslationTarget,
  translationTarget,
} from '@/lib/intelligence/translateMessage';
import { preferredTranslationTarget } from '@/lib/intelligence/localLanguage';
import { CalmModeControl } from '@/shell/CalmModeControl';
import { IgnoredUsersControl } from '@/shell/IgnoredUsersControl';
import { KeywordListControl } from './KeywordListControl';
import { moveRadioGroup } from '@/theme/publicLooks';

const DENSITY_LABELS: Record<Density, string> = { compact: 'Compact', cozy: 'Cozy', roomy: 'Roomy' };
const FONT_SCALE_LABELS: Record<FontScale, string> = { sm: 'Small', md: 'Medium', lg: 'Large' };

export type YouSettingsProps = {
  guest: boolean;
  account: JSX.Element;
  advanced: JSX.Element;
  onClose: () => void;
};

function leaveThen(onClose: () => void, open: () => void): void {
  onClose();
  queueMicrotask(open);
}

export function YouSettings(props: YouSettingsProps): JSX.Element {
  const languageValue = () => translationTarget() || preferredTranslationTarget();

  return (
    <nav class="you-settings" aria-label="You settings" data-testid="you-settings">
      <p class="you-settings-lede" role="note">
        <Show when={props.guest} fallback="Your account travels with you. Everything else here changes this device only.">
          Keep this name if you want to protect it without disconnecting.
        </Show>
      </p>

      <section class="you-settings-group" aria-labelledby="you-group-account-title">
        <h3 id="you-group-account-title" class="you-settings-group__title">Account</h3>
        <p class="you-settings-group__hint">Sign-in, recovery, and account data. These choices travel with the account.</p>
      <details class="you-settings-item" open data-testid="you-account">
        <summary>
          <span>Account</span>
          <small>Identity, protection, and account data</small>
        </summary>
        <div class="you-settings-item__body">{props.account}</div>
      </details>
      </section>

      <section class="you-settings-group" aria-labelledby="you-group-device-title">
        <h3 id="you-group-device-title" class="you-settings-group__title">This device</h3>
        <p class="you-settings-group__hint">Notifications, privacy, reading, and hardware on this browser.</p>
      <details class="you-settings-item" data-testid="you-notifications">
        <summary>
          <span>Notifications</span>
          <small>Mentions and extra ping words</small>
        </summary>
        <div class="you-settings-item__body">
          <p class="you-settings-hint">How this device tells you about mentions and messages.</p>
          <CalmModeControl />
          <KeywordListControl />
        </div>
      </details>

      <details class="you-settings-item" data-testid="you-privacy">
        <summary>
          <span>Privacy on this device</span>
          <small>Private messages and safer link previews</small>
        </summary>
        <div class="you-settings-item__body">
          <button
            type="button"
            class="you-settings-switch"
            role="switch"
            aria-checked={preferences().e2eeDms}
            onClick={() => setPreference('e2eeDms', !preferences().e2eeDms)}
          >
            <span>
              <strong>Private messages</strong>
              <small>Seal direct messages on this device when the other person can.</small>
            </span>
            <b>{preferences().e2eeDms ? 'On' : 'Off'}</b>
          </button>
          <button
            type="button"
            class="you-settings-switch"
            role="switch"
            aria-checked={preferences().httpsOnly}
            onClick={() => setPreference('httpsOnly', !preferences().httpsOnly)}
          >
            <span>
              <strong>Safer link previews</strong>
              <small>Only fetch previews for secure links.</small>
            </span>
            <b>{preferences().httpsOnly ? 'On' : 'Off'}</b>
          </button>
        </div>
      </details>

      <details class="you-settings-item" data-testid="you-blocked">
        <summary>
          <span>Blocked users on this device</span>
          <small>Hidden here, not told</small>
        </summary>
        <div class="you-settings-item__body">
          <p class="you-settings-hint">You will not see them on this device. They are not told.</p>
          <IgnoredUsersControl />
        </div>
      </details>

      <button
        type="button"
        class="you-settings-link"
        data-testid="you-settings-open-appearance"
        aria-label="Open appearance settings"
        aria-haspopup="dialog"
        onClick={() => leaveThen(props.onClose, () => getState().openAppearance())}
      >
        <span>
          <strong>Appearance</strong>
          <small>Look, text size, and motion</small>
        </span>
      </button>

      <details class="you-settings-item" data-testid="you-text-size">
        <summary>
          <span>Reading comfort</span>
          <small>Text size and density</small>
        </summary>
        <div class="you-settings-item__body">
          <div class="you-settings-choices" role="radiogroup" aria-label="Text size">
            <For each={FONT_SCALES}>
              {(value) => (
                <button
                  type="button"
                  class="you-settings-choice"
                  classList={{ on: preferences().fontScale === value }}
                  role="radio"
                  aria-checked={preferences().fontScale === value}
                  tabIndex={preferences().fontScale === value ? 0 : -1}
                  onKeyDown={moveRadioGroup}
                  onClick={() => setPreference('fontScale', value)}
                >
                  {FONT_SCALE_LABELS[value]}
                </button>
              )}
            </For>
          </div>
          <div class="you-settings-choices" role="radiogroup" aria-label="Density">
            <For each={DENSITIES}>
              {(value) => (
                <button
                  type="button"
                  class="you-settings-choice"
                  classList={{ on: preferences().density === value }}
                  role="radio"
                  aria-checked={preferences().density === value}
                  tabIndex={preferences().density === value ? 0 : -1}
                  onKeyDown={moveRadioGroup}
                  onClick={() => setPreference('density', value)}
                >
                  {DENSITY_LABELS[value]}
                </button>
              )}
            </For>
          </div>
        </div>
      </details>

      <details class="you-settings-item" data-testid="you-motion">
        <summary>
          <span>Motion and data</span>
          <small>Animation on this device</small>
        </summary>
        <div class="you-settings-item__body">
          <button
            type="button"
            class="you-settings-switch"
            role="switch"
            aria-checked={preferences().reduceMotion}
            onClick={() => setPreference('reduceMotion', !preferences().reduceMotion)}
          >
            <span>
              <strong>Reduce motion</strong>
              <small>Turn off animation on this device.</small>
            </span>
            <b>{preferences().reduceMotion ? 'On' : 'Off'}</b>
          </button>
          <button
            type="button"
            class="you-settings-switch"
            role="switch"
            aria-checked={sceneMotion() === 'off'}
            onClick={() => setSceneMotion(sceneMotion() === 'off' ? 'adaptive' : 'off')}
          >
            <span>
              <strong>Reduce background motion</strong>
              <small>Turn animated backgrounds off. Message and network data are unchanged.</small>
            </span>
            <b>{sceneMotion() === 'off' ? 'On' : 'Off'}</b>
          </button>
        </div>
      </details>

      <button
        type="button"
        class="you-settings-link"
        data-testid="you-open-voice"
        aria-haspopup="dialog"
        onClick={() => leaveThen(props.onClose, () => getState().openVoiceSettings())}
      >
        <span>
          <strong>Voice devices</strong>
          <small>Microphone, speakers, and camera</small>
        </span>
      </button>

      <details class="you-settings-item" data-testid="you-language">
        <summary>
          <span>Language tools</span>
          <small>On-device captions and translation</small>
        </summary>
        <div class="you-settings-item__body">
          <label class="you-settings-hint" for="you-language-select">Language used by on-device captions and translation.</label>
          <select
            id="you-language-select"
            class="you-settings-select"
            value={languageValue()}
            onChange={(event) => setTranslationTarget(event.currentTarget.value)}
          >
            <For each={TRANSLATION_TARGETS}>
              {(code) => <option value={code}>{languageLabel(code)}</option>}
            </For>
          </select>
        </div>
      </details>
      </section>

      <section class="you-settings-group" aria-labelledby="you-group-help-title">
        <h3 id="you-group-help-title" class="you-settings-group__title">Help</h3>
      <details class="you-settings-item" data-testid="you-support">
        <summary>
          <span>Help and status</span>
          <small>About Onyx and network status</small>
        </summary>
        <div class="you-settings-item__body you-settings-support">
          <a href="/about/">About Onyx</a>
          <a href="/status/">Network status</a>
        </div>
      </details>
      </section>

      <section class="you-settings-group you-settings-group--advanced" aria-labelledby="you-group-advanced-title">
        <h3 id="you-group-advanced-title" class="you-settings-group__title">More</h3>
      <details class="you-settings-item you-settings-item--advanced" data-testid="you-advanced">
        <summary>
          <span>Advanced</span>
          <small>Theme Studio, more settings, and operator tools</small>
        </summary>
        <div class="you-settings-item__body">
          <button
            type="button"
            class="you-settings-link"
            data-testid="you-settings-open-preferences"
            aria-haspopup="dialog"
            onClick={() => leaveThen(props.onClose, () => openPreferences())}
          >
            <span>
              <strong>All preferences</strong>
              <small>Display, history, import, and access details</small>
            </span>
          </button>
          <a class="you-settings-link" href="/appearance/" data-testid="you-open-theme-studio">
            <span>
              <strong>Theme Studio</strong>
              <small>Build and audit a custom look</small>
            </span>
          </a>
          {props.advanced}
        </div>
      </details>
      </section>
    </nav>
  );
}
