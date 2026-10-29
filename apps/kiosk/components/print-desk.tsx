"use client";

import { useState } from "react";
import { PhotoGrid } from "@/components/photo-grid";
import type { PrintPhoto } from "@/lib/contracts";

/**
 * Client-side print desk: the admin taps strips to choose which ones to print,
 * then prints only the selection. Unselected cards are hidden by the
 * `@media print` rules in globals.css.
 */
export function PrintDesk({ photos }: { photos: PrintPhoto[] }) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  function toggle(photoId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  }

  const allSelected = photos.length > 0 && selectedIds.size === photos.length;

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(photos.map((p) => p.photoId)));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-paper/20 bg-ink/90 px-4 py-3 backdrop-blur">
        <p className="text-sm text-paper/80" aria-live="polite">
          {selectedIds.size} of {photos.length} selected for printing
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleAll}
            disabled={photos.length === 0}
            className="rounded-full border border-paper/30 px-4 py-2 text-sm disabled:opacity-40"
          >
            {allSelected ? "Clear" : "Select all"}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={selectedIds.size === 0}
            className="rounded-full bg-amber px-4 py-2 text-sm font-medium text-ink disabled:opacity-40"
          >
            Print{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
          </button>
        </div>
      </div>
      <PhotoGrid photos={photos} selectedIds={selectedIds} onToggle={toggle} />
      {photos.length > 0 && selectedIds.size === 0 ? (
        <p className="no-print text-center text-sm text-paper/60">
          Tap the strips you want to print, then press Print.
        </p>
      ) : null}
    </div>
  );
}
