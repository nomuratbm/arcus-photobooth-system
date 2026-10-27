import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getAssetWithCache,
  clearAssetCache,
  getAssetCacheSize,
  loadBackgroundAndFrame,
  buildBackgroundKeyCandidates,
  buildFrameKeyCandidates,
} from '../src/assets.js';
import * as s3Module from '../src/s3.js';

vi.mock('../src/s3.js', () => ({
  readPhotoFromS3: vi.fn(),
}));

describe('Asset Caching & Loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAssetCache();
  });

  it('builds candidate keys with fallbacks', () => {
    const bgCandidates = buildBackgroundKeyCandidates('event-1', 'beach');
    expect(bgCandidates).toContain('assets/backgrounds/event-1/beach.jpg');
    expect(bgCandidates).toContain('assets/backgrounds/event-1/default.jpg');

    const frameCandidates = buildFrameKeyCandidates('event-1', 'gold');
    expect(frameCandidates).toContain('assets/frames/event-1/gold.png');
    expect(frameCandidates).toContain('assets/frames/event-1/default.png');
  });

  it('fetches from S3 on cache miss and uses cache on subsequent calls', async () => {
    const mockBuffer = Buffer.from('mock-asset-data');
    vi.spyOn(s3Module, 'readPhotoFromS3').mockResolvedValue(mockBuffer);

    expect(getAssetCacheSize()).toBe(0);

    // Call 1: Cache miss
    const res1 = await getAssetWithCache('bucket-a', 'assets/bg.jpg');
    expect(res1).toBe(mockBuffer);
    expect(s3Module.readPhotoFromS3).toHaveBeenCalledTimes(1);
    expect(getAssetCacheSize()).toBe(1);

    // Call 2: Cache hit
    const res2 = await getAssetWithCache('bucket-a', 'assets/bg.jpg');
    expect(res2).toBe(mockBuffer);
    expect(s3Module.readPhotoFromS3).toHaveBeenCalledTimes(1); // Still 1!
  });

  it('clears cache properly', async () => {
    const mockBuffer = Buffer.from('mock-asset');
    vi.spyOn(s3Module, 'readPhotoFromS3').mockResolvedValue(mockBuffer);

    await getAssetWithCache('bucket-a', 'assets/bg.jpg');
    expect(getAssetCacheSize()).toBe(1);

    clearAssetCache();
    expect(getAssetCacheSize()).toBe(0);
  });

  it('successfully loads background and frame together', async () => {
    const mockBg = Buffer.from('bg-data');
    const mockFrame = Buffer.from('frame-data');

    vi.spyOn(s3Module, 'readPhotoFromS3').mockImplementation(async (_bucket, key) => {
      if (key.includes('backgrounds')) return mockBg;
      if (key.includes('frames')) return mockFrame;
      throw new Error('Not found');
    });

    const result = await loadBackgroundAndFrame('my-bucket', {
      eventId: 'arcus-2026',
      bgId: 'stage',
      frameId: 'sponsor-border',
    });

    expect(result.backgroundBuffer).toBe(mockBg);
    expect(result.frameBuffer).toBe(mockFrame);
  });

  it('throws descriptive error if background cannot be found', async () => {
    vi.spyOn(s3Module, 'readPhotoFromS3').mockRejectedValue(new Error('NoSuchKey'));

    await expect(
      loadBackgroundAndFrame('my-bucket', {
        eventId: 'arcus-2026',
        bgId: 'nonexistent',
      })
    ).rejects.toThrow(/Failed to load background asset/);
  });
});
