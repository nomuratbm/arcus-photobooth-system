import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from '@aws-sdk/client-apigatewaymanagementapi';
import type { WebSocketMessage } from './types.js';

let wsClientInstance: ApiGatewayManagementApiClient | null = null;
let currentEndpoint: string | null = null;

export function getWebSocketClient(endpoint: string): ApiGatewayManagementApiClient {
  // Normalize endpoint: ensure it starts with https:// and remove trailing slash
  let normalizedEndpoint = endpoint.trim();
  if (normalizedEndpoint.startsWith('wss://')) {
    normalizedEndpoint = normalizedEndpoint.replace(/^wss:\/\//, 'https://');
  }

  if (!wsClientInstance || currentEndpoint !== normalizedEndpoint) {
    wsClientInstance = new ApiGatewayManagementApiClient({
      endpoint: normalizedEndpoint,
    });
    currentEndpoint = normalizedEndpoint;
  }
  return wsClientInstance;
}

export function resetWebSocketClient(): void {
  wsClientInstance = null;
  currentEndpoint = null;
}

/**
 * Sends a JSON notification to the kiosk via API Gateway WebSocket PostToConnection.
 *
 * CRITICAL REQUIREMENT:
 * If the connection is closed or gone (GoneException / 410), it is ignored gracefully
 * and returns false, without throwing an error.
 *
 * @param wsEndpoint - WebSocket API Management endpoint
 * @param connectionId - Target WebSocket connection ID
 * @param message - Message payload to deliver
 * @returns Promise<boolean> - true if sent successfully, false if client disconnected (Gone)
 */
export async function sendWebSocketNotification(
  wsEndpoint: string,
  connectionId: string,
  message: WebSocketMessage
): Promise<boolean> {
  if (!connectionId || !wsEndpoint) {
    return false;
  }

  const client = getWebSocketClient(wsEndpoint);
  const data = Buffer.from(JSON.stringify(message));

  const command = new PostToConnectionCommand({
    ConnectionId: connectionId,
    Data: data,
  });

  try {
    await client.send(command);
    return true;
  } catch (error: any) {
    const isGone =
      error instanceof GoneException ||
      error.name === 'GoneException' ||
      error.$metadata?.httpStatusCode === 410;

    if (isGone) {
      console.warn(
        `[WebSocket] Connection "${connectionId}" is gone (client disconnected). Safely ignoring.`
      );
      return false;
    }

    console.error(`[WebSocket] Failed to send message to connection "${connectionId}":`, error);
    throw error;
  }
}
