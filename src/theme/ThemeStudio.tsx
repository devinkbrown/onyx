/**
 * ThemeStudio — live theme editor.
 *
 * Pick a base theme, tweak any editable token, see changes in the live preview
 * panel.  Export the current override set as a JSON blob; import a previously
 * exported blob.
 *
 * Solid idioms used throughout:
 *   - Components run once; props are never destructured at the call site.
 *   - splitProps / mergeProps for all prop access.
 *   - createSignal / createMemo / createEffect / onCleanup for reactivity.
 *   - <For> / <Show> for list and conditional rendering.
 *   - All controls are labelled (a11y); focus-visible styles come from primitives.css.
 */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  splitProps,
  type JSX,
} from 'solid-js';

import { Button } from '../primitives/Button';
import { FormField } from '../primitives/FormField';
import { Tabs } from '../primitives/Tabs';
import { Tooltip } from '../primitives/Tooltip';

import { useTheme } from './ThemeProvider';
import { THEMES, THEME_IDS, type ThemeId, type TokenMap } from './themes';
import { customThemeTokens, getCustomTheme, isCustomThemeId } from './customThemes';
import { STUDIO_GROUPS, type StudioGroup, type StudioToken } from './tokens';
import { useStore, getState } from '@/lib/store';
import { backgroundOptions } from '@/backgrounds';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportBlob = {
  __ruri_theme_export__: true;
  base: ThemeId;
  overrides: TokenMap;
  exported: string; // ISO timestamp
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePxValue(cssValue: string): number {
  return parseInt(cssValue.replace('px', ''), 10) || 0;
}

function parseMs(cssValue: string): number {
  return parseInt(cssValue.replace('ms', ''), 10) || 0;
}

function readLiveVar(property: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(property)
    .trim();
}

function applyVar(property: string, value: string): void {
  document.documentElement.style.setProperty(property, value);
}

function removeVar(property: string): void {
  document.documentElement.style.removeProperty(property);
}

function isExportBlob(value: unknown): value is ExportBlob {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).__ruri_theme_export__ === true
  );
}

// ---------------------------------------------------------------------------
// Live-preview panel — fake IRC message thread
// ---------------------------------------------------------------------------

