// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ConversationId, MediaCallRef, OwnerSnapshot, RequestContext, SendAdmission } from './contracts';

/* Web Speech API draft surface; feature-detected instead of assumed available. */
interface SpeechAlternativeLike { readonly transcript?: string }
interface SpeechResultLike { readonly isFinal: boolean; readonly length: number; readonly 0?: SpeechAlternativeLike }
interface SpeechEventLike { readonly resultIndex: number; readonly results: ArrayLike<SpeechResultLike> }
interface RecognitionLike {
  continuous: boolean; interimResults: boolean; lang: string; processLocally?: boolean;
  onresult: ((event: SpeechEventLike) => void) | null; onerror: ((event: { readonly error?: string }) => void) | null;
  onend: (() => void) | null;
  start(audioTrack?: MediaStreamTrack): void; stop(): void; abort(): void;
}
interface SpeechRecognitionConstructor {
  new(): RecognitionLike;
  available?: (options: { readonly langs: string[]; readonly processLocally: boolean }) => Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
  install?: (options: { readonly langs: string[] }) => Promise<boolean>;
}
interface CaptionWindow extends Window { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }

export type CaptionMode = 'local' | 'browser-service';
export type CaptionReason = 'api-unavailable' | 'language-unavailable' | 'language-not-prepared' | 'explicit-consent-required' | 'call-not-active' | 'membership-unknown' | 'consent-revoked' | 'owner-changed' | 'permission-denied' | 'recognition-failed' | 'send-blocked' | null;
export interface CaptionContext extends RequestContext { readonly conversationId: ConversationId; readonly callRef: MediaCallRef }
export interface CaptionObservation {
  readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly callRef: MediaCallRef;
  readonly state: 'idle' | 'preparing' | 'listening' | 'unavailable' | 'failed' | 'stopped';
  readonly reason: CaptionReason; readonly mode: CaptionMode | null; readonly language: string | null;
  readonly source: 'local-participant-microphone' | 'browser-service' | null; readonly accuracy: 'unknown' | null;
  readonly interimText: string | null;
  readonly serverVisible: true;
}
export interface CaptionConsent { readonly activeMember: boolean; readonly localConsent: boolean; readonly policyRevision: string | null }
export interface CaptionRetirementSignal { readonly owner: OwnerSnapshot; readonly conversationId: ConversationId; readonly callRef: MediaCallRef; readonly reason: 'owner-retired' | 'call-ended' | 'membership-lost' | 'consent-revoked' }

/** Source: Web Speech API draft, `processLocally`, `available()` and `install()`.
 * Local language preparation is an explicit user action; this service never
 * downloads a pack automatically and never silently changes recognition mode.
 * https://webaudio.github.io/web-speech-api/
 */
