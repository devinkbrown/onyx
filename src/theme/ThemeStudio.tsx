// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ThemeStudio — live theme editor + generative theme factory.
 *
 * Pick a base theme, tweak any editable token, see changes in the live preview
 * panel.  Export the current override set as a JSON blob; import a previously
 * exported blob.
 *
 * The Factory section (top) drives src/theme/paletteFactory.ts:
 *   - GENERATE: a tiny seed (two hues + depth/vibrancy/warmth/contrast knobs)
 *     produces a full coherent token map, AA-clean by construction. Randomize
 *     rolls a tasteful fresh seed; "seed from current" recovers a seed from
 *     whatever palette is live so built-ins can be riffed on.
 *   - ADJUST: global relative transforms (hue rotate / saturation / warmth /
 *     contrast) over the current palette. A baseline is snapshotted when the
 *     user starts dragging, so transforms compose from that baseline and
 *     dragging back to zero restores it exactly. Bake (or Save) commits.
 *
 * Everything the factory produces flows through the same `overrides` signal
 * the manual editor uses, so the live preview, contrast audit, save, and
 * export all see the generated palette with no parallel state.
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
import { keyboardEventIsClaimed } from '../primitives/focusTrap';

import { useTheme } from './ThemeProvider';
import { THEMES, THEME_IDS, type ThemeId, type TokenMap } from './themes';
import { customThemeTokens, getCustomTheme, isCustomThemeId, type CustomTheme } from './customThemes';
import { themeShareUrl } from '@/lib/theme/themeShare';
import { STUDIO_GROUPS, type StudioGroup, type StudioToken } from './tokens';
import { resolveCssColor, wcagRating } from './contrast';
import {
  DEFAULT_SEED,
  adjustPalette,
  enforceAA,
  generatePalette,
  hexToOklch,
  randomSeed,
  seedFromTokens,
  type PaletteSeed,
} from './paletteFactory';
import { exportThemeSeed, parseThemeSeed } from './seedTransfer';
import { pickScreenColor, supportsEyeDropper } from './eyeDropper';
import { useStore, getState } from '@/lib/store';
import { backgroundOptions } from '@/backgrounds';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import { parseThemeExport, type ThemeExportBlob } from './themeImport';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportBlob = ThemeExportBlob;

/** The Adjust panel's transform state — identity means "no change". */
type AdjustState = {
  hueShift: number;
  saturation: number;
  warmth: number;
  contrast: number;
};

const ADJUST_IDENTITY: AdjustState = { hueShift: 0, saturation: 1, warmth: 0, contrast: 0 };

/** Debounce for live re-generation while factory seed knobs are dragged. */
const REGEN_DEBOUNCE_MS = 120;

function isAdjustIdentity(a: AdjustState): boolean {
  return (
    a.hueShift === ADJUST_IDENTITY.hueShift &&
    a.saturation === ADJUST_IDENTITY.saturation &&
    a.warmth === ADJUST_IDENTITY.warmth &&
    a.contrast === ADJUST_IDENTITY.contrast
  );
}

