import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  AccessDeniedException,
  ValidationException,
  ThrottlingException,
  ResourceNotFoundException,
} from '@aws-sdk/client-bedrock-runtime';
import { getConfig } from './config.js';

let bedrockClientInstance: BedrockRuntimeClient | null = null;

export function getBedrockClient(region?: string): BedrockRuntimeClient {
  const targetRegion = region || getConfig().bedrockRegion;
  if (!bedrockClientInstance) {
    bedrockClientInstance = new BedrockRuntimeClient({ region: targetRegion });
  }
  return bedrockClientInstance;
}

export function resetBedrockClient(): void {
  bedrockClientInstance = null;
}

interface StabilityRemoveBackgroundResponse {
  images?: string[];
  artifacts?: Array<{ base64?: string }>;
  image?: string;
  finish_reasons?: string[];
}

/**
 * Invokes Amazon Bedrock Stability AI Remove Background model to produce a transparent PNG cutout.
 *
 * @param photoBuffer - Input image (JPEG or PNG) as Buffer
 * @param customModelId - Optional override for model ID / inference profile ID
 * @returns Promise<Buffer> - Resulting transparent cutout as PNG Buffer
 */
export async function removeBackgroundWithBedrock(
  photoBuffer: Buffer,
  customModelId?: string
): Promise<Buffer> {
  const config = getConfig();
  const modelId = customModelId || config.bedrockModelId;
  const client = getBedrockClient();

  const payload = {
    image: photoBuffer.toString('base64'),
    output_format: 'png',
  };

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  });

  try {
    const response = await client.send(command);

    if (!response.body) {
      throw new Error('Bedrock returned an empty response body.');
    }

    const decoded = new TextDecoder('utf-8').decode(response.body);
    const parsed = JSON.parse(decoded) as StabilityRemoveBackgroundResponse;

    let base64Output: string | undefined;

    if (parsed.images && parsed.images.length > 0) {
      base64Output = parsed.images[0];
    } else if (parsed.artifacts && parsed.artifacts.length > 0 && parsed.artifacts[0].base64) {
      base64Output = parsed.artifacts[0].base64;
    } else if (parsed.image) {
      base64Output = parsed.image;
    }

    if (!base64Output) {
      throw new Error(`Bedrock response did not contain an image cutout. Keys returned: ${Object.keys(parsed).join(', ')}`);
    }

    return Buffer.from(base64Output, 'base64');
  } catch (error: any) {
    if (error instanceof AccessDeniedException) {
      throw new Error(
        `Bedrock AccessDeniedException: User/role lacks bedrock:InvokeModel permissions for model "${modelId}" in region "${config.bedrockRegion}".`
      );
    }
    if (error instanceof ResourceNotFoundException) {
      throw new Error(
        `Bedrock ResourceNotFoundException: Model or inference profile "${modelId}" was not found in region "${config.bedrockRegion}".`
      );
    }
    if (error instanceof ValidationException) {
      throw new Error(
        `Bedrock ValidationException: Invalid request parameters or input image for model "${modelId}". Details: ${error.message}`
      );
    }
    if (error instanceof ThrottlingException) {
      throw new Error(
        `Bedrock ThrottlingException: Request was throttled by AWS Bedrock for model "${modelId}". Details: ${error.message}`
      );
    }
    throw error;
  }
}
