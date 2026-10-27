const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function validatePhotoId(raw) {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (id.length !== 36) return null;
  if (!UUID_V4_RE.test(id)) return null;
  if (id.includes("/") || id.includes("\\") || id.includes("..")) return null;
  return id;
}
