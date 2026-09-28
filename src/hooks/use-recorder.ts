"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// The microphone for the AI panel (M20). Records with the browser's own encoder and hands
// the clip over when stopped or when the limit is reached; nothing is stored. The clip is
// compressed speech, so a minute is a few hundred kilobytes.
//
// Found on an Android phone (28 Sep 2026): clips arrived with no sound in them, and the
// speech model answered a silent clip with its own hint ("Deepak Silk. Indian clothing
// store: …"). So the loudness is measured while recording, and a clip that stayed silent
// is refused here, with a message, instead of being sent.

type RecorderOptions = {
  maxSeconds: number;
  onStop: (audio: Blob, seconds: number) => void;
  onError: (messageKey: string) => void;
};

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

// Loudest moment below this (root mean square of the samples, 0–1) = nothing was said.
// Speech into a phone is around 0.05–0.3; a quiet room is under 0.005.
export const SILENCE_RMS = 0.01;

type AudioContextClass = typeof AudioContext;

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
  const [starting, setStarting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const opening = useRef(false);
  // stop() pressed while the microphone was still opening (it can take a second on a
  // phone, longer behind the permission question): honoured as soon as it is open.
  const stopWanted = useRef(false);
  const audio = useRef<AudioContext | null>(null);
  const peak = useRef(0);
  const measured = useRef(false);

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  const closeAudio = () => {
    void audio.current?.close().catch(() => undefined);
    audio.current = null;
  };

  const stop = useCallback(() => {
    if (opening.current) {
      stopWanted.current = true;
      return;
    }
    const current = recorder.current;
    if (!current || current.state === "inactive") return;
    current.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorder.current || opening.current) return; // already recording or opening
    opening.current = true;
    stopWanted.current = false;
    setStarting(true);
    // Created before the first await, while the tap is still "the user's gesture":
    // otherwise some phones start it suspended and it hears nothing.
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
    try {
      audio.current = Context ? new Context() : null;
    } catch {
      audio.current = null;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      opening.current = false;
      setStarting(false);
      closeAudio();
      // No microphone at all (a desktop PC) reads differently from "blocked in the browser".
      const name = error instanceof Error ? error.name : "";
      onError(
        name === "NotFoundError" || name === "OverconstrainedError"
          ? "ai.errors.noMic"
          : "ai.errors.micDenied",
      );
      return;
    }

    // Loudness, sampled with the timer below. Any failure here only skips the check.
    peak.current = 0;
    measured.current = false;
    let analyser: AnalyserNode | null = null;
    let samples: Float32Array<ArrayBuffer> | null = null;
    try {
      if (audio.current) {
        if (audio.current.state === "suspended") void audio.current.resume();
        analyser = audio.current.createAnalyser();
        analyser.fftSize = 1024;
        audio.current.createMediaStreamSource(stream).connect(analyser);
        samples = new Float32Array(analyser.fftSize);
      }
    } catch {
      analyser = null;
    }
    const sample = () => {
      if (!analyser || !samples || audio.current?.state !== "running") return;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) sum += value * value;
      peak.current = Math.max(peak.current, Math.sqrt(sum / samples.length));
      measured.current = true;
    };

    const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const current = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    current.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    current.onstop = () => {
      clearTimer();
      stream.getTracks().forEach((track) => track.stop());
      closeAudio();
      const elapsed = Math.min(maxSeconds, Math.round((Date.now() - startedAt.current) / 1000));
      const clip = new Blob(chunks.current, { type: current.mimeType || "audio/webm" });
      recorder.current = null;
      setRecording(false);
      setSeconds(0);
      // A tap too short to say anything, or a clip with no sound in it, is not a note.
      if (clip.size === 0 || elapsed < 1) onError("ai.errors.nothingHeard");
      else if (measured.current && peak.current < SILENCE_RMS) onError("ai.errors.silent");
      else onStop(clip, elapsed);
    };
    recorder.current = current;
    opening.current = false;
    setStarting(false);
    startedAt.current = Date.now();
    setRecording(true);
    setSeconds(0);
    current.start();
    timer.current = setInterval(() => {
      sample();
      const elapsed = Math.round((Date.now() - startedAt.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= maxSeconds) stop();
    }, 100);
    if (stopWanted.current) stop();
  }, [maxSeconds, onError, onStop, stop]);

  // Leaving the screen mid-recording must release the microphone.
  useEffect(
    () => () => {
      clearTimer();
      closeAudio();
      const current = recorder.current;
      if (current && current.state !== "inactive") {
        current.onstop = null;
        current.stop();
        current.stream.getTracks().forEach((track) => track.stop());
      }
    },
    [],
  );

  return { supported: isSupported, recording, starting, seconds, start, stop };
}
