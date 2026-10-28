import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { PhotoSessionRecord, PhotoStatus } from './types.js';

let ddbDocClientInstance: DynamoDBDocumentClient | null = null;

export function getDynamoDBDocumentClient(): DynamoDBDocumentClient {
  if (!ddbDocClientInstance) {
    const rawClient = new DynamoDBClient({});
    ddbDocClientInstance = DynamoDBDocumentClient.from(rawClient, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return ddbDocClientInstance;
}

export function resetDynamoDBClient(): void {
  ddbDocClientInstance = null;
}

/**
 * Retrieves the session record for a given photo ID from DynamoDB.
 */
export async function getSessionRecord(
  tableName: string,
  photoId: string
): Promise<PhotoSessionRecord | null> {
  const ddb = getDynamoDBDocumentClient();
  const command = new GetCommand({
    TableName: tableName,
    Key: { photoId },
  });

  const response = await ddb.send(command);
  return (response.Item as PhotoSessionRecord) || null;
}

/**
 * Updates the photo session status (and optional error message) in DynamoDB.
 */
export async function updatePhotoStatus(
  tableName: string,
  photoId: string,
  status: PhotoStatus,
  error?: string
): Promise<void> {
  const ddb = getDynamoDBDocumentClient();
  const now = Date.now();

  const command = new UpdateCommand({
    TableName: tableName,
    Key: { photoId },
    UpdateExpression: error
      ? 'SET #status = :status, #error = :error, #updatedAt = :updatedAt'
      : 'SET #status = :status, #updatedAt = :updatedAt REMOVE #error',
    ExpressionAttributeNames: error
      ? {
          '#status': 'status',
          '#error': 'error',
          '#updatedAt': 'updatedAt',
        }
      : {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
          '#error': 'error',
        },
    ExpressionAttributeValues: error
      ? {
          ':status': status,
          ':error': error,
          ':updatedAt': now,
        }
      : {
          ':status': status,
          ':updatedAt': now,
        },
  });

  await ddb.send(command);
}
