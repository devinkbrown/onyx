// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

import { localTranslationReadiness, preferredTranslationTarget } from '@/lib/intelligence/localLanguage';
import {
  createBrowserTranslator,
  languageLabel,
  resolveTranslationTarget,
  translateMessage,
  translationTarget,
} from '@/lib/intelligence/translateMessage';
import { useStore } from '@/lib/store';
import { ProvenanceBadge } from '@/shell/ProvenanceBadge';
import { writeClipboardText } from '@/lib/clipboard/writeClipboardText';

import './voice-overlays.css';

type CaptionLine = {
  nick: string;
  text: string;
  time: Date;
};

/** Per-caption translation state, keyed by a content-stable caption key. */
type CaptionTranslation =
  | { status: 'pending'; lang: string }
  | { status: 'done'; text: string; lang: string }
  | { status: 'error'; lang: string };

const MAX_CONCURRENT_CAPTION_TRANSLATIONS = 3;

/** Content-stable key for a caption line (lines scroll, so index is not stable). */
function captionKey(line: CaptionLine): string {
  return `${line.time.getTime()}|${line.nick}|${line.text}`;
}

function nickColor(nick: string) {
  let hash = 0;
  for (let index = 0; index < nick.length; index += 1) {
    hash = (hash * 31 + nick.charCodeAt(index)) >>> 0;
  }
  const swatches = [
    'var(--gold-bright)',
    'var(--lapis-bright)',
    'var(--ok)',
    'var(--shu)',
    'var(--paper)',
  ];
  return swatches[hash % swatches.length] ?? swatches[0];
}

function transcriptLine(line: CaptionLine): string {
  return `[${line.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}] ${line.nick}: ${line.text}`;
}