function StudioPreview() {
  return (
    <div class="ts-preview" aria-label="Live preview">
      <div class="ts-preview__bar">
        <span class="ts-preview__bar-dot" style="background: var(--shu)" />
        <span class="ts-preview__bar-dot" style="background: var(--gold)" />
        <span class="ts-preview__bar-dot" style="background: var(--ok)" />
        <span class="ts-preview__bar-title">#general — eshmaki.me</span>
      </div>
      <div class="ts-preview__body">
        <div class="ts-preview__msg">
          <span class="ts-preview__nick" style="color: var(--lapis-bright)">aoi</span>
          <span class="ts-preview__text">surfaced from the deep current</span>
        </div>
        <div class="ts-preview__msg">
          <span class="ts-preview__nick" style="color: var(--gold-bright)">kain</span>
          <span class="ts-preview__text">
            the tide is calm —{' '}
            <span style="color: var(--shu-bright)">a coral light</span> drifting through the dark water
          </span>
        </div>
        <div class="ts-preview__msg">
          <span class="ts-preview__nick" style="color: var(--ok)">orochi</span>
          <span class="ts-preview__text ts-preview__text--dim">→ mesh: 2 shards online</span>
        </div>
        <div class="ts-preview__input-row">
          <div class="ts-preview__input">
            <span class="ts-preview__prompt" aria-hidden="true">›</span>
            <span class="ts-preview__cursor" aria-hidden="true">█</span>
          </div>
          <div class="ts-preview__actions">
            <button class="ruri-button ruri-button--primary ruri-button--sm" type="button" tabIndex={-1}>
              send
            </button>
            <button class="ruri-button ruri-button--ghost ruri-button--sm" type="button" tabIndex={-1}>
              attach
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual token controls
// ---------------------------------------------------------------------------

type TokenControlProps = {
  token: StudioToken;
  currentValue: () => string;
  onInput: (value: string) => void;
};

function TokenControl(props: TokenControlProps) {
  const [local] = splitProps(props, ['token', 'currentValue', 'onInput']);
  const id = `ts-control-${local.token.property.replace(/^--/, '').replace(/-/g, '_')}`;

  // Derive a usable current value for each control type.
  const raw = () => local.currentValue();

  const handleColorInput: JSX.EventHandlerUnion<HTMLInputElement, InputEvent> = (e) => {
    local.onInput((e.currentTarget as HTMLInputElement).value);
  };

  const handleRangeInput: JSX.EventHandlerUnion<HTMLInputElement, InputEvent> = (e) => {
    const v = (e.currentTarget as HTMLInputElement).value;
    local.onInput(`${v}px`);
  };

  const handleDurationInput: JSX.EventHandlerUnion<HTMLInputElement, InputEvent> = (e) => {
    const v = (e.currentTarget as HTMLInputElement).value;
    local.onInput(`${v}ms`);
  };

  const handleTextInput: JSX.EventHandlerUnion<HTMLInputElement, InputEvent> = (e) => {
    local.onInput((e.currentTarget as HTMLInputElement).value);
  };

  return (
    <Tooltip content={local.token.hint} placement="top">
      <div class="ts-token-control">
        <Show when={local.token.type === 'color'}>
          <label class="ts-token-label" for={id}>
            {local.token.label}
          </label>
          <div class="ts-token-color-row">
            <input
              id={id}
              type="color"
              class="ts-token-swatch"
              value={raw().startsWith('#') ? raw() : '#000000'}
              onInput={handleColorInput}
              aria-label={local.token.label}
            />
            <code class="ts-token-value">{raw()}</code>
          </div>
        </Show>

        <Show when={local.token.type === 'radius'}>
          <label class="ts-token-label" for={id}>
            {local.token.label}
            <span class="ts-token-badge">{raw()}</span>
          </label>
          <input
            id={id}
            type="range"
            class="ts-token-range"
            min={local.token.min ?? 0}
            max={local.token.max ?? 24}
            step={local.token.step ?? 1}
            value={parsePxValue(raw())}
            onInput={handleRangeInput}
            aria-label={local.token.label}
            aria-valuetext={raw()}
          />
        </Show>

        <Show when={local.token.type === 'duration'}>
          <label class="ts-token-label" for={id}>
            {local.token.label}
            <span class="ts-token-badge">{raw()}</span>
          </label>
          <input
            id={id}
            type="range"
            class="ts-token-range"
            min={local.token.min ?? 0}
            max={local.token.max ?? 600}
            step={local.token.step ?? 20}
            value={parseMs(raw())}
            onInput={handleDurationInput}
            aria-label={local.token.label}
            aria-valuetext={raw()}
          />
        </Show>

        <Show when={local.token.type === 'font' || local.token.type === 'easing'}>
          <FormField
            id={id}
            label={local.token.label}
            value={raw()}
            onInput={handleTextInput}
            aria-label={local.token.label}
            class="ts-token-text-field"
            spellcheck={false}
          />
        </Show>
      </div>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Token group panel
// ---------------------------------------------------------------------------

type GroupPanelProps = {
  group: StudioGroup;
  overrides: () => TokenMap;
  onTokenChange: (property: string, value: string) => void;
};

function GroupPanel(props: GroupPanelProps) {
  const [local] = splitProps(props, ['group', 'overrides', 'onTokenChange']);

  return (
    <div class="ts-group" data-testid={`ts-group-${local.group.id}`}>
      <For each={local.group.tokens}>
        {(token) => {
          const currentValue = createMemo(() => {
            const override = local.overrides()[token.property];
            if (override !== undefined) return override;
            return readLiveVar(token.property);
          });

          return (
            <TokenControl
              token={token}
              currentValue={currentValue}
              onInput={(val) => local.onTokenChange(token.property, val)}
            />
          );
        }}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ThemeStudio component
// ---------------------------------------------------------------------------

export type ThemeStudioProps = {
  class?: string;
};

export function ThemeStudio(props: ThemeStudioProps) {
  const [local] = splitProps(props, ['class']);
  const { themeId, setTheme, customThemes, saveCustom, deleteCustom } = useTheme();
  const backgroundId = useStore((s) => s.backgroundId);

  // The current per-session overrides the user has made on top of the base theme.
  const [overrides, setOverrides] = createSignal<TokenMap>({});
  const [importError, setImportError] = createSignal<string | null>(null);
  const [exportCopied, setExportCopied] = createSignal(false);
  // Inline "save theme" naming (replaces a browser prompt).
  const [saving, setSaving] = createSignal(false);
  const [saveName, setSaveName] = createSignal('');
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let saveInputRef: HTMLInputElement | undefined;

  // When the base theme changes, clear per-session overrides so the new
  // theme's values render cleanly.  The ThemeProvider already writes the new
  // token set onto the root.
  createEffect(() => {
    themeId(); // track
    setOverrides({});
    setImportError(null);
  });

  // Apply per-session overrides live — directly writing CSS vars.
  createEffect(() => {
    const map = overrides();
    for (const [prop, val] of Object.entries(map)) {
      applyVar(prop, val);
    }
  });

  // Cleanup: remove any locally applied overrides on unmount.
  onCleanup(() => {
    const map = overrides();
    for (const prop of Object.keys(map)) {
      removeVar(prop);
    }
    if (copyTimer !== undefined) clearTimeout(copyTimer);
  });

  const handleTokenChange = (property: string, value: string): void => {
    setOverrides((prev) => ({ ...prev, [property]: value }));
    applyVar(property, value); // immediate live-preview
  };

  const handleReset = (): void => {
    const map = overrides();
    for (const prop of Object.keys(map)) {
      removeVar(prop);
    }
    setOverrides({});
    setImportError(null);
    // Re-apply the active theme's tokens (built-in or custom: base + overrides).
    const id = themeId();
    const tokens = isCustomThemeId(id)
      ? (getCustomTheme(id) ? customThemeTokens(getCustomTheme(id)!) : {})
      : (THEMES[id as ThemeId]?.tokens ?? {});
    for (const [prop, val] of Object.entries(tokens)) {
      applyVar(prop, val);
    }
  };

  const handleExport = (): void => {
    const id = themeId();
    const base: ThemeId = isCustomThemeId(id) ? (getCustomTheme(id)?.base ?? THEME_IDS[0]!) : (id as ThemeId);
    const baseOverrides = isCustomThemeId(id) ? (getCustomTheme(id)?.overrides ?? {}) : {};
    const blob: ExportBlob = {
      __ruri_theme_export__: true,
      base,
      overrides: { ...baseOverrides, ...overrides() },
      exported: new Date().toISOString(),
    };
    const json = JSON.stringify(blob, null, 2);

    if (navigator.clipboard) {
      navigator.clipboard.writeText(json).catch(() => undefined);
    }

    setExportCopied(true);
    if (copyTimer !== undefined) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => setExportCopied(false), 2200);
  };

  const handleImport = (): void => {
    const raw = window.prompt(
      'Paste an Onyx theme JSON blob to import:',
      '',
    );
    if (!raw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setImportError('Invalid JSON — could not parse.');
      return;
    }

    if (!isExportBlob(parsed)) {
      setImportError('Not a valid Onyx theme export.');
      return;
    }

    if (!(parsed.base in THEMES)) {
      setImportError(`Unknown base theme "${parsed.base}".`);
      return;
    }

    setImportError(null);
    setTheme(parsed.base);
    // Apply overrides after a micro-task so the base theme finishes writing.
    queueMicrotask(() => {
      const safeOverrides: TokenMap = {};
      for (const [k, v] of Object.entries(parsed.overrides)) {
        if (typeof v === 'string') safeOverrides[k] = v;
      }
      setOverrides(safeOverrides);
    });
  };

  const activeThemeMeta = createMemo(() => {
    const id = themeId();
    if (isCustomThemeId(id)) {
      const c = getCustomTheme(id);
      const base = c ? THEMES[c.base] : undefined;
      return {
        label: c?.name ?? 'Custom',
        description: base ? `Your custom theme, based on ${base.label}.` : 'Your custom theme.',
        scheme: base?.scheme ?? 'dark',
      };
    }
    return THEMES[id as ThemeId];
  });

  const hasOverrides = createMemo(() => Object.keys(overrides()).length > 0);

  // Open the inline name field, pre-filled with a sensible suggestion.
  const beginSave = (): void => {
    const id = themeId();
    const suggested = isCustomThemeId(id)
      ? (getCustomTheme(id)?.name ?? 'My theme')
      : `${THEMES[id as ThemeId]?.label ?? 'My'} custom`;
    setSaveName(suggested);
    setSaving(true);
    queueMicrotask(() => {
      saveInputRef?.focus();
      saveInputRef?.select();
    });
  };

  // Commit the current base + edits as a named, selectable theme. Editing an
  // existing custom theme folds its overrides into the new one.
  const confirmSave = (): void => {
    const name = saveName().trim();
    if (!name) return;
    const id = themeId();
    const base: ThemeId = isCustomThemeId(id) ? (getCustomTheme(id)?.base ?? THEME_IDS[0]!) : (id as ThemeId);
    const baseOverrides = isCustomThemeId(id) ? (getCustomTheme(id)?.overrides ?? {}) : {};
    const merged: TokenMap = { ...baseOverrides, ...overrides() };
    const newId = saveCustom(name, base, merged);
    setSaving(false);
    setTheme(newId); // select it; the base-change effect clears the session overrides
  };

  const chooseBackground = (id: string): void => {
    getState().setBackground(id);
  };

  return (
    <div
      class={['ts-studio', local.class].filter(Boolean).join(' ')}
      data-testid="theme-studio"
    >
      {/* ── Header ── */}
      <header class="ts-header">
        <div class="ts-header__title-row">
          <span class="ts-eyebrow">// Theme Studio</span>
          <Show when={hasOverrides()}>
            <span class="ts-badge ts-badge--modified">modified</span>
          </Show>
        </div>
        <p class="ts-header__desc">
          {activeThemeMeta().description}
        </p>
      </header>

      {/* ── Base theme selector ── */}
      <section class="ts-section" aria-labelledby="ts-base-label">
        <h2 class="ts-section__heading" id="ts-base-label">Base theme</h2>
        <div class="ts-theme-grid" role="radiogroup" aria-label="Select base theme">
          <For each={THEME_IDS}>
            {(id) => {
              const meta = THEMES[id];
              const isActive = () => themeId() === id;
              return (
                <button
                  type="button"
                  class="ts-theme-chip"
                  aria-pressed={isActive()}
                  data-active={isActive() ? 'true' : undefined}
                  data-testid={`ts-theme-chip-${id}`}
                  onClick={() => setTheme(id)}
                >
                  <span class="ts-theme-chip__label">{meta.label}</span>
                  <span class="ts-theme-chip__scheme">{meta.scheme}</span>
                </button>
              );
            }}
          </For>

          {/* User-saved custom themes — selectable + deletable. */}
          <For each={customThemes()}>
            {(ct) => {
              const isActive = () => themeId() === ct.id;
              return (
                <span class="ts-theme-chip-wrap">
                  <button
                    type="button"
                    class="ts-theme-chip ts-theme-chip--custom"
                    aria-pressed={isActive()}
                    data-active={isActive() ? 'true' : undefined}
                    data-testid={`ts-theme-chip-${ct.id}`}
                    onClick={() => setTheme(ct.id)}
                  >
                    <span class="ts-theme-chip__label">{ct.name}</span>
                    <span class="ts-theme-chip__scheme">custom · {ct.base}</span>
                  </button>
                  <button
                    type="button"
                    class="ts-theme-chip-del"
                    aria-label={`Delete theme ${ct.name}`}
                    title={`Delete ${ct.name}`}
                    onClick={() => deleteCustom(ct.id)}
                  >
                    ×
                  </button>
                </span>
              );
            }}
          </For>
        </div>
      </section>

      {/* ── Background selector ── */}
      <section class="ts-section" aria-labelledby="ts-bg-label">
        <h2 class="ts-section__heading" id="ts-bg-label">Background</h2>
        <div class="ts-theme-grid" role="radiogroup" aria-label="Select background">
          <For each={backgroundOptions}>
            {(opt) => {
              const isActive = () => backgroundId() === opt.id;
              return (
                <button
                  type="button"
                  class="ts-theme-chip"
                  aria-pressed={isActive()}
                  data-active={isActive() ? 'true' : undefined}
                  data-testid={`ts-bg-chip-${opt.id}`}
                  onClick={() => chooseBackground(opt.id)}
                >
                  <span class="ts-theme-chip__label">{opt.label}</span>
                  <span class="ts-theme-chip__scheme">{opt.kind}</span>
                </button>
              );
            }}
          </For>
        </div>
      </section>

      {/* ── Main editing area + live preview ── */}
      <div class="ts-body">
        {/* Token editor (tabs by group) */}
        <div class="ts-editor" aria-label="Token editor">
          <Tabs defaultValue={STUDIO_GROUPS[0]?.id ?? 'surfaces'}>
            <Tabs.List aria-label="Token group">
              <For each={STUDIO_GROUPS}>
                {(group) => (
                  <Tabs.Trigger value={group.id}>
                    {group.label}
                  </Tabs.Trigger>
                )}
              </For>
            </Tabs.List>

            <For each={STUDIO_GROUPS}>
              {(group) => (
                <Tabs.Content value={group.id}>
                  <GroupPanel
                    group={group}
                    overrides={overrides}
                    onTokenChange={handleTokenChange}
                  />
                </Tabs.Content>
              )}
            </For>
          </Tabs>
        </div>

        {/* Live preview */}
        <aside class="ts-preview-pane" aria-label="Live preview">
          <span class="ts-eyebrow">// Preview</span>
          <StudioPreview />
        </aside>
      </div>

      {/* ── Actions toolbar ── */}
      <footer class="ts-footer">
        <div class="ts-footer__left">
          <Tooltip content="Reset all custom overrides to the base theme defaults." placement="top">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={!hasOverrides()}
              data-testid="ts-reset-btn"
            >
              [reset]
            </Button>
          </Tooltip>
          <Show
            when={saving()}
            fallback={
              <Tooltip content="Save the current base + edits as a named theme you can select anywhere." placement="top">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={beginSave}
                  data-testid="ts-save-btn"
                >
                  [save theme]
                </Button>
              </Tooltip>
            }
          >
            <div class="ts-save-row" role="group" aria-label="Name your theme">
              <input
                ref={saveInputRef}
                class="ts-save-input"
                value={saveName()}
                placeholder="Theme name"
                aria-label="Theme name"
                spellcheck={false}
                onInput={(e) => setSaveName((e.currentTarget as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); confirmSave(); }
                  else if (e.key === 'Escape') { e.preventDefault(); setSaving(false); }
                }}
              />
              <Button variant="primary" size="sm" onClick={confirmSave} data-testid="ts-save-confirm">
                save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSaving(false)}>
                cancel
              </Button>
            </div>
          </Show>
        </div>

        <div class="ts-footer__right">
          <Show when={importError()}>
            {(err) => (
              <span class="ts-error" role="alert" data-testid="ts-import-error">
                {err()}
              </span>
            )}
          </Show>

          <Tooltip content="Import a previously exported theme JSON blob." placement="top">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleImport}
              data-testid="ts-import-btn"
            >
              [import]
            </Button>
          </Tooltip>

          <Tooltip
            content={exportCopied() ? 'Copied to clipboard!' : 'Export current token overrides as JSON.'}
            placement="top"
          >
            <Button
              variant="primary"
              size="sm"
              onClick={handleExport}
              data-testid="ts-export-btn"
            >
              <Show when={exportCopied()} fallback="[export]">
                [copied!]
              </Show>
            </Button>
          </Tooltip>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThemeStudio CSS — scoped to .ts-* classes.
// Written as a <style> tag appended at module init so it co-locates with the
// component without creating a separate CSS file.
// ---------------------------------------------------------------------------

const STUDIO_CSS = `
/* ── Studio shell ── */
.ts-studio {
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: 0;
  min-height: 100%;
  background: color-mix(in oklab, var(--ink) 90%, var(--stone));
  border: 1px solid var(--seam-faint);
  color: var(--washi);
  font-family: var(--font-sans);
}

/* ── Header ── */
.ts-header {
  padding: 1.1rem 1.4rem 0.9rem;
  border-bottom: 1px solid var(--seam-faint);
  display: grid;
  gap: 0.35rem;
}
.ts-header__title-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.ts-header__desc {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.88rem;
  line-height: 1.45;
  color: var(--washi-dim);
}

/* ── Eyebrow ── */
.ts-eyebrow {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--gold);
}

/* ── Badge ── */
.ts-badge {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 0.16rem 0.42rem;
  border: 1px solid currentColor;
}
.ts-badge--modified { color: var(--shu-bright); }

/* ── Section ── */
.ts-section {
  padding: 0.9rem 1.4rem;
  border-bottom: 1px solid var(--seam-faint);
}
.ts-section__heading {
  margin: 0 0 0.72rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--washi-mute);
  font-weight: 400;
}

/* ── Base theme grid ── */
.ts-theme-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.ts-theme-chip {
  appearance: none;
  cursor: pointer;
  border: 1px solid var(--seam-faint);
  background: color-mix(in oklab, var(--stone) 22%, transparent);
  color: var(--washi-dim);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  padding: 0.42rem 0.78rem;
  display: inline-flex;
  flex-direction: column;
  gap: 0.15rem;
  align-items: flex-start;
  transition:
    border-color var(--dur) var(--ease),
    color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}
.ts-theme-chip:hover {
  border-color: var(--lapis);
  color: var(--washi);
}
.ts-theme-chip[data-active='true'] {
  border-color: var(--lapis-bright);
  background: color-mix(in oklab, var(--lapis-deep) 22%, var(--stone));
  color: var(--lapis-bright);
}
.ts-theme-chip__scheme {
  font-size: 0.6rem;
  opacity: 0.6;
}

/* Custom (user-saved) theme chip + its delete affordance. */
.ts-theme-chip-wrap {
  position: relative;
  display: inline-flex;
}
.ts-theme-chip--custom {
  padding-right: 1.6rem;
  border-style: dashed;
}
.ts-theme-chip--custom[data-active='true'] {
  border-style: solid;
}
.ts-theme-chip-del {
  position: absolute;
  top: 50%;
  right: 0.3rem;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.05rem;
  height: 1.05rem;
  padding: 0;
  border: none;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--washi-mute);
  font-size: 0.95rem;
  line-height: 1;
  cursor: pointer;
  transition: color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.ts-theme-chip-del:hover {
  color: var(--shu-bright);
  background: color-mix(in oklab, var(--shu) 18%, transparent);
}
.ts-theme-chip-del:focus-visible {
  outline: 2px solid var(--lapis);
  outline-offset: 1px;
}

/* ── Body: editor + preview side-by-side ── */
.ts-body {
  display: grid;
  grid-template-columns: 1fr min(28rem, 40%);
  min-height: 0;
}
@media (max-width: 900px) {
  .ts-body { grid-template-columns: 1fr; }
}

/* ── Editor ── */
.ts-editor {
  padding: 1rem 1.2rem;
  border-right: 1px solid var(--seam-faint);
  overflow-y: auto;
  min-height: 0;
}
@media (max-width: 900px) {
  .ts-editor {
    border-right: none;
    border-bottom: 1px solid var(--seam-faint);
  }
}

/* ── Token group ── */
.ts-group {
  display: grid;
  gap: 1.1rem;
  padding: 0.75rem 0;
}

/* ── Token control ── */
.ts-token-control {
  display: grid;
  gap: 0.35rem;
}
.ts-token-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--gold);
}
.ts-token-badge {
  font-family: var(--font-mono);
  font-size: 0.64rem;
  color: var(--washi-mute);
}
.ts-token-color-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}
.ts-token-swatch {
  width: 2.4rem;
  height: 2rem;
  border: 1px solid var(--seam-faint);
  background: transparent;
  cursor: pointer;
  padding: 0.1rem;
  appearance: none;
  -webkit-appearance: none;
}
.ts-token-swatch::-webkit-color-swatch-wrapper { padding: 0; }
.ts-token-swatch::-webkit-color-swatch { border: none; }
.ts-token-swatch:focus-visible {
  outline: 2px solid var(--lapis);
  outline-offset: 2px;
}
.ts-token-value {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--washi-dim);
  letter-spacing: 0.04em;
}
.ts-token-range {
  width: 100%;
  cursor: pointer;
  accent-color: var(--gold-bright);
}
.ts-token-range:focus-visible {
  outline: 2px solid var(--lapis);
  outline-offset: 4px;
}
.ts-token-text-field { margin-top: 0.1rem; }

/* ── Preview pane ── */
.ts-preview-pane {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.2rem;
  overflow-y: auto;
}

/* ── Preview widget ── */
.ts-preview {
  border: 1px solid var(--seam);
  background: color-mix(in oklab, var(--stone) 26%, var(--ink));
  flex: 1;
  min-height: 0;
}
.ts-preview__bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--seam-faint);
  background: color-mix(in oklab, var(--ink) 72%, var(--stone));
}
.ts-preview__bar-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  flex: none;
}
.ts-preview__bar-title {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 0.64rem;
  letter-spacing: 0.08em;
  color: var(--washi-mute);
  text-align: center;
}
.ts-preview__body {
  display: grid;
  gap: 0.6rem;
  padding: 0.85rem;
}
.ts-preview__msg {
  display: flex;
  gap: 0.55rem;
  font-size: 0.84rem;
  line-height: 1.45;
}
.ts-preview__nick {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 700;
  flex: none;
  white-space: nowrap;
}
.ts-preview__nick::after { content: ':'; color: var(--washi-mute); }
.ts-preview__text {
  color: var(--washi-dim);
  font-family: var(--font-sans);
}
.ts-preview__text--dim { color: var(--washi-mute); font-style: italic; }
.ts-preview__input-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-top: 0.35rem;
}
.ts-preview__input {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.42rem 0.58rem;
  border: 1px solid var(--seam-faint);
  background: color-mix(in oklab, var(--ink) 70%, var(--stone));
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--washi-mute);
}
.ts-preview__prompt { color: var(--gold); }
.ts-preview__cursor {
  color: var(--washi);
  animation: ts-blink 1.1s steps(1) infinite;
}
@keyframes ts-blink { 50% { opacity: 0; } }
.ts-preview__actions {
  display: flex;
  gap: 0.35rem;
}

/* ── Footer toolbar ── */
.ts-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 1.2rem;
  border-top: 1px solid var(--seam-faint);
  flex-wrap: wrap;
}
.ts-footer__left,
.ts-footer__right {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.ts-error {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  color: var(--shu-bright);
}

/* ── Inline save-theme name field ── */
.ts-save-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.ts-save-input {
  width: 11rem;
  padding: 0.32rem 0.55rem;
  border: 1px solid var(--seam);
  border-radius: var(--r-sm);
  background: color-mix(in oklab, var(--ink) 60%, transparent);
  color: var(--washi);
  font-family: var(--font-mono);
  font-size: 0.74rem;
  letter-spacing: 0.02em;
}
.ts-save-input:focus-visible {
  outline: 2px solid var(--lapis);
  outline-offset: 1px;
  border-color: var(--lapis);
}
.ts-save-input::placeholder { color: var(--washi-mute); }
`;

// Inject the studio styles once at module evaluation time.
if (typeof document !== 'undefined') {
  const existing = document.getElementById('ruri-theme-studio-styles');
  if (!existing) {
    const styleEl = document.createElement('style');
    styleEl.id = 'ruri-theme-studio-styles';
    styleEl.textContent = STUDIO_CSS;
    document.head.appendChild(styleEl);
  }
}
