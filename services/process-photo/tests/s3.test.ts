import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseRawPhotoKey,
  buildFinalPhotoKey,
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
  it('parses valid raw photo key', () => {
    const res = parseRawPhotoKey('raw/photo-uuid-123.jpg');
    expect(res).toEqual({ photoId: 'photo-uuid-123' });
  });

  it('handles urlencoded raw photo key', () => {
    const res = parseRawPhotoKey('raw/photo%20with+spaces.jpg');
    expect(res).toEqual({ photoId: 'photo with spaces' });
  });

  it('rejects keys from final/ (safety prevention of recursive Lambda loops)', () => {
    expect(parseRawPhotoKey('final/photo-uuid-123.jpg')).toBeNull();
  });

  it('rejects keys outside raw/ directory', () => {
    expect(parseRawPhotoKey('assets/frames/default/frame1.png')).toBeNull();
    expect(parseRawPhotoKey('raw/')).toBeNull();
    expect(parseRawPhotoKey('raw/.jpg')).toBeNull();
    expect(parseRawPhotoKey('some-other-prefix/photo.jpg')).toBeNull();
  });

  it('builds final photo key correctly', () => {
    expect(buildFinalPhotoKey('photo-123')).toBe('final/photo-123.jpg');
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
