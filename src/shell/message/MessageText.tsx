// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MessageText.tsx — renders a parsed token array as safe SolidJS JSX.
 *
 * SECURITY: NEVER uses innerHTML or dangerouslySetInnerHTML.
 * All user content is rendered as JSX text nodes or via safe element props.
 *
 * Features:
 * - Bold, italic, strike, inline code, code blocks, blockquotes
 * - Spoiler (click-to-reveal) — keyboard accessible
 * - Links as <a target="_blank" rel="noopener noreferrer">
 * - @mention — self-mention gets distinct class
 * - #channel — clickable jump via onChannelClick callback
 * - :emoji: shortcode → unicode (unknown shortcodes render literally as :code:)
 * - Inline media unfurl for direct image/video/audio URLs
 *
 * SOLID IDIOMS: never destructure props; use splitProps; For/Show/Switch/Match.
 */

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  Switch,
  Match,
  onCleanup,
  splitProps,
  type JSX,
} from 'solid-js';
import { createResource } from 'solid-js';
import { preferences } from '@/lib/prefs/preferences';
import { fetchLinkPreview, isPreviewableUrl, pickPreviewUrl } from '@/lib/preview/linkPreview';
import {
  mayUnfurlUrl,
  unfurlPrivacyFromPrefs,
  type UnfurlPrivacyPrefs,
} from '@/lib/preview/unfurlPrivacy';
import { parseMessage } from '@/lib/format/parseMessage';
import { lookupEmoji } from '@/lib/format/emoji';
import {
  extractBlockKitLite,
  prepareBlockKitAction,
  type BlockKitLiteAction,
  type BlockKitLiteBlock,
  type BlockKitLiteButton,
  type BlockKitLiteMessageBlock,
  type BlockKitLiteModalBlock,
  type BlockKitLiteSelect,
  type PreparedBlockKitAction,
} from '@/lib/integrations/blockKitLite';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';
import { getState } from '@/lib/store';
import { BlockKitActionConfirmationDialog } from './BlockKitActionConfirmation';
import { BlockKitModal } from './BlockKitModal';
import type {
  Token,
  InlineToken,
  BoldToken,
  ItalicToken,
  StrikeToken,
  SpoilerToken,
  StyledToken,
  BlockquoteToken,
  CodeBlockToken,
} from '@/lib/format/parseMessage';

// ── Media detection ───────────────────────────────────────────────────────────

const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i;
const VIDEO_EXTS = /\.(mp4|webm)(\?.*)?$/i;
const AUDIO_EXTS = /\.(mp3|ogg|wav)(\?.*)?$/i;

type MediaKind = 'image' | 'video' | 'audio' | null;

/**
 * True only for an absolute http(s) URL. This is the single gate every href/src
 * placed by this component must pass, so a javascript:/data:/vbscript: scheme can
 * never reach an anchor or media element even via a server-supplied preview.
 */
function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Live unfurl privacy from display preferences (https-only + host blocklist). */
function liveUnfurlPrivacy(): UnfurlPrivacyPrefs {
  return unfurlPrivacyFromPrefs(preferences());
}

/**
 * Resource candidates get a stricter boundary than user-activated links:
 * credential-bearing URLs are always rejected, and internal/private hosts are
 * admitted only when they are the app's own origin. Public cross-origin URLs
 * still require explicit consent at the render sink below, and honor the
 * https-only / blocked-host preferences.
 */
function isAutoLoadableHttpUrl(url: string): boolean {
  return isSameOriginHttpUrl(url) || isPreviewableUrl(url, liveUnfurlPrivacy());
}

/** Same-origin resources do not disclose the viewer to a third-party host. */
function isSameOriginHttpUrl(url: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const parsed = new URL(url, window.location.href);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.username === ''
      && parsed.password === ''
      && parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

function resourceHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'external host';
  }
}

function detectMediaKind(url: string): MediaKind {
  try {
    // Only allow https/http
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const path = u.pathname;
    if (IMAGE_EXTS.test(path)) return 'image';
    if (VIDEO_EXTS.test(path)) return 'video';
    if (AUDIO_EXTS.test(path)) return 'audio';
    return null;
  } catch {
    return null;
  }
}

