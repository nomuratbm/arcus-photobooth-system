import type { S3Event, Context } from 'aws-lambda';
import { getConfig } from './config.js';
import { parseRawPhotoKey, readPhotoFromS3, writeCutoutToS3, writeFinalPhotoToS3 } from './s3.js';
import { removeBackgroundWithBedrock } from './bedrock.js';
import { loadFrameOverlay, loadSlotBackgrounds, loadCutouts } from './assets.js';
import { compositeStrip } from './composite.js';
import { getSessionRecord, updatePhotoStatus, incrementShotCount } from './dynamodb.js';
import { sendWebSocketNotification } from './websocket.js';
import { SHOT_COUNT } from './frame-layout.js';
import type { SlotInput } from './types.js';

/**
 * Main AWS Lambda handler triggered by S3 ObjectCreated events on "raw/".
 *
 * Each guest session uploads SHOT_COUNT raw shots (raw/{sessionId}/{index}.jpg),
 * each of which triggers this handler:
 * 1. Extract bucket and key from S3 event record
 * 2. Parse and validate key (must match raw/{sessionId}/{index}.jpg; reject
 *    final/ and work/ to prevent loops)
 * 3. Fetch session state from DynamoDB (connectionId, eventId, frameId)
 * 4. Update status to 'processing'
 * 5. Download this shot's raw photo from S3
 * 6. Send it to Bedrock for background removal -> transparent PNG cutout
 * 7. Store the cutout at work/{sessionId}/{index}.png
 * 8. Atomically increment the session's shotsReceived counter
 * 9. If this invocation is the one that reaches SHOT_COUNT, finalize:
 *    a. Load all SHOT_COUNT cutouts from work/
 *    b. Pick a random curated background per slot
 *    c. Load the baked frame overlay
 *    d. Composite: subtle background + cutout per slot, frame overlay on top
 *    e. Upload the strip to final/{sessionId}.jpg
 *    f. Update status to 'done' and notify the kiosk over WebSocket
 * 10. If error occurs: update DynamoDB to 'error' and notify kiosk
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
      console.log(`[ProcessPhoto] Key "${rawKey}" is not a raw shot event. Skipping.`);
      continue;
    }

    const { sessionId, index } = parsedKey;
    console.log(
      `[ProcessPhoto] Processing shot ${index}/${SHOT_COUNT} for session "${sessionId}" from s3://${bucket}/${rawKey}`
    );

    let connectionId: string | undefined;

    try {
      // Step 3: Look up session record in DynamoDB
      const session = config.tableName
        ? await getSessionRecord(config.tableName, sessionId)
        : null;

      connectionId = session?.connectionId;
      const eventId = session?.eventId || config.defaultEventId || 'default';
      const frameId = session?.frameId;

      // Step 4: Update status to 'processing' in DynamoDB
      if (config.tableName) {
        await updatePhotoStatus(config.tableName, sessionId, 'processing');
      }

      // Step 5: Read this shot's raw photo from S3
      console.log(`[ProcessPhoto] Downloading raw shot: s3://${bucket}/${rawKey}`);
      const rawPhotoBuffer = await readPhotoFromS3(bucket, rawKey);

      // Step 6: Call Bedrock for background removal
      console.log(`[ProcessPhoto] Calling Bedrock model: ${config.bedrockModelId}`);
      const cutoutBuffer = await removeBackgroundWithBedrock(rawPhotoBuffer);
      console.log(`[ProcessPhoto] Cutout generated (${cutoutBuffer.length} bytes).`);

      // Step 7: Persist the cutout for the finalize step
      await writeCutoutToS3(bucket, sessionId, index, cutoutBuffer);

      // Step 8: Atomically claim a slot in the session's shot count
      const received = config.tableName
        ? await incrementShotCount(config.tableName, sessionId)
        : SHOT_COUNT; // No table (local dev): finalize on every invocation.

      if (received < SHOT_COUNT) {
        console.log(
          `[ProcessPhoto] Session "${sessionId}" has ${received}/${SHOT_COUNT} shots. Waiting for the rest.`
        );
        continue;
      }
      if (received > SHOT_COUNT) {
        console.log(
          `[ProcessPhoto] Session "${sessionId}" already finalized (count ${received}). Skipping.`
        );
        continue;
      }

      // Step 9: This invocation received the final shot -> finalize the strip.
      console.log(`[ProcessPhoto] All ${SHOT_COUNT} shots received. Finalizing session "${sessionId}".`);

      const [cutouts, backgrounds, overlayBuffer] = await Promise.all([
        loadCutouts(bucket, sessionId, SHOT_COUNT),
        loadSlotBackgrounds(bucket, eventId, SHOT_COUNT),
        loadFrameOverlay(bucket, { eventId, frameId }),
      ]);

      const slots: SlotInput[] = cutouts.map((cutout, i) => ({
        cutoutBuffer: cutout,
        backgroundBuffer: backgrounds[i],
      }));

      console.log('[ProcessPhoto] Compositing strip with Sharp...');
      const finalJpegBuffer = await compositeStrip(overlayBuffer, slots);

      console.log(`[ProcessPhoto] Uploading final strip: final/${sessionId}.jpg`);
      const finalKey = await writeFinalPhotoToS3(bucket, sessionId, finalJpegBuffer);

      if (config.tableName) {
        await updatePhotoStatus(config.tableName, sessionId, 'done');
      }

      if (config.wsEndpoint && connectionId) {
        console.log(`[ProcessPhoto] Notifying kiosk (conn: ${connectionId})...`);
        await sendWebSocketNotification(config.wsEndpoint, connectionId, {
          status: 'done',
          key: finalKey,
        });
      }

      console.log(`[ProcessPhoto] Successfully processed session: "${sessionId}"`);
    } catch (error: any) {
      console.error(`[ProcessPhoto] Error processing session "${sessionId}":`, error);

      const errorMessage = error?.message || 'Internal photo processing failure';

      try {
        if (config.tableName) {
          await updatePhotoStatus(config.tableName, sessionId, 'error', errorMessage);
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