function fmtSigned(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

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

/**
 * Representative accent swatches for the seed colour pickers, taken straight
 * from the engine's output (`--lapis` / `--gold`) so each swatch previews
 * EXACTLY the accent the seed will produce — banned-hue snapping and gamut
 * clamping included. Deriving the swatch by hand from `seed.primaryHue` would
 * paint an indigo→magenta hue (258–342°) the factory never emits, so the
 * picker would lie about the result; sourcing it from `generatePalette` keeps
 * the preview faithful and auto-tracks any change to how the engine builds the
 * triads.
 */
export function seedSwatches(seed: PaletteSeed): { primary: string; accent: string } {
  const palette = generatePalette(seed);
  return {
    primary: palette['--lapis'] ?? '#000000',
    accent: palette['--gold'] ?? '#000000',
  };
}

function sampledAccentSeed(value: unknown): { hex: string; hue: number } | null {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return null;
  const hex = value.toLowerCase();
  const color = hexToOklch(hex);
  return color ? { hex, hue: Math.round(color.h) } : null;
}

// ---------------------------------------------------------------------------
// Live-preview panel — a compact but realistic slice of the app chrome (fake
// data, no store): channel rail with unread marks, header, message thread with
// role-coloured nicks, action buttons + badges, member list, composer. Every
// surface is painted with the live CSS vars so the whole mock re-tints as the
// palette changes — this is the "does my theme actually look good" surface.
// ---------------------------------------------------------------------------

function StudioPreview() {
  return (
    <div class="ts-preview" aria-label="Live preview">
      <div class="ts-preview__bar">
        <span class="ts-preview__bar-dot" style={{"background":"var(--shu)"}} />
        <span class="ts-preview__bar-dot" style={{"background":"var(--gold)"}} />
        <span class="ts-preview__bar-dot" style={{"background":"var(--ok)"}} />
        <span class="ts-preview__bar-title">onyx — eshmaki.me</span>
      </div>

      <div class="ts-preview__chrome" aria-hidden="true">
        {/* Channel rail */}
        <div class="ts-pv-side">
          <div class="ts-pv-side__server">
            <span class="ts-pv-side__sigil">◆</span>ircxnet
          </div>
          <div class="ts-pv-side__group">channels</div>
          <div class="ts-pv-chan" data-active="true">
            <span class="ts-pv-chan__hash">#</span>general
          </div>
          <div class="ts-pv-chan">
            <span class="ts-pv-chan__hash">#</span>reef
            <span class="ts-pv-chan__pip" />
          </div>
          <div class="ts-pv-chan">
            <span class="ts-pv-chan__hash">#</span>dev
            <span class="ts-pv-chan__count">3</span>
          </div>
          <div class="ts-pv-chan ts-pv-chan--muted">
            <span class="ts-pv-chan__hash">#</span>abyss
          </div>
          <div class="ts-pv-side__group">voice</div>
          <div class="ts-pv-chan">
            <span class="ts-pv-chan__hash ts-pv-chan__hash--voice">◉</span>tide-pool
          </div>
        </div>

        {/* Main column: header, thread, actions, composer */}
        <div class="ts-pv-main">
          <div class="ts-pv-head">
            <span class="ts-pv-head__chan">#general</span>
            <span class="ts-pv-head__topic">the tide is calm tonight</span>
            <span class="ts-pv-badge ts-pv-badge--accent">beta</span>
            <span class="ts-pv-badge ts-pv-badge--hot">3 new</span>
          </div>

          <div class="ts-pv-thread">
            <div class="ts-pv-msg">
              <span class="ts-pv-msg__time">21:04</span>
              <span class="ts-pv-msg__nick" style={{"color":"var(--lapis-bright)"}}>aoi</span>
              <span class="ts-pv-msg__text">surfaced from the deep current</span>
            </div>
            <div class="ts-pv-msg">
              <span class="ts-pv-msg__time">21:06</span>
              <span class="ts-pv-msg__nick" style={{"color":"var(--gold-bright)"}}>kain</span>
              <span class="ts-pv-msg__text">
                pushing the reef build tonight — <span class="ts-pv-msg__link">eshmaki.me/stats</span>
              </span>
            </div>
            <div class="ts-pv-msg">
              <span class="ts-pv-msg__time">21:07</span>
              <span class="ts-pv-msg__nick" style={{"color":"var(--ok)"}}>orochi</span>
              <span class="ts-pv-msg__text ts-pv-msg__text--dim">→ mesh: 2 shards linked, quorum ok</span>
            </div>
            <div class="ts-pv-msg">
              <span class="ts-pv-msg__time">21:09</span>
              <span class="ts-pv-msg__nick" style={{"color":"var(--shu)"}}>rei</span>
              <span class="ts-pv-msg__text">a coral light drifting through dark water</span>
            </div>
          </div>

          <div class="ts-pv-actions">
            <button class="ts-pv-btn ts-pv-btn--primary" type="button" tabIndex={-1}>join voice</button>
            <button class="ts-pv-btn ts-pv-btn--danger" type="button" tabIndex={-1}>leave</button>
          </div>

          <div class="ts-pv-composer">
            <span class="ts-pv-composer__prompt">›</span>
            <span class="ts-pv-composer__ghost">message #general</span>
            <span class="ts-pv-composer__cursor">█</span>
            <button class="ts-pv-btn ts-pv-btn--primary ts-pv-btn--send" type="button" tabIndex={-1}>send</button>
          </div>
        </div>

        {/* Member list with role sigils */}
        <div class="ts-pv-members">
          <div class="ts-pv-members__head">online — 4</div>
          <div class="ts-pv-member">
            <span class="ts-pv-member__sigil" style={{"color":"var(--gold-bright)"}}>!</span>aoi
            <span class="ts-pv-member__dot" style={{"background":"var(--ok)"}} />
          </div>
          <div class="ts-pv-member">
            <span class="ts-pv-member__sigil" style={{"color":"var(--lapis-bright)"}}>@</span>kain
            <span class="ts-pv-member__dot" style={{"background":"var(--ok)"}} />
          </div>
          <div class="ts-pv-member">
            <span class="ts-pv-member__sigil" style={{"color":"var(--ok)"}}>+</span>rei
            <span class="ts-pv-member__dot" style={{"background":"var(--warn)"}} />
          </div>
          <div class="ts-pv-member ts-pv-member--plain">
            <span class="ts-pv-member__sigil"> </span>mira
            <span class="ts-pv-member__dot" style={{"background":"var(--washi-mute)"}} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live contrast auditor — grades key foreground/background pairs against WCAG
// so a theme can't silently become unreadable. Reacts to live token edits.
// ---------------------------------------------------------------------------

// `min` is each pair's WCAG bar: body/secondary text needs AA 4.5; metadata and
// UI accents (links, status, danger — icon/large-text components) need 3:1.
// This mirrors paletteFactory's AA_PAIRS so a generated palette reads "all pass".
type ContrastPair = { label: string; fg: string; bg: string; min: number };

const CONTRAST_PAIRS: ContrastPair[] = [
  { label: 'Body text', fg: '--washi', bg: '--ink', min: 4.5 },
  { label: 'Secondary text', fg: '--washi-dim', bg: '--ink', min: 4.5 },
  { label: 'Metadata', fg: '--washi-mute', bg: '--ink', min: 3 },
  { label: 'Text on panel', fg: '--washi', bg: '--stone-2', min: 4.5 },
  { label: 'Links / accent', fg: '--lapis-bright', bg: '--ink', min: 3 },
  { label: 'Gold accent', fg: '--gold-bright', bg: '--ink', min: 3 },
  { label: 'Status OK', fg: '--ok', bg: '--ink', min: 3 },
  { label: 'Danger', fg: '--shu-bright', bg: '--ink', min: 3 },
];

type ContrastAuditProps = {
  /** Tracked so the audit re-runs on every live token edit. */
  overrides: () => TokenMap;
  /** Tracked so the audit re-runs when the base theme switches. */
  themeId: () => string;
  /** One-click repair — enforceAA over the resolved palette. */
  onAutoFix: () => void;
};

function ContrastAudit(props: ContrastAuditProps) {
  const [local] = splitProps(props, ['overrides', 'themeId', 'onAutoFix']);

  const rows = createMemo(() => {
    local.overrides(); // dependency: live edits
    local.themeId(); // dependency: base theme switch
    return CONTRAST_PAIRS.map((pair) => {
      const fg = resolveCssColor(readLiveVar(pair.fg));
      const bg = resolveCssColor(readLiveVar(pair.bg));
      const rating = fg && bg ? wcagRating(fg, bg) : null;
      return { ...pair, rating };
    });
  });

  const failing = createMemo(
    () => rows().filter((r) => r.rating && r.rating.ratio < r.min).length,
  );

  return (
    <div class="ts-audit" aria-label="Contrast audit" data-testid="ts-contrast-audit">
      <div class="ts-audit__head">
        <span class="ts-eyebrow">// Contrast (WCAG AA)</span>
        <Show
          when={failing() > 0}
          fallback={<span class="ts-audit__status ts-audit__status--ok" data-testid="ts-audit-status">all pass AA</span>}
        >
          <span class="ts-audit__status ts-audit__status--warn" data-testid="ts-audit-status">
            {failing()} below AA
          </span>
        </Show>
      </div>
      <ul class="ts-audit__list">
        <For each={rows()}>
          {(row) => (
            <li class="ts-audit__row">
              <span
                class="ts-audit__sample"
                aria-hidden="true"
                style={{ background: `var(${row.bg})`, color: `var(${row.fg})` }}
              >
                Aa
              </span>
              <span class="ts-audit__label">{row.label}</span>
              <Show
                when={row.rating}
                fallback={<span class="ts-audit__badge ts-audit__badge--na">n/a</span>}
              >
                {(r) => (
                  <>
                    <span class="ts-audit__ratio" title={`${r().ratio}:1`}>{r().ratio.toFixed(2)}</span>
                    <span
                      class={`ts-audit__badge ts-audit__badge--${r().level.toLowerCase().replace(/\s+/g, '-')}`}
                      aria-label={`${row.label}: contrast ${r().ratio} to one, ${r().level}`}
                    >
                      {r().level}
                    </span>
                  </>
                )}
              </Show>
            </li>
          )}
        </For>
      </ul>
      <button
        type="button"
        class="ts-audit__fix"
        data-failing={failing() > 0 ? 'true' : undefined}
        onClick={() => local.onAutoFix()}
        data-testid="ts-autofix"
        title="Nudge text tokens until every pair clears its WCAG floor."
      >
        ⚑ auto-fix to AA
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Factory slider — a labelled range control in the studio's visual language,
// shared by the Generate seed knobs and the Adjust transform knobs.
// ---------------------------------------------------------------------------

type FactorySliderProps = {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: () => number;
  format: (v: number) => string;
  onValue: (v: number) => void;
  /** Snapshot hook — the Adjust panel captures its baseline on drag start. */
  onPointerDown?: () => void;
  testid?: string;
};

function FactorySlider(props: FactorySliderProps) {
  const [local] = splitProps(props, [
    'id', 'label', 'min', 'max', 'step', 'value', 'format', 'onValue', 'onPointerDown', 'testid',
  ]);

  return (
    <div class="ts-token-control">
      <label class="ts-token-label" for={local.id}>
        {local.label}
        <span class="ts-token-badge">{local.format(local.value())}</span>
      </label>
      <input
        id={local.id}
        type="range"
        class="ts-token-range"
        min={local.min}
        max={local.max}
        step={local.step}
        value={local.value()}
        onInput={(e) => local.onValue(Number((e.currentTarget as HTMLInputElement).value))}
        onPointerDown={() => local.onPointerDown?.()}
        aria-label={local.label}
        aria-valuetext={local.format(local.value())}
        data-testid={local.testid}
      />
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
  /** Whether this token currently carries an override (vs the base value). */
  modified: () => boolean;
  /** Revert this token to the base theme's value. */
  onReset: () => void;
};

function TokenControl(props: TokenControlProps) {
  const [local] = splitProps(props, ['token', 'currentValue', 'onInput', 'modified', 'onReset']);
  const id = () => `ts-control-${local.token.property.replace(/^--/, '').replace(/-/g, '_')}`;

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
          <label class="ts-token-label" for={id()}>
            {local.token.label}
          </label>
          <div class="ts-token-color-row">
            <input
              id={id()}
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
          <label class="ts-token-label" for={id()}>
            {local.token.label}
            <span class="ts-token-badge">{raw()}</span>
          </label>
          <input
            id={id()}
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
          <label class="ts-token-label" for={id()}>
            {local.token.label}
            <span class="ts-token-badge">{raw()}</span>
          </label>
          <input
            id={id()}
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
            id={id()}
            label={local.token.label}
            value={raw()}
            onInput={handleTextInput}
            aria-label={local.token.label}
            class="ts-token-text-field"
            spellcheck={false}
          />
        </Show>

        <Show when={local.modified()}>
          <button
            type="button"
            class="ts-token-revert"
            onClick={() => local.onReset()}
            aria-label={`Revert ${local.token.label} to base`}
            title="Revert to base value"
            data-testid={`ts-revert-${local.token.property.replace(/^--/, '')}`}
          >
            ↺ revert
          </button>
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
  onTokenReset: (property: string) => void;
};

function GroupPanel(props: GroupPanelProps) {
  const [local] = splitProps(props, ['group', 'overrides', 'onTokenChange', 'onTokenReset']);

  return (
    <div class="ts-group" data-testid={`ts-group-${local.group.id}`}>
      <For each={local.group.tokens}>
        {(token) => {
          const currentValue = createMemo(() => {
            const override = local.overrides()[token.property];
            if (override !== undefined) return override;
            return readLiveVar(token.property);
          });
          const modified = createMemo(() => local.overrides()[token.property] !== undefined);

          return (
            <TokenControl
              token={token}
              currentValue={currentValue}
              modified={modified}
              onInput={(val) => local.onTokenChange(token.property, val)}
              onReset={() => local.onTokenReset(token.property)}
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
  const [seedCopied, setSeedCopied] = createSignal(false);
  const [shareCopied, setShareCopied] = createSignal(false);
  const [exportCopyBusy, setExportCopyBusy] = createSignal(false);
  const [seedCopyBusy, setSeedCopyBusy] = createSignal(false);
  const [shareCopyBusy, setShareCopyBusy] = createSignal(false);
  const [seedCopyFailure, setSeedCopyFailure] = createSignal<string | null>(null);
  const [footerCopyFailure, setFooterCopyFailure] = createSignal<string | null>(null);
  const [eyeDropperBusy, setEyeDropperBusy] = createSignal(false);
  const [eyeDropperStatus, setEyeDropperStatus] = createSignal<{
    message: string;
    failure: boolean;
  } | null>(null);
  const eyeDropperAvailable = supportsEyeDropper();
  // Inline "save theme" naming (replaces a browser prompt).
  const [saving, setSaving] = createSignal(false);
  const [saveName, setSaveName] = createSignal('');
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let seedTimer: ReturnType<typeof setTimeout> | undefined;
  let shareTimer: ReturnType<typeof setTimeout> | undefined;
  let saveInputRef: HTMLInputElement | undefined;
  let eyeDropperEpoch = 0;
  let exportCopyEpoch = 0;
  let seedCopyEpoch = 0;
  let shareCopyEpoch = 0;
  let disposed = false;

  // ── Factory state ──
  // The generative seed driving the GENERATE panel.
  const [seed, setSeed] = createSignal<PaletteSeed>({ ...DEFAULT_SEED });
  // Once the user has generated at least once, seed knobs re-generate live.
  const [factoryArmed, setFactoryArmed] = createSignal(false);
  // The ADJUST panel's relative transform (identity = untouched).
  const [adjust, setAdjust] = createSignal<AdjustState>({ ...ADJUST_IDENTITY });
  // When Generate produces a palette whose scheme differs from the base theme,
  // color-scheme is overridden live so the preview stays legible.
  const [schemeOverride, setSchemeOverride] = createSignal<'dark' | 'light' | null>(null);
  // Snapshot taken when an Adjust drag starts: transforms compose from this
  // baseline (not from each other), and identity restores it exactly.
  let adjustBaseline: { resolved: TokenMap; overrides: TokenMap } | null = null;
  let regenTimer: ReturnType<typeof setTimeout> | undefined;

  // When the base theme changes, clear per-session overrides so the new
  // theme's values render cleanly.  The ThemeProvider already writes the new
  // token set onto the root.
  createEffect(() => {
    themeId(); // track
    eyeDropperEpoch += 1;
    exportCopyEpoch += 1;
    seedCopyEpoch += 1;
    shareCopyEpoch += 1;
    if (copyTimer !== undefined) clearTimeout(copyTimer);
    if (seedTimer !== undefined) clearTimeout(seedTimer);
    if (shareTimer !== undefined) clearTimeout(shareTimer);
    copyTimer = undefined;
    seedTimer = undefined;
    shareTimer = undefined;
    setExportCopied(false);
    setSeedCopied(false);
    setShareCopied(false);
    setExportCopyBusy(false);
    setSeedCopyBusy(false);
    setShareCopyBusy(false);
    setSeedCopyFailure(null);
    setFooterCopyFailure(null);
    setEyeDropperBusy(false);
    setEyeDropperStatus(null);
    setOverrides({});
    setImportError(null);
    resetFactoryState();
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
    disposed = true;
    eyeDropperEpoch += 1;
    exportCopyEpoch += 1;
    seedCopyEpoch += 1;
    shareCopyEpoch += 1;
    const map = overrides();
    for (const prop of Object.keys(map)) {
      removeVar(prop);
    }
    if (copyTimer !== undefined) clearTimeout(copyTimer);
    if (seedTimer !== undefined) clearTimeout(seedTimer);
    if (shareTimer !== undefined) clearTimeout(shareTimer);
    if (regenTimer !== undefined) clearTimeout(regenTimer);
    // Restore the base theme's color-scheme if a generated palette changed it.
    if (schemeOverride() !== null) applyVar('color-scheme', baseScheme());
  });

  const handleTokenChange = (property: string, value: string): void => {
    setOverrides((prev) => ({ ...prev, [property]: value }));
    applyVar(property, value); // immediate live-preview
  };

  // Resolve the active theme's base token set (built-in tokens, or a custom
  // theme's base + its saved overrides).
  const baseTokens = (): TokenMap => {
    const id = themeId();
    if (isCustomThemeId(id)) {
      const c = getCustomTheme(id);
      return c ? customThemeTokens(c) : {};
    }
    return THEMES[id as ThemeId]?.tokens ?? {};
  };

  // ── Factory plumbing ──

  /** Scheme of the active base theme (built-in or a custom theme's base). */
  const baseScheme = (): 'dark' | 'light' => activeThemeMeta()?.scheme ?? 'dark';

  /** Effective scheme: a generated palette's scheme wins over the base's. */
  const activeScheme = (): 'dark' | 'light' => schemeOverride() ?? baseScheme();

  /** The palette as currently rendered: base tokens overlaid with overrides. */
  const resolvedTokens = (): TokenMap => ({ ...baseTokens(), ...overrides() });

  /**
   * Replace the whole override set with `map` and apply it live. Entries equal
   * to the base value are dropped (they change nothing), and overrides no
   * longer present are reverted to base — so Save/Export/audit all see exactly
   * the palette on screen, with no stale vars left behind.
   */
  const setAllOverrides = (map: TokenMap): void => {
    const base = baseTokens();
    const next: TokenMap = {};
    for (const [prop, val] of Object.entries(map)) {
      if (base[prop] !== val) next[prop] = val;
    }
    for (const prop of Object.keys(overrides())) {
      if (next[prop] === undefined) {
        removeVar(prop);
        const baseVal = base[prop];
        if (baseVal !== undefined) applyVar(prop, baseVal);
      }
    }
    for (const [prop, val] of Object.entries(next)) {
      applyVar(prop, val);
    }
    setOverrides(next);
  };

  /** Keep the preview legible when the generated scheme differs from base. */
  const applySchemeForPreview = (scheme: 'dark' | 'light'): void => {
    setSchemeOverride(scheme === baseScheme() ? null : scheme);
    applyVar('color-scheme', scheme);
  };

  /** Run the engine on a seed and apply the full result as live overrides. */
  const generateNow = (s: PaletteSeed = seed()): void => {
    setAllOverrides(generatePalette(s));
    applySchemeForPreview(s.scheme);
    // A fresh generation supersedes any in-flight adjust session.
    adjustBaseline = null;
    setAdjust({ ...ADJUST_IDENTITY });
    setFactoryArmed(true);
  };

  /** Update the seed; once armed (first Generate), re-generate live, debounced. */
  const updateSeed = (patch: Partial<PaletteSeed>): void => {
    const next = { ...seed(), ...patch };
    setSeed(next);
    if (!factoryArmed()) return;
    if (regenTimer !== undefined) clearTimeout(regenTimer);
    regenTimer = setTimeout(() => generateNow(next), REGEN_DEBOUNCE_MS);
  };

  const handleRandomize = (): void => {
    const s = randomSeed();
    setSeed(s);
    generateNow(s);
  };

  /** Recover a seed from whatever palette is live so it can be riffed on. */
  const handleSeedFromCurrent = (): void => {
    setSeed(seedFromTokens(resolvedTokens(), activeScheme()));
  };

  /**
   * Copy the current seed as a portable JSON envelope. Unlike [export], this
   * ships only the seven-field seed — the recipient regenerates the palette
   * locally through the factory, so it re-passes AA on their machine by
   * construction rather than trusting baked-in hex off the wire.
   */
  const handleExportSeed = async (): Promise<void> => {
    if (seedCopyBusy()) return;
    const epoch = ++seedCopyEpoch;
    const json = exportThemeSeed(activeThemeMeta()?.label ?? 'Custom', seed());
    if (seedTimer !== undefined) clearTimeout(seedTimer);
    setSeedCopied(false);
    setSeedCopyFailure(null);
    setSeedCopyBusy(true);
    let copied: boolean;
    try {
      copied = await writeClipboardText(json);
    } catch {
      copied = false;
    }
    if (disposed || epoch !== seedCopyEpoch) return;
    setSeedCopyBusy(false);
    if (!copied) {
      setSeedCopyFailure('Theme seed copy failed. Clipboard access may be blocked in this browser.');
      return;
    }

    setSeedCopied(true);
    seedTimer = setTimeout(() => {
      if (disposed || epoch !== seedCopyEpoch) return;
      setSeedCopied(false);
      seedTimer = undefined;
    }, 2200);
  };

  /**
   * Import a portable seed envelope, fail-closed. A malformed or out-of-range
   * seed is rejected with a message and nothing changes; a valid seed (with any
   * banned-hue warning surfaced) is loaded and generated immediately, so the
   * result is guaranteed AA-clean.
   */
  const handleImportSeed = (): void => {
    const raw = window.prompt('Paste an Onyx theme-seed JSON to import:', '');
    if (!raw) return;
    const result = parseThemeSeed(raw);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    setImportError(result.warnings.length > 0 ? result.warnings.join(' ') : null);
    setSeed(result.seed);
    generateNow(result.seed);
  };

  /** Capture the Adjust baseline once per drag session. */
  const ensureAdjustBaseline = (): void => {
    if (!adjustBaseline) {
      adjustBaseline = { resolved: resolvedTokens(), overrides: { ...overrides() } };
    }
  };

  /** Apply a transform patch, composing from the drag-start baseline. */
  const applyAdjustPatch = (patch: Partial<AdjustState>): void => {
    ensureAdjustBaseline();
    const next = { ...adjust(), ...patch };
    setAdjust(next);
    if (isAdjustIdentity(next)) {
      // Back to zero — restore the baseline exactly (no oklch round-trip drift).
      setAllOverrides(adjustBaseline!.overrides);
      return;
    }
    setAllOverrides(adjustPalette(adjustBaseline!.resolved, next, activeScheme()));
  };

  const adjustDirty = createMemo(() => !isAdjustIdentity(adjust()));

  /** Commit the adjusted palette: keep the tokens, zero the knobs. */
  const bakeAdjust = (): void => {
    adjustBaseline = null;
    setAdjust({ ...ADJUST_IDENTITY });
  };

  /** Abandon the adjust session and restore the baseline palette. */
  const revertAdjust = (): void => {
    if (adjustBaseline) setAllOverrides(adjustBaseline.overrides);
    bakeAdjust();
  };

  /** One-click AA repair over the resolved palette. */
  const handleAutoFix = (): void => {
    setAllOverrides(enforceAA(resolvedTokens(), activeScheme()));
  };

  const resetFactoryState = (): void => {
    adjustBaseline = null;
    setAdjust({ ...ADJUST_IDENTITY });
    setFactoryArmed(false);
    setSchemeOverride(null);
    if (regenTimer !== undefined) {
      clearTimeout(regenTimer);
      regenTimer = undefined;
    }
  };

  /**
   * When the factory generated a palette whose scheme differs from the active
   * base, anchor saves/exports on a same-scheme built-in so `color-scheme`
   * (form controls, scrollbars) matches the palette when it is re-applied.
   */
  const schemeCorrectedBase = (base: ThemeId): ThemeId => {
    const target = schemeOverride();
    if (!target || THEMES[base]?.scheme === target) return base;
    return target === 'light' ? 'pearl' : THEME_IDS[0]!;
  };

  // Representative swatches for the seed colour pickers — sourced from the
  // engine's own --lapis / --gold output so each swatch is a faithful preview
  // of the accent the seed will produce (banned-hue snapping + gamut clamp
  // included), never a raw seed hue the factory would never emit.
  const swatches = createMemo(() => seedSwatches(seed()));
  const primarySwatch = (): string => swatches().primary;
  const accentSwatch = (): string => swatches().accent;

  const handlePrimarySeedColor: JSX.EventHandlerUnion<HTMLInputElement, InputEvent> = (e) => {
    const ok = hexToOklch((e.currentTarget as HTMLInputElement).value);
    if (ok) updateSeed({ primaryHue: Math.round(ok.h) });
  };

  const handleAccentSeedColor: JSX.EventHandlerUnion<HTMLInputElement, InputEvent> = (e) => {
    const ok = hexToOklch((e.currentTarget as HTMLInputElement).value);
    if (ok) updateSeed({ accentHue: Math.round(ok.h) });
  };

  const handleAccentEyeDropper = async (): Promise<void> => {
    if (eyeDropperBusy()) return;
    const epoch = ++eyeDropperEpoch;
    setEyeDropperBusy(true);
    setEyeDropperStatus({ message: 'Choose an accent colour from the screen…', failure: false });

    try {
      const result = await pickScreenColor();
      if (disposed || epoch !== eyeDropperEpoch) return;

      if (result.state === 'selected') {
        const sampled = sampledAccentSeed(result.sRGBHex);
        if (!sampled) {
          setEyeDropperStatus({
            message: 'The sampled screen colour was invalid. The accent seed was not changed.',
            failure: true,
          });
          return;
        }
        updateSeed({ accentHue: sampled.hue });
        setEyeDropperStatus({
          message: `Accent seed sampled from ${sampled.hex}.`,
          failure: false,
        });
      } else if (result.state === 'cancelled' || result.state === 'unsupported') {
        setEyeDropperStatus({ message: result.detail, failure: false });
      } else {
        setEyeDropperStatus({ message: result.detail, failure: true });
      }
    } catch {
      if (!disposed && epoch === eyeDropperEpoch) {
        setEyeDropperStatus({
          message: 'Screen colour sampling failed. Use the accent colour control instead.',
          failure: true,
        });
      }
    } finally {
      if (!disposed && epoch === eyeDropperEpoch) setEyeDropperBusy(false);
    }
  };

  // Revert a single token to its base value, dropping just that override.
  const handleTokenReset = (property: string): void => {
    removeVar(property);
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[property];
      return next;
    });
    const baseVal = baseTokens()[property];
    if (baseVal !== undefined) applyVar(property, baseVal);
  };

  const handleReset = (): void => {
    const map = overrides();
    for (const prop of Object.keys(map)) {
      removeVar(prop);
    }
    setOverrides({});
    setImportError(null);
    resetFactoryState();
    // Re-apply the active theme's tokens (built-in or custom: base + overrides).
    const id = themeId();
    const tokens = isCustomThemeId(id)
      ? (getCustomTheme(id) ? customThemeTokens(getCustomTheme(id)!) : {})
      : (THEMES[id as ThemeId]?.tokens ?? {});
    for (const [prop, val] of Object.entries(tokens)) {
      applyVar(prop, val);
    }
    applyVar('color-scheme', baseScheme());
  };

  const handleExport = async (): Promise<void> => {
    if (exportCopyBusy()) return;
    const epoch = ++exportCopyEpoch;
    const id = themeId();
    const base: ThemeId = schemeCorrectedBase(
      isCustomThemeId(id) ? (getCustomTheme(id)?.base ?? THEME_IDS[0]!) : (id as ThemeId),
    );
    const baseOverrides = isCustomThemeId(id) ? (getCustomTheme(id)?.overrides ?? {}) : {};
    const blob: ExportBlob = {
      __onyx_theme_export__: true,
      base,
      overrides: { ...baseOverrides, ...overrides() },
      exported: new Date().toISOString(),
    };
    const json = JSON.stringify(blob, null, 2);

    if (copyTimer !== undefined) clearTimeout(copyTimer);
    setExportCopied(false);
    setFooterCopyFailure(null);
    setExportCopyBusy(true);
    let copied: boolean;
    try {
      copied = await writeClipboardText(json);
    } catch {
      copied = false;
    }
    if (disposed || epoch !== exportCopyEpoch) return;
    setExportCopyBusy(false);
    if (!copied) {
      setFooterCopyFailure('Theme export copy failed. Clipboard access may be blocked in this browser.');
      return;
    }

    setExportCopied(true);
    copyTimer = setTimeout(() => {
      if (disposed || epoch !== exportCopyEpoch) return;
      setExportCopied(false);
      copyTimer = undefined;
    }, 2200);
  };

  // The active theme, when it is a saved custom theme — the only thing that can
  // be turned into a shareable link. Tracks the saved list so it stays current.
  const shareableTheme = createMemo<CustomTheme | null>(() => {
    customThemes(); // dependency: saved custom themes changed
    const id = themeId();
    if (!isCustomThemeId(id)) return null;
    return getCustomTheme(id) ?? null;
  });

  // Copy a share link for the current custom theme to the clipboard. Guards a
  // missing Clipboard API and shows brief "copied" feedback on success.
  const handleShare = async (): Promise<void> => {
    if (shareCopyBusy()) return;
    const theme = shareableTheme();
    if (!theme) return;
    const epoch = ++shareCopyEpoch;
    if (shareTimer !== undefined) clearTimeout(shareTimer);
    setShareCopied(false);
    setFooterCopyFailure(null);
    setShareCopyBusy(true);
    let copied: boolean;
    try {
      copied = await writeClipboardText(themeShareUrl(theme, location.origin));
    } catch {
      copied = false;
    }
    if (disposed || epoch !== shareCopyEpoch) return;
    setShareCopyBusy(false);
    if (!copied) {
      setFooterCopyFailure('Theme share-link copy failed. Clipboard access may be blocked in this browser.');
      return;
    }

    setShareCopied(true);
    shareTimer = setTimeout(() => {
      if (disposed || epoch !== shareCopyEpoch) return;
      setShareCopied(false);
      shareTimer = undefined;
    }, 2200);
  };

  const handleImport = (): void => {
    const raw = window.prompt(
      'Paste an Onyx theme JSON blob to import:',
      '',
    );
    if (!raw) return;

    const result = parseThemeExport(raw);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    const parsed = result.value;

    setImportError(null);
    setTheme(parsed.base);
    // Apply overrides after a micro-task so the base theme finishes writing.
    queueMicrotask(() => {
      setOverrides(parsed.overrides);
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
    const base: ThemeId = schemeCorrectedBase(
      isCustomThemeId(id) ? (getCustomTheme(id)?.base ?? THEME_IDS[0]!) : (id as ThemeId),
    );
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

      {/* ── Factory — the generative palette engine ── */}
      <section class="ts-section ts-factory" aria-labelledby="ts-factory-label" data-testid="ts-factory">
        <h2 class="ts-section__heading" id="ts-factory-label">Factory</h2>
        <div class="ts-factory__grid">

          {/* Generate: seed → whole palette */}
          <div class="ts-factory__col" role="group" aria-label="Generate a palette from a seed">
            <div class="ts-factory__col-head">
              <span class="ts-eyebrow">// Generate</span>
              <div class="ts-scheme-toggle" role="group" aria-label="Colour scheme">
                <button
                  type="button"
                  class="ts-scheme-toggle__btn"
                  aria-pressed={seed().scheme === 'dark'}
                  data-testid="ts-scheme-dark"
                  onClick={() => updateSeed({ scheme: 'dark' })}
                >
                  dark
                </button>
                <button
                  type="button"
                  class="ts-scheme-toggle__btn"
                  aria-pressed={seed().scheme === 'light'}
                  data-testid="ts-scheme-light"
                  onClick={() => updateSeed({ scheme: 'light' })}
                >
                  light
                </button>
              </div>
            </div>

            <div class="ts-seed-colors">
              <div class="ts-seed-color">
                <label class="ts-token-label" for="ts-seed-primary">Primary seed</label>
                <div class="ts-token-color-row">
                  <input
                    id="ts-seed-primary"
                    type="color"
                    class="ts-token-swatch"
                    value={primarySwatch()}
                    onInput={handlePrimarySeedColor}
                    aria-label="Primary seed colour"
                    data-testid="ts-seed-primary"
                  />
                  <code class="ts-token-value">{primarySwatch()} · {Math.round(seed().primaryHue)}°</code>
                </div>
              </div>
              <div class="ts-seed-color">
                <label class="ts-token-label" for="ts-seed-accent">Accent seed</label>
                <div class="ts-token-color-row">
                  <input
                    id="ts-seed-accent"
                    type="color"
                    class="ts-token-swatch"
                    value={accentSwatch()}
                    onInput={handleAccentSeedColor}
                    aria-label="Accent seed colour"
                    data-testid="ts-seed-accent"
                  />
                  <code class="ts-token-value">{accentSwatch()} · {Math.round(seed().accentHue)}°</code>
                </div>
                <Show when={eyeDropperAvailable}>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="ts-eyedropper-button"
                    disabled={eyeDropperBusy()}
                    aria-busy={eyeDropperBusy()}
                    aria-label="Sample accent seed colour from the screen"
                    onClick={() => void handleAccentEyeDropper()}
                    data-testid="ts-accent-eyedropper"
                  >
                    {eyeDropperBusy() ? '[sampling screen…]' : '[⌖ sample screen]'}
                  </Button>
                </Show>
                <Show when={eyeDropperStatus()}>
                  {(status) => (
                    <span
                      class={`ts-eyedropper-status${status().failure ? ' ts-eyedropper-status--error' : ''}`}
                      role={status().failure ? 'alert' : 'status'}
                    >
                      {status().message}
                    </span>
                  )}
                </Show>
              </div>
            </div>

            <div class="ts-factory__sliders">
              <FactorySlider
                id="ts-gen-primary-hue" label="Primary hue" min={0} max={360} step={1}
                value={() => seed().primaryHue}
                format={(v) => `${Math.round(v)}°`}
                onValue={(v) => updateSeed({ primaryHue: v })}
              />
              <FactorySlider
                id="ts-gen-accent-hue" label="Accent hue" min={0} max={360} step={1}
                value={() => seed().accentHue}
                format={(v) => `${Math.round(v)}°`}
                onValue={(v) => updateSeed({ accentHue: v })}
              />
              <FactorySlider
                id="ts-gen-depth" label="Depth" min={0} max={1} step={0.01}
                value={() => seed().depth}
                format={(v) => v.toFixed(2)}
                onValue={(v) => updateSeed({ depth: v })}
              />
              <FactorySlider
                id="ts-gen-vibrancy" label="Vibrancy" min={0} max={1} step={0.01}
                value={() => seed().vibrancy}
                format={(v) => v.toFixed(2)}
                onValue={(v) => updateSeed({ vibrancy: v })}
              />
              <FactorySlider
                id="ts-gen-warmth" label="Warmth" min={-1} max={1} step={0.02}
                value={() => seed().warmth}
                format={fmtSigned}
                onValue={(v) => updateSeed({ warmth: v })}
              />
              <FactorySlider
                id="ts-gen-contrast" label="Contrast" min={4.5} max={12} step={0.1}
                value={() => seed().contrast}
                format={(v) => `${v.toFixed(1)}:1`}
                onValue={(v) => updateSeed({ contrast: v })}
              />
            </div>

            <div class="ts-factory__actions">
              <Button variant="primary" size="sm" onClick={() => generateNow()} data-testid="ts-generate">
                [generate]
              </Button>
              <Button variant="ghost" size="sm" onClick={handleRandomize} data-testid="ts-randomize">
                [🎲 randomize]
              </Button>
              <Tooltip content="Recover a seed from the palette that is live right now." placement="top">
                <Button variant="ghost" size="sm" onClick={handleSeedFromCurrent} data-testid="ts-seed-from-current">
                  [seed from current]
                </Button>
              </Tooltip>
              <div class="ts-seed-transfer" role="group" aria-label="Portable seed transfer">
                <Tooltip content="Copy this seed as portable JSON — the recipient regenerates it AA-clean." placement="top">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="ts-seed-btn"
                    data-copied={seedCopied() ? 'true' : undefined}
                    disabled={seedCopyBusy()}
                    aria-busy={seedCopyBusy()}
                    onClick={() => void handleExportSeed()}
                    data-testid="ts-export-seed"
                  >
                    {seedCopyBusy()
                      ? '[copying seed…]'
                      : seedCopied()
                        ? '[✓ seed copied]'
                        : '[export seed]'}
                  </Button>
                </Tooltip>
                <Tooltip content="Paste a portable seed JSON — validated fail-closed, then generated." placement="top">
                  <Button variant="ghost" size="sm" class="ts-seed-btn" onClick={handleImportSeed} data-testid="ts-import-seed">
                    [import seed]
                  </Button>
                </Tooltip>
              </div>
            </div>
            <Show when={seedCopyFailure()}>
              {(failure) => (
                <p class="ts-error" role="alert" data-testid="ts-seed-copy-error">
                  {failure()}
                </p>
              )}
            </Show>
            <p class="ts-factory__hint">
              One seed → a whole coherent palette, AA-clean by construction.
              After the first generate, the knobs re-generate live.
            </p>
          </div>

          {/* Adjust: global transforms on the current palette */}
          <div class="ts-factory__col" role="group" aria-label="Adjust the current palette">
            <div class="ts-factory__col-head">
              <span class="ts-eyebrow">// Adjust</span>
              <Show when={adjustDirty()}>
                <span class="ts-badge ts-badge--modified">live</span>
              </Show>
            </div>

            <div class="ts-factory__sliders">
              <FactorySlider
                id="ts-adj-hue" label="Hue rotate" min={-180} max={180} step={1}
                value={() => adjust().hueShift}
                format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}°`}
                onValue={(v) => applyAdjustPatch({ hueShift: v })}
                onPointerDown={ensureAdjustBaseline}
                testid="ts-adjust-hue"
              />
              <FactorySlider
                id="ts-adj-sat" label="Saturation" min={0} max={1.6} step={0.01}
                value={() => adjust().saturation}
                format={(v) => `×${v.toFixed(2)}`}
                onValue={(v) => applyAdjustPatch({ saturation: v })}
                onPointerDown={ensureAdjustBaseline}
                testid="ts-adjust-saturation"
              />
              <FactorySlider
                id="ts-adj-warmth" label="Warmth" min={-1} max={1} step={0.02}
                value={() => adjust().warmth}
                format={fmtSigned}
                onValue={(v) => applyAdjustPatch({ warmth: v })}
                onPointerDown={ensureAdjustBaseline}
                testid="ts-adjust-warmth"
              />
              <FactorySlider
                id="ts-adj-contrast" label="Contrast" min={-1} max={1} step={0.02}
                value={() => adjust().contrast}
                format={fmtSigned}
                onValue={(v) => applyAdjustPatch({ contrast: v })}
                onPointerDown={ensureAdjustBaseline}
                testid="ts-adjust-contrast"
              />
            </div>

            <div class="ts-factory__actions">
              <Tooltip content="Commit the adjusted palette and zero the knobs." placement="top">
                <Button variant="primary" size="sm" onClick={bakeAdjust} disabled={!adjustDirty()} data-testid="ts-bake">
                  [bake]
                </Button>
              </Tooltip>
              <Tooltip content="Abandon the adjustment and restore the palette you started from." placement="top">
                <Button variant="ghost" size="sm" onClick={revertAdjust} disabled={!adjustDirty()} data-testid="ts-adjust-revert">
                  [revert]
                </Button>
              </Tooltip>
            </div>
            <p class="ts-factory__hint">
              Relative nudges from the palette as it was when you started dragging —
              zero restores it exactly. Bake (or Save) keeps the result.
            </p>
          </div>
        </div>
      </section>

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
          {/* 'auto' follows the active theme's signature scene (see themeBackground.ts). */}
          <button
            type="button"
            class="ts-theme-chip"
            aria-pressed={backgroundId() === 'auto'}
            data-active={backgroundId() === 'auto' ? 'true' : undefined}
            data-testid="ts-bg-chip-auto"
            onClick={() => chooseBackground('auto')}
          >
            <span class="ts-theme-chip__label">Auto</span>
            <span class="ts-theme-chip__scheme">match theme</span>
          </button>
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
                    onTokenReset={handleTokenReset}
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
          <ContrastAudit overrides={overrides} themeId={themeId} onAutoFix={handleAutoFix} />
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
                  if (keyboardEventIsClaimed(e)) return;
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

          <Show when={footerCopyFailure()}>
            {(failure) => (
              <span class="ts-error" role="alert" data-testid="ts-copy-error">
                {failure()}
              </span>
            )}
          </Show>

          <Show when={shareableTheme()}>
            <Tooltip
              content={shareCopied() ? 'Link copied to clipboard!' : 'Copy a shareable link to this custom theme.'}
              placement="top"
            >
              <Button
                variant="ghost"
                size="sm"
                disabled={shareCopyBusy()}
                aria-busy={shareCopyBusy()}
                onClick={() => void handleShare()}
                data-testid="ts-share-btn"
              >
                {shareCopyBusy() ? '[copying link…]' : shareCopied() ? '[copied!]' : '[share link]'}
              </Button>
            </Tooltip>
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
              disabled={exportCopyBusy()}
              aria-busy={exportCopyBusy()}
              onClick={() => void handleExport()}
              data-testid="ts-export-btn"
            >
              {exportCopyBusy() ? '[copying…]' : exportCopied() ? '[copied!]' : '[export]'}
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

/* ── Factory — generative palette engine ── */
.ts-factory__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
@media (max-width: 860px) {
  .ts-factory__grid { grid-template-columns: 1fr; }
}
.ts-factory__col {
  border: 1px solid var(--seam-faint);
  background: color-mix(in oklab, var(--ink) 82%, var(--stone));
  padding: 0.8rem 0.9rem 0.9rem;
  display: grid;
  gap: 0.75rem;
  align-content: start;
}
.ts-factory__col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.ts-factory__sliders {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem 1rem;
}
@media (max-width: 520px) {
  .ts-factory__sliders { grid-template-columns: 1fr; }
}
.ts-factory__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.1rem;
}

/* Portable-seed pair: export/import are one artifact moving in and out, so a
   hairline seam sets them apart from the generation actions (proximity does
   the grouping). The copied confirm is a designed state, not a bare text swap. */
.ts-seed-transfer {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding-inline-start: 0.6rem;
  border-inline-start: 1px solid var(--seam-faint);
}
.ts-seed-btn {
  transition:
    color var(--dur) var(--ease),
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease),
    transform var(--dur) var(--ease);
}
.ts-seed-btn[data-copied='true'],
.ts-seed-btn[data-copied='true']:hover:not(:disabled):not([aria-disabled='true']),
.ts-seed-btn[data-copied='true']:active:not(:disabled):not([aria-disabled='true']) {
  color: var(--lapis-bright);
  border-color: var(--lapis-bright);
  background: color-mix(in oklab, var(--lapis-deep) 32%, var(--stone));
  box-shadow:
    0 0 0 1px color-mix(in oklab, var(--lapis-bright) 42%, transparent) inset,
    0 0 22px -14px var(--lapis-bright);
  transform: none;
  animation: ts-seed-copied-flash var(--dur) var(--ease);
}
@keyframes ts-seed-copied-flash {
  0% {
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--lapis-bright) 42%, transparent) inset,
      0 0 0 0 color-mix(in oklab, var(--lapis-bright) 55%, transparent);
  }
  60% {
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--lapis-bright) 42%, transparent) inset,
      0 0 0 4px color-mix(in oklab, var(--lapis-bright) 20%, transparent);
  }
  100% {
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--lapis-bright) 42%, transparent) inset,
      0 0 22px -14px var(--lapis-bright);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ts-seed-btn { transition: none; }
  .ts-seed-btn[data-copied='true'] { animation: none; }
}
.ts-factory__hint {
  margin: 0;
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 0.7rem;
  line-height: 1.45;
  color: var(--washi-mute);
}
.ts-seed-colors {
  display: flex;
  gap: 1.1rem;
  flex-wrap: wrap;
}
.ts-seed-color {
  display: grid;
  gap: 0.3rem;
}
.ts-eyedropper-button {
  width: max-content;
}
.ts-eyedropper-status {
  max-width: 22rem;
  font-family: var(--font-mono);
  font-size: 0.66rem;
  line-height: 1.45;
  color: var(--washi-dim);
}
.ts-eyedropper-status--error {
  color: var(--shu-bright);
}
.ts-scheme-toggle {
  display: inline-flex;
  border: 1px solid var(--seam-faint);
  width: max-content;
}
.ts-scheme-toggle__btn {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--washi-dim);
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.3rem 0.7rem;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    color var(--dur) var(--ease);
}
.ts-scheme-toggle__btn:hover { color: var(--washi); }
.ts-scheme-toggle__btn[aria-pressed='true'] {
  background: color-mix(in oklab, var(--lapis-deep) 30%, var(--stone));
  color: var(--lapis-bright);
}
.ts-scheme-toggle__btn:focus-visible {
  outline: 2px solid var(--lapis);
  outline-offset: -2px;
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

/* ── Contrast auditor ── */
.ts-audit {
  border: 1px solid var(--seam-faint);
  background: color-mix(in oklab, var(--ink) 80%, var(--stone));
  padding: 0.7rem 0.8rem 0.8rem;
}
.ts-audit__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.55rem;
}
.ts-audit__status {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.1rem 0.4rem;
  border-radius: var(--r-sm);
}
.ts-audit__status--ok { color: var(--ok); border: 1px solid color-mix(in oklab, var(--ok) 40%, transparent); }
.ts-audit__status--warn { color: var(--shu-bright); border: 1px solid color-mix(in oklab, var(--shu-bright) 50%, transparent); }
.ts-audit__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.3rem; }
.ts-audit__row {
  display: grid;
  grid-template-columns: 1.6rem minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.5rem;
}
.ts-audit__sample {
  display: grid;
  place-items: center;
  width: 1.6rem;
  height: 1.6rem;
  border: 1px solid var(--seam-faint);
  border-radius: var(--r-sm);
  font-family: var(--font-serif);
  font-size: 0.78rem;
  line-height: 1;
}
.ts-audit__label { font-size: 0.74rem; color: var(--washi-dim); min-width: 0; }
.ts-audit__ratio { font-family: var(--font-mono); font-size: 0.7rem; color: var(--washi-mute); }
.ts-audit__badge {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.08rem 0.34rem;
  border-radius: var(--r-sm);
  border: 1px solid transparent;
  white-space: nowrap;
}
.ts-audit__badge--aaa { color: var(--ok); border-color: color-mix(in oklab, var(--ok) 48%, transparent); }
.ts-audit__badge--aa { color: var(--lapis-bright); border-color: color-mix(in oklab, var(--lapis-bright) 48%, transparent); }
.ts-audit__badge--aa-large { color: var(--gold-bright); border-color: color-mix(in oklab, var(--gold-bright) 48%, transparent); }
.ts-audit__badge--fail { color: var(--ink); background: var(--shu); border-color: var(--shu); }
.ts-audit__badge--na { color: var(--washi-mute); border-color: var(--seam-faint); }

/* One-click AA repair — lives with the audit so a failing row has its fix. */
.ts-audit__fix {
  width: 100%;
  margin-top: 0.6rem;
  padding: 0.3rem 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gold-bright);
  background: transparent;
  border: 1px solid color-mix(in oklab, var(--gold-bright) 36%, transparent);
  border-radius: var(--r-sm);
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    color var(--dur) var(--ease),
    border-color var(--dur) var(--ease);
}
.ts-audit__fix[data-failing='true'] {
  color: var(--shu-bright);
  border-color: color-mix(in oklab, var(--shu-bright) 50%, transparent);
}
.ts-audit__fix:hover {
  color: var(--ink);
  background: var(--gold-bright);
  border-color: var(--gold-bright);
}
.ts-audit__fix[data-failing='true']:hover {
  background: var(--shu-bright);
  border-color: var(--shu-bright);
}
.ts-audit__fix:focus-visible {
  outline: 2px solid var(--lapis);
  outline-offset: 2px;
}

/* ── Per-token revert ── */
.ts-token-revert {
  justify-self: start;
  margin-top: 0.3rem;
  padding: 0.12rem 0.45rem;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  color: var(--gold-bright);
  background: transparent;
  border: 1px solid color-mix(in oklab, var(--gold-bright) 36%, transparent);
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.ts-token-revert:hover {
  color: var(--ink);
  background: var(--gold-bright);
  border-color: var(--gold-bright);
}

/* ── Preview widget — miniature app chrome ── */
.ts-preview {
  border: 1px solid var(--seam);
  background: color-mix(in oklab, var(--stone) 26%, var(--ink));
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
/* The three-column chrome mock: channel rail | main | member list. */
.ts-preview__chrome {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  flex: 1;
  min-height: 0;
}

/* Channel rail */
.ts-pv-side {
  width: 5.6rem;
  padding: 0.5rem 0.4rem;
  border-right: 1px solid var(--seam-faint);
  background: color-mix(in oklab, var(--ink) 78%, var(--stone));
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  font-family: var(--font-mono);
}
.ts-pv-side__server {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.56rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--washi);
  padding: 0.15rem 0.3rem 0.42rem;
  border-bottom: 1px solid var(--seam-faint);
  margin-bottom: 0.3rem;
}
.ts-pv-side__sigil { color: var(--lapis-bright); font-size: 0.6rem; }
.ts-pv-side__group {
  font-size: 0.5rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--washi-mute);
  margin: 0.32rem 0.3rem 0.08rem;
}
.ts-pv-chan {
  display: flex;
  align-items: center;
  gap: 0.24rem;
  font-size: 0.62rem;
  color: var(--washi-dim);
  padding: 0.16rem 0.3rem;
  border-radius: var(--r-sm);
}
.ts-pv-chan__hash { color: var(--washi-mute); }
.ts-pv-chan__hash--voice { color: var(--ok); font-size: 0.52rem; }
.ts-pv-chan[data-active='true'] {
  background: color-mix(in oklab, var(--lapis-deep) 32%, transparent);
  color: var(--lapis-bright);
}
.ts-pv-chan[data-active='true'] .ts-pv-chan__hash { color: var(--lapis); }
.ts-pv-chan--muted { color: var(--washi-mute); }
.ts-pv-chan__pip {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--shu);
  margin-left: auto;
  flex: none;
}
.ts-pv-chan__count {
  margin-left: auto;
  font-size: 0.5rem;
  font-weight: 700;
  background: var(--shu);
  color: var(--ink);
  padding: 0 0.26rem;
  border-radius: var(--r-pill);
  flex: none;
}

/* Main column */
.ts-pv-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.ts-pv-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.55rem;
  border-bottom: 1px solid var(--seam-faint);
  background: color-mix(in oklab, var(--ink) 68%, var(--stone));
}
.ts-pv-head__chan {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 0.66rem;
  color: var(--washi);
  flex: none;
}
.ts-pv-head__topic {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 0.6rem;
  color: var(--washi-mute);
}
.ts-pv-badge {
  flex: none;
  font-family: var(--font-mono);
  font-size: 0.5rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.08rem 0.3rem;
  border-radius: var(--r-sm);
  border: 1px solid transparent;
}
.ts-pv-badge--accent {
  color: var(--lapis-bright);
  border-color: color-mix(in oklab, var(--lapis-bright) 45%, transparent);
}
.ts-pv-badge--hot {
  color: var(--ink);
  background: var(--shu);
  font-weight: 700;
}
.ts-pv-thread {
  display: grid;
  gap: 0.34rem;
  padding: 0.55rem;
  align-content: start;
  flex: 1;
}
.ts-pv-msg {
  display: flex;
  gap: 0.38rem;
  align-items: baseline;
  font-size: 0.68rem;
  line-height: 1.4;
  min-width: 0;
}
.ts-pv-msg__time {
  font-family: var(--font-mono);
  font-size: 0.52rem;
  color: var(--washi-mute);
  flex: none;
}
.ts-pv-msg__nick {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  font-weight: 700;
  flex: none;
  white-space: nowrap;
}
.ts-pv-msg__nick::after { content: ':'; color: var(--washi-mute); }
.ts-pv-msg__text {
  color: var(--washi);
  font-family: var(--font-sans);
  min-width: 0;
}
.ts-pv-msg__text--dim { color: var(--washi-mute); font-style: italic; }
.ts-pv-msg__link {
  color: var(--lapis-bright);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.ts-pv-actions {
  display: flex;
  gap: 0.4rem;
  padding: 0 0.55rem 0.5rem;
}
.ts-pv-btn {
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.06em;
  padding: 0.26rem 0.6rem;
  border-radius: var(--r-sm);
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    color var(--dur) var(--ease),
    border-color var(--dur) var(--ease);
}
.ts-pv-btn--primary {
  background: var(--lapis);
  color: var(--ink);
  border-color: color-mix(in oklab, var(--lapis-bright) 55%, transparent);
}
.ts-pv-btn--primary:hover { background: var(--lapis-bright); }
.ts-pv-btn--danger {
  background: transparent;
  color: var(--shu-bright);
  border-color: color-mix(in oklab, var(--shu) 55%, transparent);
}
.ts-pv-btn--danger:hover {
  background: var(--shu);
  color: var(--ink);
  border-color: var(--shu);
}
.ts-pv-composer {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.1rem 0.55rem 0.55rem;
  padding: 0.3rem 0.45rem;
  border: 1px solid var(--seam-faint);
  border-radius: var(--r-sm);
  background: color-mix(in oklab, var(--ink) 70%, var(--stone));
}
.ts-pv-composer__prompt {
  color: var(--gold);
  font-family: var(--font-mono);
  font-size: 0.66rem;
}
.ts-pv-composer__ghost {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--washi-mute);
  font-family: var(--font-mono);
  font-size: 0.6rem;
}
.ts-pv-composer__cursor {
  color: var(--washi);
  font-size: 0.6rem;
  animation: ts-blink 1.1s steps(1) infinite;
}
@keyframes ts-blink { 50% { opacity: 0; } }
.ts-pv-btn--send { padding: 0.16rem 0.5rem; }

/* Member list */
.ts-pv-members {
  width: 5.8rem;
  padding: 0.5rem 0.45rem;
  border-left: 1px solid var(--seam-faint);
  background: color-mix(in oklab, var(--ink) 78%, var(--stone));
  display: flex;
  flex-direction: column;
  gap: 0.26rem;
  font-family: var(--font-mono);
}
.ts-pv-members__head {
  font-size: 0.5rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--washi-mute);
  margin-bottom: 0.15rem;
}
.ts-pv-member {
  display: flex;
  align-items: center;
  gap: 0.26rem;
  font-size: 0.62rem;
  color: var(--washi-dim);
}
.ts-pv-member--plain { color: var(--washi-mute); }
.ts-pv-member__sigil {
  width: 0.6rem;
  text-align: center;
  font-weight: 700;
  flex: none;
  white-space: pre;
}
.ts-pv-member__dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  margin-left: auto;
  flex: none;
}
@media (max-width: 560px) {
  .ts-pv-members { display: none; }
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

/* At 400% zoom the studio is a narrow editing surface, not a scaled desktop
   canvas. Collapse decorative preview chrome and let every editing group own
   its wrapping so the page never inherits a multi-column min-content width. */
@media (max-width: 42rem) and (max-height: 30rem) {
  .ts-studio,
  .ts-studio * {
    min-width: 0;
  }

  .ts-studio {
    width: 100%;
    max-width: 100%;
    overflow-x: hidden;
  }

  .ts-header,
  .ts-section,
  .ts-editor,
  .ts-preview-pane,
  .ts-footer {
    padding: 8px;
  }

  .ts-header,
  .ts-factory__col,
  .ts-group,
  .ts-preview-pane {
    gap: 8px;
  }

  .ts-header__title-row,
  .ts-factory__col-head,
  .ts-audit__head {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 4px;
  }

  .ts-header__desc,
  .ts-factory__hint,
  .ts-eyedropper-status,
  .ts-error {
    overflow-wrap: anywhere;
  }

  .ts-header__desc,
  .ts-factory__hint,
  .ts-eyedropper-status {
    font-size: 16px;
    line-height: 1.4;
  }

  .ts-eyebrow,
  .ts-section__heading,
  .ts-token-label {
    font-size: 14px;
    letter-spacing: 0.08em;
  }

  .ts-section__heading {
    margin-bottom: 8px;
  }

  .ts-theme-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }

  .ts-theme-chip {
    width: 100%;
    min-height: 44px;
    padding: 8px 10px;
    font-size: 14px;
  }

  .ts-factory__col {
    padding: 8px;
  }

  .ts-scheme-toggle {
    display: flex;
    width: 100%;
  }

  .ts-scheme-toggle__btn {
    flex: 1 1 0;
    min-height: 44px;
    padding: 8px;
    font-size: 14px;
  }

  .ts-factory__actions,
  .ts-seed-transfer,
  .ts-footer__left,
  .ts-footer__right,
  .ts-save-row {
    flex-wrap: wrap;
    gap: 4px;
  }

  .ts-seed-transfer {
    width: 100%;
    padding: 4px 0 0;
    border-inline-start: 0;
    border-top: 1px solid var(--seam-faint);
  }

  .ts-studio .onyx-button {
    min-height: 44px;
    max-width: 100%;
    padding: 8px 10px;
    font-size: 14px;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .ts-seed-colors {
    gap: 8px;
  }

  .ts-seed-color {
    width: 100%;
  }

  .ts-token-color-row {
    gap: 8px;
  }

  .ts-token-swatch {
    width: 44px;
    height: 44px;
    padding: 2px;
    flex: none;
  }

  .ts-token-value {
    font-size: 14px;
    overflow-wrap: anywhere;
  }

  .ts-audit {
    padding: 8px;
  }

  .ts-audit__row {
    grid-template-columns: 44px minmax(0, 1fr) auto;
    gap: 4px 8px;
  }

  .ts-audit__sample {
    grid-column: 1;
    grid-row: 1 / span 2;
    width: 44px;
    height: 44px;
    font-size: 16px;
  }

  .ts-audit__label {
    grid-column: 2 / -1;
    grid-row: 1;
    font-size: 16px;
    overflow-wrap: anywhere;
  }

  .ts-audit__ratio {
    grid-column: 2;
    grid-row: 2;
    font-size: 14px;
  }

  .ts-audit__badge {
    grid-column: 3;
    grid-row: 2;
    padding: 2px 6px;
    font-size: 12px;
  }

  .ts-preview__bar {
    gap: 4px;
    padding: 8px;
  }

  .ts-preview__bar-title {
    font-size: 14px;
    overflow-wrap: anywhere;
  }

  .ts-preview__chrome {
    grid-template-columns: minmax(0, 1fr);
  }

  .ts-preview,
  .ts-preview__chrome,
  .ts-pv-main {
    overflow: hidden;
  }

  .ts-pv-side,
  .ts-pv-members {
    display: none;
  }

  .ts-pv-head {
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px;
  }

  .ts-pv-head__chan {
    font-size: 14px;
  }

  .ts-pv-head__topic {
    display: none;
  }

  .ts-pv-badge {
    padding: 2px 4px;
    font-size: 10px;
  }

  .ts-pv-thread {
    gap: 4px;
    padding: 8px;
  }

  .ts-pv-msg {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 2px 4px;
    font-size: 14px;
  }

  .ts-pv-msg__time {
    font-size: 10px;
  }

  .ts-pv-msg__nick {
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .ts-pv-msg__text {
    grid-column: 1 / -1;
    font-size: 14px;
    overflow-wrap: anywhere;
  }

  .ts-pv-actions {
    flex-wrap: wrap;
    gap: 4px;
    padding: 0 8px 8px;
  }

  .ts-pv-btn {
    min-height: 44px;
    max-width: 100%;
    padding: 8px;
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .ts-pv-composer {
    gap: 4px;
    margin: 0 8px 8px;
    padding: 8px;
  }

  .ts-pv-composer__prompt {
    font-size: 14px;
  }

  .ts-pv-composer__ghost,
  .ts-pv-composer__cursor {
    font-size: 12px;
  }

  .ts-footer {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }

  .ts-footer__left,
  .ts-footer__right,
  .ts-save-row {
    width: 100%;
  }

  .ts-save-input {
    flex: 1 1 100%;
    width: 100%;
    max-width: 100%;
    min-height: 44px;
    padding: 8px 10px;
    font-size: 16px;
  }

  .ts-error {
    width: 100%;
    font-size: 14px;
  }
}
`;

// Inject the studio styles once at module evaluation time.
if (typeof document !== 'undefined') {
  const existing = document.getElementById('onyx-theme-studio-styles');
  if (!existing) {
    const styleEl = document.createElement('style');
    styleEl.id = 'onyx-theme-studio-styles';
    styleEl.textContent = STUDIO_CSS;
    document.head.appendChild(styleEl);
  }
}
