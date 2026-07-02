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
  createMemo,
  createSignal,
  For,
  Show,
  Switch,
  Match,
  splitProps,
  type JSX,
} from 'solid-js';
import { createResource } from 'solid-js';
import { preferences } from '@/lib/prefs/preferences';
import { pickPreviewUrl, fetchLinkPreview } from '@/lib/preview/linkPreview';
import { parseMessage } from '@/lib/format/parseMessage';
import { lookupEmoji } from '@/lib/format/emoji';
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

  return (
    <Show when={local.kind !== null}>
      <div class="shell-msg-media">
        <Switch>
          <Match when={local.kind === 'image'}>
            <a
              href={local.href}
              target="_blank"
              rel="noopener noreferrer"
              class="shell-msg-media-link"
              aria-label="Open image in new tab"
            >
              <img
                src={local.href}
                alt=""
                loading="lazy"
                decoding="async"
                class="shell-msg-media-img"
              />
            </a>
          </Match>
          <Match when={local.kind === 'video'}>
            <video
              src={local.href}
              controls
              preload="metadata"
              class="shell-msg-media-video"
              aria-label="Attached video"
            />
          </Match>
          <Match when={local.kind === 'audio'}>
            <audio
              src={local.href}
              controls
              preload="metadata"
              class="shell-msg-media-audio"
              aria-label="Attached audio"
            />
          </Match>
        </Switch>
      </div>
    </Show>
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
      const swapBg = fg ?? 'var(--washi)';
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

function RenderInlineTokens(props: InlineProps): JSX.Element {
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
          return (
            <a
              href={t.href}
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
          return unicode !== null ? (
            <span class="shell-msg-emoji" aria-label={shortcode} role="img">
              {unicode}
            </span>
          ) : (
            <span>:{shortcode}:</span>
          );
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
};

/**
 * MessageText — parses and renders a single message body as safe JSX.
 *
 * Usage:
 *   <MessageText text={msg.text} selfNick={selfNick()} />
 */
function LinkPreviewCard(props: { url: string }): JSX.Element {
  const [local] = splitProps(props, ['url']);
  const [preview] = createResource(() => local.url, fetchLinkPreview);

  return (
    <Show when={preview()}>
      {(p) => (
        <a
          class="shell-msg-preview"
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
          <Show when={p().image}>
            <img
              class="shell-msg-preview-thumb"
              src={p().image}
              alt=""
              loading="lazy"
              decoding="async"
            />
          </Show>
        </a>
      )}
    </Show>
  );
}

export function MessageText(props: MessageTextProps): JSX.Element {
  const [local] = splitProps(props, ['text', 'selfNick', 'onChannelClick', 'class']);

  const tokens = createMemo(() => parseMessage(local.text));

  /** First plain web link → OG preview card (preference-gated). */
  const previewUrl = createMemo<string | null>(() => {
    if (!preferences().linkPreviews) return null;
    const hrefs: string[] = [];
    for (const t of tokens()) {
      if (t.type === 'link') {
        const href = (t as { href: string }).href;
        if (detectMediaKind(href) === null) hrefs.push(href);
      }
    }
    return pickPreviewUrl(hrefs);
  });

  /** Collect top-level link tokens that are media URLs for unfurling. */
  const mediaLinks = createMemo<Array<{ href: string; kind: NonNullable<MediaKind> }>>(() => {
    const result: Array<{ href: string; kind: NonNullable<MediaKind> }> = [];
    for (const t of tokens()) {
      if (t.type === 'link') {
        const href = (t as { href: string }).href;
        const kind = detectMediaKind(href);
        if (kind !== null) {
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
        {(url) => <LinkPreviewCard url={url()} />}
      </Show>
    </p>
  );
}
