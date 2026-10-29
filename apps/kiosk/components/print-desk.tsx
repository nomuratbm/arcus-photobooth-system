"use client";

import { useMemo, useState } from "react";
import { PhotoGrid } from "@/components/photo-grid";
import { downloadStripsAsPng } from "@/lib/download";
import type { PrintPhoto } from "@/lib/contracts";

/**
 * Client-side print desk: the admin taps strips to choose which ones to print
 * or download, then prints only the selection (unselected cards are hidden by
 * the `@media print` rules in globals.css) or saves it as PNG files. An
 * optional toggle inserts each session's raw camera shots after its strip.
 */
function buildVisibleList(
  photos: PrintPhoto[],
  rawPhotos: PrintPhoto[],
  showRaw: boolean,
): PrintPhoto[] {
  if (!showRaw) return photos;

  const rawsBySession = new Map<string, PrintPhoto[]>();
  for (const raw of rawPhotos) {
    const list = rawsBySession.get(raw.sessionId);
    if (list) list.push(raw);
    else rawsBySession.set(raw.sessionId, [raw]);
  }

  const merged: PrintPhoto[] = [];
  const withStrip = new Set<string>();
  for (const strip of photos) {
    merged.push(strip);
    withStrip.add(strip.sessionId);
    const raws = rawsBySession.get(strip.sessionId);
    if (raws) merged.push(...raws);
  }
  // Sessions whose strip is missing (e.g. not finalized) still show their shots.
  for (const [sessionId, raws] of rawsBySession) {
    if (!withStrip.has(sessionId)) merged.push(...raws);
  }
  return merged;
}

export function PrintDesk({
  photos,
  rawPhotos,
}: {
  photos: PrintPhoto[];
  rawPhotos: PrintPhoto[];
}) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [downloading, setDownloading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const visible = useMemo(
    () => buildVisibleList(photos, rawPhotos, showRaw),
    [photos, rawPhotos, showRaw],
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

  const allSelected = visible.length > 0 && selectedIds.size === visible.length;

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(visible.map((p) => p.photoId)));
  }

  function toggleShowRaw() {
    const next = !showRaw;
    setShowRaw(next);
    if (next) return;
    // Drop hidden raw shots from the selection so counts stay truthful.
    const rawIds = new Set(rawPhotos.map((p) => p.photoId));
    setSelectedIds((prev) => {
      let changed = false;
      const kept = new Set<string>();
      for (const id of prev) {
        if (rawIds.has(id)) changed = true;
        else kept.add(id);
      }
      return changed ? kept : prev;
    });
  }

  async function downloadPng() {
    if (downloading) return;
    setDownloading(true);
    try {
      const selected = visible.filter((photo) => selectedIds.has(photo.photoId));
      const failures = await downloadStripsAsPng(selected);
      if (failures > 0) {
        window.alert(`Could not download ${failures} of ${selected.length} strips.`);
      }
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-paper/20 bg-ink/90 px-4 py-3 backdrop-blur">
        <p className="text-sm text-paper/80" aria-live="polite">
          {selectedIds.size} of {visible.length} selected for printing
        </p>
        <div className="flex items-center gap-2">
          {rawPhotos.length > 0 ? (
            <button
              type="button"
              onClick={toggleShowRaw}
              aria-pressed={showRaw}
              className={
                showRaw
                  ? "rounded-full border border-amber bg-amber/15 px-4 py-2 text-sm text-amber"
                  : "rounded-full border border-paper/30 px-4 py-2 text-sm"
              }
            >
              Raw photos
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleAll}
            disabled={visible.length === 0}
            className="rounded-full border border-paper/30 px-4 py-2 text-sm disabled:opacity-40"
          >
            {allSelected ? "Clear" : "Select all"}
          </button>
          <button
            type="button"
            onClick={() => void downloadPng()}
            disabled={selectedIds.size === 0 || downloading}
            className="rounded-full border border-amber px-4 py-2 text-sm font-medium text-amber disabled:opacity-40"
          >
            {downloading
              ? "Preparing…"
              : `Download PNG${selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}`}
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
      <PhotoGrid photos={visible} selectedIds={selectedIds} onToggle={toggle} />
      {visible.length > 0 && selectedIds.size === 0 ? (
        <p className="no-print text-center text-sm text-paper/60">
          Tap the strips you want, then press Print or Download PNG.
        </p>
      ) : null}
    </div>
  );
}
