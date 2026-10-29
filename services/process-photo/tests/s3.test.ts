import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseRawPhotoKey,
  buildFinalPhotoKey,
  buildCutoutKey,
  readPhotoFromS3,
  writeFinalPhotoToS3,
  resetS3Client,
} from '../src/s3.js';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<any>('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: vi.fn(),
    GetObjectCommand: vi.fn((args) => ({ ...args, _type: 'GetObjectCommand' })),
    PutObjectCommand: vi.fn((args) => ({ ...args, _type: 'PutObjectCommand' })),
  };
});

describe('S3 Key Utilities', () => {
  it('parses valid raw shot key', () => {
    const res = parseRawPhotoKey('raw/session-uuid-123/2.jpg');
    expect(res).toEqual({ sessionId: 'session-uuid-123', index: 2 });
  });

  it('handles urlencoded raw shot key', () => {
    const res = parseRawPhotoKey('raw/session%20with+spaces/1.jpg');
    expect(res).toEqual({ sessionId: 'session with spaces', index: 1 });
  });

  it('rejects keys from final/ and work/ (safety prevention of recursive Lambda loops)', () => {
    expect(parseRawPhotoKey('final/session-uuid-123.jpg')).toBeNull();
    expect(parseRawPhotoKey('work/session-uuid-123/1.png')).toBeNull();
  });

  it('rejects keys outside raw/{sessionId}/{index} pattern', () => {
    expect(parseRawPhotoKey('assets/frames/default/frame1.png')).toBeNull();
    expect(parseRawPhotoKey('raw/')).toBeNull();
    expect(parseRawPhotoKey('raw/session.jpg')).toBeNull();
    expect(parseRawPhotoKey('raw/session/0.jpg')).toBeNull();
    expect(parseRawPhotoKey('raw/session/abc.jpg')).toBeNull();
    expect(parseRawPhotoKey('some-other-prefix/photo.jpg')).toBeNull();
  });

  it('builds final photo key correctly', () => {
    expect(buildFinalPhotoKey('session-123')).toBe('final/session-123.jpg');
  });

  it('builds cutout key correctly', () => {
    expect(buildCutoutKey('session-123', 3)).toBe('work/session-123/3.png');
  });
});

describe('S3 Read & Write Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetS3Client();
  });

  it('reads photo buffer from S3', async () => {
    const mockBytes = new Uint8Array([1, 2, 3, 4]);
    const mockSend = vi.fn().mockResolvedValue({
      Body: {
        transformToByteArray: vi.fn().mockResolvedValue(mockBytes),
      },
    });

    (S3Client as any).mockImplementation(() => ({
      send: mockSend,
    }));

    const result = await readPhotoFromS3('my-bucket', 'raw/photo.jpg');
    expect(Buffer.compare(result, Buffer.from(mockBytes))).toBe(0);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'my-bucket',
        Key: 'raw/photo.jpg',
      })
    );
  });

  it('writes final photo to S3 with ContentType image/jpeg', async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    (S3Client as any).mockImplementation(() => ({
      send: mockSend,
    }));

    const imageBuffer = Buffer.from([10, 20, 30]);
    const finalKey = await writeFinalPhotoToS3('my-bucket', 'photo-789', imageBuffer);

    expect(finalKey).toBe('final/photo-789.jpg');
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'my-bucket',
        Key: 'final/photo-789.jpg',
        Body: imageBuffer,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=86400',
      })
    );
  });
});
