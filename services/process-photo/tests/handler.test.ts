import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { S3Event } from 'aws-lambda';
import { handler } from '../src/index.js';
import * as s3Module from '../src/s3.js';
import * as bedrockModule from '../src/bedrock.js';
import * as assetsModule from '../src/assets.js';
import * as compositeModule from '../src/composite.js';
import * as dynamodbModule from '../src/dynamodb.js';
import * as websocketModule from '../src/websocket.js';
import { SHOT_COUNT } from '../src/frame-layout.js';

vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    bucketName: 'test-bucket',
    tableName: 'test-table',
    wsEndpoint: 'https://test-ws.execute-api.ap-southeast-1.amazonaws.com/dev',
    bedrockRegion: 'us-east-1',
    bedrockModelId: 'us.stability.stable-image-remove-background-v1:0',
    defaultEventId: 'default',
  }),
}));

vi.mock('../src/s3.js', async () => {
  const actual = await vi.importActual<any>('../src/s3.js');
  return {
    ...actual,
    readPhotoFromS3: vi.fn(),
    writeCutoutToS3: vi.fn(),
    writeFinalPhotoToS3: vi.fn(),
  };
});

vi.mock('../src/bedrock.js', () => ({
  removeBackgroundWithBedrock: vi.fn(),
}));

vi.mock('../src/assets.js', () => ({
  loadFrameOverlay: vi.fn(),
  loadSlotBackgrounds: vi.fn(),
  loadCutouts: vi.fn(),
}));

vi.mock('../src/composite.js', () => ({
  compositeStrip: vi.fn(),
}));

vi.mock('../src/dynamodb.js', () => ({
  getSessionRecord: vi.fn(),
  updatePhotoStatus: vi.fn(),
  incrementShotCount: vi.fn(),
}));

vi.mock('../src/websocket.js', () => ({
  sendWebSocketNotification: vi.fn(),
}));

function createS3Event(key: string, bucket = 'test-bucket'): S3Event {
  return {
    Records: [
      {
        eventVersion: '2.1',
        eventSource: 'aws:s3',
        awsRegion: 'ap-southeast-1',
        eventTime: new Date().toISOString(),
        eventName: 'ObjectCreated:Put',
        userIdentity: { principalId: 'AWS' },
        requestParameters: { sourceIPAddress: '127.0.0.1' },
        responseElements: { 'x-amz-request-id': 'req', 'x-amz-id-2': 'req2' },
        s3: {
          s3SchemaVersion: '1.0',
          configurationId: 'conf',
          bucket: {
            name: bucket,
            ownerIdentity: { principalId: 'owner' },
            arn: `arn:aws:s3:::${bucket}`,
          },
          object: {
            key,
            size: 1024,
            eTag: 'etag',
            sequencer: '1',
          },
        },
      },
    ],
  };
}

