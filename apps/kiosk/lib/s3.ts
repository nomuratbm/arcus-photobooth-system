import "server-only";

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { finalImageUrl, SHOT_COUNT, type PrintPhoto } from "@/lib/contracts";

let client: S3Client | undefined;
let clientRegion: string | undefined;

export class PrintStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintStorageError";
  }
}

function getS3Client(region: string): S3Client {
  if (!client || clientRegion !== region) {
    client = new S3Client({ region });
    clientRegion = region;
  }
  return client;
}

export async function presignRawUpload(
  bucket: string,
  region: string,
  key: string,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: "image/jpeg",
  });

  return getSignedUrl(getS3Client(region), command, { expiresIn: 120 });
}

async function listFromS3(
  bucket: string,
  region: string,
  domain: string,
): Promise<PrintPhoto[]> {
  const s3 = getS3Client(region);
  const ranked: { photoId: string; url: string; modified: number }[] = [];
  let token: string | undefined;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "final/",
        MaxKeys: 100,
        ContinuationToken: token,
      }),
    );

    for (const item of response.Contents ?? []) {
      const key = item.Key;
      if (!key?.startsWith("final/") || !key.endsWith(".jpg")) continue;
      const photoId = key.slice("final/".length, -".jpg".length);
      ranked.push({
        photoId,
        url: finalImageUrl(domain, key),
        modified: item.LastModified?.getTime() ?? 0,
      });
    }

    token = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (token && ranked.length < 300);

  return ranked
    .toSorted((a, b) => b.modified - a.modified)
    .map(({ photoId, url }) => ({ photoId, url, kind: "strip", sessionId: photoId }));
}

const RAW_KEY_RE = /^raw\/([^/]+)\/([1-9])\.jpg$/;

async function listRawFromS3(bucket: string, region: string): Promise<PrintPhoto[]> {
  const s3 = getS3Client(region);
  const found: { sessionId: string; shot: number; modified: number }[] = [];
  let token: string | undefined;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "raw/",
        MaxKeys: 1000,
        ContinuationToken: token,
      }),
    );

    for (const item of response.Contents ?? []) {
      const match = item.Key ? RAW_KEY_RE.exec(item.Key) : null;
      if (!match) continue;
      const shot = Number(match[2]);
      if (shot < 1 || shot > SHOT_COUNT) continue;
      found.push({ sessionId: match[1], shot, modified: item.LastModified?.getTime() ?? 0 });
    }

    token = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (token);

  // Newest session first (by its latest shot), shots ascending within a session.
  const sessionMax = new Map<string, number>();
  for (const item of found) {
    sessionMax.set(item.sessionId, Math.max(sessionMax.get(item.sessionId) ?? 0, item.modified));
  }
  return found
    .toSorted(
      (a, b) =>
        (sessionMax.get(b.sessionId) ?? 0) - (sessionMax.get(a.sessionId) ?? 0) ||
        a.sessionId.localeCompare(b.sessionId) ||
        a.shot - b.shot,
    )
    .map(({ sessionId, shot }) => ({
      photoId: `${sessionId}-${shot}`,
      // Raw shots are private (CloudFront only serves final/), so they are
      // streamed through the kiosk's own admin-only proxy route.
      url: `/api/photo?id=${encodeURIComponent(sessionId)}&shot=${shot}`,
      kind: "raw",
      sessionId,
      shot,
    }));
}

/**
 * Original camera shots per session. Optional extras on the print desk, so
 * any failure degrades to an empty list instead of breaking the page.
 */
export async function listRawPhotos(): Promise<PrintPhoto[]> {
  const bucket = process.env.BUCKET_NAME;
  const region = process.env.AWS_REGION;
  if (!bucket || !region) return [];

  try {
    return await listRawFromS3(bucket, region);
  } catch (error) {
    console.warn("[print] raw shot listing failed; continuing without them.", error);
    return [];
  }
}

/** Reads one raw shot straight from S3 for the /api/photo proxy. */
export async function getRawPhotoBytes(
  sessionId: string,
  shot: number,
): Promise<Uint8Array | null> {
  const bucket = process.env.BUCKET_NAME;
  const region = process.env.AWS_REGION;
  if (!bucket || !region) return null;

  try {
    const data = await getS3Client(region).send(
      new GetObjectCommand({ Bucket: bucket, Key: `raw/${sessionId}/${shot}.jpg` }),
    );
    return (await data.Body?.transformToByteArray()) ?? null;
  } catch (error) {
    console.error(`[photo] failed to read raw/${sessionId}/${shot}.jpg:`, error);
    return null;
  }
}

/**
 * Bundled sample strips served only in development when S3 is unreachable, so
 * the /print layout and physical printing can be exercised locally before the
 * storage stack is deployed. Never used in production.
 */
const DEV_SAMPLE_PHOTOS: PrintPhoto[] = [
  { photoId: "sample-strip-1", url: "/samples/strip-sample.jpg", kind: "strip", sessionId: "sample-strip-1" },
  { photoId: "sample-strip-2", url: "/samples/strip-sample.jpg", kind: "strip", sessionId: "sample-strip-2" },
];

export async function listFinalPhotos(): Promise<PrintPhoto[]> {
  const bucket = process.env.BUCKET_NAME;
  const region = process.env.AWS_REGION;
  const domain = process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN?.trim();
  const isDev = process.env.NODE_ENV !== "production";

  if (bucket && region && domain) {
    try {
      return await listFromS3(bucket, region, domain);
    } catch (error) {
      if (!isDev) {
        throw new PrintStorageError("Could not load photos from storage.");
      }
      console.warn(
        "[print] S3 listing failed; falling back to bundled sample strips (development only).",
        error,
      );
    }
  } else if (!isDev) {
    throw new PrintStorageError("Print storage is not configured.");
  }

  return DEV_SAMPLE_PHOTOS;
}