export function createCaptionProducer(deps: {
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  /** Must return a caption-owned clone; stopping it must never stop call audio. */
  readonly getOwnedLocalAudioTrack: (context: CaptionContext) => Promise<MediaStreamTrack | null>;
  readonly captionConsent: (context: CaptionContext) => Promise<CaptionConsent>;
  readonly onRetirement: (listener: (signal: CaptionRetirementSignal) => void) => { dispose(): void };
  readonly sendCaption: (input: { readonly owner: OwnerSnapshot; readonly conversationId: string; readonly callRef: string; readonly text: string; readonly policyRevision: string }) => SendAdmission;
  readonly onObservation: (value: CaptionObservation) => void;
  readonly isCallCurrent?: (context: CaptionContext) => boolean;
  readonly speechApi?: SpeechRecognitionConstructor | null;
}): {
  prepareLocalLanguage(input: { readonly context: CaptionContext; readonly language: string; readonly explicitUserAction: true }): Promise<{ readonly state: 'available' | 'installed' | 'unavailable' | 'failed'; readonly reason: CaptionReason }>;
  start(input: { readonly context: CaptionContext; readonly language: string; readonly mode: CaptionMode; readonly browserServiceConsent: boolean }): Promise<CaptionObservation>;
  stop(context: CaptionContext): void;
  snapshot(): CaptionObservation | null;
  dispose(): void;
} {
  const api = deps.speechApi ?? (typeof window !== 'undefined' ? ((window as CaptionWindow).SpeechRecognition ?? (window as CaptionWindow).webkitSpeechRecognition ?? null) : null);
  const prepared = new Set<string>();
  let recognition: RecognitionLike | null = null;
  let track: MediaStreamTrack | null = null;
  let activeContext: CaptionContext | null = null;
  let generation = 0;
  let languageGeneration = 0;
  let disposed = false;
  let lastObservation: CaptionObservation | null = null;
  const sameOwner = (left: OwnerSnapshot, right: OwnerSnapshot) => left.ownerRef === right.ownerRef && left.networkId === right.networkId
    && left.accountId === right.accountId && left.accountGeneration === right.accountGeneration
    && left.connectionGeneration === right.connectionGeneration && left.physicalRef === right.physicalRef;
  const emit = (value: CaptionObservation) => { lastObservation = value; try { deps.onObservation(value); } catch { /* observers are isolated */ } };
  const current = (context: CaptionContext, ownGeneration: number) => !disposed && generation === ownGeneration
    && activeContext?.requestId === context.requestId && activeContext.callRef === context.callRef
    && activeContext.conversationId === context.conversationId && sameOwner(activeContext.owner, context.owner)
    && deps.isCurrent(context.owner) && sameOwner(deps.ownerSnapshot(), context.owner)
    && (deps.isCallCurrent?.(context) ?? true);
  const base = (context: CaptionContext, state: CaptionObservation['state'], reason: CaptionReason, mode: CaptionMode | null, language: string | null, interimText: string | null = null): CaptionObservation => ({
    owner: context.owner, conversationId: context.conversationId, callRef: context.callRef, state, reason, mode, language,
    source: state === 'listening' ? mode === 'local' ? 'local-participant-microphone' : mode === 'browser-service' ? 'browser-service' : null : null,
    accuracy: state === 'listening' ? 'unknown' : null, interimText, serverVisible: true,
  });
  const report = (value: CaptionObservation) => { emit(value); return value; };
  const cleanup = () => {
    generation++;
    const old = recognition; recognition = null;
    if (old) { old.onresult = null; old.onerror = null; old.onend = null; try { old.abort(); } catch { /* already stopped */ } }
    const oldTrack = track; track = null; try { oldTrack?.stop(); } catch { /* best effort */ }
    activeContext = null;
  };
  const retirementSubscription = deps.onRetirement(signal => {
    const active = activeContext;
    if (!active || !sameOwner(signal.owner, active.owner) || signal.callRef !== active.callRef || signal.conversationId !== active.conversationId) return;
    cleanup();
    emit(base(active, 'stopped', signal.reason === 'consent-revoked' ? 'consent-revoked' : signal.reason === 'owner-retired' ? 'owner-changed' : 'call-not-active', null, null));
  });
  const prepareLocalLanguage = async (input: { readonly context: CaptionContext; readonly language: string; readonly explicitUserAction: true }) => {
    if (!api?.available || !api.install) return { state: 'unavailable' as const, reason: 'api-unavailable' as const };
    if (!deps.isCurrent(input.context.owner) || !sameOwner(deps.ownerSnapshot(), input.context.owner)
      || (deps.isCallCurrent && !deps.isCallCurrent(input.context))) return { state: 'failed' as const, reason: 'owner-changed' as const };
    if (!/^[A-Za-z0-9-]{2,64}$/u.test(input.language)) return { state: 'failed' as const, reason: 'language-unavailable' as const };
    const operation = ++languageGeneration;
    const isCurrentLanguageRequest = () => !disposed && operation === languageGeneration
      && deps.isCurrent(input.context.owner) && sameOwner(deps.ownerSnapshot(), input.context.owner)
      && (!deps.isCallCurrent || deps.isCallCurrent(input.context));
    try {
      if (prepared.has(input.language)) {
        const availability = await api.available({ langs: [input.language], processLocally: true });
        if (!isCurrentLanguageRequest()) return { state: 'failed' as const, reason: 'owner-changed' as const };
        if (availability === 'available') return { state: 'available' as const, reason: null } as const;
        prepared.delete(input.language);
      }
      // Invoke install before the first await so a direct trusted user gesture
      // reaches the browser API without losing transient activation.
      const installPromise = api.install({ langs: [input.language] });
      const installed = await installPromise;
      if (!isCurrentLanguageRequest()) return { state: 'failed' as const, reason: 'owner-changed' as const };
      if (!installed) return { state: 'failed' as const, reason: 'language-unavailable' as const };
      const finalAvailability = await api.available({ langs: [input.language], processLocally: true });
      if (!isCurrentLanguageRequest()) return { state: 'failed' as const, reason: 'owner-changed' as const };
      if (finalAvailability !== 'available') return { state: 'failed' as const, reason: 'language-unavailable' as const };
      prepared.add(input.language);
      return { state: 'installed' as const, reason: null };
    } catch { return { state: 'failed' as const, reason: isCurrentLanguageRequest() ? 'language-unavailable' as const : 'owner-changed' as const }; }
  };
  const start = async (input: { readonly context: CaptionContext; readonly language: string; readonly mode: CaptionMode; readonly browserServiceConsent: boolean }): Promise<CaptionObservation> => {
    const { context, language, mode } = input;
    if (disposed || !api || !deps.isCurrent(context.owner) || !sameOwner(deps.ownerSnapshot(), context.owner)
      || (deps.isCallCurrent && !deps.isCallCurrent(context))) return base(context, 'unavailable', 'owner-changed', mode, language);
    if (mode === 'local' && !prepared.has(language)) return report(base(context, 'unavailable', 'language-not-prepared', mode, language));
    if (mode === 'browser-service' && input.browserServiceConsent !== true) return report(base(context, 'unavailable', 'explicit-consent-required', mode, language));
    cleanup();
    const ownGeneration = ++generation;
    activeContext = context;
    emit(base(context, 'preparing', null, mode, language));
    let localTrack: MediaStreamTrack | null = null;
    let resultQueue: Promise<void> = Promise.resolve();
    let queuedResultEvents = 0;
    let lastFinalIndex = -1;
    try {
      const consent = await deps.captionConsent(context);
      if (!current(context, ownGeneration)) return base(context, 'stopped', 'owner-changed', mode, language);
      if (!consent.activeMember) { if (current(context, ownGeneration)) cleanup(); return report(base(context, 'unavailable', 'call-not-active', mode, language)); }
      if (!consent.localConsent || !consent.policyRevision) { if (current(context, ownGeneration)) cleanup(); return report(base(context, 'unavailable', 'consent-revoked', mode, language)); }
      const policyRevision = consent.policyRevision;
      localTrack = await deps.getOwnedLocalAudioTrack(context);
      if (!current(context, ownGeneration)) { localTrack?.stop(); return base(context, 'stopped', 'owner-changed', mode, language); }
      if (!localTrack || localTrack.kind !== 'audio' || localTrack.readyState !== 'live') {
        try { localTrack?.stop(); } catch { /* owned clone cleanup */ }
        localTrack = null;
        if (current(context, ownGeneration)) cleanup();
        return report(base(context, 'unavailable', 'permission-denied', mode, language));
      }
      const instance = new api();
      const ownedTrack = localTrack;
      recognition = instance; track = ownedTrack; localTrack = null;
      ownedTrack.addEventListener('ended', () => {
        if (!current(context, ownGeneration)) return;
        cleanup(); emit(base(context, 'stopped', 'permission-denied', mode, language));
      }, { once: true });
      instance.lang = language; instance.continuous = true; instance.interimResults = true;
      if (mode === 'local') {
        if (!('processLocally' in instance)) throw new Error('local-processing-unavailable');
        instance.processLocally = true;
      } else if ('processLocally' in instance) instance.processLocally = false;
      instance.onresult = event => {
        if (!current(context, ownGeneration)) return;
        if (queuedResultEvents >= 8) { cleanup(); emit(base(context, 'failed', 'recognition-failed', mode, language)); return; }
        const eventResults: Array<{ index: number; isFinal: boolean; text: string }> = [];
        const endIndex = Math.min(event.results.length, event.resultIndex + 32);
        for (let index = event.resultIndex; index < endIndex; index++) {
          const result = event.results[index];
          const raw = result?.[0]?.transcript;
          if (typeof raw !== 'string') continue;
          const text = raw.replace(/[\u0000\r\n]/gu, ' ').trim();
          if (text && new TextEncoder().encode(text).byteLength <= 1000) eventResults.push({ index, isFinal: result?.isFinal === true, text });
        }
        queuedResultEvents++;
        resultQueue = resultQueue.then(async () => {
          queuedResultEvents--;
          if (!current(context, ownGeneration)) return;
          const latest = await deps.captionConsent(context);
          if (!current(context, ownGeneration)) return;
          if (!latest.activeMember || !latest.localConsent || latest.policyRevision !== consent.policyRevision) { cleanup(); emit(base(context, 'stopped', 'consent-revoked', mode, language)); return; }
          let interimText: string | null = null;
          for (const entry of eventResults) {
            if (!current(context, ownGeneration)) return;
            if (entry.isFinal) {
              if (entry.index <= lastFinalIndex) continue;
              lastFinalIndex = entry.index;
              const admitted = deps.sendCaption({ owner: context.owner, conversationId: context.conversationId, callRef: context.callRef, text: entry.text, policyRevision });
              if (admitted.kind !== 'transport-admitted') { cleanup(); emit(base(context, 'failed', 'send-blocked', mode, language)); return; }
            } else interimText = entry.text;
          }
          if (current(context, ownGeneration)) emit(base(context, 'listening', null, mode, language, interimText));
        }).catch(() => { if (current(context, ownGeneration)) { cleanup(); emit(base(context, 'failed', 'consent-revoked', mode, language)); } });
      };
      instance.onerror = event => { if (current(context, ownGeneration)) { cleanup(); emit(base(context, 'failed', event.error === 'not-allowed' ? 'permission-denied' : 'recognition-failed', mode, language)); } };
      instance.onend = () => { if (current(context, ownGeneration)) { cleanup(); emit(base(context, 'stopped', null, mode, language)); } };
      if (mode === 'local' && instance.processLocally !== true) throw new Error('local-processing-not-confirmed');
      instance.start(ownedTrack);
      const observation = base(context, 'listening', null, mode, language);
      emit(observation); return observation;
    } catch (error) {
      localTrack?.stop();
      const ownedFailure = current(context, ownGeneration);
      if (ownedFailure) cleanup();
      if (!ownedFailure) return base(context, 'stopped', 'owner-changed', mode, language);
      const reason: CaptionReason = error instanceof Error && (error.message === 'local-processing-not-confirmed' || error.message === 'local-processing-unavailable') ? 'api-unavailable' : 'recognition-failed';
      const observation = base(context, 'failed', reason, mode, language); emit(observation); return observation;
    }
  };
  return {
    prepareLocalLanguage,
    start,
    stop(context) { const active = activeContext; if (active && active.callRef === context.callRef && active.conversationId === context.conversationId && sameOwner(active.owner, context.owner)) { const last = lastObservation; cleanup(); emit(base(active, 'stopped', null, last?.mode ?? null, last?.language ?? null)); } },
    snapshot() { return lastObservation; },
    dispose() { if (disposed) return; disposed = true; languageGeneration++; retirementSubscription.dispose(); cleanup(); prepared.clear(); },
  };
}