export function CaptionsOverlay() {
  const [copyState, setCopyState] = createSignal<'idle' | 'copied' | 'blocked'>('idle');
  const [copying, setCopying] = createSignal(false);
  let copyEpoch = 0;
  let disposed = false;
  const localNick = useStore((state) => state.ourNick);
  const connectionStatus = useStore((state) => state.connectionStatus);
  const lines = useStore((state) => {
    // Captions are opt-in: the VoiceBar toggle drives state.voice.captionsEnabled
    // (default off). Honour it so toggling actually shows/hides the overlay.
    if (!state.voice.captionsEnabled) return [] as CaptionLine[];
    const voiceTarget = state.voice.callChannel;
    const activeTarget = state.activeView.kind === 'channel' ? state.activeView.channel : null;
    const target = voiceTarget ?? activeTarget;
    if (!target || state.voice.callState === 'idle') return [] as CaptionLine[];
    return state.mediaTranscripts.get(target.toLowerCase()) ?? [];
  });

  const visibleLines = createMemo(() => lines().slice(-3));
  const captionSource = createMemo(() => connectionStatus() === 'connected' ? 'Live from this call' : 'Captions unavailable while reconnecting');
  const transcriptText = createMemo(() => lines().map(transcriptLine).join('\n'));
  const copyTranscript = async (): Promise<void> => {
    if (copying()) return;
    const text = transcriptText();
    if (!text) return;
    const epoch = ++copyEpoch;
    setCopying(true);
    setCopyState('idle');
    let copied: boolean;
    try {
      copied = await writeClipboardText(text);
    } catch {
      copied = false;
    }
    if (disposed || epoch !== copyEpoch) return;
    setCopyState(copied ? 'copied' : 'blocked');
    setCopying(false);
  };

  // On-device translation: gated on the browser Translator probe, target from the stored
  // preference (falling back to the browser locale). Output is transient, never persisted.
  const [translations, setTranslations] = createSignal<Map<string, CaptionTranslation>>(new Map());
  const target = createMemo(() => resolveTranslationTarget(translationTarget(), preferredTranslationTarget()));
  const canTranslate = createMemo(() => localTranslationReadiness(target()).state === 'available');
  const translator = createBrowserTranslator();
  const activeTranslations = new Map<string, symbol>();

  // Component runs once; invalidate async completions when their caption leaves the
  // live window, the target changes, or the overlay unmounts. The map is deliberately
  // transient and bounded to the three visible captions.
  let observedTarget: string | undefined;
  createEffect(() => {
    const currentTarget = target();
    const currentKeys = new Set(visibleLines().map(captionKey));
    if (currentKeys.size === 0) {
      copyEpoch += 1;
      setCopying(false);
      setCopyState('idle');
    }
    if (observedTarget === undefined) {
      observedTarget = currentTarget;
    } else if (currentTarget !== observedTarget) {
      observedTarget = currentTarget;
      activeTranslations.clear();
      setTranslations(new Map());
      return;
    }

    for (const key of activeTranslations.keys()) {
      if (!currentKeys.has(key)) activeTranslations.delete(key);
    }
    setTranslations((previous) => {
      if ([...previous.keys()].every((key) => currentKeys.has(key))) return previous;
      return new Map([...previous].filter(([key]) => currentKeys.has(key)));
    });
  });
  onCleanup(() => {
    disposed = true;
    copyEpoch += 1;
    activeTranslations.clear();
  });

  const translateLine = async (line: CaptionLine) => {
    const key = captionKey(line);
    const lang = target();
    if (!canTranslate() || activeTranslations.has(key)) return;
    if (activeTranslations.size >= MAX_CONCURRENT_CAPTION_TRANSLATIONS) return;
    if (!visibleLines().some((visible) => captionKey(visible) === key)) return;

    const request = Symbol(key);
    activeTranslations.set(key, request);
    setTranslations((prev) => new Map(prev).set(key, { status: 'pending', lang }));
    try {
      const result = await translateMessage(translator, { text: line.text }, lang);
      if (
        disposed
        || activeTranslations.get(key) !== request
        || target() !== lang
        || !visibleLines().some((visible) => captionKey(visible) === key)
      ) return;
      activeTranslations.delete(key);
      const text = result.translation?.translated;
      if (text === undefined) throw new Error('The on-device translator returned no result.');
      setTranslations((prev) => new Map(prev).set(key, { status: 'done', text, lang }));
    } catch {
      if (
        disposed
        || activeTranslations.get(key) !== request
        || target() !== lang
        || !visibleLines().some((visible) => captionKey(visible) === key)
      ) return;
      activeTranslations.delete(key);
      setTranslations((prev) => new Map(prev).set(key, { status: 'error', lang }));
    }
  };

  return (
    <Show when={visibleLines().length > 0}>
      <section class="voice-captions" data-testid="captions-overlay" aria-label="Live captions">
        <div class="voice-captions__head">
          <div class="voice-captions__title">
            <span>Live captions</span>
            <span class="voice-captions__source" data-state={connectionStatus()}>
              {captionSource()}
            </span>
          </div>
          <div class="voice-captions__tools">
            <ProvenanceBadge scope="server" subject="Live captions" />
            <button
              class="voice-captions__copy"
              type="button"
              aria-label="Copy live caption transcript"
              disabled={copying()}
              aria-busy={copying()}
              onClick={() => void copyTranscript()}
            >
              {copying() ? 'Copying…' : 'Copy transcript'}
            </button>
            <Show when={copyState() !== 'idle'}>
              <span
                class="voice-captions__copy-state"
                role={copyState() === 'blocked' ? 'alert' : 'status'}
              >
                {copyState() === 'copied' ? 'Copied' : 'Clipboard unavailable'}
              </span>
            </Show>
          </div>
        </div>
        <Show when={!canTranslate()}>
          <p class="voice-captions__copy-state" role="status" aria-live="polite" aria-atomic="true">
            On-device caption translation is unavailable in this browser.
          </p>
        </Show>
        {/* The live region is scoped to the caption lines only — the toolbar above
            (Copy transcript, provenance, copy-state) stays out of the announced feed,
            so its controls are never read as new caption activity (SC 4.1.3). */}
        <div class="voice-captions__log" role="log" aria-live="polite" aria-label="Live captions">
          <For each={visibleLines()}>
          {(line, index) => {
            const opacity = createMemo(() => 0.58 + ((index() + 1) / visibleLines().length) * 0.42);
            const translation = createMemo(() => translations().get(captionKey(line)));
            const doneTranslation = createMemo(() => {
              const state = translation();
              return state?.status === 'done' ? state : undefined;
            });
            return (
              <p
                class="voice-caption-line"
                style={{
                  '--voice-caption-color': nickColor(line.nick),
                  '--voice-caption-opacity': String(opacity()),
                }}
              >
                <span class="voice-caption-speaker">
                  {line.nick}
                  <span class="voice-caption-speaker__source">
                    {line.nick.toLowerCase() === localNick().toLowerCase() ? 'You · local' : 'Remote'}
                  </span>
                </span>
                <span class="voice-caption-text">{line.text}</span>
                <Show when={canTranslate()}>
                  <button
                    class="voice-captions__copy voice-caption-translate"
                    type="button"
                    aria-label={translation()?.status === 'error'
                      ? `Retry translating ${line.nick}'s caption to ${languageLabel(target())}`
                      : `Translate ${line.nick}'s caption to ${languageLabel(target())}`}
                    disabled={translation()?.status === 'pending'}
                    onClick={() => void translateLine(line)}
                  >
                    {translation()?.status === 'pending'
                      ? 'Translating…'
                      : translation()?.status === 'error'
                        ? 'Retry'
                        : 'Translate'}
                  </button>
                </Show>
                <Show when={translation()?.status === 'pending'}>
                  <span class="voice-caption-translation" role="status" aria-live="polite">
                    Translating on this device…
                  </span>
                </Show>
                <Show when={doneTranslation()}>
                  {(done) => (
                    <span class="voice-caption-translation" data-lang={done().lang}>
                      <ProvenanceBadge scope="device" subject="Caption translation" />
                      <span class="voice-caption-text">{done().text}</span>
                    </span>
                  )}
                </Show>
                <Show when={translation()?.status === 'error'}>
                  <span class="voice-caption-translation" role="status" aria-live="polite">
                    On-device translation failed. Use Retry to try again.
                  </span>
                </Show>
              </p>
            );
          }}
          </For>
        </div>
      </section>
    </Show>
  );
}

export default CaptionsOverlay;
