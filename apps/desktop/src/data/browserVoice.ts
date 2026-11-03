/**
 * Phone push-to-talk (ADR 0010, F38): the phone records, the laptop transcribes and acts, and
 * the phone says the answer. The laptop never uses this, because its voice service owns the
 * microphone there.
 */
import { ApiError, isUnreachable, type SiriusClient, type SiriusEvent } from '@sirius/contracts';
import { useCallback, useMemo, useRef, useState } from 'react';
import { createSpeaker } from './speech.ts';

const MAX_RECORDING_MS = 20_000; // F28

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

export function usePhoneVoice(client: SiriusClient, handlers: Handlers) {
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const speaker = useMemo(() => createSpeaker(setSpeaking), []);
  const recorder = useRef<MediaRecorder | null>(null);
  /** The agent turn this phone started by voice, whose reply it should say. */
  const agentTurn = useRef<string | null>(null);
  /** A fast failure can be said before the upload's answer names its turn. */
  const early = useRef<Extract<SiriusEvent, { type: 'voice_reply' }>[]>([]);
  const sendingNow = useRef(false);
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
    speaker.stream(event.text, event.lang, event.final);
    if (event.final) agentTurn.current = null;
  };

  const send = async (audio: Blob) => {
    setSending(true);
    sendingNow.current = true;
    early.current = [];
    try {
      const result = await client.speak(audio);
      if (!result.transcript) {
        latest.current.onError("I didn't hear anything.");
      } else if (result.route === 'agent' && result.turn_id) {
        // The question and the answer arrive through the chat as usual.
        agentTurn.current = result.turn_id;
        for (const event of early.current) if (event.turn_id === result.turn_id) sayReply(event);
      } else {
        latest.current.onHeard({
          transcript: result.transcript,
          reply: result.reply,
          intent: result.intent ?? null,
        });
        if (result.reply) speaker.say(result.reply, result.lang);
      }
    } catch (error) {
      latest.current.onError(failure(error));
    } finally {
      sendingNow.current = false;
      early.current = [];
      setSending(false);
    }
  };

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const media = new MediaRecorder(stream);
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
      setRecording(false);
      recorder.current = null;
      void send(new Blob(chunks, { type: media.mimeType }));
    };
    media.start();
    recorder.current = media;
    setRecording(true);
    setTimeout(() => {
      if (media.state === 'recording') media.stop();
    }, MAX_RECORDING_MS);
  };

  const stopSpeaking = () => {
    agentTurn.current = null;
    speaker.stop();
  };

  return {
    recording,
    sending,
    speaking,
    readLevel,
    /** Tap: start, or stop recording, or cut the answer short. Never two at once. */
    toggle() {
      if (recorder.current) recorder.current.stop();
      else if (speaking) stopSpeaking();
      else if (!sending)
        start().catch(() => latest.current.onError('I could not reach the microphone.'));
    },
    stopSpeaking,
    /** Feed every live event; only the reply to this phone's own voice turn is spoken. */
    onEvent(event: SiriusEvent) {
      if (event.type !== 'voice_reply') return;
      if (event.turn_id === agentTurn.current) sayReply(event);
      else if (sendingNow.current) early.current.push(event);
    },
  };
}
