import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendWebSocketNotification,
  resetWebSocketClient,
} from '../src/websocket.js';
import {
  ApiGatewayManagementApiClient,
  GoneException,
} from '@aws-sdk/client-apigatewaymanagementapi';

vi.mock('@aws-sdk/client-apigatewaymanagementapi', async () => {
  const actual = await vi.importActual<any>('@aws-sdk/client-apigatewaymanagementapi');
  return {
    ...actual,
    ApiGatewayManagementApiClient: vi.fn(),
    PostToConnectionCommand: vi.fn((args) => ({ ...args, _type: 'PostToConnectionCommand' })),
  };
});

describe('WebSocket Notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWebSocketClient();
  });

  it('sends message to connection successfully', async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    (ApiGatewayManagementApiClient as any).mockImplementation(() => ({
      send: mockSend,
    }));

    const success = await sendWebSocketNotification(
      'https://api.example.com/dev',
      'conn-123',
      { status: 'done', key: 'final/photo-abc.jpg' }
    );

    expect(success).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        ConnectionId: 'conn-123',
      })
    );
  });

  it('gracefully handles GoneException (410) and returns false', async () => {
    const goneError = new Error('Client disconnected') as any;
    goneError.name = 'GoneException';
    goneError.$metadata = { httpStatusCode: 410 };

    const mockSend = vi.fn().mockRejectedValue(goneError);
    (ApiGatewayManagementApiClient as any).mockImplementation(() => ({
      send: mockSend,
    }));

    const success = await sendWebSocketNotification(
      'https://api.example.com/dev',
      'conn-gone',
      { status: 'done', key: 'final/photo-abc.jpg' }
    );

    expect(success).toBe(false);
  });

  it('rethrows unexpected network or server errors', async () => {
    const internalError = new Error('InternalServerError');
    const mockSend = vi.fn().mockRejectedValue(internalError);
    (ApiGatewayManagementApiClient as any).mockImplementation(() => ({
      send: mockSend,
    }));

    await expect(
      sendWebSocketNotification('https://api.example.com/dev', 'conn-123', {
        status: 'error',
        message: 'Something went wrong',
      })
    ).rejects.toThrow('InternalServerError');
  });

  it('returns false immediately if connectionId or endpoint is empty', async () => {
    const res = await sendWebSocketNotification('', '', { status: 'done', key: 'final/a.jpg' });
    expect(res).toBe(false);
  });
});
