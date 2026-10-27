"use client";

import dynamic from "next/dynamic";
import type { PublicConfig } from "@/lib/contracts";

const boothFallback = (
  <section className="grid min-h-[50vh] place-items-center">
    <p className="font-display text-3xl">Starting camera…</p>
  </section>
);

const KioskBooth = dynamic(
  () => import("@/components/kiosk-booth").then((mod) => mod.KioskBooth),
  { ssr: false, loading: () => boothFallback },
);

export function KioskLoader({ config }: { config: PublicConfig }) {
  return <KioskBooth config={config} />;
}
