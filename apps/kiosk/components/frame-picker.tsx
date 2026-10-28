"use client";

import Link from "next/link";
import { useState } from "react";
import { LookPicker } from "@/components/look-picker";
import type { LookOption } from "@/lib/contracts";

function preloadCameraBooth() {
  if (typeof window === "undefined") return;
  void import("@/components/kiosk-booth");
}

export function FramePicker({ frames }: { frames: LookOption[] }) {
  const [frameId, setFrameId] = useState(frames[0]?.id ?? "default");

  return (
    <div className="flex flex-col items-start gap-8">
      <LookPicker
        label="Frame"
        options={frames}
        value={frameId}
        disabled={false}
        onChange={setFrameId}
      />
      <Link
        href={`/camera?frame=${encodeURIComponent(frameId)}`}
        onMouseEnter={preloadCameraBooth}
        onFocus={preloadCameraBooth}
        className="rounded-full bg-amber px-8 py-3 font-medium text-ink"
      >
        Proceed
      </Link>
    </div>
  );
}