describe('Lambda Handler 3-Shot Aggregate Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finalizes the strip when the last shot arrives', async () => {
    const sessionId = 'test-session-123';
    const mockRawBuf = Buffer.from('raw-jpeg');
    const mockCutoutBuf = Buffer.from('cutout-png');
    const mockBgBuf = Buffer.from('bg-jpg');
    const mockOverlayBuf = Buffer.from('overlay-png');
    const mockFinalBuf = Buffer.from('final-jpg');
    const cutouts = Array.from({ length: SHOT_COUNT }, () => mockCutoutBuf);
    const backgrounds = Array.from({ length: SHOT_COUNT }, () => mockBgBuf);

    vi.spyOn(dynamodbModule, 'getSessionRecord').mockResolvedValue({
      photoId: sessionId,
      connectionId: 'conn-abc',
      status: 'connected',
      eventId: 'curated',
      frameId: 'default',
    });
    vi.spyOn(dynamodbModule, 'incrementShotCount').mockResolvedValue(SHOT_COUNT);

    vi.spyOn(s3Module, 'readPhotoFromS3').mockResolvedValue(mockRawBuf);
    vi.spyOn(bedrockModule, 'removeBackgroundWithBedrock').mockResolvedValue(mockCutoutBuf);
    vi.spyOn(s3Module, 'writeCutoutToS3').mockResolvedValue(`work/${sessionId}/3.png`);
    vi.spyOn(assetsModule, 'loadCutouts').mockResolvedValue(cutouts);
    vi.spyOn(assetsModule, 'loadSlotBackgrounds').mockResolvedValue(backgrounds);
    vi.spyOn(assetsModule, 'loadFrameOverlay').mockResolvedValue(mockOverlayBuf);
    vi.spyOn(compositeModule, 'compositeStrip').mockResolvedValue(mockFinalBuf);
    vi.spyOn(s3Module, 'writeFinalPhotoToS3').mockResolvedValue(`final/${sessionId}.jpg`);
    vi.spyOn(websocketModule, 'sendWebSocketNotification').mockResolvedValue(true);

    const event = createS3Event(`raw/${sessionId}/3.jpg`);
    await handler(event);

    // 1. S3 read of this shot
    expect(s3Module.readPhotoFromS3).toHaveBeenCalledWith('test-bucket', `raw/${sessionId}/3.jpg`);

    // 2. DynamoDB status: processing
    expect(dynamodbModule.updatePhotoStatus).toHaveBeenCalledWith('test-table', sessionId, 'processing');

    // 3. Bedrock remove background for this shot
    expect(bedrockModule.removeBackgroundWithBedrock).toHaveBeenCalledWith(mockRawBuf);

    // 4. Cutout persisted to work/
    expect(s3Module.writeCutoutToS3).toHaveBeenCalledWith('test-bucket', sessionId, 3, mockCutoutBuf);

    // 5. Counter incremented
    expect(dynamodbModule.incrementShotCount).toHaveBeenCalledWith('test-table', sessionId);

    // 6. Finalize: load cutouts, backgrounds, overlay
    expect(assetsModule.loadCutouts).toHaveBeenCalledWith('test-bucket', sessionId, SHOT_COUNT);
    expect(assetsModule.loadSlotBackgrounds).toHaveBeenCalledWith('test-bucket', 'curated', SHOT_COUNT);
    expect(assetsModule.loadFrameOverlay).toHaveBeenCalledWith('test-bucket', {
      eventId: 'curated',
      frameId: 'default',
    });

    // 7. Compositing with one slot per shot
    expect(compositeModule.compositeStrip).toHaveBeenCalledWith(
      mockOverlayBuf,
      expect.arrayContaining([
        expect.objectContaining({ cutoutBuffer: mockCutoutBuf, backgroundBuffer: mockBgBuf }),
      ])
    );

    // 8. Write final strip
    expect(s3Module.writeFinalPhotoToS3).toHaveBeenCalledWith('test-bucket', sessionId, mockFinalBuf);

    // 9. DynamoDB status: done
    expect(dynamodbModule.updatePhotoStatus).toHaveBeenCalledWith('test-table', sessionId, 'done');

    // 10. WebSocket notification
    expect(websocketModule.sendWebSocketNotification).toHaveBeenCalledWith(
      'https://test-ws.execute-api.ap-southeast-1.amazonaws.com/dev',
      'conn-abc',
      { status: 'done', key: `final/${sessionId}.jpg` }
    );
  });

  it('waits (does not finalize) while fewer than SHOT_COUNT shots have arrived', async () => {
    const sessionId = 'partial-session-1';

    vi.spyOn(dynamodbModule, 'getSessionRecord').mockResolvedValue({
      photoId: sessionId,
      connectionId: 'conn-abc',
      status: 'connected',
    });
    vi.spyOn(dynamodbModule, 'incrementShotCount').mockResolvedValue(1);
    vi.spyOn(s3Module, 'readPhotoFromS3').mockResolvedValue(Buffer.from('raw-jpeg'));
    vi.spyOn(bedrockModule, 'removeBackgroundWithBedrock').mockResolvedValue(Buffer.from('cutout'));
    vi.spyOn(s3Module, 'writeCutoutToS3').mockResolvedValue(`work/${sessionId}/1.png`);

    const event = createS3Event(`raw/${sessionId}/1.jpg`);
    await handler(event);

    expect(s3Module.writeCutoutToS3).toHaveBeenCalled();
    expect(compositeModule.compositeStrip).not.toHaveBeenCalled();
    expect(s3Module.writeFinalPhotoToS3).not.toHaveBeenCalled();
    expect(websocketModule.sendWebSocketNotification).not.toHaveBeenCalled();
  });

  it('safely skips final/ and work/ keys to prevent infinite loops', async () => {
    await handler(createS3Event('final/session-abc.jpg'));
    await handler(createS3Event('work/session-abc/1.png'));

    expect(s3Module.readPhotoFromS3).not.toHaveBeenCalled();
    expect(bedrockModule.removeBackgroundWithBedrock).not.toHaveBeenCalled();
    expect(s3Module.writeFinalPhotoToS3).not.toHaveBeenCalled();
  });

  it('handles pipeline errors, updates DynamoDB, and notifies kiosk of error', async () => {
    const sessionId = 'error-session-999';

    vi.spyOn(dynamodbModule, 'getSessionRecord').mockResolvedValue({
      photoId: sessionId,
      connectionId: 'conn-err',
      status: 'connected',
    });

    vi.spyOn(s3Module, 'readPhotoFromS3').mockResolvedValue(Buffer.from('bad-raw'));
    vi.spyOn(bedrockModule, 'removeBackgroundWithBedrock').mockRejectedValue(
      new Error('Bedrock quota exceeded')
    );

    const event = createS3Event(`raw/${sessionId}/1.jpg`);

    await expect(handler(event)).rejects.toThrow('Bedrock quota exceeded');

    // Updates DynamoDB with error
    expect(dynamodbModule.updatePhotoStatus).toHaveBeenCalledWith(
      'test-table',
      sessionId,
      'error',
      'Bedrock quota exceeded'
    );

    // Sends error notification over WebSocket
    expect(websocketModule.sendWebSocketNotification).toHaveBeenCalledWith(
      'https://test-ws.execute-api.ap-southeast-1.amazonaws.com/dev',
      'conn-err',
      {
        status: 'error',
        message: 'Bedrock quota exceeded',
      }
    );
  });
});
