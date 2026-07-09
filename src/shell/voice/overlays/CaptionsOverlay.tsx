import { createMemo, createSignal, For, Show } from 'solid-js';

import { useStore } from '@/lib/store';
import { ProvenanceBadge } from '@/shell/ProvenanceBadge';

import './voice-overlays.css';

type CaptionLine = {
  nick: string;
  text: string;
  time: Date;
};

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
              </p>
            );
          }}
        </For>
      </section>
    </Show>
  );
}

export default CaptionsOverlay;
