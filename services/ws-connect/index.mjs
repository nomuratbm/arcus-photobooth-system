import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { validatePhotoId } from "./validate-photo-id.mjs";

let docClient;

function getDocClient(inject) {
  if (inject) return inject;
  if (!docClient) {
    docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return docClient;
}

function extractPhotoId(event) {
  if (!event) return null;

  const qs = event.queryStringParameters;
  const mvqs = event.multiValueQueryStringParameters;

  let candidate = null;

  if (mvqs && mvqs.photoId !== undefined) {
    if (!Array.isArray(mvqs.photoId) || mvqs.photoId.length !== 1) {
      return null;
    }
    const val = mvqs.photoId[0];
    if (typeof val !== "string") {
      return null;
    }
    candidate = val;
  }

  if (qs && qs.photoId !== undefined) {
    if (typeof qs.photoId !== "string") {
      return null;
    }
    if (candidate !== null && candidate !== qs.photoId) {
      return null;
    }
    if (candidate === null) {
      candidate = qs.photoId;
    }
  }

  return candidate;
}

export async function handler(event, context, { ddbClient, now } = {}) {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    return { statusCode: 500 };
  }

  const connectionId =
    event &&
    event.requestContext &&
    event.requestContext.connectionId;

  if (!connectionId || typeof connectionId !== "string") {
    return { statusCode: 400 };
  }

  const rawPhotoId = extractPhotoId(event);
  if (!rawPhotoId) {
    return { statusCode: 400 };
  }

  const photoId = validatePhotoId(rawPhotoId);
  if (!photoId) {
    return { statusCode: 400 };
  }

  const currentTime = now ? now() : Date.now();
  const ttlValue = Math.floor(currentTime / 1000) + 3600;
  const nowEpoch = Math.floor(currentTime / 1000);

  const client = getDocClient(ddbClient);

  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { photoId },
        UpdateExpression:
          "SET connectionId = :cid, #ttl = :ttl, #st = if_not_exists(#st, :initial_status)",
        ConditionExpression:
          "attribute_not_exists(photoId) OR #ttl >= :now_epoch",
        ExpressionAttributeNames: {
          "#ttl": "ttl",
          "#st": "status",
        },
        ExpressionAttributeValues: {
          ":cid": connectionId,
          ":ttl": ttlValue,
          ":initial_status": "connected",
          ":now_epoch": nowEpoch,
        },
      })
    );
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      return { statusCode: 409 };
    }
    throw err;
  }

  return { statusCode: 200 };
}
