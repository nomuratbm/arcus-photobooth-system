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

/**
 * Parses and validates an S3 key for a raw photobooth photo.
 * Expected pattern: raw/{photoId}.jpg
 *
 * CRITICAL SAFETY CHECK: Keys starting with "final/" or anything outside "raw/"
 * MUST return null to prevent recursive Lambda invocation loops.
 */
export function parseRawPhotoKey(key: string): { photoId: string } | null {
  // Decode S3 event key (S3 replaces spaces with '+' and URI-encodes other characters)
  const decodedKey = decodeURIComponent(key.replace(/\+/g, '%20'));

  // Explicit safety check: never process final/
  if (decodedKey.startsWith('final/')) {
    return null;
  }

  // Must match raw/<photoId>.jpg (case-insensitive extension)
  const match = decodedKey.match(/^raw\/([^/]+)\.(jpe?g|png)$/i);
  if (!match) {
    return null;
  }

  const photoId = match[1];
  if (!photoId || photoId.trim().length === 0) {
    return null;
  }

  return { photoId };
}

/**
 * Builds the final destination S3 key for a finished photobooth photo.
 */
export function buildFinalPhotoKey(photoId: string): string {
  return `final/${photoId}.jpg`;
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
 * Uploads a finished composite photo to S3 with ContentType: image/jpeg.
 * Overwrites existing key if retried.
 */
export async function writeFinalPhotoToS3(
  bucket: string,
  photoId: string,
  imageBuffer: Buffer
): Promise<string> {
  const client = getS3Client();
  const key = buildFinalPhotoKey(photoId);

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
