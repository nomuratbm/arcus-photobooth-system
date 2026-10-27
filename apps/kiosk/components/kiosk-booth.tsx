"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BoothNotice, PhotoResult } from "@/components/photo-result";
import { CountdownOverlay } from "@/components/countdown-overlay";
import { LookPicker } from "@/components/look-picker";
import {
  COUNTDOWN_SECONDS,
  startGuestSession,
  type GuestPhase,
} from "@/lib/guest-session";
import type { PublicConfig } from "@/lib/contracts";

function statusLabel(
  phase: GuestPhase,
  cameraError: string | null,
  cameraReady: boolean,
): string {
  if (phase.type === "countdown") return `Hold still. ${phase.seconds}`;
  if (phase.type === "uploading") return "Sending photo…";
  if (phase.type === "processing") return "Making your photo…";
  if (phase.type === "done") return "Your photo is ready.";
  if (phase.type === "error") return phase.message;
  if (cameraError) return cameraError;
  if (!cameraReady) return "Starting camera…";
  return `Press the shutter. You will have ${COUNTDOWN_SECONDS} seconds.`;
}

export function KioskBooth({ config }: { config: PublicConfig }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<{ cancel: () => void } | null>(null);
  const mountedRef = useRef(true);
  const phaseRef = useRef<GuestPhase["type"]>("idle");
  const [phase, setPhase] = useState<GuestPhase>({ type: "idle" });
  const [frameId, setFrameId] = useState(config.frames[0]?.id ?? "default");
  const [bgId, setBgId] = useState(config.backgrounds[0]?.id ?? "default");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const setBoothPhase = useCallback((next: GuestPhase) => {
    phaseRef.current = next.type;
    if (!mountedRef.current) return;
    setPhase(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        if (!cancelled) setCameraReady(true);
      } catch {
        if (!cancelled) {
          setCameraReady(false);
          setCameraError("Camera access is required to take a photo.");
        }
      }
    }

    void startCamera();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      sessionRef.current?.cancel();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const handleReset = useCallback(() => {
    sessionRef.current?.cancel();
    sessionRef.current = null;
    setBoothPhase({ type: "idle" });
  }, [setBoothPhase]);

  function handleTakePhoto() {
    if (phaseRef.current !== "idle" || cameraError !== null || !cameraReady) return;
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    sessionRef.current = startGuestSession({
      video,
      wsUrl: config.wsUrl,
      cloudfrontDomain: config.cloudfrontDomain,
      eventId: config.eventId,
      frameId,
      bgId,
      onPhase: setBoothPhase,
    });
  }

  const choosingLook = phase.type !== "idle";
  const label = statusLabel(phase, cameraError, cameraReady);
  const showProgress = phase.type === "uploading" || phase.type === "processing";

  return (
    <div className="mx-auto flex h-dvh max-w-6xl flex-col gap-4 overflow-hidden px-6 py-4">
      <header className="flex shrink-0 items-center justify-between">
        <p className="font-display text-3xl tracking-wide">ARCUS</p>
        <Link href="/print" className="no-print text-sm text-paper/70 underline-offset-4 hover:underline">
          Staff
        </Link>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-4 md:grid-cols-[minmax(0,1fr)_15rem] md:grid-rows-1">
        <section className="relative min-h-0 overflow-hidden rounded-[2rem] bg-black shadow-[0_0_0_10px_rgba(244,239,230,0.08)]">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            aria-label="Live camera"
            className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
          />
          {cameraError !== null && phase.type === "idle" ? (
            <p className="absolute inset-x-6 bottom-6 text-center text-sm">{cameraError}</p>
          ) : null}
          {phase.type === "countdown" ? <CountdownOverlay seconds={phase.seconds} /> : null}
          {showProgress ? (
            <p className="absolute inset-x-6 bottom-6 text-center text-lg">{label}</p>
          ) : null}
          {phase.type === "done" ? (
            <PhotoResult url={phase.url} onNewPhoto={handleReset} />
          ) : null}
          {phase.type === "error" ? (
            <BoothNotice message={phase.message} action="Try again" onAction={handleReset} />
          ) : null}
        </section>

        <aside className="flex flex-col gap-6">
          <LookPicker
            label="Frame"
            options={config.frames}
            value={frameId}
            disabled={choosingLook}
            onChange={setFrameId}
          />
          <LookPicker
            label="Background"
            options={config.backgrounds}
            value={bgId}
            disabled={choosingLook}
            onChange={setBgId}
          />
          <button
            type="button"
            onClick={handleTakePhoto}
            disabled={phase.type !== "idle" || cameraError !== null || !cameraReady}
            className="size-28 self-center rounded-full bg-amber text-sm font-semibold tracking-wide text-ink uppercase disabled:opacity-40"
          >
            Take photo
          </button>
          <p aria-live="polite" className="min-h-12 text-center text-sm text-paper/80">
            {label}
          </p>
        </aside>
      </div>
    </div>
  );
}
