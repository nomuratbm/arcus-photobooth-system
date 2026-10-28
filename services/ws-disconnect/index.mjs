import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

let docClient;

function getDocClient(inject) {
  if (inject) return inject;
  if (!docClient) {
    docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return docClient;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 150;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryByConnection(client, tableName, indexName, connectionId) {
  const items = [];
  let lastKey;

  do {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: indexName,
        KeyConditionExpression: "connectionId = :cid",
        ExpressionAttributeValues: { ":cid": connectionId },
        ExclusiveStartKey: lastKey,
      })
    );

    if (result.Items) {
      items.push(...result.Items);
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

export async function handler(event, context, { ddbClient, sleepFn } = {}) {
  const tableName = process.env.TABLE_NAME;
  const indexName = process.env.CONNECTION_INDEX_NAME;

  if (!tableName || !indexName) {
    const missing = [];
    if (!tableName) missing.push("TABLE_NAME");
    if (!indexName) missing.push("CONNECTION_INDEX_NAME");
    console.error(JSON.stringify({ event: "config_missing", missing }));
    return { statusCode: 500 };
  }

  const connectionId =
    event &&
    event.requestContext &&
    event.requestContext.connectionId;

  if (!connectionId || typeof connectionId !== "string") {
    return { statusCode: 200 };
  }

  const client = getDocClient(ddbClient);
  const wait = sleepFn || sleep;

  let items = [];
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    items = await queryByConnection(client, tableName, indexName, connectionId);
    if (items.length > 0) break;
    if (attempt < MAX_RETRIES) {
      await wait(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  if (items.length === 0) {
    console.error(JSON.stringify({ event: "no_mapping_found", connectionId: connectionId.substring(0, 8) }));
    return { statusCode: 200 };
  }

  const errors = [];

  for (const item of items) {
    if (!item.photoId) continue;
    try {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { photoId: item.photoId },
          UpdateExpression: "REMOVE connectionId",
          ConditionExpression:
            "attribute_exists(photoId) AND connectionId = :cid",
          ExpressionAttributeValues: { ":cid": connectionId },
        })
      );
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        continue;
      }
      errors.push({ photoId: item.photoId, error: err.name });
    }
  }

  if (errors.length > 0) {
    console.error(JSON.stringify({ event: "cleanup_errors", count: errors.length }));
    return { statusCode: 500 };
  }

  return { statusCode: 200 };
}
