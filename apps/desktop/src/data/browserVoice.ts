/**
 * Phone push-to-talk (ADR-10): the browser records and the core transcribes. The laptop never
 * uses this, because the voice service owns the microphone there. Only https pages get here,
 * since browsers refuse microphone access otherwise.
 */
import { useRef, useState } from 'react';

const MAX_RECORDING_MS = 20_000; // F28

export function browserVoiceSupported(): boolean {
  return (
    window.location.protocol === 'https:' &&
    !('__TAURI_INTERNALS__' in window) &&
    typeof MediaRecorder !== 'undefined'
  );
}

interface VoiceUploadResult {
  reply?: string | null;
}

export function useBrowserVoice(onReply: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);

  const upload = async (audio: Blob) => {
    const response = await fetch('/v1/voice/audio', { method: 'POST', body: audio });
    const result = (await response.json()) as VoiceUploadResult & { message?: string };
    const text = response.ok ? result.reply : result.message;
    if (text) onReply(text);
  };

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const media = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    media.ondataavailable = (event) => chunks.push(event.data);
    media.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      setRecording(false);
      recorder.current = null;
      void upload(new Blob(chunks, { type: media.mimeType })).catch(() =>
        onReply("That didn't reach me."),
      );
    };
    media.start();
    recorder.current = media;
    setRecording(true);
    setTimeout(() => {
      if (media.state === 'recording') media.stop();
    }, MAX_RECORDING_MS);
  };

  const toggle = () => {
    if (recorder.current) recorder.current.stop();
    else start().catch(() => onReply('I could not reach the microphone.'));
  };

  return { recording, toggle };
}
