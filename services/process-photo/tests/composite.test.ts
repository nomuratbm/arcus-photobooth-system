import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { compositeStrip } from '../src/composite.js';
import { FRAME_LAYOUT, SHOT_COUNT } from '../src/frame-layout.js';

async function createTestSlots() {
  // Background: blue rectangle (will be muted by the subtle treatment)
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

  // Cutout: transparent PNG with a red circle
  const svgCutout = `
    <svg width="400" height="400" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
      <circle cx="200" cy="200" r="150" fill="#ff4500" />
    </svg>
  `;
  const cutoutBuffer = await sharp(Buffer.from(svgCutout)).png().toBuffer();

  return Array.from({ length: SHOT_COUNT }, () => ({
    backgroundBuffer,
    cutoutBuffer,
  }));
}

async function createTestOverlay() {
  // Frame overlay: transparent canvas with a yellow border, matching layout size
  const { width, height } = FRAME_LAYOUT;
  const svgFrame = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="20" width="${width - 40}" height="${height - 40}" fill="none" stroke="#ffd700" stroke-width="40" />
    </svg>
  `;
  return sharp(Buffer.from(svgFrame)).png().toBuffer();
}

describe('compositeStrip', () => {
  it('composites slots and overlay into a valid JPEG at layout size', async () => {
    const slots = await createTestSlots();
    const overlay = await createTestOverlay();

    const resultBuffer = await compositeStrip(overlay, slots);

    expect(resultBuffer).toBeInstanceOf(Buffer);
    expect(resultBuffer.length).toBeGreaterThan(0);

    const metadata = await sharp(resultBuffer).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(FRAME_LAYOUT.width);
    expect(metadata.height).toBe(FRAME_LAYOUT.height);
  });

  it('rejects when the number of slots does not match the layout', async () => {
    const slots = await createTestSlots();
    const overlay = await createTestOverlay();

    await expect(compositeStrip(overlay, slots.slice(0, 1))).rejects.toThrow(
      /Expected \d+ slot inputs/
    );
  });

  it('rejects with error if a background buffer is invalid', async () => {
    const slots = await createTestSlots();
    slots[0].backgroundBuffer = Buffer.from('invalid-buffer');
    const overlay = await createTestOverlay();

    await expect(compositeStrip(overlay, slots)).rejects.toThrow();
  });
});
