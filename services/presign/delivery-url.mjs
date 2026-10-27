import { validatePhotoId } from "./validate-photo-id.mjs";

const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

export function buildDeliveryUrl(domain, key) {
  if (typeof domain !== "string" || typeof key !== "string") {
    throw new TypeError("Domain and key must be strings");
  }

  const cleanDomain = domain.trim();
  if (!DOMAIN_RE.test(cleanDomain) || cleanDomain.includes("://") || cleanDomain.includes("/")) {
    throw new Error("Invalid CloudFront domain: " + domain);
  }

  const cleanKey = key.trim();
  if (!cleanKey.startsWith("final/")) {
    throw new Error("Key must start with final/: " + key);
  }

  if (cleanKey.startsWith("final/final/") || cleanKey.includes("//") || cleanKey.includes("..")) {
    throw new Error("Invalid key path: " + key);
  }

  const parts = cleanKey.split("/");
  if (parts.length !== 2) {
    throw new Error("Key must have exactly two path segments: " + key);
  }

  const filename = parts[1];
  if (!filename.endsWith(".jpg")) {
    throw new Error("Key must end with .jpg extension: " + key);
  }

  const photoId = filename.slice(0, -4);
  if (!validatePhotoId(photoId)) {
    throw new Error("Key contains invalid photoId: " + key);
  }

  return `https://${cleanDomain}/${cleanKey}`;
}
