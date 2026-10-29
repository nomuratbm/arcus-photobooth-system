"use client";

import Image from "next/image";
import type { PrintPhoto } from "@/lib/contracts";

export function PhotoGrid({
  photos,
  selectedIds,
  onToggle,
}: {
  photos: PrintPhoto[];
  selectedIds: ReadonlySet<string>;
  onToggle: (photoId: string) => void;
}) {
  if (photos.length === 0) {
    return <p className="text-lg">No finished photos yet.</p>;
  }

  let lastSelectedIndex = -1;
  photos.forEach((photo, i) => {
    if (selectedIds.has(photo.photoId)) lastSelectedIndex = i;
  });

  return (
    <ul className="print-grid grid grid-cols-2 gap-4 md:grid-cols-3">
      {photos.map((photo, i) => {
        const selected = selectedIds.has(photo.photoId);
        const isRaw = photo.kind === "raw";
        return (
          <li
            key={photo.photoId}
            className={[
              "print-card relative overflow-hidden rounded-2xl bg-white",
              // Strips are tall portraits; raw shots are landscape camera frames.
              isRaw ? "aspect-video" : "aspect-[600/1697]",
              selected ? "print-selected ring-4 ring-amber" : "opacity-60",
              selected && i === lastSelectedIndex ? "print-last" : "",
            ].join(" ")}
          >
            <Image
              src={photo.url}
              alt={
                isRaw
                  ? `Raw shot ${photo.shot} from session ${photo.sessionId}`
                  : `Finished photo ${photo.photoId}`
              }
              fill
              unoptimized
              sizes="(min-width: 768px) 33vw, 50vw"
              className="object-contain"
            />
            {isRaw ? (
              <span className="pointer-events-none absolute bottom-2 left-2 z-20 rounded-full bg-black/60 px-2 py-0.5 text-[10px] tracking-wide text-paper uppercase">
                Raw {photo.shot}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onToggle(photo.photoId)}
              aria-pressed={selected}
              aria-label={
                selected
                  ? `Deselect photo ${photo.photoId} for printing`
                  : `Select photo ${photo.photoId} for printing`
              }
              className="absolute inset-0 z-10 cursor-pointer"
            />
            <span
              aria-hidden="true"
              className={[
                "pointer-events-none absolute top-3 right-3 z-20 grid size-8 place-items-center rounded-full text-sm font-bold",
                selected ? "bg-amber text-ink" : "border border-paper/40 bg-black/50 text-transparent",
              ].join(" ")}
            >
              ✓
            </span>
          </li>
        );
      })}
    </ul>
  );
}
