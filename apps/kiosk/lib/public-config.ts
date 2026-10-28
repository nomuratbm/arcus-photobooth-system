import type { LookOption, PublicConfig } from "@/lib/contracts";

const LOOK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function labelFromId(id: string): string {
  return id
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseLookOptions(value: string | undefined): LookOption[] {
  const source = value?.trim() ? value : "default";
  const seen = new Set<string>();
  const options: LookOption[] = [];

  for (const part of source.split(",")) {
    const id = part.trim();
    if (!LOOK_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    options.push({ id, label: labelFromId(id) });
  }

  if (options.length === 0) {
    options.push({ id: "default", label: "Default" });
  }

  return options;
}

export function frameIdFromQuery(
  frames: LookOption[],
  requested: string | undefined,
): string {
  if (requested && frames.some((frame) => frame.id === requested)) return requested;
  return frames[0]?.id ?? "default";
}

export function getPublicConfig(): PublicConfig {
  const eventId = process.env.NEXT_PUBLIC_EVENT_ID?.trim() || "default";

  return {
    wsUrl: process.env.NEXT_PUBLIC_WS_URL?.trim() ?? "",
    cloudfrontDomain: process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN?.trim() ?? "",
    eventId: LOOK_ID_RE.test(eventId) ? eventId : "default",
    frames: parseLookOptions(process.env.NEXT_PUBLIC_FRAME_IDS),
    backgrounds: parseLookOptions(process.env.NEXT_PUBLIC_BG_IDS),
  };
}
