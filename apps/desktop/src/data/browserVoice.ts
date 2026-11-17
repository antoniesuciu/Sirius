/**
 * Phone push-to-talk (ADR 0010, F38): the phone records, the laptop transcribes and acts, and
 * the phone says the answer. The laptop never uses this, because its voice service owns the
 * microphone there.
 */
import { ApiError, isUnreachable, type SiriusClient, type SiriusEvent } from '@sirius/contracts';
import { useCallback, useMemo, useRef, useState } from 'react';
import { createSpeaker } from './speech.ts';

const MAX_RECORDING_MS = 20_000; // F28
/** Recording ends this long after the voice stops, once there was a voice at all. */
const QUIET_AFTER_MS = 1500;
/** On readLevel's 0–1 scale: a voice is well above this, a quiet room well below QUIET. */
const SPEECH_LEVEL = 0.12;
const QUIET_LEVEL = 0.06;

/**
 * Says when to stop: after speech, a stretch of quiet. Silence before anyone speaks never
 * stops it, so a slow start is not cut off; the 20 s cap still applies.
 */
export function quietAfterSpeech(quietMs = QUIET_AFTER_MS) {
  let spoke = false;
  let quietSince: number | null = null;
  return (level: number, now: number): boolean => {
    if (level >= SPEECH_LEVEL) {
      spoke = true;
      quietSince = null;
    } else if (spoke && level < QUIET_LEVEL) {
      quietSince ??= now;
      return now - quietSince >= quietMs;
    } else quietSince = null;
    return false;
  };
}

/** Browsers refuse the microphone outside a secure context, and Tauri has the voice service. */
export function browserVoiceSupported(): boolean {
  return (
    window.isSecureContext &&
    !('__TAURI_INTERNALS__' in window) &&
    typeof MediaRecorder !== 'undefined' &&
    navigator.mediaDevices !== undefined
  );
}

/** A command the core did at once. It is not part of the chat thread, so the phone shows it. */
export interface HeardCommand {
  transcript: string;
  reply: string | null;
  intent: string | null;
}

interface Handlers {
  onHeard(command: HeardCommand): void;
  onError(text: string): void;
}

function failure(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (isUnreachable(error)) return "That didn't reach the laptop. Try again when it's back.";
  return 'That recording could not be used.';
}

/**
 * Push-to-talk on the phone. `turnId` is the agent turn this phone started by voice, whose
 * reply it should say; while speaking it is null once that reply's last part arrived (or for
 * a command's own reply).
 */
export type PhoneVoice =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'recording'; recorder: MediaRecorder }
  | { kind: 'sending' }
  | { kind: 'awaitingReply'; turnId: string }
  | { kind: 'speaking'; turnId: string | null };

export type PhoneVoiceInput =
  | { type: 'open' }
  | { type: 'opened'; recorder: MediaRecorder }
  | { type: 'openFailed' }
  | { type: 'stopped' }
  | { type: 'sent'; turnId: string | null }
  | { type: 'reply'; turnId: string; final: boolean }
  /** From the speaker: it started, or went quiet. */
  | { type: 'voiceOn' }
  | { type: 'quiet' }
  | { type: 'hush' };

/** What a tap does now. While the mic is opening or the recording uploads, nothing. */
export function tapAction(voice: PhoneVoice): 'open' | 'stop' | 'hush' | null {
  if (voice.kind === 'recording') return 'stop';
  if (voice.kind === 'speaking') return 'hush';
  if (voice.kind === 'idle' || voice.kind === 'awaitingReply') return 'open';
  return null;
}

/** Only the reply to this phone's own voice turn is spoken. */
export function awaits(voice: PhoneVoice, turnId: string): boolean {
  return (voice.kind === 'awaitingReply' || voice.kind === 'speaking') && voice.turnId === turnId;
}

export function phoneVoiceStep(voice: PhoneVoice, input: PhoneVoiceInput): PhoneVoice {
  switch (input.type) {
    case 'open':
      // A new recording drops any reply still awaited, so it is never said over the mic.
      return tapAction(voice) === 'open' ? { kind: 'opening' } : voice;
    case 'opened':
      return voice.kind === 'opening' ? { kind: 'recording', recorder: input.recorder } : voice;
    case 'openFailed':
      return voice.kind === 'opening' ? { kind: 'idle' } : voice;
    case 'stopped':
      return voice.kind === 'recording' ? { kind: 'sending' } : voice;
    case 'sent':
      if (voice.kind !== 'sending') return voice;
      return input.turnId ? { kind: 'awaitingReply', turnId: input.turnId } : { kind: 'idle' };
    case 'reply':
      if (!awaits(voice, input.turnId) || !input.final) return voice;
      return voice.kind === 'speaking' ? { kind: 'speaking', turnId: null } : { kind: 'idle' };
    case 'voiceOn':
      if (voice.kind === 'awaitingReply') return { kind: 'speaking', turnId: voice.turnId };
      return voice.kind === 'idle' ? { kind: 'speaking', turnId: null } : voice;
    case 'quiet':
      // Between two sentences of a streamed reply the speaker can run dry; keep listening.
      if (voice.kind !== 'speaking') return voice;
      return voice.turnId ? { kind: 'awaitingReply', turnId: voice.turnId } : { kind: 'idle' };
    case 'hush':
      return voice.kind === 'speaking' || voice.kind === 'awaitingReply' ? { kind: 'idle' } : voice;
  }
}

