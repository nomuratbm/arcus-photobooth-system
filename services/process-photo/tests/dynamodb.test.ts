import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSessionRecord,
  updatePhotoStatus,
  resetDynamoDBClient,
} from '../src/dynamodb.js';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual = await vi.importActual<any>('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: vi.fn(),
    },
    GetCommand: vi.fn((args) => ({ ...args, _type: 'GetCommand' })),
    UpdateCommand: vi.fn((args) => ({ ...args, _type: 'UpdateCommand' })),
  };
});

describe('DynamoDB Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDynamoDBClient();
  });

  it('retrieves session record for photo ID', async () => {
    const mockRecord = {
      photoId: 'photo-123',
      connectionId: 'conn-abc',
      status: 'connected',
    };

    const mockSend = vi.fn().mockResolvedValue({ Item: mockRecord });
    (DynamoDBDocumentClient.from as any).mockReturnValue({ send: mockSend });

    const result = await getSessionRecord('my-table', 'photo-123');
    expect(result).toEqual(mockRecord);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'my-table',
        Key: { photoId: 'photo-123' },
      })
    );
  });

  it('returns null when record does not exist', async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    (DynamoDBDocumentClient.from as any).mockReturnValue({ send: mockSend });

    const result = await getSessionRecord('my-table', 'nonexistent');
    expect(result).toBeNull();
  });

  it('updates photo status to processing without error', async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    (DynamoDBDocumentClient.from as any).mockReturnValue({ send: mockSend });

    await updatePhotoStatus('my-table', 'photo-123', 'processing');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'my-table',
        Key: { photoId: 'photo-123' },
        UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt REMOVE #error',
      })
    );
  });

  it('updates photo status to error with error message', async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    (DynamoDBDocumentClient.from as any).mockReturnValue({ send: mockSend });

    await updatePhotoStatus('my-table', 'photo-123', 'error', 'Model timeout');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'my-table',
        Key: { photoId: 'photo-123' },
        UpdateExpression: 'SET #status = :status, #error = :error, #updatedAt = :updatedAt',
        ExpressionAttributeValues: expect.objectContaining({
          ':status': 'error',
          ':error': 'Model timeout',
        }),
      })
    );
  });
});
