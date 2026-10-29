import type { PrintPhoto } from "@/lib/contracts";

/**
 * Downloads finished strips and raw shots as PNG files. Strips are JPEGs on
 * CloudFront (no CORS headers) and raw shots are private, so both kinds are
 * re-fetched through the same-origin /api/photo proxy (relative URLs) and
 * re-encoded in a canvas.
 */

async function fetchJpeg(photo: PrintPhoto): Promise<Blob> {
  const source = photo.url.startsWith("/")
    ? photo.url // raw shots and dev samples: already same-origin proxy paths
    : `/api/photo?id=${encodeURIComponent(photo.sessionId)}`;
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Could not fetch ${photo.photoId} (${response.status})`);
  }
  return response.blob();
}

async function convertToPng(jpeg: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(jpeg);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!png) throw new Error("PNG encoding failed");
    return png;
  } finally {
    bitmap.close();
  }
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Saves each strip as `{photoId}.png`; returns how many downloads failed. */
export async function downloadStripsAsPng(photos: PrintPhoto[]): Promise<number> {
  let failures = 0;
  for (const photo of photos) {
    try {
      const png = await convertToPng(await fetchJpeg(photo));
      saveBlob(png, `${photo.photoId}.png`);
    } catch (error) {
      failures += 1;
      console.error(`[print] PNG download failed for ${photo.photoId}:`, error);
    }
  }
  return failures;
}
