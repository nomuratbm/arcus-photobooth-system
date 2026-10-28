import { readPhotoFromS3 } from './s3.js';
import { getConfig } from './config.js';

// In-memory cache surviving warm Lambda invocations
const assetCache = new Map<string, Buffer>();

export function getAssetCacheSize(): number {
  return assetCache.size;
}

export function clearAssetCache(): void {
  assetCache.clear();
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
  bgId?: string;
  frameId?: string;
}

/**
 * Builds candidate S3 keys for background assets.
 * Supports {bgId}.jpg, {bgId}.png, or fallback to default.jpg.
 */
export function buildBackgroundKeyCandidates(eventId: string, bgId?: string): string[] {
  const chosenBg = bgId || 'default';
  const candidates = [
    `assets/backgrounds/${eventId}/${chosenBg}.jpg`,
    `assets/backgrounds/${eventId}/${chosenBg}.png`,
  ];

  if (chosenBg !== 'default') {
    candidates.push(`assets/backgrounds/${eventId}/default.jpg`);
    candidates.push(`assets/backgrounds/default/default.jpg`);
  } else if (eventId !== 'default') {
    candidates.push(`assets/backgrounds/default/default.jpg`);
  }

  return candidates;
}

/**
 * Builds candidate S3 keys for frame assets.
 * Supports {frameId}.png or fallback to default.png.
 */
export function buildFrameKeyCandidates(eventId: string, frameId?: string): string[] {
  const chosenFrame = frameId || 'default';
  const candidates = [
    `assets/frames/${eventId}/${chosenFrame}.png`,
  ];

  if (chosenFrame !== 'default') {
    candidates.push(`assets/frames/${eventId}/default.png`);
    candidates.push(`assets/frames/default/default.png`);
  } else if (eventId !== 'default') {
    candidates.push(`assets/frames/default/default.png`);
  }

  return candidates;
}

/**
 * Loads the background and frame buffers for a photobooth session with caching.
 */
export async function loadBackgroundAndFrame(
  bucket: string,
  selection: AssetSelection = {}
): Promise<{ backgroundBuffer: Buffer; frameBuffer: Buffer }> {
  const config = getConfig();
  const eventId = selection.eventId || config.defaultEventId || 'default';

  // Find and load background
  const bgCandidates = buildBackgroundKeyCandidates(eventId, selection.bgId);
  let backgroundBuffer: Buffer | null = null;
  let lastBgError: Error | null = null;

  for (const candidateKey of bgCandidates) {
    try {
      backgroundBuffer = await getAssetWithCache(bucket, candidateKey);
      break;
    } catch (err: any) {
      lastBgError = err;
    }
  }

  if (!backgroundBuffer) {
    throw new Error(
      `Failed to load background asset for event "${eventId}", bgId "${selection.bgId}". Tried: ${bgCandidates.join(', ')}. Details: ${lastBgError?.message}`
    );
  }

  // Find and load frame
  const frameCandidates = buildFrameKeyCandidates(eventId, selection.frameId);
  let frameBuffer: Buffer | null = null;
  let lastFrameError: Error | null = null;

  for (const candidateKey of frameCandidates) {
    try {
      frameBuffer = await getAssetWithCache(bucket, candidateKey);
      break;
    } catch (err: any) {
      lastFrameError = err;
    }
  }

  if (!frameBuffer) {
    throw new Error(
      `Failed to load frame asset for event "${eventId}", frameId "${selection.frameId}". Tried: ${frameCandidates.join(', ')}. Details: ${lastFrameError?.message}`
    );
  }

  return {
    backgroundBuffer,
    frameBuffer,
  };
}
