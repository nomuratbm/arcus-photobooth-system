import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getAssetWithCache,
  clearAssetCache,
  getAssetCacheSize,
  loadFrameOverlay,
  buildFrameKeyCandidates,
  chooseBackgroundKeys,
} from '../src/assets.js';
import * as s3Module from '../src/s3.js';

vi.mock('../src/s3.js', () => ({
  readPhotoFromS3: vi.fn(),
  getS3Client: vi.fn(),
  buildCutoutKey: (sessionId: string, index: number) => `work/${sessionId}/${index}.png`,
}));

describe('Asset Caching & Loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAssetCache();
  });

  it('builds frame overlay candidate keys with fallbacks', () => {
    const frameCandidates = buildFrameKeyCandidates('event-1', 'gold');
    expect(frameCandidates).toContain('assets/frames/event-1/gold.png');
    expect(frameCandidates).toContain('assets/frames/event-1/default.png');

    const defaultCandidates = buildFrameKeyCandidates('curated');
    expect(defaultCandidates).toContain('assets/frames/curated/default.png');
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

  it('successfully loads the frame overlay', async () => {
    const mockFrame = Buffer.from('frame-data');
    vi.spyOn(s3Module, 'readPhotoFromS3').mockResolvedValue(mockFrame);

    const result = await loadFrameOverlay('my-bucket', {
      eventId: 'curated',
      frameId: 'default',
    });

    expect(result).toBe(mockFrame);
    expect(s3Module.readPhotoFromS3).toHaveBeenCalledWith(
      'my-bucket',
      'assets/frames/curated/default.png'
    );
  });

  it('throws descriptive error if the frame overlay cannot be found', async () => {
    vi.spyOn(s3Module, 'readPhotoFromS3').mockRejectedValue(new Error('NoSuchKey'));

    await expect(
      loadFrameOverlay('my-bucket', { eventId: 'curated', frameId: 'nonexistent' })
    ).rejects.toThrow(/Failed to load frame overlay/);
  });

  it('chooses distinct background keys up to the available pool', () => {
    const keys = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'];
    const chosen = chooseBackgroundKeys(keys, 3);
    expect(chosen).toHaveLength(3);
    expect(new Set(chosen).size).toBe(3);
    for (const key of chosen) expect(keys).toContain(key);
  });

  it('repeats backgrounds when fewer exist than requested', () => {
    const keys = ['only.jpg'];
    const chosen = chooseBackgroundKeys(keys, 3);
    expect(chosen).toHaveLength(3);
    expect(chosen.every((key) => key === 'only.jpg')).toBe(true);
  });
});
