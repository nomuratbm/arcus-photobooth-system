import type { S3Event, Context } from 'aws-lambda';
import { getConfig } from './config.js';
import { parseRawPhotoKey, readPhotoFromS3, writeFinalPhotoToS3 } from './s3.js';
import { removeBackgroundWithBedrock } from './bedrock.js';
import { loadBackgroundAndFrame } from './assets.js';
import { compositePhoto } from './composite.js';
import { getSessionRecord, updatePhotoStatus } from './dynamodb.js';
import { sendWebSocketNotification } from './websocket.js';

/**
 * Main AWS Lambda handler triggered by S3 ObjectCreated events on "raw/".
 *
 * Workflow:
 * 1. Extract bucket and key from S3 event record
 * 2. Parse and validate key (must match raw/{photoId}.jpg; reject final/ to prevent loops)
 * 3. Fetch session state from DynamoDB (connectionId, eventId, bgId, frameId)
 * 4. Update status to 'processing'
 * 5. Download raw photo from S3
 * 6. Send photo to Bedrock for background removal -> returns transparent PNG cutout
 * 7. Fetch background and frame from assets/ (using warm memory cache)
 * 8. Composite in order: Background -> Cutout -> Frame using Sharp -> outputs JPEG
 * 9. Upload finished photo to final/{photoId}.jpg
 * 10. Update status to 'done' in DynamoDB
 * 11. Notify kiosk over WebSocket with { status: 'done', key: 'final/{photoId}.jpg' }
 * 12. If error occurs: update DynamoDB to 'error' and notify kiosk with { status: 'error', message }
 */
export async function handler(event: S3Event, context?: Context): Promise<void> {
  const config = getConfig();

  if (!event || !event.Records || !Array.isArray(event.Records)) {
    console.warn('[ProcessPhoto] Received empty or malformed event. Skipping.');
    return;
  }

  for (const record of event.Records) {
    const bucket = record.s3?.bucket?.name;
    const rawKey = record.s3?.object?.key;

    if (!bucket || !rawKey) {
      console.warn('[ProcessPhoto] Record missing bucket or key. Skipping:', record);
      continue;
    }

    // Step 1 & 2: Parse raw photo key & apply infinite loop safety filter
    const parsedKey = parseRawPhotoKey(rawKey);
    if (!parsedKey) {
      console.log(`[ProcessPhoto] Key "${rawKey}" is not a raw photo event. Skipping.`);
      continue;
    }

    const { photoId } = parsedKey;
    console.log(`[ProcessPhoto] Processing photoId: "${photoId}" from s3://${bucket}/${rawKey}`);

    let connectionId: string | undefined;

    try {
      // Step 3: Look up session record in DynamoDB
      const session = config.tableName
        ? await getSessionRecord(config.tableName, photoId)
        : null;

      connectionId = session?.connectionId;
      const eventId = session?.eventId || config.defaultEventId || 'default';
      const bgId = session?.bgId;
      const frameId = session?.frameId;

      // Step 4: Update status to 'processing' in DynamoDB
      if (config.tableName) {
        await updatePhotoStatus(config.tableName, photoId, 'processing');
      }

      // Step 5: Read raw photo from S3
      console.log(`[ProcessPhoto] Downloading raw photo: s3://${bucket}/${rawKey}`);
      const rawPhotoBuffer = await readPhotoFromS3(bucket, rawKey);

      // Step 6: Call Bedrock for background removal
      console.log(`[ProcessPhoto] Calling Bedrock model: ${config.bedrockModelId}`);
      const cutoutBuffer = await removeBackgroundWithBedrock(rawPhotoBuffer);
      console.log(`[ProcessPhoto] Cutout generated (${cutoutBuffer.length} bytes).`);

      // Step 7: Load background and frame assets with caching
      console.log(`[ProcessPhoto] Loading assets for event "${eventId}"...`);
      const { backgroundBuffer, frameBuffer } = await loadBackgroundAndFrame(bucket, {
        eventId,
        bgId,
        frameId,
      });

      // Step 8: Composite layers (Background -> Cutout -> Frame)
      console.log('[ProcessPhoto] Compositing with Sharp...');
      const finalJpegBuffer = await compositePhoto({
        backgroundBuffer,
        cutoutBuffer,
        frameBuffer,
      });

      // Step 9: Write final photo to S3
      console.log(`[ProcessPhoto] Uploading final photo: final/${photoId}.jpg`);
      const finalKey = await writeFinalPhotoToS3(bucket, photoId, finalJpegBuffer);

      // Step 10: Update status to 'done' in DynamoDB
      if (config.tableName) {
        await updatePhotoStatus(config.tableName, photoId, 'done');
      }

      // Step 11: Notify kiosk via WebSocket
      if (config.wsEndpoint && connectionId) {
        console.log(`[ProcessPhoto] Notifying kiosk (conn: ${connectionId})...`);
        await sendWebSocketNotification(config.wsEndpoint, connectionId, {
          status: 'done',
          key: finalKey,
        });
      }

      console.log(`[ProcessPhoto] Successfully processed photoId: "${photoId}"`);
    } catch (error: any) {
      console.error(`[ProcessPhoto] Error processing photoId "${photoId}":`, error);

      const errorMessage = error?.message || 'Internal photo processing failure';

      // Step 12: On error, record error status in DynamoDB and notify kiosk
      try {
        if (config.tableName) {
          await updatePhotoStatus(config.tableName, photoId, 'error', errorMessage);
        }
      } catch (dbError) {
        console.error('[ProcessPhoto] Failed to update error status in DynamoDB:', dbError);
      }

      try {
        if (config.wsEndpoint && connectionId) {
          await sendWebSocketNotification(config.wsEndpoint, connectionId, {
            status: 'error',
            message: errorMessage,
          });
        }
      } catch (wsError) {
        console.error('[ProcessPhoto] Failed to send error message to WebSocket:', wsError);
      }

      // Re-throw so AWS Lambda execution metrics / CloudWatch capture the error
      throw error;
    }
  }
}
