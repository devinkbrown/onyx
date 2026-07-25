// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * SmartMuteSection — keyword mute for OS notifications (not message hide).
 */
import { createEffect, createSignal, Show, type JSX } from 'solid-js';
import type { DeviceMemoryOwner } from '@/lib/deviceMemoryOwner';
import {
  loadSmartMute,
  saveSmartMute,
} from '@/lib/notifications/smartMuteMemory';
import { sanitizeKeyword } from '@/lib/notifications/smartMute';
import { Button } from '@/primitives/index';

export interface SmartMuteSectionProps {
  owner: DeviceMemoryOwner | null;
}

export function SmartMuteSection(props: SmartMuteSectionProps): JSX.Element {
  const [keywordsText, setKeywordsText] = createSignal('');
  const [muteSystem, setMuteSystem] = createSignal(false);
  const [status, setStatus] = createSignal<string | null>(null);

  createEffect(() => {
    const owner = props.owner;
    if (!owner) {
      setKeywordsText('');
      setMuteSystem(false);
      return;
    }
    const rules = loadSmartMute(owner);
    setKeywordsText(rules.keywords.join(', '));
    setMuteSystem(rules.muteSystemNoise);
  });

  function onSave(): void {
    const owner = props.owner;
    if (!owner) return;
    const keywords = keywordsText()
      .split(/[,;\n]+/)
      .map((part) => sanitizeKeyword(part))
      .filter((k): k is string => !!k);
    const ok = saveSmartMute(
      {
        keywords,
        muteSystemNoise: muteSystem(),
        mutedNicks: loadSmartMute(owner).mutedNicks,
      },
      owner,
    );
    setStatus(ok
      ? `Saved ${keywords.length} keyword mute(s). Ignored nicks also silence notifications.`
      : 'Could not save smart mute rules.');
  }

  return (
    <Show when={props.owner}>
      <section
        class="acct-section"
        aria-labelledby="acct-smartmute-title"
        aria-describedby="acct-smartmute-hint"
        data-testid="smart-mute-section"
      >
        <div class="acct-section-head">
          <h3 class="acct-section-title" id="acct-smartmute-title">
            Smart mute
          </h3>
          <p class="acct-section-hint" id="acct-smartmute-hint">
            Silence OS notifications for keyword spam. Does not hide messages in the room.
            Ignored nicks already mute notifications and feed visibility.
          </p>
        </div>
        <div class="acct-section-body">
          <label class="acct-section-hint" for="smart-mute-keywords">
            Mute keywords (comma-separated)
          </label>
          <input
            id="smart-mute-keywords"
            type="text"
            data-testid="smart-mute-keywords"
            value={keywordsText()}
            onInput={(e) => setKeywordsText(e.currentTarget.value)}
            placeholder="crypto airdrop, free nitro"
            style={{
              width: '100%',
              padding: '0.45rem 0.6rem',
              background: 'var(--stone-2)',
              border: '1px solid var(--seam)',
              color: 'var(--paper)',
              'border-radius': 'var(--r-sm)',
            }}
          />
          <label class="acct-toggle-row" style={{ 'margin-top': '0.75rem' }}>
            <input
              type="checkbox"
              checked={muteSystem()}
              onChange={(e) => setMuteSystem(e.currentTarget.checked)}
              data-testid="smart-mute-system"
            />
            <span class="acct-toggle-body">
              <span class="acct-toggle-label">Mute system / error alerts</span>
              <span class="acct-toggle-desc">Join/part noise and error toasts stay off the OS tray.</span>
            </span>
          </label>
          <Button type="button" variant="ghost" size="sm" data-testid="smart-mute-save" onClick={onSave}>
            Save smart mute
          </Button>
          <Show when={status()}>
            {(msg) => (
              <p class="acct-section-hint" role="status" data-testid="smart-mute-status">
                {msg()}
              </p>
            )}
          </Show>
        </div>
      </section>
    </Show>
  );
}

export default SmartMuteSection;