// ── Media unfurl ──────────────────────────────────────────────────────────────

type MediaUnfurlProps = {
  href: string;
  kind: MediaKind;
};

function MediaUnfurl(props: MediaUnfurlProps): JSX.Element {
  const [local] = splitProps(props, ['href', 'kind']);
  const [failed, setFailed] = createSignal(false);
  const [externalAllowed, setExternalAllowed] = createSignal(false);

  // Defense in depth at the sink: only credential-free same-origin or public
  // http(s) may reach the media gate. Public cross-origin resources remain
  // inert until this specific unfurl's consent button is activated.
  // detectMediaKind already enforces the scheme today, but re-checking here
  // protects future callers and prevents ambient loads from URL userinfo.
  const safeHref = createMemo(() => (isAutoLoadableHttpUrl(local.href) ? local.href : null));

  let observedResource = '';
  createEffect(() => {
    const nextResource = `${local.kind ?? ''}\u0000${local.href}`;
    if (nextResource === observedResource) return;
    observedResource = nextResource;
    setFailed(false);
    setExternalAllowed(false);
  });

  const allowedHref = createMemo(() => {
    const href = safeHref();
    return href && (isSameOriginHttpUrl(href) || externalAllowed()) ? href : null;
  });

  return (
    <Show when={local.kind !== null && safeHref()}>
      {(href) => (
        <div class="shell-msg-media">
          <Show
            when={allowedHref()}
            fallback={(
              <button
                type="button"
                class="shell-msg-media-consent"
                aria-label={`Load external ${local.kind ?? 'media'} from ${resourceHost(href())}`}
                onClick={() => setExternalAllowed(true)}
              >
                <span>Load external {local.kind ?? 'media'}</span>
                <small>{resourceHost(href())}</small>
              </button>
            )}
          >
            {(allowed) => (
              <Show
                when={!failed()}
                fallback={(
                  <a
                    href={allowed()}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="shell-msg-link shell-msg-media-fallback"
                  >
                    {local.kind === 'image'
                      ? 'Image preview unavailable — open attachment'
                      : local.kind === 'video'
                        ? 'Video preview unavailable — open attachment'
                        : 'Audio preview unavailable — open attachment'}
                  </a>
                )}
              >
                <Switch>
                  <Match when={local.kind === 'image'}>
                    <a
                      href={allowed()}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="shell-msg-media-link"
                      aria-label="Open image in new tab"
                    >
                      <img
                        src={allowed()}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        class="shell-msg-media-img"
                        onError={() => setFailed(true)}
                      />
                    </a>
                  </Match>
                  <Match when={local.kind === 'video'}>
                    <video
                      {...{ loading: 'lazy' }}
                      src={allowed()}
                      controls
                      preload="none"
                      class="shell-msg-media-video"
                      aria-label="Attached video"
                      onError={() => setFailed(true)}
                    />
                  </Match>
                  <Match when={local.kind === 'audio'}>
                    <audio
                      {...{ loading: 'lazy' }}
                      src={allowed()}
                      controls
                      preload="none"
                      class="shell-msg-media-audio"
                      aria-label="Attached audio"
                      onError={() => setFailed(true)}
                    />
                  </Match>
                </Switch>
              </Show>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}

type BlockKitLiteViewProps = {
  block: BlockKitLiteBlock;
  /** Conversation this block is rendered in; the only target its actions may reach. */
  origin: string;
};

type BlockKitActionSource = HTMLButtonElement | HTMLSelectElement;

type PendingBlockKitAction = {
  action: BlockKitLiteAction;
  origin: string;
  selectedValue: string | undefined;
  prepared: PreparedBlockKitAction;
  source: BlockKitActionSource;
};

type StageBlockKitAction = (
  action: BlockKitLiteAction,
  selectedValue: string | undefined,
  source: BlockKitActionSource,
) => void;

function BlockKitLiteButtonView(props: {
  button: BlockKitLiteButton;
  onAction: StageBlockKitAction;
}): JSX.Element {
  const [local] = splitProps(props, ['button', 'onAction']);
  const [copyStatus, setCopyStatus] = createSignal<'idle' | 'copied' | 'failed'>('idle');
  let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
  let copyEpoch = 0;
  let disposed = false;

  const clearCopyResetTimer = (): void => {
    if (copyResetTimer !== undefined) clearTimeout(copyResetTimer);
    copyResetTimer = undefined;
  };

  createEffect(() => {
    void local.button.label;
    void local.button.value;
    copyEpoch += 1;
    clearCopyResetTimer();
    setCopyStatus('idle');
  });

  onCleanup(() => {
    disposed = true;
    copyEpoch += 1;
    clearCopyResetTimer();
  });

  async function copyValue(): Promise<void> {
    const value = local.button.value;
    const label = local.button.label;
    if (!value) return;
    const epoch = ++copyEpoch;
    const copied = await writeClipboardText(value);
    if (
      disposed
      || epoch !== copyEpoch
      || local.button.value !== value
      || local.button.label !== label
    ) return;
    setCopyStatus(copied ? 'copied' : 'failed');
    clearCopyResetTimer();
    copyResetTimer = setTimeout(() => {
      if (disposed || epoch !== copyEpoch) return;
      copyResetTimer = undefined;
      setCopyStatus('idle');
    }, 1400);
  }

  return (
    <Show
      when={local.button.url}
      fallback={(
        <Show
          when={local.button.action}
          fallback={(
            <>
              <button
                type="button"
                disabled={!local.button.value}
                title={local.button.value ? `Copy ${local.button.value}` : undefined}
                aria-label={local.button.value ? `Copy value for ${local.button.label}` : local.button.label}
                data-copy-state={copyStatus()}
                onClick={() => void copyValue()}
              >
                {copyStatus() === 'copied'
                  ? 'Copied'
                  : copyStatus() === 'failed'
                    ? 'Copy failed'
                    : local.button.label}
              </button>
              <span class="sr-only" role="status" aria-live="polite">
                {copyStatus() === 'copied'
                  ? `${local.button.label} value copied.`
                  : copyStatus() === 'failed'
                    ? `${local.button.label} value could not be copied.`
                    : ''}
              </span>
            </>
          )}
        >
          {(action) => (
            <button
              type="button"
              onClick={(event) => local.onAction(action(), undefined, event.currentTarget)}
            >
              {local.button.label}
            </button>
          )}
        </Show>
      )}
    >
      {(url) => (
        <a href={url()} target="_blank" rel="noopener noreferrer">
          {local.button.label}
        </a>
      )}
    </Show>
  );
}

function BlockKitLiteSelectView(props: {
  select: BlockKitLiteSelect;
  onAction: StageBlockKitAction;
}): JSX.Element {
  const [local] = splitProps(props, ['select', 'onAction']);

  function handleChange(event: Event): void {
    const source = event.currentTarget as HTMLSelectElement;
    const selectedValue = source.value;
    if (!selectedValue || !local.select.action) return;
    source.value = '';
    local.onAction(local.select.action, selectedValue, source);
  }

  return (
    <label>
      <span>{local.select.label}</span>
      <select aria-label={local.select.label} onChange={handleChange}>
        <Show when={local.select.action}>
          <option value="">Choose...</option>
        </Show>
        <For each={local.select.options}>
          {(option) => <option value={option.value}>{option.label}</option>}
        </For>
      </select>
    </label>
  );
}

function BlockKitLiteMessageView(props: {
  block: BlockKitLiteMessageBlock;
  onAction: StageBlockKitAction;
}): JSX.Element {
  const [local] = splitProps(props, ['block', 'onAction']);

  return (
    <>
      <Show when={local.block.title}>
        {(title) => <strong class="shell-msg-blockkit-title">{title()}</strong>}
      </Show>
      <Show when={local.block.text}>
        {(text) => <span class="shell-msg-blockkit-text">{text()}</span>}
      </Show>
      <Show when={local.block.fields.length > 0}>
        <dl class="shell-msg-blockkit-fields">
          <For each={local.block.fields}>
            {(field) => (
              <div>
                <dt>{field.label}</dt>
                <dd>{field.value || 'Not set'}</dd>
              </div>
            )}
          </For>
        </dl>
      </Show>
      <Show when={local.block.selects.length > 0}>
        <div class="shell-msg-blockkit-selects">
          <For each={local.block.selects}>
            {(select) => <BlockKitLiteSelectView select={select} onAction={local.onAction} />}
          </For>
        </div>
      </Show>
      <Show when={local.block.buttons.length > 0}>
        <div class="shell-msg-blockkit-actions">
          <For each={local.block.buttons}>
            {(button) => <BlockKitLiteButtonView button={button} onAction={local.onAction} />}
          </For>
        </div>
        <span class="shell-msg-blockkit-hint" aria-live="polite">
          Safe controls only: links open, values copy, commands do not run.
        </span>
      </Show>
    </>
  );
}

function BlockKitLiteModalTrigger(props: {
  block: BlockKitLiteModalBlock;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: StageBlockKitAction;
  confirmation: PreparedBlockKitAction | null;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const [local] = splitProps(props, [
    'block',
    'open',
    'onOpenChange',
    'onAction',
    'confirmation',
    'onConfirm',
    'onCancel',
  ]);

  return (
    <>
      <button type="button" onClick={() => local.onOpenChange(true)}>
        {local.block.triggerLabel}
      </button>
      <BlockKitModal
        block={local.block}
        open={local.open}
        onOpenChange={local.onOpenChange}
        onAction={local.onAction}
        confirmation={local.confirmation}
        onConfirm={local.onConfirm}
        onCancel={local.onCancel}
      />
    </>
  );
}

function BlockKitLiteView(props: BlockKitLiteViewProps): JSX.Element {
  const [local] = splitProps(props, ['block', 'origin']);
  const [pending, setPending] = createSignal<PendingBlockKitAction | null>(null);
  const [detailsOpen, setDetailsOpen] = createSignal(false);

  function stageAction(
    action: BlockKitLiteAction,
    selectedValue: string | undefined,
    source: BlockKitActionSource,
  ): void {
    // Snapshot every attacker-controlled field used by the later confirmation
    // pass. The preview and confirmation revalidation must describe one request.
    const actionSnapshot: BlockKitLiteAction = action.type === 'send'
      ? { type: 'send', target: action.target, value: action.value }
      : { type: 'select-notify', target: action.target, value: action.value };
    const originSnapshot = local.origin;
    const prepared = prepareBlockKitAction(actionSnapshot, originSnapshot, selectedValue);
    if (!prepared) return;

    setPending({
      action: actionSnapshot,
      origin: originSnapshot,
      selectedValue,
      prepared,
      source,
    });
  }

  function dismissPending(): void {
    const source = pending()?.source;
    setPending(null);
    queueMicrotask(() => source?.focus());
  }

  function confirmPending(): void {
    const request = pending();
    if (!request) return;

    // Re-run all target, CRLF, leading-slash and text bounds at the only dispatch
    // point. A changed result fails closed instead of sending a different message
    // than the plaintext the user reviewed.
    const revalidated = prepareBlockKitAction(
      request.action,
      request.origin,
      request.selectedValue,
    );
    if (
      revalidated
      && revalidated.target === request.prepared.target
      && revalidated.text === request.prepared.text
    ) {
      getState().sendMessage(revalidated.target, revalidated.text);
    }
    dismissPending();
  }

  function changeDetailsOpen(open: boolean): void {
    if (!open && pending()) {
      // Escape/backdrop/close while reviewing cancels the staged send, then
      // returns to the exact originating control still mounted in the details.
      dismissPending();
      return;
    }
    setDetailsOpen(open);
  }

  return (
    <div class="shell-msg-blockkit" role="group" aria-label={local.block.title ?? 'Structured message actions'}>
      <Switch>
        <Match when={local.block.type === 'modal'}>
          <BlockKitLiteModalTrigger
            block={local.block as BlockKitLiteModalBlock}
            open={detailsOpen()}
            onOpenChange={changeDetailsOpen}
            onAction={stageAction}
            confirmation={pending()?.prepared ?? null}
            onConfirm={confirmPending}
            onCancel={dismissPending}
          />
        </Match>
        <Match when={local.block.type === 'message'}>
          <BlockKitLiteMessageView
            block={local.block as BlockKitLiteMessageBlock}
            onAction={stageAction}
          />
          <Show when={pending()}>
            {(request) => (
              <BlockKitActionConfirmationDialog
                open
                prepared={request().prepared}
                onConfirm={confirmPending}
                onCancel={dismissPending}
              />
            )}
          </Show>
        </Match>
      </Switch>
    </div>
  );
}

// ── Spoiler reveal ────────────────────────────────────────────────────────────

type SpoilerProps = {
  children: InlineToken[];
  selfNick: string;
  onChannelClick: ((name: string) => void) | undefined;
};

function Spoiler(props: SpoilerProps): JSX.Element {
  const [local] = splitProps(props, ['children', 'selfNick', 'onChannelClick']);
  const [revealed, setReveal] = createSignal(false);

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setReveal((v) => !v);
    }
  }

  return (
    <span
      class={`shell-msg-spoiler${revealed() ? ' shell-msg-spoiler--revealed' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={revealed() ? 'Hide spoiler' : 'Reveal spoiler'}
      aria-pressed={revealed()}
      onClick={() => setReveal((v) => !v)}
      onKeyDown={handleKeyDown}
    >
      <Show
        when={revealed()}
        fallback={<span class="shell-msg-spoiler-label" aria-hidden="true">spoiler</span>}
      >
        <RenderInlineTokens
          tokens={local.children}
          selfNick={local.selfNick}
          onChannelClick={local.onChannelClick}
        />
      </Show>
    </span>
  );
}

// ── IRC formatting run ─────────────────────────────────────────────────────────

type StyledRunProps = {
  token: StyledToken;
  selfNick: string;
  onChannelClick: ((name: string) => void) | undefined;
};

/**
 * Render a run of IRC/mIRC-formatted text. Colours come from a fixed palette or
 * a validated 6-hex value, so they are safe to place in an inline `color:` /
 * `background-color:` — there is no string interpolation of user text here.
 */
function StyledRun(props: StyledRunProps): JSX.Element {
  const [local] = splitProps(props, ['token', 'selfNick', 'onChannelClick']);

  const css = createMemo<JSX.CSSProperties>(() => {
    const s = local.token.style;
    let fg = s.fg;
    let bg = s.bg;
    // Reverse video swaps fg/bg, falling back to the surface + text defaults.
    if (s.reverse) {
      const swapFg = bg ?? 'var(--ink)';
      const swapBg = fg ?? 'var(--paper)';
      fg = swapFg;
      bg = swapBg;
    }
    const out: Record<string, string> = {};
    if (fg) out['color'] = fg;
    if (bg) {
      out['background-color'] = bg;
      out['border-radius'] = '2px';
      out['padding'] = '0 2px';
      out['box-decoration-break'] = 'clone';
    }
    if (s.bold) out['font-weight'] = '700';
    if (s.italic) out['font-style'] = 'italic';
    if (s.monospace) out['font-family'] = 'var(--font-mono)';
    const deco: string[] = [];
    if (s.underline) deco.push('underline');
    if (s.strike) deco.push('line-through');
    if (deco.length) out['text-decoration-line'] = deco.join(' ');
    return out as JSX.CSSProperties;
  });

  return (
    <span class="shell-msg-irc" style={css()}>
      <RenderInlineTokens
        tokens={local.token.children}
        selfNick={local.selfNick}
        onChannelClick={local.onChannelClick}
      />
    </span>
  );
}

// ── Inline token renderer ─────────────────────────────────────────────────────

type InlineProps = {
  tokens: InlineToken[];
  selfNick: string;
  onChannelClick: ((name: string) => void) | undefined;
};

export function RenderInlineTokens(props: InlineProps): JSX.Element {
  const [local] = splitProps(props, ['tokens', 'selfNick', 'onChannelClick']);
  return (
    <For each={local.tokens}>
      {(token) => (
        <RenderInlineToken
          token={token}
          selfNick={local.selfNick}
          onChannelClick={local.onChannelClick}
        />
      )}
    </For>
  );
}

type SingleInlineProps = {
  token: InlineToken;
  selfNick: string;
  onChannelClick: ((name: string) => void) | undefined;
};

function RenderInlineToken(props: SingleInlineProps): JSX.Element {
  const [local] = splitProps(props, ['token', 'selfNick', 'onChannelClick']);

  return (
    <Switch fallback={null}>
      <Match when={local.token.type === 'text'}>
        {/* Preserve newlines as line breaks */}
        <For each={(local.token as { text: string }).text.split('\n')}>
          {(segment, idx) => (
            <>
              {segment}
              <Show when={idx() < (local.token as { text: string }).text.split('\n').length - 1}>
                <br />
              </Show>
            </>
          )}
        </For>
      </Match>

      <Match when={local.token.type === 'bold'}>
        <strong>
          <RenderInlineTokens
            tokens={(local.token as BoldToken).children}
            selfNick={local.selfNick}
            onChannelClick={local.onChannelClick}
          />
        </strong>
      </Match>

      <Match when={local.token.type === 'italic'}>
        <em>
          <RenderInlineTokens
            tokens={(local.token as ItalicToken).children}
            selfNick={local.selfNick}
            onChannelClick={local.onChannelClick}
          />
        </em>
      </Match>

      <Match when={local.token.type === 'strike'}>
        <s>
          <RenderInlineTokens
            tokens={(local.token as StrikeToken).children}
            selfNick={local.selfNick}
            onChannelClick={local.onChannelClick}
          />
        </s>
      </Match>

      <Match when={local.token.type === 'code'}>
        <code>{(local.token as { text: string }).text}</code>
      </Match>

      <Match when={local.token.type === 'spoiler'}>
        <Spoiler
          children={(local.token as SpoilerToken).children}
          selfNick={local.selfNick}
          onChannelClick={local.onChannelClick}
        />
      </Match>

      <Match when={local.token.type === 'styled'}>
        <StyledRun
          token={local.token as StyledToken}
          selfNick={local.selfNick}
          onChannelClick={local.onChannelClick}
        />
      </Match>

      <Match when={local.token.type === 'link'}>
        {(() => {
          const t = local.token as { href: string; text: string };
          // Defense in depth at the sink: parseMessage only mints a link token on a
          // literal http(s):// prefix, so t.href is provably safe today. Re-check it
          // through the same isHttpUrl gate the media/preview sinks use so a future
          // second token source (a markdown [text](url) branch, a server-supplied
          // token) that lacks that guarantee can never place a javascript:/data:
          // href on the anchor — a bad scheme renders as inert text, no live href.
          return (
            <a
              href={isHttpUrl(t.href) ? t.href : undefined}
              target="_blank"
              rel="noopener noreferrer"
              class="shell-msg-link"
            >
              {t.text}
            </a>
          );
        })()}
      </Match>

      <Match when={local.token.type === 'mention'}>
        {(() => {
          const nick = (local.token as { nick: string }).nick;
          const isSelf = createMemo(() =>
            !!local.selfNick &&
            nick.toLowerCase() === local.selfNick.toLowerCase()
          );
          return (
            <span class={`shell-msg-mention${isSelf() ? ' shell-msg-mention--self' : ''}`}>
              @{nick}
            </span>
          );
        })()}
      </Match>

      <Match when={local.token.type === 'channel'}>
        {(() => {
          const name = (local.token as { name: string }).name;
          return (
            <button
              type="button"
              class="shell-msg-channel-link"
              onClick={() => local.onChannelClick?.(name)}
              aria-label={`Jump to ${name}`}
            >
              {name}
            </button>
          );
        })()}
      </Match>

      <Match when={local.token.type === 'emoji'}>
        {(() => {
          const shortcode = (local.token as { shortcode: string }).shortcode;
          const unicode = lookupEmoji(shortcode);
          return <Show when={unicode !== null} fallback={<span>:{shortcode}:</span>}><span class="shell-msg-emoji" aria-label={shortcode} role="img">
              {unicode}
            </span></Show>;
        })()}
      </Match>
    </Switch>
  );
}

// ── Top-level token renderer ──────────────────────────────────────────────────

type TokenListProps = {
  tokens: Token[];
  selfNick: string;
  onChannelClick: ((name: string) => void) | undefined;
};

function RenderTokenList(props: TokenListProps): JSX.Element {
  const [local] = splitProps(props, ['tokens', 'selfNick', 'onChannelClick']);

  return (
    <For each={local.tokens}>
      {(token) => (
        <Switch fallback={null}>
          <Match when={token.type === 'codeblock'}>
            {(() => {
              const cb = token as CodeBlockToken;
              return (
                <pre class="shell-msg-codeblock">
                  <Show when={cb.lang}>
                    <span class="shell-msg-codeblock-lang" aria-hidden="true">
                      {cb.lang}
                    </span>
                  </Show>
                  <code>{cb.text}</code>
                </pre>
              );
            })()}
          </Match>

          <Match when={token.type === 'blockquote'}>
            <blockquote class="shell-msg-blockquote">
              <RenderInlineTokens
                tokens={(token as BlockquoteToken).children}
                selfNick={local.selfNick}
                onChannelClick={local.onChannelClick}
              />
            </blockquote>
          </Match>

          {/* All inline token types */}
          <Match when={token.type !== 'codeblock' && token.type !== 'blockquote'}>
            <RenderInlineToken
              token={token as InlineToken}
              selfNick={local.selfNick}
              onChannelClick={local.onChannelClick}
            />
          </Match>
        </Switch>
      )}
    </For>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export type MessageTextProps = {
  /** Raw message text to parse and render. */
  text: string;
  /** Our own nick — used to highlight self-mentions. */
  selfNick?: string;
  /** Called when a #channel mention is clicked. */
  onChannelClick?: (name: string) => void;
  /** CSS class for the outer wrapper. */
  class?: string;
  /**
   * The conversation (channel or DM target) this message is rendered in.
   * Block-Kit actions may ONLY speak into this exact target; a block that names
   * any other target is inert. Omitting it fails closed — no action dispatches.
   */
  origin?: string;
};

/**
 * MessageText — parses and renders a single message body as safe JSX.
 *
 * Usage:
 *   <MessageText text={msg.text} selfNick={selfNick()} />
 */
function LinkPreviewCard(props: { url: string; privacy: UnfurlPrivacyPrefs }): JSX.Element {
  const [local] = splitProps(props, ['url', 'privacy']);
  const [preview] = createResource(
    // Re-key when privacy flips (e.g. linkPreviews toggled off) so we never
    // keep serving a cached card after the user disables unfurls.
    () => ({ url: local.url, privacy: local.privacy }),
    ({ url, privacy }) => fetchLinkPreview(url, privacy),
    // A preview is optional decoration for an already-renderable message. Keep
    // its network wait out of the route Suspense boundary so one URL can never
    // blank the transcript, composer, or roster.
    { initialValue: null },
  );
  const [thumbnailFailed, setThumbnailFailed] = createSignal(false);
  const [externalThumbnailAllowed, setExternalThumbnailAllowed] = createSignal(false);

  // Defense in depth at the sink: the card's canonical URL is extracted by the
  // same-origin /linkpreview endpoint from the (untrusted) target page's OG
  // metadata, so a hostile page could set og:url to a javascript: scheme. The
  // same-origin endpoint is the real boundary; here we drop any card whose URL
  // is not credential-free same-origin/public http(s), so a dangerous scheme,
  // URL userinfo, or third-party internal/private host never reaches the anchor.
  const safe = createMemo(() => {
    const p = preview.latest;
    return p && isAutoLoadableHttpUrl(p.url) ? p : null;
  });

  let observedThumbnail = '';
  createEffect(() => {
    const nextThumbnail = safe()?.image ?? '';
    if (nextThumbnail === observedThumbnail) return;
    observedThumbnail = nextThumbnail;
    setThumbnailFailed(false);
    setExternalThumbnailAllowed(false);
  });

  const safeThumbnail = createMemo(() => {
    const image = safe()?.image ?? '';
    return image && isAutoLoadableHttpUrl(image) ? image : null;
  });

  const allowedThumbnail = createMemo(() => {
    const image = safeThumbnail();
    return image && (isSameOriginHttpUrl(image) || externalThumbnailAllowed()) ? image : null;
  });

  return (
    <Show when={safe()}>
      {(p) => (
        <span class="shell-msg-preview">
          <a
            class="shell-msg-preview-link"
            href={p().url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Link preview: ${p().title || p().url}`}
          >
            <span class="shell-msg-preview-body">
              <Show when={p().site}>
                <span class="shell-msg-preview-site">{p().site}</span>
              </Show>
              <Show when={p().title}>
                <span class="shell-msg-preview-title">{p().title}</span>
              </Show>
              <Show when={p().description}>
                <span class="shell-msg-preview-desc">{p().description}</span>
              </Show>
            </span>
          </a>
          <Show when={!thumbnailFailed() && safeThumbnail()}>
            {(thumbnail) => (
              <Show
                when={allowedThumbnail()}
                fallback={(
                  <button
                    type="button"
                    class="shell-msg-preview-consent"
                    aria-label={`Load external preview image from ${resourceHost(thumbnail())}`}
                    onClick={() => setExternalThumbnailAllowed(true)}
                  >
                    Load image
                  </button>
                )}
              >
                {(allowed) => (
                  <img
                    class="shell-msg-preview-thumb"
                    src={allowed()}
                    alt=""
                    width={72}
                    height={72}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={() => setThumbnailFailed(true)}
                  />
                )}
              </Show>
            )}
          </Show>
        </span>
      )}
    </Show>
  );
}

export function MessageText(props: MessageTextProps): JSX.Element {
  const [local] = splitProps(props, ['text', 'selfNick', 'onChannelClick', 'class', 'origin']);

  const blockKit = createMemo(() => extractBlockKitLite(local.text));
  const tokens = createMemo(() => parseMessage(blockKit().text));

  /** First plain web link → OG preview card (preference-gated). */
  const previewUrl = createMemo<string | null>(() => {
    const privacy = liveUnfurlPrivacy();
    if (!privacy.linkPreviews) return null;
    const hrefs: string[] = [];
    for (const t of tokens()) {
      if (t.type === 'link') {
        const href = (t as { href: string }).href;
        if (detectMediaKind(href) === null) hrefs.push(href);
      }
    }
    return pickPreviewUrl(hrefs, privacy);
  });

  /** Collect top-level link tokens that are media URLs for unfurling. */
  const mediaLinks = createMemo<Array<{ href: string; kind: NonNullable<MediaKind> }>>(() => {
    const privacy = liveUnfurlPrivacy();
    if (!privacy.linkPreviews) return [];
    const result: Array<{ href: string; kind: NonNullable<MediaKind> }> = [];
    for (const t of tokens()) {
      if (t.type === 'link') {
        const href = (t as { href: string }).href;
        const kind = detectMediaKind(href);
        if (kind === null) continue;
        // Same-origin media always eligible; cross-origin honors https-only + blocklist.
        if (isSameOriginHttpUrl(href) || mayUnfurlUrl(href, privacy)) {
          result.push({ href, kind });
        }
      }
    }
    return result;
  });

  return (
    <p class={local.class ?? 'shell-msg-text'}>
      <RenderTokenList
        tokens={tokens()}
        selfNick={local.selfNick ?? ''}
        onChannelClick={local.onChannelClick}
      />
      <Show when={mediaLinks().length > 0}>
        <For each={mediaLinks()}>
          {(media) => <MediaUnfurl href={media.href} kind={media.kind} />}
        </For>
      </Show>
      <Show when={previewUrl()}>
        {(url) => <LinkPreviewCard url={url()} privacy={liveUnfurlPrivacy()} />}
      </Show>
      <Show when={blockKit().blocks.length > 0}>
        <For each={blockKit().blocks}>
          {(block) => <BlockKitLiteView block={block} origin={local.origin ?? ''} />}
        </For>
      </Show>
    </p>
  );
}
