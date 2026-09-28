"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// Hold-to-talk for the AI panel (M20 step 1). Records with the browser's own encoder and
// hands the clip over when the finger lifts or the limit is reached; nothing is stored.
// The clip is compressed speech, so a minute is a few hundred kilobytes.

type RecorderOptions = {
  maxSeconds: number;
  onStop: (audio: Blob, seconds: number) => void;
  onError: (messageKey: string) => void;
};

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}
const noSubscribe = () => () => {};

export function useRecorder({ maxSeconds, onStop, onError }: RecorderOptions) {
  // Decided in the browser only: the server render must not guess at the phone's
  // capabilities and then disagree with it.
  const isSupported = useSyncExternalStore(noSubscribe, supported, () => false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const stop = useCallback(() => {
    const current = recorder.current;
    if (!current || current.state === "inactive") return;
    current.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorder.current) return; // already recording
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      // No microphone at all (a desktop PC) reads differently from "blocked in the browser".
      const name = error instanceof Error ? error.name : "";
      onError(
        name === "NotFoundError" || name === "OverconstrainedError"
          ? "ai.errors.noMic"
          : "ai.errors.micDenied",
      );
      return;
    }
    const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const current = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    current.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    current.onstop = () => {
      clearTimer();
      stream.getTracks().forEach((track) => track.stop());
      const elapsed = Math.min(maxSeconds, Math.round((Date.now() - startedAt.current) / 1000));
      const audio = new Blob(chunks.current, { type: current.mimeType || "audio/webm" });
      recorder.current = null;
      setRecording(false);
      setSeconds(0);
      // A tap too short to say anything is not a note.
      if (audio.size > 0 && elapsed >= 1) onStop(audio, elapsed);
      else if (audio.size > 0) onError("ai.errors.nothingHeard");
    };
    recorder.current = current;
    startedAt.current = Date.now();
    setRecording(true);
    setSeconds(0);
    current.start();
    timer.current = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAt.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= maxSeconds) stop();
    }, 250);
  }, [maxSeconds, onError, onStop, stop]);

  // Leaving the screen mid-recording must release the microphone.
  useEffect(
    () => () => {
      clearTimer();
      const current = recorder.current;
      if (current && current.state !== "inactive") {
        current.onstop = null;
        current.stop();
        current.stream.getTracks().forEach((track) => track.stop());
      }
    },
    [],
  );

  return { supported: isSupported, recording, seconds, start, stop };
}
