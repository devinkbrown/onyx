import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

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
    'var(--washi)',
  ];
  return swatches[hash % swatches.length] ?? swatches[0];
}

function transcriptLine(line: CaptionLine): string {
  return `[${line.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}] ${line.nick}: ${line.text}`;
}

export function CaptionsOverlay() {
  const [copyState, setCopyState] = createSignal<'idle' | 'copied' | 'blocked'>('idle');
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
  const transcriptText = createMemo(() => lines().map(transcriptLine).join('\n'));
  const copyTranscript = async () => {
    const text = transcriptText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('blocked');
    }
  };

  // On-device translation: gated on the browser Translator probe, target from the stored
  // preference (falling back to the browser locale). Output is transient, never persisted.
  const [translations, setTranslations] = createSignal<Map<string, CaptionTranslation>>(new Map());
  const target = createMemo(() => resolveTranslationTarget(translationTarget(), preferredTranslationTarget()));
  const canTranslate = createMemo(() => localTranslationReadiness(target()).state === 'available');
  const translator = createBrowserTranslator();

  // Component runs once; guard async completions that land after unmount.
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const translateLine = async (line: CaptionLine) => {
    const key = captionKey(line);
    const lang = target();
    setTranslations((prev) => new Map(prev).set(key, { status: 'pending', lang }));
    try {
      const result = await translateMessage(translator, { text: line.text }, lang);
      if (disposed) return;
      const text = result.translation?.translated ?? line.text;
      setTranslations((prev) => new Map(prev).set(key, { status: 'done', text, lang }));
    } catch {
      if (disposed) return;
      setTranslations((prev) => new Map(prev).set(key, { status: 'error', lang }));
    }
  };

  return (
    <Show when={visibleLines().length > 0}>
      <section
        class="voice-captions"
        role="log"
        aria-live="polite"
        aria-label="Live captions"
        data-testid="captions-overlay"
      >
        <div class="voice-captions__head">
          <span>Live captions</span>
          <div class="voice-captions__tools">
            <ProvenanceBadge scope="server" subject="Live captions" />
            <button
              class="voice-captions__copy"
              type="button"
              aria-label="Copy live caption transcript"
              onClick={() => void copyTranscript()}
            >
              Copy transcript
            </button>
            <Show when={copyState() !== 'idle'}>
              <span class="voice-captions__copy-state" aria-live="polite">
                {copyState() === 'copied' ? 'Copied' : 'Clipboard unavailable'}
              </span>
            </Show>
          </div>
        </div>
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
                <span class="voice-caption-speaker">{line.nick}</span>
                <span class="voice-caption-text">{line.text}</span>
                <Show when={canTranslate()}>
                  <button
                    class="voice-captions__copy voice-caption-translate"
                    type="button"
                    aria-label={`Translate ${line.nick}'s caption to ${languageLabel(target())}`}
                    disabled={translation()?.status === 'pending'}
                    onClick={() => void translateLine(line)}
                  >
                    {translation()?.status === 'pending' ? 'Translating…' : 'Translate'}
                  </button>
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
                  <span class="voice-caption-translation" role="status">
                    On-device translation unavailable.
                  </span>
                </Show>
              </p>
            );
          }}
        </For>
      </section>
    </Show>
  );
}

export default CaptionsOverlay;
