import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { readPhotoFromS3, getS3Client, buildCutoutKey } from './s3.js';
import { getConfig } from './config.js';

// In-memory cache surviving warm Lambda invocations
const assetCache = new Map<string, Buffer>();
const backgroundListCache = new Map<string, string[]>();

export function getAssetCacheSize(): number {
  return assetCache.size;
}

export function clearAssetCache(): void {
  assetCache.clear();
  backgroundListCache.clear();
}

/**
 * Retrieves an asset buffer from in-memory cache, or fetches from S3 on cache miss.
 */
export async function getAssetWithCache(bucket: string, key: string): Promise<Buffer> {
  const cacheKey = `${bucket}:${key}`;

  const cached = assetCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const assetBuffer = await readPhotoFromS3(bucket, key);
  assetCache.set(cacheKey, assetBuffer);
  return assetBuffer;
}

export interface AssetSelection {
  eventId?: string;
  frameId?: string;
}

/**
 * Builds candidate S3 keys for the baked frame overlay PNG.
 * The overlay is produced by scripts/bake-frame-overlay.mjs as
 * assets/frames/{eventId}/{frameId}.png (transparent slot openings).
 */
export function buildFrameKeyCandidates(eventId: string, frameId?: string): string[] {
  const chosenFrame = frameId || 'default';
  const candidates = [`assets/frames/${eventId}/${chosenFrame}.png`];

  if (chosenFrame !== 'default') {
    candidates.push(`assets/frames/${eventId}/default.png`);
    candidates.push(`assets/frames/default/default.png`);
  } else if (eventId !== 'default') {
    candidates.push(`assets/frames/default/default.png`);
  }

  return candidates;
}

/**
 * Loads the baked frame overlay (transparent slot openings) with caching.
 */
export async function loadFrameOverlay(
  bucket: string,
  selection: AssetSelection = {}
): Promise<Buffer> {
  const config = getConfig();
  const eventId = selection.eventId || config.defaultEventId || 'default';
  const candidates = buildFrameKeyCandidates(eventId, selection.frameId);

  let lastError: Error | null = null;
  for (const candidateKey of candidates) {
    try {
      return await getAssetWithCache(bucket, candidateKey);
    } catch (err: any) {
      lastError = err;
    }
  }

  throw new Error(
    `Failed to load frame overlay for event "${eventId}", frameId "${selection.frameId}". Tried: ${candidates.join(', ')}. Details: ${lastError?.message}`
  );
}

/**
 * Lists the available background asset keys under assets/backgrounds/{eventId}/,
 * caching the result across warm invocations.
 */
export async function listBackgroundKeys(bucket: string, eventId: string): Promise<string[]> {
  const cacheKey = `${bucket}:${eventId}`;
  const cached = backgroundListCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const client = getS3Client();
  const prefix = `assets/backgrounds/${eventId}/`;
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    for (const item of response.Contents ?? []) {
      const key = item.Key;
      if (key && /\.(jpe?g|png)$/i.test(key)) keys.push(key);
    }
    token = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (token);

  if (keys.length === 0) {
    throw new Error(`No background assets found under s3://${bucket}/${prefix}`);
  }

  backgroundListCache.set(cacheKey, keys);
  return keys;
}

/**
 * Picks `count` distinct background keys at random. If fewer backgrounds exist
 * than requested, repeats are allowed so every slot still gets one.
 */
export function chooseBackgroundKeys(keys: string[], count: number): string[] {
  const pool = [...keys];
  const chosen: string[] = [];

  while (chosen.length < count) {
    if (pool.length === 0) {
      pool.push(...keys);
    }
    const i = Math.floor(Math.random() * pool.length);
    chosen.push(pool.splice(i, 1)[0]);
  }

  return chosen;
}

/**
 * Loads a random subtle-ready background buffer for each slot.
 */
export async function loadSlotBackgrounds(
  bucket: string,
  eventId: string,
  count: number
): Promise<Buffer[]> {
  const keys = await listBackgroundKeys(bucket, eventId);
  const chosen = chooseBackgroundKeys(keys, count);
  return Promise.all(chosen.map((key) => getAssetWithCache(bucket, key)));
}

/**
 * Loads the intermediate cutouts for every shot of a session from work/.
 */
export async function loadCutouts(
  bucket: string,
  sessionId: string,
  count: number
): Promise<Buffer[]> {
  const indices = Array.from({ length: count }, (_, i) => i + 1);
  return Promise.all(
    indices.map((index) => readPhotoFromS3(bucket, buildCutoutKey(sessionId, index)))
  );
}
