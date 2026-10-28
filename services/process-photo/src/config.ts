import dotenv from 'dotenv';
import type { ServiceConfig } from './types.js';

// Load local .env if present (useful in local dev / test runs)
dotenv.config();

export function getConfig(): ServiceConfig {
  const bucketName = process.env.BUCKET_NAME || '';
  const tableName = process.env.TABLE_NAME || '';
  const wsEndpoint = process.env.WS_ENDPOINT || '';
  const bedrockRegion = process.env.BEDROCK_REGION || 'us-east-1';
  const bedrockModelId = process.env.BEDROCK_MODEL_ID || 'us.stability.stable-image-remove-background-v1:0';
  const defaultEventId = process.env.DEFAULT_EVENT_ID || 'default';

  return {
    bucketName,
    tableName,
    wsEndpoint,
    bedrockRegion,
    bedrockModelId,
    defaultEventId,
  };
}

export function validateRequiredConfig(keys: Array<keyof ServiceConfig>): void {
  const current = getConfig();
  const missing: string[] = [];

  for (const key of keys) {
    if (!current[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment configuration: ${missing.join(', ')}`);
  }
}
