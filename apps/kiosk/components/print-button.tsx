"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-full bg-amber px-4 py-2 text-sm font-medium text-ink"
    >
      Print
    </button>
  );
}
