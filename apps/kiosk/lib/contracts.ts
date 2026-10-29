export type LookOption = {
  id: string;
  label: string;
};

export type PublicConfig = {
  wsUrl: string;
  cloudfrontDomain: string;
  eventId: string;
  frames: LookOption[];
  backgrounds: LookOption[];
};

export type BoothConfig = {
  wsUrl: string;
  cloudfrontDomain: string;
  eventId: string;
  frameId: string;
  bgId: string;
  cameraId: string;
};

export type PrintPhoto = {
  photoId: string;
  url: string;
  /** "strip" is the composited final; "raw" is one original camera shot. */
  kind: "strip" | "raw";
  /** Guest session this photo belongs to. */
  sessionId: string;
  /** 1-based capture index; only set for raw shots. */
  shot?: number;
};

export type WebSocketMessage =
  | { status: "done"; key: string }
  | { status: "error"; message: string };

export const PHOTO_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Number of photos captured per guest session (composited into one strip). */
export const SHOT_COUNT = 3;

/** S3 key for one shot of a session: raw/{sessionId}/{index}.jpg */
export function rawShotKey(sessionId: string, index: number): string {
  return `raw/${sessionId}/${index}.jpg`;
}

export function finalImageUrl(domain: string, key: string): string {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const path = key.replace(/^\/+/, "");
  return `https://${host}/${path}`;
}

export function parseWebSocketMessage(data: unknown): WebSocketMessage | null {
  if (typeof data !== "string") return null;

  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;

  if (record.status === "done" && typeof record.key === "string") {
    return { status: "done", key: record.key };
  }

  if (record.status === "error" && typeof record.message === "string") {
    return { status: "error", message: record.message };
  }

  return null;
}
