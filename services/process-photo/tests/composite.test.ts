import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { compositePhoto } from '../src/composite.js';

async function createTestAssets() {
  // Background: 800x600 blue rectangle
  const backgroundBuffer = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 30, g: 144, b: 255 },
    },
  })
    .jpeg()
    .toBuffer();

  // Cutout: 400x400 transparent PNG with a red circle
  const svgCutout = `
    <svg width="400" height="400" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <circle cx="200" cy="200" r="150" fill="#ff4500" />
    </svg>
  `;
  const cutoutBuffer = await sharp(Buffer.from(svgCutout)).png().toBuffer();

  // Frame: 800x600 transparent PNG with yellow border
  const svgFrame = `
    <svg width="800" height="600" viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="20" width="760" height="560" fill="none" stroke="#ffd700" stroke-width="40" />
    </svg>
  `;
  const frameBuffer = await sharp(Buffer.from(svgFrame)).png().toBuffer();

  return { backgroundBuffer, cutoutBuffer, frameBuffer };
}

describe('compositePhoto', () => {
  it('composites background, cutout, and frame into a valid JPEG', async () => {
    const assets = await createTestAssets();
    const resultBuffer = await compositePhoto(assets);

    expect(resultBuffer).toBeInstanceOf(Buffer);
    expect(resultBuffer.length).toBeGreaterThan(0);

    const metadata = await sharp(resultBuffer).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(600);
  });

  it('respects custom target canvas dimensions', async () => {
    const assets = await createTestAssets();
    const resultBuffer = await compositePhoto(assets, {
      dimensions: { width: 1200, height: 900 },
      quality: 85,
    });

    const metadata = await sharp(resultBuffer).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(900);
  });

  it('rejects with error if background buffer is invalid', async () => {
    const assets = await createTestAssets();
    assets.backgroundBuffer = Buffer.from('invalid-buffer');

    await expect(compositePhoto(assets)).rejects.toThrow();
  });
});
