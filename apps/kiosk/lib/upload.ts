export async function requestPresign(photoId: string): Promise<string> {
  const response = await fetch("/api/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoId }),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "Could not prepare the upload.";
    throw new Error(message);
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("url" in payload) ||
    typeof payload.url !== "string"
  ) {
    throw new Error("Could not prepare the upload.");
  }

  return payload.url;
}

export async function uploadJpeg(url: string, blob: Blob): Promise<void> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body: blob,
  });

  if (!response.ok) {
    throw new Error("Upload failed.");
  }
}
