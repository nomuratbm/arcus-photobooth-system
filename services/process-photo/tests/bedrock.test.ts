import { describe, it, expect, vi, beforeEach } from 'vitest';
import { removeBackgroundWithBedrock, resetBedrockClient } from '../src/bedrock.js';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

vi.mock('@aws-sdk/client-bedrock-runtime', async () => {
  const actual = await vi.importActual<any>('@aws-sdk/client-bedrock-runtime');
  return {
    ...actual,
    BedrockRuntimeClient: vi.fn(),
    InvokeModelCommand: vi.fn(),
  };
});

describe('removeBackgroundWithBedrock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBedrockClient();
  });

  it('successfully extracts cutout from parsed images array', async () => {
    const mockOutputPngBase64 = Buffer.from('mock-transparent-png').toString('base64');
    const mockResponseBody = JSON.stringify({
      images: [mockOutputPngBase64],
    });

    const mockSend = vi.fn().mockResolvedValue({
      body: new TextEncoder().encode(mockResponseBody),
    });

    (BedrockRuntimeClient as any).mockImplementation(() => ({
      send: mockSend,
    }));

    const inputJpg = Buffer.from('mock-input-jpg');
    const result = await removeBackgroundWithBedrock(inputJpg);

    expect(result.toString('base64')).toBe(mockOutputPngBase64);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('extracts cutout from legacy artifacts array if images array is absent', async () => {
    const mockOutputPngBase64 = Buffer.from('mock-artifact-png').toString('base64');
    const mockResponseBody = JSON.stringify({
      artifacts: [{ base64: mockOutputPngBase64 }],
    });

    const mockSend = vi.fn().mockResolvedValue({
      body: new TextEncoder().encode(mockResponseBody),
    });

    (BedrockRuntimeClient as any).mockImplementation(() => ({
      send: mockSend,
    }));

    const inputJpg = Buffer.from('mock-input-jpg');
    const result = await removeBackgroundWithBedrock(inputJpg);

    expect(result.toString('base64')).toBe(mockOutputPngBase64);
  });

  it('throws an informative error if response has no image payload', async () => {
    const mockResponseBody = JSON.stringify({ unexpected: 'payload' });
    const mockSend = vi.fn().mockResolvedValue({
      body: new TextEncoder().encode(mockResponseBody),
    });

    (BedrockRuntimeClient as any).mockImplementation(() => ({
      send: mockSend,
    }));

    const inputJpg = Buffer.from('mock-input-jpg');
    await expect(removeBackgroundWithBedrock(inputJpg)).rejects.toThrow(
      /Bedrock response did not contain an image cutout/
    );
  });
});