/**
 * The microphone and a recorder already running on it. Any failure after the permission was
 * granted stops the tracks, or the browser keeps showing the mic as in use.
 */
export async function openRecorder(): Promise<{ stream: MediaStream; media: MediaRecorder }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    const media = new MediaRecorder(stream);
    media.start();
    return { stream, media };
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    throw error;
  }
}

export function usePhoneVoice(client: SiriusClient, handlers: Handlers) {
  const [voice, setVoice] = useState<PhoneVoice>({ kind: 'idle' });
  const state = useRef<PhoneVoice>(voice);
  const dispatch = useCallback((input: PhoneVoiceInput) => {
    const next = phoneVoiceStep(state.current, input);
    if (next !== state.current) {
      state.current = next;
      setVoice(next);
    }
  }, []);
  const speaker = useMemo(
    () => createSpeaker((on) => dispatch({ type: on ? 'voiceOn' : 'quiet' })),
    [dispatch],
  );
  /** A fast failure can be said before the upload's answer names its turn. */
  const early = useRef<Extract<SiriusEvent, { type: 'voice_reply' }>[]>([]);
  const latest = useRef(handlers);
  latest.current = handlers;
  /** Reads the microphone's loudness for the voice wave while recording. */
  const meter = useRef<{
    analyser: AnalyserNode;
    samples: Float32Array<ArrayBuffer>;
    close(): void;
  } | null>(null);
  const readLevel = useCallback(() => {
    const m = meter.current;
    if (!m) return 0;
    m.analyser.getFloatTimeDomainData(m.samples);
    let sum = 0;
    for (const sample of m.samples) sum += sample * sample;
    // Speech RMS sits around 0.02–0.2; scaled so a normal voice fills most of the swing.
    return Math.min(1, Math.sqrt(sum / m.samples.length) * 6);
  }, []);

  const sayReply = (event: Extract<SiriusEvent, { type: 'voice_reply' }>) => {
    if (!awaits(state.current, event.turn_id)) return;
    speaker.stream(event.text, event.lang, event.final);
    dispatch({ type: 'reply', turnId: event.turn_id, final: event.final });
  };

  const send = async (audio: Blob) => {
    early.current = [];
    let turnId: string | null = null;
    let said: { text: string; lang: string } | null = null;
    try {
      const result = await client.speak(audio);
      if (!result.transcript) {
        latest.current.onError("I didn't hear anything.");
      } else if (result.route === 'agent' && result.turn_id) {
        // The question and the answer arrive through the chat as usual.
        turnId = result.turn_id;
      } else {
        latest.current.onHeard({
          transcript: result.transcript,
          reply: result.reply,
          intent: result.intent ?? null,
        });
        if (result.reply) said = { text: result.reply, lang: result.lang };
      }
    } catch (error) {
      latest.current.onError(failure(error));
    } finally {
      // Out of `sending` first, so the speaker starting moves the state to `speaking`.
      dispatch({ type: 'sent', turnId });
      for (const event of early.current) sayReply(event);
      early.current = [];
    }
    if (said) speaker.say(said.text, said.lang);
  };

  const start = async () => {
    const { stream, media } = await openRecorder();
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      meter.current = {
        analyser,
        samples: new Float32Array(analyser.fftSize),
        close: () => void context.close(),
      };
    } catch {
      // The wave then just breathes; recording does not depend on it.
    }
    const chunks: Blob[] = [];
    media.ondataavailable = (event) => chunks.push(event.data);
    media.onstop = () => {
      meter.current?.close();
      meter.current = null;
      for (const track of stream.getTracks()) track.stop();
      dispatch({ type: 'stopped' });
      void send(new Blob(chunks, { type: media.mimeType }));
    };
    dispatch({ type: 'opened', recorder: media });
    setTimeout(() => {
      if (media.state === 'recording') media.stop();
    }, MAX_RECORDING_MS);
    // Without a meter there is nothing to hear the quiet with, so it waits for a tap.
    if (meter.current) {
      const done = quietAfterSpeech();
      const watch = setInterval(() => {
        if (media.state !== 'recording') clearInterval(watch);
        else if (done(readLevel(), performance.now())) {
          clearInterval(watch);
          media.stop();
        }
      }, 100);
    }
  };

  const stopSpeaking = () => {
    dispatch({ type: 'hush' });
    speaker.stop();
  };

  return {
    recording: voice.kind === 'recording',
    sending: voice.kind === 'sending',
    speaking: voice.kind === 'speaking',
    readLevel,
    /** Tap: start, or stop recording, or cut the answer short. Never two at once. */
    toggle() {
      const now = state.current;
      const action = tapAction(now);
      if (action === 'stop' && now.kind === 'recording') now.recorder.stop();
      else if (action === 'hush') stopSpeaking();
      else if (action === 'open') {
        // Whatever is left of an earlier reply is dropped with it.
        speaker.stop();
        dispatch({ type: 'open' });
        start().catch(() => {
          dispatch({ type: 'openFailed' });
          latest.current.onError('I could not reach the microphone.');
        });
      }
    },
    stopSpeaking,
    /** Feed every live event; only the reply to this phone's own voice turn is spoken. */
    onEvent(event: SiriusEvent) {
      if (event.type !== 'voice_reply') return;
      if (state.current.kind === 'sending') early.current.push(event);
      else sayReply(event);
    },
  };
}
