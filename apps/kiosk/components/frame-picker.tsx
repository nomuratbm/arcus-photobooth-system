"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const DEFAULT_CAMERA = "default";
const PREVIEW_PHOTO = "/frames/preview-photo.svg";

type FrameChoice = {
  id: string;
  label: string;
  src: string;
};

type CameraChoice = {
  id: string;
  label: string;
};

function preloadCameraBooth() {
  if (typeof window === "undefined") return;
  void import("@/components/kiosk-booth");
}

function videoInputs(devices: MediaDeviceInfo[]): CameraChoice[] {
  const cameras: CameraChoice[] = [];
  for (const device of devices) {
    if (device.kind !== "videoinput" || device.deviceId === "") continue;
    const label = device.label.trim();
    cameras.push({
      id: device.deviceId,
      label: label === "" ? `Camera ${cameras.length + 1}` : label,
    });
  }
  return cameras;
}

function FrameLook({
  src,
  missing,
  onMissing,
}: {
  src: string;
  missing: boolean;
  onMissing: () => void;
}) {
  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden bg-black">
      <img src={PREVIEW_PHOTO} alt="" className="absolute inset-[15%] object-cover" />
      {missing ? (
        <div className="absolute inset-0 border-[18px] border-paper" />
      ) : (
        <img src={src} alt="" className="absolute inset-0 h-full w-full" onError={onMissing} />
      )}
    </div>
  );
}

export function FramePicker({ frames }: { frames: FrameChoice[] }) {
  const [frameId, setFrameId] = useState(frames[0]?.id ?? "default");
  const [cameraId, setCameraId] = useState(DEFAULT_CAMERA);
  const [cameras, setCameras] = useState<CameraChoice[]>([]);
  const [missingFrames, setMissingFrames] = useState<ReadonlySet<string>>(new Set());
  const selected = frames.find((frame) => frame.id === frameId) ?? frames[0];
  const cameraStillListed =
    cameraId === DEFAULT_CAMERA || cameras.some((camera) => camera.id === cameraId);
  const selectedCamera = cameraStillListed ? cameraId : DEFAULT_CAMERA;
  const cameraParams = new URLSearchParams({ frame: frameId });
  if (selectedCamera !== DEFAULT_CAMERA) cameraParams.set("camera", selectedCamera);
  const showChoices = frames.length > 1;

  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media) return;

    let cancelled = false;

    async function listCameras() {
      const devices = await media.enumerateDevices();
      if (cancelled) return;
      setCameras(videoInputs(devices));
    }

    async function loadCameras() {
      const listed = await media.enumerateDevices();
      const needsLabels = listed.some(
        (device) => device.kind === "videoinput" && device.deviceId !== "" && device.label === "",
      );
      if (needsLabels) {
        try {
          const stream = await media.getUserMedia({ audio: false, video: true });
          stream.getTracks().forEach((track) => track.stop());
        } catch {
          // Names stay generic until camera access is allowed.
        }
      }
      if (cancelled) return;
      await listCameras();
    }

    void loadCameras();
    const onDeviceChange = () => {
      void listCameras();
    };
    media.addEventListener("devicechange", onDeviceChange);

    return () => {
      cancelled = true;
      media.removeEventListener("devicechange", onDeviceChange);
    };
  }, []);

  function markFrameMissing(id: string) {
    setMissingFrames((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  return (
    <div className="flex w-full max-w-md flex-col items-start gap-8">
      {selected ? (
        <figure className="w-64">
          <FrameLook
            src={selected.src}
            missing={missingFrames.has(selected.id)}
            onMissing={() => markFrameMissing(selected.id)}
          />
          <figcaption className="mt-3 text-sm text-paper/80">{selected.label}</figcaption>
        </figure>
      ) : null}
      {showChoices ? (
        <div className="flex flex-wrap gap-3" role="group" aria-label="Frames">
          {frames.map((frame) => {
            const pressed = frame.id === frameId;
            return (
              <button
                key={frame.id}
                type="button"
                aria-pressed={pressed}
                onClick={() => setFrameId(frame.id)}
                className={
                  pressed
                    ? "w-28 rounded-2xl p-1 ring-2 ring-amber"
                    : "w-28 rounded-2xl p-1 ring-1 ring-paper/30"
                }
              >
                <FrameLook
                  src={frame.src}
                  missing={missingFrames.has(frame.id)}
                  onMissing={() => markFrameMissing(frame.id)}
                />
                <span className="mt-1 block text-center text-xs">{frame.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <label className="block w-full space-y-2">
        <span className="text-sm tracking-wide text-paper/70 uppercase">Camera</span>
        <select
          value={selectedCamera}
          onChange={(event) => setCameraId(event.target.value)}
          className="w-full rounded-2xl border border-paper/20 bg-ink px-4 py-3 text-base text-paper outline-none focus:border-amber"
        >
          <option value={DEFAULT_CAMERA}>Default camera</option>
          {cameras.map((camera) => (
            <option key={camera.id} value={camera.id}>
              {camera.label}
            </option>
          ))}
        </select>
      </label>
      <Link
        href={`/camera?${cameraParams.toString()}`}
        onMouseEnter={preloadCameraBooth}
        onFocus={preloadCameraBooth}
        className="rounded-full bg-amber px-8 py-3 font-medium text-ink"
      >
        Proceed
      </Link>
    </div>
  );
}
