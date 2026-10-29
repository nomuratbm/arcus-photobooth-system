"use client";

import { useMemo, useState } from "react";
import { PhotoGrid } from "@/components/photo-grid";
import { downloadStripsAsPng } from "@/lib/download";
import type { PrintPhoto } from "@/lib/contracts";

/**
 * Client-side print desk: the admin taps strips to choose which ones to print
 * or download, then prints only the selection (unselected cards are hidden by
 * the `@media print` rules in globals.css) or saves it as PNG files. Raw
 * camera shots stay hidden until their strip is selected; the "Raw photos"
 * toggle then reveals only the shots belonging to the selected strips.
 */
function buildVisibleList(
  photos: PrintPhoto[],
  rawPhotos: PrintPhoto[],
  showRaw: boolean,
  selectedIds: ReadonlySet<string>,
): PrintPhoto[] {
  if (!showRaw) return photos;

  const rawsBySession = new Map<string, PrintPhoto[]>();
  for (const raw of rawPhotos) {
    const list = rawsBySession.get(raw.sessionId);
    if (list) list.push(raw);
    else rawsBySession.set(raw.sessionId, [raw]);
  }

  const merged: PrintPhoto[] = [];
  for (const strip of photos) {
    merged.push(strip);
    // Only the selected strip's own raw shots are revealed, right after it.
    if (selectedIds.has(strip.photoId)) {
      const raws = rawsBySession.get(strip.sessionId);
      if (raws) merged.push(...raws);
    }
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

  // Raw photos unlock only once at least one strip is selected.
  const stripSelected = photos.some((photo) => selectedIds.has(photo.photoId));
  const rawAvailable = rawPhotos.length > 0 && stripSelected;

  const visible = useMemo(
    () => buildVisibleList(photos, rawPhotos, showRaw && rawAvailable, selectedIds),
    [photos, rawPhotos, showRaw, rawAvailable, selectedIds],
  );

  // Effective selection: stale picks (e.g. raws whose strip was deselected,
  // or anything hidden by the toggle) are ignored without mutating state.
  const selected = useMemo(() => {
    const visibleIds = new Set(visible.map((photo) => photo.photoId));
    const kept = new Set<string>();
    for (const id of selectedIds) {
      if (visibleIds.has(id)) kept.add(id);
    }
    return kept;
  }, [selectedIds, visible]);

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

  const allSelected = visible.length > 0 && selected.size === visible.length;

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(visible.map((p) => p.photoId)));
  }

  async function downloadPng() {
    if (downloading) return;
    setDownloading(true);
    try {
      const picked = visible.filter((photo) => selected.has(photo.photoId));
      const failures = await downloadStripsAsPng(picked);
      if (failures > 0) {
        window.alert(`Could not download ${failures} of ${picked.length} photos.`);
      }
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-paper/20 bg-ink/90 px-4 py-3 backdrop-blur">
        <p className="text-sm text-paper/80" aria-live="polite">
          {selected.size} of {visible.length} selected for printing
        </p>
        <div className="flex items-center gap-2">
          {rawPhotos.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowRaw((on) => !on)}
              aria-pressed={showRaw && rawAvailable}
              disabled={!rawAvailable && !showRaw}
              title={
                rawAvailable || showRaw
                  ? undefined
                  : "Select a strip first to reveal its raw photos"
              }
              className={
                showRaw && rawAvailable
                  ? "rounded-full border border-amber bg-amber/15 px-4 py-2 text-sm text-amber disabled:opacity-40"
                  : "rounded-full border border-paper/30 px-4 py-2 text-sm disabled:opacity-40"
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
            disabled={selected.size === 0 || downloading}
            className="rounded-full border border-amber px-4 py-2 text-sm font-medium text-amber disabled:opacity-40"
          >
            {downloading
              ? "Preparing…"
              : `Download PNG${selected.size > 0 ? ` (${selected.size})` : ""}`}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={selected.size === 0}
            className="rounded-full bg-amber px-4 py-2 text-sm font-medium text-ink disabled:opacity-40"
          >
            Print{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
        </div>
      </div>
      <PhotoGrid photos={visible} selectedIds={selected} onToggle={toggle} />
      {visible.length > 0 && selected.size === 0 ? (
        <p className="no-print text-center text-sm text-paper/60">
          Tap the strips you want, then press Print or Download PNG. Select a
          strip to unlock its raw photos.
        </p>
      ) : null}
    </div>
  );
}
