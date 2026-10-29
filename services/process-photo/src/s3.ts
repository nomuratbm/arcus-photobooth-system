import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

let s3ClientInstance: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!s3ClientInstance) {
    s3ClientInstance = new S3Client({});
  }
  return s3ClientInstance;
}

export function resetS3Client(): void {
  s3ClientInstance = null;
}

export interface ParsedRawPhotoKey {
  sessionId: string;
  index: number;
}

/**
 * Parses and validates an S3 key for a raw photobooth shot.
 * Expected pattern: raw/{sessionId}/{index}.jpg  (index = 1-based shot number)
 *
 * CRITICAL SAFETY CHECK: Keys starting with "final/" or "work/" or anything
 * outside "raw/" MUST return null to prevent recursive Lambda invocation loops.
 */
export function parseRawPhotoKey(key: string): ParsedRawPhotoKey | null {
  // Decode S3 event key (S3 replaces spaces with '+' and URI-encodes other characters)
  const decodedKey = decodeURIComponent(key.replace(/\+/g, '%20'));

  // Explicit safety check: never process our own outputs
  if (decodedKey.startsWith('final/') || decodedKey.startsWith('work/')) {
    return null;
  }

  // Must match raw/<sessionId>/<index>.jpg (case-insensitive extension)
  const match = decodedKey.match(/^raw\/([^/]+)\/(\d+)\.(jpe?g|png)$/i);
  if (!match) {
    return null;
  }

  const sessionId = match[1];
  const index = Number.parseInt(match[2], 10);

  if (!sessionId || sessionId.trim().length === 0) {
    return null;
  }
  if (!Number.isInteger(index) || index < 1) {
    return null;
  }

  return { sessionId, index };
}

/**
 * Builds the intermediate cutout key for one shot of a session.
 */
export function buildCutoutKey(sessionId: string, index: number): string {
  return `work/${sessionId}/${index}.png`;
}

/**
 * Builds the final destination S3 key for a finished photobooth strip.
 */
export function buildFinalPhotoKey(sessionId: string): string {
  return `final/${sessionId}.jpg`;
}

/**
 * Downloads a photo from S3 into memory as a Buffer.
 */
export async function readPhotoFromS3(bucket: string, key: string): Promise<Buffer> {
  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await client.send(command);

  if (!response.Body) {
    throw new Error(`S3 GetObject returned empty body for s3://${bucket}/${key}`);
  }

  const byteArray = await response.Body.transformToByteArray();
  return Buffer.from(byteArray);
}

/**
 * Uploads a transparent background-removed cutout for one shot to work/.
 * These are intermediates consumed by the finalize step; they never trigger
 * the Lambda because the S3 notification filter only matches raw/.
 */
export async function writeCutoutToS3(
  bucket: string,
  sessionId: string,
  index: number,
  imageBuffer: Buffer
): Promise<string> {
  const client = getS3Client();
  const key = buildCutoutKey(sessionId, index);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: imageBuffer,
    ContentType: 'image/png',
  });

  await client.send(command);
  return key;
}

/**
 * Uploads the finished composite strip to S3 with ContentType: image/jpeg.
 * Overwrites existing key if retried.
 */
export async function writeFinalPhotoToS3(
  bucket: string,
  sessionId: string,
  imageBuffer: Buffer
): Promise<string> {
  const client = getS3Client();
  const key = buildFinalPhotoKey(sessionId);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: imageBuffer,
    ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=86400',
  });

  await client.send(command);
  return key;
}
