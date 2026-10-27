import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { S3Event } from 'aws-lambda';
import { handler } from '../src/index.js';
import * as s3Module from '../src/s3.js';
import * as bedrockModule from '../src/bedrock.js';
import * as assetsModule from '../src/assets.js';
import * as compositeModule from '../src/composite.js';
import * as dynamodbModule from '../src/dynamodb.js';
import * as websocketModule from '../src/websocket.js';

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
    writeFinalPhotoToS3: vi.fn(),
  };
});

vi.mock('../src/bedrock.js', () => ({
  removeBackgroundWithBedrock: vi.fn(),
}));

vi.mock('../src/assets.js', () => ({
  loadBackgroundAndFrame: vi.fn(),
}));

vi.mock('../src/composite.js', () => ({
  compositePhoto: vi.fn(),
}));

vi.mock('../src/dynamodb.js', () => ({
  getSessionRecord: vi.fn(),
  updatePhotoStatus: vi.fn(),
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

describe('Lambda Handler End-to-End Orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully orchestrates the entire photobooth pipeline', async () => {
    const photoId = 'test-session-123';
    const mockRawBuf = Buffer.from('raw-jpeg');
    const mockCutoutBuf = Buffer.from('cutout-png');
    const mockBgBuf = Buffer.from('bg-jpg');
    const mockFrameBuf = Buffer.from('frame-png');
    const mockFinalBuf = Buffer.from('final-jpg');

    vi.spyOn(dynamodbModule, 'getSessionRecord').mockResolvedValue({
      photoId,
      connectionId: 'conn-abc',
      status: 'connected',
      eventId: 'arcus-gala',
      bgId: 'bg-1',
      frameId: 'frame-1',
    });

    vi.spyOn(s3Module, 'readPhotoFromS3').mockResolvedValue(mockRawBuf);
    vi.spyOn(bedrockModule, 'removeBackgroundWithBedrock').mockResolvedValue(mockCutoutBuf);
    vi.spyOn(assetsModule, 'loadBackgroundAndFrame').mockResolvedValue({
      backgroundBuffer: mockBgBuf,
      frameBuffer: mockFrameBuf,
    });
    vi.spyOn(compositeModule, 'compositePhoto').mockResolvedValue(mockFinalBuf);
    vi.spyOn(s3Module, 'writeFinalPhotoToS3').mockResolvedValue(`final/${photoId}.jpg`);
    vi.spyOn(websocketModule, 'sendWebSocketNotification').mockResolvedValue(true);

    const event = createS3Event(`raw/${photoId}.jpg`);
    await handler(event);

    // 1. S3 read
    expect(s3Module.readPhotoFromS3).toHaveBeenCalledWith('test-bucket', `raw/${photoId}.jpg`);

    // 2. DynamoDB status: processing
    expect(dynamodbModule.updatePhotoStatus).toHaveBeenCalledWith('test-table', photoId, 'processing');

    // 3. Bedrock remove background
    expect(bedrockModule.removeBackgroundWithBedrock).toHaveBeenCalledWith(mockRawBuf);

    // 4. Asset loader
    expect(assetsModule.loadBackgroundAndFrame).toHaveBeenCalledWith('test-bucket', {
      eventId: 'arcus-gala',
      bgId: 'bg-1',
      frameId: 'frame-1',
    });

    // 5. Compositing
    expect(compositeModule.compositePhoto).toHaveBeenCalledWith({
      backgroundBuffer: mockBgBuf,
      cutoutBuffer: mockCutoutBuf,
      frameBuffer: mockFrameBuf,
    });

    // 6. Write final photo
    expect(s3Module.writeFinalPhotoToS3).toHaveBeenCalledWith('test-bucket', photoId, mockFinalBuf);

    // 7. DynamoDB status: done
    expect(dynamodbModule.updatePhotoStatus).toHaveBeenCalledWith('test-table', photoId, 'done');

    // 8. WebSocket notification
    expect(websocketModule.sendWebSocketNotification).toHaveBeenCalledWith(
      'https://test-ws.execute-api.ap-southeast-1.amazonaws.com/dev',
      'conn-abc',
      {
        status: 'done',
        key: `final/${photoId}.jpg`,
      }
    );
  });

  it('safely skips final/ keys to prevent infinite loops', async () => {
    const event = createS3Event('final/photo-abc.jpg');
    await handler(event);

    expect(s3Module.readPhotoFromS3).not.toHaveBeenCalled();
    expect(bedrockModule.removeBackgroundWithBedrock).not.toHaveBeenCalled();
    expect(s3Module.writeFinalPhotoToS3).not.toHaveBeenCalled();
  });

  it('handles pipeline errors, updates DynamoDB, and notifies kiosk of error', async () => {
    const photoId = 'error-session-999';

    vi.spyOn(dynamodbModule, 'getSessionRecord').mockResolvedValue({
      photoId,
      connectionId: 'conn-err',
      status: 'connected',
    });

    vi.spyOn(s3Module, 'readPhotoFromS3').mockResolvedValue(Buffer.from('bad-raw'));
    vi.spyOn(bedrockModule, 'removeBackgroundWithBedrock').mockRejectedValue(
      new Error('Bedrock quota exceeded')
    );

    const event = createS3Event(`raw/${photoId}.jpg`);

    await expect(handler(event)).rejects.toThrow('Bedrock quota exceeded');

    // Updates DynamoDB with error
    expect(dynamodbModule.updatePhotoStatus).toHaveBeenCalledWith(
      'test-table',
      photoId,
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
