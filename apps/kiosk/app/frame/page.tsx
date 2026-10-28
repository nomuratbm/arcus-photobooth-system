import Link from "next/link";
import { FramePicker } from "@/components/frame-picker";
import { framePreviewSrc, getPublicConfig } from "@/lib/public-config";

const exitLink = (
  <Link href="/" className="rounded-full border border-paper/30 px-4 py-2 text-sm">
    Exit
  </Link>
);

export default function FramePage() {
  const config = getPublicConfig();
  const frames = config.frames.map((frame) => ({
    id: frame.id,
    label: frame.label,
    src: framePreviewSrc(config.eventId, frame.id),
  }));

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 px-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm tracking-[0.2em] text-paper/70 uppercase">ARCUS</p>
          <h1 className="font-display text-4xl">Choose a frame</h1>
        </div>
        {exitLink}
      </header>
      <FramePicker frames={frames} />
    </main>
  );
}
